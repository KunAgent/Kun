import { describe, expect, it, vi } from 'vitest'
import { McpCapabilityConfig, type McpServerConfig } from '../../contracts/capabilities.js'
import {
  KUN_MANAGED_GITHUB_MCP_AUTHORIZATION,
  KUN_MANAGED_GITHUB_MCP_MARKER,
  KUN_MANAGED_GITHUB_MCP_TOOLSETS,
  KUN_MANAGED_GITHUB_MCP_URL
} from '../../contracts/builtin-mcp.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import {
  buildMcpToolProviders,
  McpAuthorizationRequiredError,
  type McpClientLifecycleHandlers,
  type McpClientLike,
  type McpToolDescriptor
} from './mcp-tool-provider.js'

class MockMcpClient implements McpClientLike {
  lifecycle: McpClientLifecycleHandlers = {}
  close = vi.fn(async () => undefined)
  listResources?: McpClientLike['listResources']
  readResource?: McpClientLike['readResource']
  listResourceTemplates?: McpClientLike['listResourceTemplates']
  listPrompts?: McpClientLike['listPrompts']
  getPrompt?: McpClientLike['getPrompt']
  listTools = vi.fn(async (): Promise<{ tools: McpToolDescriptor[] }> => {
    if (this.listToolsOverride) return this.listToolsOverride()
    return { tools: this.tools }
  })

  constructor(
    private readonly tools: McpToolDescriptor[],
    readonly callTool: McpClientLike['callTool'],
    extras: Partial<Pick<McpClientLike, 'listResources' | 'readResource' | 'listResourceTemplates' | 'listPrompts' | 'getPrompt'>> = {},
    private readonly listToolsOverride?: () => Promise<{ tools: McpToolDescriptor[] }>
  ) {
    Object.assign(this, extras)
  }

  setLifecycleHandlers(handlers: McpClientLifecycleHandlers): void {
    this.lifecycle = handlers
  }
}

const server: McpServerConfig = {
  enabled: true,
  transport: 'streamable-http',
  url: 'http://127.0.0.1:39999/mcp',
  headers: {},
  args: [],
  env: {},
  workspaceRoots: [],
  trustScope: 'user',
  trustedWorkspaceRoots: [],
  timeoutMs: 1_000
}

const config = McpCapabilityConfig.parse({
  enabled: true,
  servers: { docs: server },
  search: { enabled: false }
})

const searchConfig = McpCapabilityConfig.parse({
  enabled: true,
  servers: { docs: server },
  search: { enabled: true, mode: 'search', topKDefault: 5, topKMax: 10, minScore: 0.15 }
})

const context: ToolHostContext = {
  threadId: 'thread_test',
  turnId: 'turn_test',
  workspace: '/workspace',
  approvalPolicy: 'auto',
  abortSignal: new AbortController().signal,
  awaitApproval: vi.fn()
}

const descriptor: McpToolDescriptor = {
  name: 'lookup',
  description: 'Lookup docs',
  inputSchema: { type: 'object', properties: {} },
  annotations: { readOnlyHint: true }
}

const descriptors = (count: number, prefix: string): McpToolDescriptor[] =>
  Array.from({ length: count }, (_, index) => ({
    name: `${prefix}${index}`,
    description: `${prefix} tool ${index}`,
    inputSchema: { type: 'object', properties: {} }
  }))

const autoSearchConfig = (autoThresholdToolCount: number) =>
  McpCapabilityConfig.parse({
    enabled: true,
    servers: {
      a: server,
      b: { ...server, url: 'http://127.0.0.1:39998/mcp' }
    },
    search: {
      enabled: true,
      mode: 'auto',
      autoThresholdToolCount,
      topKDefault: 5,
      topKMax: 10,
      minScore: 0.15
    }
  })

describe('mcp tool provider reliability', () => {
  it('uses only host configuration, not remote read-only annotations, for Plan access', async () => {
    const client = new MockMcpClient([descriptor], vi.fn(async () => ({ ok: true })))
    const untrustedHint = await buildMcpToolProviders(config, {
      clientFactory: vi.fn(async () => client)
    })
    const hintedTool = untrustedHint.providers
      .flatMap((provider) => provider.tools)
      .find((tool) => tool.name === 'mcp_docs_lookup')
    expect(hintedTool?.sideEffect).toBeUndefined()

    const hostConfigured = McpCapabilityConfig.parse({
      enabled: true,
      servers: { docs: { ...server, planModeReadOnlyTools: ['lookup'] } },
      search: { enabled: false }
    })
    const configured = await buildMcpToolProviders(hostConfigured, {
      clientFactory: vi.fn(async () => new MockMcpClient([descriptor], vi.fn(async () => ({ ok: true }))))
    })
    const configuredTool = configured.providers
      .flatMap((provider) => provider.tools)
      .find((tool) => tool.name === 'mcp_docs_lookup')
    expect(configuredTool?.sideEffect).toBe('read-only')
  })

  it('gates the search-mode read-only call gateway with host configuration', async () => {
    const callTool = vi.fn(async () => ({ rows: [{ id: 1 }] }))
    const configured = McpCapabilityConfig.parse({
      enabled: true,
      servers: { docs: { ...server, planModeReadOnlyTools: ['lookup'] } },
      search: { enabled: true, mode: 'search', topKDefault: 5, topKMax: 10, minScore: 0.15 }
    })
    const built = await buildMcpToolProviders(configured, {
      clientFactory: vi.fn(async () => new MockMcpClient([descriptor], callTool))
    })
    const gateway = built.providers
      .flatMap((provider) => provider.tools)
      .find((tool) => tool.name === 'mcp_read_only_call')

    expect(gateway?.sideEffect).toBe('read-only')
    await expect(gateway!.execute({ toolId: 'mcp_docs_lookup', arguments: {} }, context))
      .resolves.toMatchObject({ output: { result: { rows: [{ id: 1 }] } } })
    expect(callTool).toHaveBeenCalledTimes(1)

    const unconfigured = await buildMcpToolProviders(searchConfig, {
      clientFactory: vi.fn(async () => new MockMcpClient([descriptor], callTool))
    })
    const blockedGateway = unconfigured.providers
      .flatMap((provider) => provider.tools)
      .find((tool) => tool.name === 'mcp_read_only_call')
    await expect(blockedGateway!.execute({ toolId: 'mcp_docs_lookup', arguments: {} }, context))
      .resolves.toMatchObject({ isError: true, output: { error: expect.stringContaining('not host-approved') } })
    expect(callTool).toHaveBeenCalledTimes(1)
  })

  it('does not replay concurrent MCP calls based on server read-only annotations', async () => {
    const first = new MockMcpClient([descriptor], vi.fn(async () => {
      throw new Error('socket connection reset')
    }))
    const second = new MockMcpClient([descriptor], vi.fn(async () => ({ ok: true })))
    const clientFactory = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)

    const built = await buildMcpToolProviders(config, {
      clientFactory,
      nowIso: () => '2026-06-29T00:00:00.000Z'
    })
    expect(built.diagnostics[0]?.toolNames).toEqual(['lookup'])
    const tool = built.providers[0]?.tools.find((item) => item.name === 'mcp_call')
    expect(tool).toBeTruthy()

    const settled = await Promise.allSettled([
      tool!.execute({ toolId: 'mcp_docs_lookup', arguments: {} }, context),
      tool!.execute({ toolId: 'mcp_docs_lookup', arguments: {} }, context)
    ])

    expect(clientFactory).toHaveBeenCalledTimes(2)
    expect(first.close).toHaveBeenCalledTimes(1)
    expect(second.callTool).not.toHaveBeenCalled()
    expect(settled.every((result) => result.status === 'rejected')).toBe(true)
    expect(settled.find((result) => result.status === 'rejected')).toMatchObject({
      reason: expect.objectContaining({ statusUnknown: true })
    })
    await vi.waitFor(() => {
      expect(built.diagnostics[0]).toMatchObject({
        id: 'docs',
        status: 'connected',
        available: true,
        reconnectAttempts: 1
      })
    })
  })

  it('marks lifecycle transport close as offline and reconnects on the next call', async () => {
    const first = new MockMcpClient([descriptor], vi.fn(async () => ({ stale: true })))
    const second = new MockMcpClient([descriptor], vi.fn(async () => ({ fresh: true })))
    const clientFactory = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)

    const built = await buildMcpToolProviders(config, { clientFactory })
    first.lifecycle.onClose?.()
    expect(built.diagnostics[0]).toMatchObject({
      status: 'error',
      available: false,
      lastError: 'MCP transport closed'
    })

    const tool = built.providers[0]!.tools.find((item) => item.name === 'mcp_call')!
    const result = await tool.execute({ toolId: 'mcp_docs_lookup', arguments: {} }, context)

    expect(result).toMatchObject({ output: { result: { fresh: true } } })
    expect(clientFactory).toHaveBeenCalledTimes(2)
    expect(built.diagnostics[0]).toMatchObject({
      status: 'connected',
      available: true,
      reconnectAttempts: 1
    })
  })

  it('publishes the negotiated protocol diagnostics and replaces them after reconnect', async () => {
    const first = new MockMcpClient([descriptor], vi.fn(async () => ({ stale: true })))
    Object.assign(first, {
      protocolEra: 'legacy',
      protocolVersion: '2025-11-25',
      serverInfo: { name: 'fixture', version: '1.0.0' },
      serverCapabilities: { tools: {} }
    })
    const second = new MockMcpClient([descriptor], vi.fn(async () => ({ fresh: true })))
    Object.assign(second, {
      protocolEra: 'modern',
      protocolVersion: '2026-07-28',
      serverInfo: { name: 'fixture', version: '2.0.0' },
      serverCapabilities: { tools: {}, resources: {} }
    })
    const built = await buildMcpToolProviders(config, {
      clientFactory: vi.fn()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second)
    })
    expect(built.diagnostics[0]).toMatchObject({
      protocolEra: 'legacy',
      protocolVersion: '2025-11-25',
      serverInfo: { version: '1.0.0' }
    })

    first.lifecycle.onClose?.()
    const tool = built.providers[0]!.tools.find((item) => item.name === 'mcp_call')!
    await tool.execute({ toolId: 'mcp_docs_lookup', arguments: {} }, context)
    expect(built.diagnostics[0]).toMatchObject({
      protocolEra: 'modern',
      protocolVersion: '2026-07-28',
      serverInfo: { version: '2.0.0' },
      serverCapabilities: { resources: {} }
    })
  })

  it('does not mark deterministic tool errors as offline', async () => {
    const client = new MockMcpClient([descriptor], vi.fn(async () => {
      throw new Error('Invalid arguments: query is required')
    }))
    const built = await buildMcpToolProviders(config, {
      clientFactory: vi.fn(async () => client)
    })
    const tool = built.providers[0]!.tools.find((item) => item.name === 'mcp_call')!

    await expect(tool.execute({ toolId: 'mcp_docs_lookup', arguments: {} }, context)).rejects.toThrow('Invalid arguments')

    expect(built.diagnostics[0]).toMatchObject({
      status: 'connected',
      available: true,
      lastError: 'Invalid arguments: query is required'
    })
  })

  it('always registers the facade provider and hides facade tools without capable servers', async () => {
    const client = new MockMcpClient([descriptor], vi.fn(async () => ({ ok: true })))
    const built = await buildMcpToolProviders(config, {
      clientFactory: vi.fn(async () => client)
    })

    expect(built.providers.map((provider) => provider.id)).toContain('mcp:facade')
    const facade = built.providers.find((provider) => provider.id === 'mcp:facade')
    expect(facade?.tools.map((tool) => tool.name)).toEqual([
      'mcp_list_resources',
      'mcp_read_resource',
      'mcp_list_resource_templates',
      'mcp_list_prompts',
      'mcp_get_prompt'
    ])
    expect(facade?.tools.every((tool) => tool.shouldAdvertise?.(context) === false)).toBe(true)
  })

  it('never exposes managed GitHub through the unscoped resource and prompt facade', async () => {
    const listResources = vi.fn(async () => ({ resources: [{ uri: 'github://private' }] }))
    const client = new MockMcpClient([descriptor], vi.fn(async () => ({ ok: true })), { listResources })
    const githubServer = McpCapabilityConfig.parse({
      enabled: true,
      servers: { github: {
        enabled: true, managedBy: KUN_MANAGED_GITHUB_MCP_MARKER,
        transport: 'streamable-http', url: KUN_MANAGED_GITHUB_MCP_URL,
        headers: { Authorization: KUN_MANAGED_GITHUB_MCP_AUTHORIZATION,
          'X-MCP-Toolsets': KUN_MANAGED_GITHUB_MCP_TOOLSETS, 'X-MCP-Readonly': 'true' },
        trustScope: 'user', planModeReadOnlyTools: ['lookup'],
        githubPolicy: { host: 'github.com', allowedHosts: ['github.com'],
          allowedOrganizations: ['acme'], allowedRepositories: [],
          authorization: { source: 'github-cli', host: 'github.com', login: 'octocat',
            scopes: ['repo'], fingerprint: 'a'.repeat(64) } }
      } }, search: { enabled: false }
    })
    const built = await buildMcpToolProviders(githubServer, {
      clientFactory: vi.fn(async () => client)
    })
    const facade = built.providers.find((provider) => provider.id === 'mcp:facade')
    const tool = facade?.tools.find((candidate) => candidate.name === 'mcp_list_resources')
    expect(tool?.shouldAdvertise?.(context)).toBe(false)
    await expect(tool?.execute({}, context)).resolves.toMatchObject({ isError: true })
    expect(listResources).not.toHaveBeenCalled()
  })

  it('uses search plus facade providers without direct per-server MCP providers in search mode', async () => {
    const client = new MockMcpClient(
      [descriptor],
      vi.fn(async () => ({ ok: true })),
      {
        listResources: vi.fn(async () => ({ resources: [{ uri: 'file:///docs/readme.md' }] }))
      }
    )
    const built = await buildMcpToolProviders(searchConfig, {
      clientFactory: vi.fn(async () => client)
    })

    expect(built.providers.map((provider) => provider.id)).toEqual(['mcp:search', 'mcp:facade'])
    const facade = built.providers.find((provider) => provider.id === 'mcp:facade')
    expect(facade?.tools.find((tool) => tool.name === 'mcp_list_resources')?.shouldAdvertise?.(context)).toBe(true)
  })

  it('updates facade availability after OAuth authorization without a runtime restart', async () => {
    const authorizedClient = new MockMcpClient(
      [descriptor],
      vi.fn(async () => ({ ok: true })),
      {
        listResources: vi.fn(async () => ({ resources: [{ uri: 'file:///docs/spec.md' }] }))
      }
    )
    const clientFactory = vi.fn()
      .mockRejectedValueOnce(new McpAuthorizationRequiredError('docs'))
      .mockResolvedValueOnce(authorizedClient)
    const authorize = vi.fn(async () => ({
      serverId: 'docs',
      status: 'authorized' as const,
      authorized: true
    }))

    const built = await buildMcpToolProviders(searchConfig, {
      clientFactory,
      authorize,
      oauthStorageDir: 'C:/tmp/oauth'
    })
    const facade = built.providers.find((provider) => provider.id === 'mcp:facade')
    const listResourcesTool = facade?.tools.find((tool) => tool.name === 'mcp_list_resources')

    expect(listResourcesTool?.shouldAdvertise?.(context)).toBe(false)
    await expect(built.authorizeOAuth('docs')).resolves.toMatchObject({ authorized: true })
    expect(listResourcesTool?.shouldAdvertise?.(context)).toBe(true)
  })

  it('updates facade availability after background reconnect succeeds', async () => {
    const reconnectedClient = new MockMcpClient(
      [descriptor],
      vi.fn(async () => ({ ok: true })),
      {
        listPrompts: vi.fn(async () => ({ prompts: [{ name: 'summarize' }] }))
      }
    )
    const clientFactory = vi.fn()
      .mockRejectedValueOnce(new Error('startup timeout'))
      .mockResolvedValueOnce(reconnectedClient)

    const built = await buildMcpToolProviders(searchConfig, {
      clientFactory,
      delay: async () => undefined
    })
    const facade = built.providers.find((provider) => provider.id === 'mcp:facade')
    const listPromptsTool = facade?.tools.find((tool) => tool.name === 'mcp_list_prompts')

    expect(listPromptsTool?.shouldAdvertise?.(context)).toBe(false)
    await built.startBackgroundReconnect({ register: () => undefined, unregister: () => undefined })
    expect(listPromptsTool?.shouldAdvertise?.(context)).toBe(true)
  })

  it('fails facade execution closed when the workspace cannot use the server', async () => {
    const restrictedServer = {
      ...server,
      workspaceRoots: ['/allowed']
    } satisfies McpServerConfig
    const client = new MockMcpClient(
      [descriptor],
      vi.fn(async () => ({ ok: true })),
      {
        listResources: vi.fn(async () => ({ resources: [{ uri: 'file:///docs/spec.md' }] }))
      }
    )
    const built = await buildMcpToolProviders(McpCapabilityConfig.parse({
      enabled: true,
      servers: { docs: restrictedServer },
      search: { enabled: false }
    }), {
      clientFactory: vi.fn(async () => client)
    })
    const facade = built.providers.find((provider) => provider.id === 'mcp:facade')
    const tool = facade?.tools.find((item) => item.name === 'mcp_list_resources')

    expect(tool?.shouldAdvertise?.(context)).toBe(false)
    await expect(tool?.execute({}, context)).resolves.toMatchObject({
      output: { error: 'No connected MCP server can use listResources in this workspace.' },
      isError: true
    })
  })

  it('atomically swaps direct providers to search mode when a late reconnect crosses the auto threshold', async () => {
    const clientFactory = vi.fn()
      .mockResolvedValueOnce(new MockMcpClient(descriptors(1, 'a'), vi.fn(async () => ({ ok: true }))))
      .mockRejectedValueOnce(new Error('startup timeout'))
      .mockResolvedValueOnce(new MockMcpClient(descriptors(5, 'b'), vi.fn(async () => ({ ok: true }))))

    const built = await buildMcpToolProviders(autoSearchConfig(3), {
      clientFactory,
      delay: async () => undefined
    })

    expect(built.providers.map((provider) => provider.id)).toContain('mcp:a')

    const registered: string[] = []
    const unregistered: string[] = []
    await built.startBackgroundReconnect({
      register: (provider) => registered.push(provider.id),
      unregister: (providerId) => unregistered.push(providerId)
    })

    expect(unregistered).toContain('mcp:a')
    expect(unregistered).not.toContain('mcp:b')
    expect(registered).toEqual([])
    expect(built.search.indexedToolCount).toBe(6)
    expect(built.search.active).toBe(true)
  })

  it('atomically swaps to search mode when OAuth authorization crosses the auto threshold', async () => {
    const clientFactory = vi.fn()
      .mockResolvedValueOnce(new MockMcpClient(descriptors(1, 'a'), vi.fn(async () => ({ ok: true }))))
      .mockRejectedValueOnce(new McpAuthorizationRequiredError('b'))
      .mockResolvedValueOnce(new MockMcpClient(descriptors(5, 'b'), vi.fn(async () => ({ ok: true }))))
    const authorize = vi.fn(async () => ({ serverId: 'b', status: 'authorized' as const, authorized: true }))

    const built = await buildMcpToolProviders(autoSearchConfig(3), {
      clientFactory,
      authorize,
      oauthStorageDir: 'C:/tmp/oauth'
    })

    expect(built.providers.map((provider) => provider.id)).toContain('mcp:a')

    const registered: string[] = []
    const unregistered: string[] = []
    await built.startBackgroundReconnect({
      register: (provider) => registered.push(provider.id),
      unregister: (providerId) => unregistered.push(providerId)
    })

    await built.authorizeOAuth('b')

    expect(unregistered).toContain('mcp:a')
    expect(registered).toEqual([])
    expect(built.search.indexedToolCount).toBe(6)
    expect(built.search.active).toBe(true)
  })

  it('does not register direct providers for a late server when already in search mode', async () => {
    const clientFactory = vi.fn()
      .mockResolvedValueOnce(new MockMcpClient(descriptors(5, 'a'), vi.fn(async () => ({ ok: true }))))
      .mockRejectedValueOnce(new Error('startup timeout'))
      .mockResolvedValueOnce(new MockMcpClient(descriptors(3, 'b'), vi.fn(async () => ({ ok: true }))))

    const built = await buildMcpToolProviders(autoSearchConfig(3), {
      clientFactory,
      delay: async () => undefined
    })

    expect(built.providers.map((provider) => provider.id)).toEqual(['mcp:search', 'mcp:facade'])

    const registered: string[] = []
    const unregistered: string[] = []
    await built.startBackgroundReconnect({
      register: (provider) => registered.push(provider.id),
      unregister: (providerId) => unregistered.push(providerId)
    })

    expect(registered).toEqual([])
    expect(unregistered).toEqual([])
    expect(built.search.indexedToolCount).toBe(8)
    expect(built.search.active).toBe(true)
  })

  it('still registers a direct provider for a late server when below the auto threshold', async () => {
    const clientFactory = vi.fn()
      .mockResolvedValueOnce(new MockMcpClient(descriptors(1, 'a'), vi.fn(async () => ({ ok: true }))))
      .mockRejectedValueOnce(new Error('startup timeout'))
      .mockResolvedValueOnce(new MockMcpClient(descriptors(1, 'b'), vi.fn(async () => ({ ok: true }))))

    const built = await buildMcpToolProviders(autoSearchConfig(3), {
      clientFactory,
      delay: async () => undefined
    })

    expect(built.providers.map((provider) => provider.id)).toContain('mcp:a')

    const registered: string[] = []
    const unregistered: string[] = []
    await built.startBackgroundReconnect({
      register: (provider) => registered.push(provider.id),
      unregister: (providerId) => unregistered.push(providerId)
    })

    expect(registered).toContain('mcp:b')
    expect(unregistered).toEqual([])
    expect(built.search.active).toBe(false)
    expect(built.search.indexedToolCount).toBe(2)
  })

  it('closes the client when startup catalog loading fails', async () => {
    const client = new MockMcpClient([], vi.fn(), {}, async () => {
      throw new Error('list tools failed')
    })
    const built = await buildMcpToolProviders(config, {
      clientFactory: vi.fn(async () => client)
    })

    expect(client.close).toHaveBeenCalledTimes(1)
    expect(built.connectedServers).toBe(0)
    expect(built.toolCount).toBe(0)
    expect(built.providers.some((provider) => provider.id === 'mcp:docs')).toBe(false)
    expect(built.diagnostics[0]).toMatchObject({
      id: 'docs',
      status: 'error',
      available: false,
      lastError: 'list tools failed'
    })
  })

  it('closes every failed retry client during background reconnect', async () => {
    const firstRetry = new MockMcpClient([], vi.fn(), {}, async () => {
      throw new Error('list failed 1')
    })
    const secondRetry = new MockMcpClient([], vi.fn(), {}, async () => {
      throw new Error('list failed 2')
    })
    const clientFactory = vi.fn()
      .mockRejectedValueOnce(new Error('startup timeout'))
      .mockResolvedValueOnce(firstRetry)
      .mockResolvedValueOnce(secondRetry)

    const built = await buildMcpToolProviders(config, {
      clientFactory,
      delay: async () => undefined,
      backgroundReconnect: { maxAttempts: 2 }
    })
    await built.startBackgroundReconnect({ register: () => undefined, unregister: () => undefined })

    expect(clientFactory).toHaveBeenCalledTimes(3)
    expect(firstRetry.close).toHaveBeenCalledTimes(1)
    expect(secondRetry.close).toHaveBeenCalledTimes(1)
    expect(built.connectedServers).toBe(0)
    expect(built.providers.some((provider) => provider.id === 'mcp:docs')).toBe(false)
  })

  it('closes the replacement client when runtime reconnect catalog loading fails', async () => {
    const first = new MockMcpClient([descriptor], vi.fn(async () => ({ stale: true })))
    const failing = new MockMcpClient([], vi.fn(), {}, async () => {
      throw new Error('list tools failed')
    })
    const clientFactory = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(failing)

    const built = await buildMcpToolProviders(config, { clientFactory })
    expect(built.diagnostics[0]).toMatchObject({ status: 'connected' })

    first.lifecycle.onClose?.()
    expect(built.diagnostics[0]).toMatchObject({ status: 'error', lastError: 'MCP transport closed' })

    const tool = built.providers[0]!.tools.find((item) => item.name === 'mcp_call')!
    await expect(tool.execute({ toolId: 'mcp_docs_lookup', arguments: {} }, context)).rejects.toThrow('list tools failed')

    expect(failing.close).toHaveBeenCalledTimes(1)
    expect(first.close).toHaveBeenCalledTimes(1)
    expect(clientFactory).toHaveBeenCalledTimes(2)
    expect(built.diagnostics[0]).toMatchObject({
      status: 'error',
      available: false,
      lastError: 'list tools failed'
    })
    expect(built.diagnostics[0].nextReconnectAt).toBeDefined()
  })

  it('closes the client when OAuth live connect catalog loading fails', async () => {
    const failing = new MockMcpClient([], vi.fn(), {}, async () => {
      throw new Error('list tools failed')
    })
    const clientFactory = vi.fn()
      .mockRejectedValueOnce(new McpAuthorizationRequiredError('docs'))
      .mockResolvedValueOnce(failing)
    const authorize = vi.fn(async () => ({
      serverId: 'docs',
      status: 'authorized' as const,
      authorized: true
    }))

    const built = await buildMcpToolProviders(searchConfig, {
      clientFactory,
      authorize,
      oauthStorageDir: 'C:/tmp/oauth'
    })

    const result = await built.authorizeOAuth('docs')
    expect(result).toMatchObject({ authorized: true })
    expect(failing.close).toHaveBeenCalledTimes(1)
    expect(built.connectedServers).toBe(0)
    expect(built.toolCount).toBe(0)
    expect(built.providers.some((provider) => provider.id === 'mcp:docs')).toBe(false)
  })

  it('closes a late-success client that loses the startup timeout race', async () => {
    let resolveFactory: (client: MockMcpClient) => void = () => undefined
    const gate = new Promise<MockMcpClient>((resolve) => {
      resolveFactory = resolve
    })
    const lateClient = new MockMcpClient([descriptor], vi.fn(async () => ({ ok: true })))
    const clientFactory = vi.fn(() => gate)

    const built = await buildMcpToolProviders(config, {
      clientFactory,
      startupConnectTimeoutMs: 10
    })

    expect(built.diagnostics[0]).toMatchObject({ id: 'docs', status: 'error' })
    expect(lateClient.close).not.toHaveBeenCalled()

    resolveFactory(lateClient)
    await vi.waitFor(() => {
      expect(lateClient.close).toHaveBeenCalledTimes(1)
    })
    expect(built.connectedServers).toBe(0)
  })
})

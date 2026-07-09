import { describe, expect, it, vi } from 'vitest'
import { McpCapabilityConfig, type McpServerConfig } from '../../contracts/capabilities.js'
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

  constructor(
    private readonly tools: McpToolDescriptor[],
    readonly callTool: McpClientLike['callTool'],
    extras: Partial<Pick<McpClientLike, 'listResources' | 'readResource' | 'listResourceTemplates' | 'listPrompts' | 'getPrompt'>> = {}
  ) {
    Object.assign(this, extras)
  }

  async listTools(): Promise<{ tools: McpToolDescriptor[] }> {
    return { tools: this.tools }
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

describe('mcp tool provider reliability', () => {
  it('shares one reconnect across concurrent tool calls after a transport failure', async () => {
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
    const tool = built.providers[0]?.tools.find((item) => item.name === 'mcp_call')
    expect(tool).toBeTruthy()

    const [one, two] = await Promise.all([
      tool!.execute({ toolId: 'mcp_docs_lookup', arguments: {} }, context),
      tool!.execute({ toolId: 'mcp_docs_lookup', arguments: {} }, context)
    ])

    expect(clientFactory).toHaveBeenCalledTimes(2)
    expect(first.close).toHaveBeenCalledTimes(1)
    expect(second.callTool).toHaveBeenCalledTimes(2)
    expect(one).toMatchObject({ output: { result: { ok: true } } })
    expect(two).toMatchObject({ output: { result: { ok: true } } })
    expect(built.diagnostics[0]).toMatchObject({
      id: 'docs',
      status: 'connected',
      available: true,
      reconnectAttempts: 1
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
    await built.startBackgroundReconnect(() => undefined)
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
})

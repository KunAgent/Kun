import { describe, expect, it, vi } from 'vitest'
import { McpCapabilityConfig, type McpServerConfig } from '../../contracts/capabilities.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import {
  buildMcpToolProviders,
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
  listTools = vi.fn(async (): Promise<{ tools: McpToolDescriptor[] }> => ({ tools: this.tools }))

  constructor(
    private readonly tools: McpToolDescriptor[],
    readonly callTool: McpClientLike['callTool']
  ) {}

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

const context: ToolHostContext = {
  threadId: 'thread_test',
  turnId: 'turn_test',
  workspace: '/workspace',
  approvalPolicy: 'auto',
  abortSignal: new AbortController().signal,
  awaitApproval: vi.fn()
}

const descriptors = (count: number, prefix: string): McpToolDescriptor[] =>
  Array.from({ length: count }, (_, index) => ({
    name: `${prefix}${index}`,
    description: `${prefix} tool ${index}`,
    inputSchema: { type: 'object', properties: {} }
  }))

const singleAutoSearchConfig = (autoThresholdToolCount: number) =>
  McpCapabilityConfig.parse({
    enabled: true,
    servers: { docs: server },
    search: {
      enabled: true,
      mode: 'auto',
      autoThresholdToolCount,
      topKDefault: 5,
      topKMax: 10,
      minScore: 0.15
    }
  })

describe('mcp tool provider manual refresh catalog sync', () => {
  it('removes direct providers when a manual refresh crosses the auto threshold', async () => {
    const client = new MockMcpClient([], vi.fn(async () => ({ ok: true })))
    client.listTools
      .mockResolvedValueOnce({ tools: descriptors(1, 'a') })
      .mockResolvedValueOnce({ tools: descriptors(5, 'a') })

    const built = await buildMcpToolProviders(singleAutoSearchConfig(3), {
      clientFactory: vi.fn(async () => client)
    })
    expect(built.providers.map((provider) => provider.id)).toContain('mcp:docs')

    const unregistered: string[] = []
    await built.startBackgroundReconnect({
      register: () => undefined,
      unregister: (providerId) => unregistered.push(providerId),
      replace: () => undefined
    })

    const refresh = built.providers
      .flatMap((provider) => provider.tools)
      .find((tool) => tool.name === 'mcp_refresh_catalog')!
    await refresh.execute({}, context)

    expect(unregistered).toContain('mcp:docs')
    expect(built.search.indexedToolCount).toBe(5)
    expect(built.search.active).toBe(true)
  })

  it('registers direct providers when a manual refresh falls below the auto threshold', async () => {
    const client = new MockMcpClient([], vi.fn(async () => ({ ok: true })))
    client.listTools
      .mockResolvedValueOnce({ tools: descriptors(5, 'a') })
      .mockResolvedValueOnce({ tools: descriptors(1, 'a') })

    const built = await buildMcpToolProviders(singleAutoSearchConfig(3), {
      clientFactory: vi.fn(async () => client)
    })
    expect(built.providers.map((provider) => provider.id)).toEqual(['mcp:search', 'mcp:facade'])

    const registered: string[] = []
    await built.startBackgroundReconnect({
      register: (provider) => registered.push(provider.id),
      unregister: () => undefined,
      replace: () => undefined
    })

    const refresh = built.providers
      .flatMap((provider) => provider.tools)
      .find((tool) => tool.name === 'mcp_refresh_catalog')!
    await refresh.execute({}, context)

    expect(registered).toContain('mcp:docs')
    expect(built.search.indexedToolCount).toBe(1)
    expect(built.search.active).toBe(false)
  })

  it('replaces an exposed direct provider when a refresh changes its schema', async () => {
    const oldDescriptor: McpToolDescriptor = {
      name: 'lookup',
      description: 'old schema',
      inputSchema: { type: 'object', properties: {} }
    }
    const newDescriptor: McpToolDescriptor = {
      name: 'lookup',
      description: 'new schema',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
    }
    const client = new MockMcpClient([], vi.fn(async () => ({ ok: true })))
    client.listTools
      .mockResolvedValueOnce({ tools: [oldDescriptor] })
      .mockResolvedValueOnce({ tools: [newDescriptor] })

    const built = await buildMcpToolProviders(singleAutoSearchConfig(3), {
      clientFactory: vi.fn(async () => client)
    })
    expect(built.providers.map((provider) => provider.id)).toContain('mcp:docs')

    const replaced: string[] = []
    await built.startBackgroundReconnect({
      register: () => undefined,
      unregister: () => undefined,
      replace: (provider) => replaced.push(provider.tools[0]?.description ?? '')
    })

    const refresh = built.providers
      .flatMap((provider) => provider.tools)
      .find((tool) => tool.name === 'mcp_refresh_catalog')!
    await refresh.execute({}, context)

    expect(replaced[replaced.length - 1]).toBe('new schema')
  })

  it('keeps the old catalog and fingerprint when a manual refresh fails', async () => {
    const client = new MockMcpClient([], vi.fn(async () => ({ ok: true })))
    client.listTools
      .mockResolvedValueOnce({ tools: descriptors(1, 'a') })
      .mockRejectedValueOnce(new Error('refresh boom'))

    const built = await buildMcpToolProviders(singleAutoSearchConfig(3), {
      clientFactory: vi.fn(async () => client)
    })
    const fingerprintBefore = built.search.catalogFingerprint

    await built.startBackgroundReconnect({
      register: () => undefined,
      unregister: () => undefined,
      replace: () => undefined
    })

    const refresh = built.providers
      .flatMap((provider) => provider.tools)
      .find((tool) => tool.name === 'mcp_refresh_catalog')!
    await expect(refresh.execute({}, context)).rejects.toThrow('refresh boom')

    expect(built.search.indexedToolCount).toBe(1)
    expect(built.search.catalogFingerprint).toBe(fingerprintBefore)
    expect(built.search.lastError).toBe('refresh boom')
  })
})

describe('mcp tool provider runtime reconnect catalog commit', () => {
  const directConfig = () =>
    McpCapabilityConfig.parse({
      enabled: true,
      servers: { docs: server },
      search: { enabled: false }
    })

  const lookup = (inputSchema: Record<string, unknown>): McpToolDescriptor => ({
    name: 'lookup',
    description: 'lookup',
    inputSchema
  })

  it('commits the fresh catalog when a runtime reconnect adds/removes tools', async () => {
    const first = new MockMcpClient([lookup({ type: 'object', properties: {} })], vi.fn(async () => ({ ok: true })))
    const second = new MockMcpClient(
      [
        { name: 'lookup2', description: 'lookup2', inputSchema: { type: 'object', properties: {} } }
      ],
      vi.fn(async () => ({ ok: true }))
    )
    const clientFactory = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)

    const built = await buildMcpToolProviders(directConfig(), { clientFactory })

    const replaced: Array<{ tools: readonly { name: string }[] }> = []
    await built.startBackgroundReconnect({
      register: () => undefined,
      unregister: () => undefined,
      replace: (provider) => replaced.push(provider)
    })

    first.lifecycle.onClose?.()
    const direct = built.providers.find((provider) => provider.id === 'mcp:docs')!
    const tool = direct.tools.find((item) => item.name === 'mcp_docs_lookup')!
    await tool.execute({}, context)

    expect(clientFactory).toHaveBeenCalledTimes(2)
    const committed = replaced[replaced.length - 1]!
    expect(committed.tools.map((item) => item.name)).toContain('mcp_docs_lookup2')
    expect(committed.tools.map((item) => item.name)).not.toContain('mcp_docs_lookup')
    expect(built.toolCount).toBe(1)
    expect(built.diagnostics[0]?.toolNames).toEqual(['lookup2'])
  })

  it('updates the exposed direct tool schema after a runtime reconnect', async () => {
    const oldSchema = { type: 'object', properties: {} }
    const newSchema = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
    const first = new MockMcpClient([lookup(oldSchema)], vi.fn(async () => ({ ok: true })))
    const second = new MockMcpClient([lookup(newSchema)], vi.fn(async () => ({ ok: true })))
    const clientFactory = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)

    const built = await buildMcpToolProviders(directConfig(), { clientFactory })

    const replaced: Array<{ tools: readonly { name: string; inputSchema: Record<string, unknown> }[] }> = []
    await built.startBackgroundReconnect({
      register: () => undefined,
      unregister: () => undefined,
      replace: (provider) => replaced.push(provider)
    })

    first.lifecycle.onClose?.()
    const direct = built.providers.find((provider) => provider.id === 'mcp:docs')!
    const tool = direct.tools.find((item) => item.name === 'mcp_docs_lookup')!
    await tool.execute({}, context)

    const committed = replaced[replaced.length - 1]!
    const refreshed = committed.tools.find((item) => item.name === 'mcp_docs_lookup')
    expect(refreshed?.inputSchema).toMatchObject({ required: ['query'] })
  })

  it('reads live connectedServers/toolCount after a background reconnect', async () => {
    const clientFactory = vi.fn()
      .mockRejectedValueOnce(new Error('startup timeout'))
      .mockResolvedValueOnce(new MockMcpClient(descriptors(2, 'a'), vi.fn(async () => ({ ok: true }))))

    const built = await buildMcpToolProviders(directConfig(), {
      clientFactory,
      delay: async () => undefined
    })

    expect(built.connectedServers).toBe(0)
    expect(built.toolCount).toBe(0)

    await built.startBackgroundReconnect({ register: () => undefined, unregister: () => undefined })

    expect(built.connectedServers).toBe(1)
    expect(built.toolCount).toBe(2)
  })
})

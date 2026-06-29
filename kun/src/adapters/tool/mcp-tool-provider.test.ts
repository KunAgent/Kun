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

  constructor(
    private readonly tools: McpToolDescriptor[],
    readonly callTool: McpClientLike['callTool']
  ) {}

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
    const tool = built.providers[0]?.tools[0]
    expect(tool?.name).toBe('mcp_docs_lookup')

    const [one, two] = await Promise.all([
      tool!.execute({}, context),
      tool!.execute({}, context)
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

    const tool = built.providers[0]!.tools[0]!
    const result = await tool.execute({}, context)

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
    const tool = built.providers[0]!.tools[0]!

    await expect(tool.execute({}, context)).rejects.toThrow('Invalid arguments')

    expect(built.diagnostics[0]).toMatchObject({
      status: 'connected',
      available: true,
      lastError: 'Invalid arguments: query is required'
    })
  })
})

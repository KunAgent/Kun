import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpCapabilityConfig } from '../contracts/capabilities.js'
import { buildMcpToolProviders, type McpClientLike } from '../adapters/tool/mcp-tool-provider.js'
import { MCP_STARTUP_CONNECTION_BUDGET_MS, prepareInitialCapabilities } from './runtime-composition-services.js'

function client(): McpClientLike {
  return {
    listTools: vi.fn(async () => ({
      tools: [{ name: 'lookup', inputSchema: { type: 'object', properties: {} } }]
    })),
    callTool: vi.fn(async () => ({ ok: true })),
    close: vi.fn(async () => undefined)
  }
}

describe('runtime MCP startup budget', () => {
  afterEach(() => vi.useRealTimers())

  it('starts MCP, skills, and computer-use readiness concurrently', async () => {
    const started: string[] = []
    let finishMcp!: (value: string) => void
    let finishSkills!: (value: string) => void
    let finishComputer!: (value: string) => void
    const mcp = () => { started.push('mcp'); return new Promise<string>((resolve) => { finishMcp = resolve }) }
    const skills = () => { started.push('skills'); return new Promise<string>((resolve) => { finishSkills = resolve }) }
    const computer = () => { started.push('computer'); return new Promise<string>((resolve) => { finishComputer = resolve }) }

    const result = prepareInitialCapabilities(mcp, skills, computer)
    expect(started).toEqual(['mcp', 'skills', 'computer'])
    finishComputer('computer-ready')
    finishSkills('skills-ready')
    finishMcp('mcp-ready')
    await expect(result).resolves.toEqual(['mcp-ready', 'skills-ready', 'computer-ready'])
  })

  it('stops waiting for a slow server and registers its tools after reconnect', async () => {
    vi.useFakeTimers()
    let finishFirst!: (value: McpClientLike) => void
    const slow = new Promise<McpClientLike>((resolve) => { finishFirst = resolve })
    const lateClient = client()
    const reconnectedClient = client()
    const clientFactory = vi.fn().mockReturnValueOnce(slow).mockResolvedValueOnce(reconnectedClient)
    const config = McpCapabilityConfig.parse({
      enabled: true,
      servers: { docs: { enabled: true, transport: 'streamable-http', url: 'http://127.0.0.1:39999/mcp', trustScope: 'user' } },
      search: { enabled: false }
    })
    let settled = false
    const pending = buildMcpToolProviders(config, {
      clientFactory,
      startupConnectTimeoutMs: MCP_STARTUP_CONNECTION_BUDGET_MS,
      delay: async () => undefined
    }).then((result) => { settled = true; return result })

    expect(MCP_STARTUP_CONNECTION_BUDGET_MS).toBe(3_000)
    await vi.advanceTimersByTimeAsync(MCP_STARTUP_CONNECTION_BUDGET_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const built = await pending
    expect(built.diagnostics[0]).toMatchObject({ id: 'docs', status: 'error' })
    expect(built.connectedServers).toBe(0)

    const registered: string[] = []
    await built.startBackgroundReconnect({
      register: (provider) => registered.push(provider.id),
      unregister: () => undefined
    })
    expect(built.connectedServers).toBe(1)
    expect(registered).toContain('mcp:docs')

    finishFirst(lateClient)
    await vi.advanceTimersByTimeAsync(0)
    expect(lateClient.close).toHaveBeenCalledOnce()
    await built.close()
  })
})

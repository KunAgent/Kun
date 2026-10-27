import { describe, expect, it, vi } from 'vitest'
import type { McpServerConfig } from '../../contracts/capabilities.js'
import { mcpCallTimeoutMs } from './mcp-call-budget.js'
import { callMcpToolWithReconnect } from './mcp-tool-runtime.js'
import type { McpConnectionState } from './mcp-tool-provider.js'

function serverConfig(patch: Partial<McpServerConfig>): McpServerConfig {
  return {
    enabled: true,
    transport: 'stdio',
    command: '/bin/true',
    timeoutMs: 5_000,
    ...patch
  } as McpServerConfig
}

function connectedState(server: McpServerConfig, callTool: ReturnType<typeof vi.fn>): McpConnectionState {
  return {
    serverId: 'gui_schedule',
    server,
    client: { callTool, ready: vi.fn(async () => undefined), close: vi.fn(async () => undefined) },
    status: 'connected'
  } as unknown as McpConnectionState
}

describe('mcpCallTimeoutMs', () => {
  it('falls back to the connect/query budget when no call budget is configured', () => {
    expect(mcpCallTimeoutMs(serverConfig({}))).toBe(5_000)
  })

  it('prefers the reserved per-call budget', () => {
    expect(mcpCallTimeoutMs(serverConfig({ callTimeoutMs: 90_000 }))).toBe(90_000)
  })

  it('applies the per-call budget to real tool calls, not the connect budget', async () => {
    const callTool = vi.fn(async () => ({ content: [] }))
    const state = connectedState(serverConfig({ timeoutMs: 5_000, callTimeoutMs: 90_000 }), callTool)

    await callMcpToolWithReconnect(state, { name: 'run_workflow', arguments: {} }, undefined)

    expect(callTool).toHaveBeenCalledWith(
      { name: 'run_workflow', arguments: {} },
      expect.objectContaining({ timeout: 90_000 })
    )
  })

  it('attaches source metadata only from the runtime context for the assistant assignment tool', async () => {
    const callTool = vi.fn(async () => ({ content: [] }))
    const state = { ...connectedState(serverConfig({}), callTool), serverId: 'kun_assistants' }
    const context = { threadId: 'thread', turnId: 'turn', activeToolCallId: 'call', abortSignal: new AbortController().signal } as never
    await callMcpToolWithReconnect(state, { name: 'assign_assistant_task', arguments: { instructions: 'work' } }, context)
    expect(callTool).toHaveBeenCalledWith({ name: 'assign_assistant_task', arguments: { instructions: 'work' },
      _meta: { kunSource: { threadId: 'thread', turnId: 'turn', callId: 'call' } } }, expect.anything())
    await callMcpToolWithReconnect(state, { name: 'assign_assistant_task', arguments: {} }, undefined)
    expect(callTool).toHaveBeenLastCalledWith({ name: 'assign_assistant_task', arguments: {} }, expect.anything())
  })

  it('keeps the connect budget for calls when no call budget is configured', async () => {
    const callTool = vi.fn(async () => ({ content: [] }))
    const state = connectedState(serverConfig({ timeoutMs: 5_000 }), callTool)

    await callMcpToolWithReconnect(state, { name: 'anything', arguments: {} }, undefined)

    expect(callTool).toHaveBeenCalledWith(
      { name: 'anything', arguments: {} },
      expect.objectContaining({ timeout: 5_000 })
    )
  })
})

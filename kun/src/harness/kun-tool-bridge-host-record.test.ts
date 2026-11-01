import { describe, expect, it } from 'vitest'
import { createKunToolBridgeHost } from './kun-tool-bridge-host.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { ToolHost } from '../ports/tool-host.js'

const thread = {
  id: 'thread_1',
  title: 'Bridge',
  workspace: '/workspace',
  model: 'm1',
  status: 'active',
  turns: [{
    id: 'turn_1',
    threadId: 'thread_1',
    status: 'running',
    prompt: 'design it',
    harnessId: 'codex',
    actingModelRoute: { model: 'm1', providerId: 'deepseek' }
  }]
} as unknown as ThreadRecord

function hostFor(output: unknown, isError = false) {
  const applied: Array<{ id: string; toolName?: string; output?: unknown }> = []
  const toolHost: ToolHost = {
    id: 'fake',
    listTools: async () => [],
    execute: async (call) => ({
      item: { kind: 'tool_result', id: 'item_native', toolName: call.toolName, output, isError },
      approved: false
    }) as never
  }
  const host = createKunToolBridgeHost({
    threadStore: { get: async () => thread } as never,
    sessionStore: {} as never,
    registry: { listTools: () => [] } as never,
    toolHost,
    turns: { applyItem: async (_threadId: string, item: never) => { applied.push(item) }, updateItem: async () => {} } as never,
    events: { record: async () => undefined } as never,
    ids: { next: (prefix: string) => `${prefix}_7` },
    defaultApprovalPolicy: 'never',
    recordResultItemTools: new Set(['design_open'])
  })
  return { host, applied }
}

describe('KunToolBridgeHost result item recording', () => {
  it('applies the Kun result item of a listed tool to the running turn', async () => {
    const { host, applied } = hostFor({ ok: true, designRequest: { title: 'Toast' } })
    const result = await host.execute('thread_1', 'turn_1', {
      toolName: 'design_open', args: {}, callId: 'mcp_3', signal: new AbortController().signal
    })
    expect(result.isError).toBe(false)
    expect(applied).toEqual([expect.objectContaining({
      id: 'item_toolresult_turn_1_mcp_3_kun_7',
      toolName: 'design_open',
      output: { ok: true, designRequest: { title: 'Toast' } }
    })])
  })

  it('records nothing for other tools or failed calls', async () => {
    const other = hostFor('ok')
    await other.host.execute('thread_1', 'turn_1', { toolName: 'memory_search', args: {}, callId: 'c', signal: new AbortController().signal })
    expect(other.applied).toEqual([])
    const failed = hostFor('screen "A" needs html', true)
    await failed.host.execute('thread_1', 'turn_1', { toolName: 'design_open', args: {}, callId: 'c', signal: new AbortController().signal })
    expect(failed.applied).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { ToolOperationJournal } from '../../reliability/operation-journal.js'
import { LocalToolHost } from './local-tool-host.js'

function context(turnId: string): ToolHostContext {
  return {
    threadId: 'thread-1',
    turnId,
    workspace: '/tmp/workspace',
    approvalPolicy: 'auto',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}

describe('LocalToolHost operation journal', () => {
  it('reuses completed results for the exact same turn-scoped identity', async () => {
    let executions = 0
    const host = new LocalToolHost({
      operationJournal: new ToolOperationJournal({ nowIso: () => '2026-01-01T00:00:00.000Z' }),
      tools: [LocalToolHost.defineTool({
        name: 'counted',
        description: 'count executions',
        policy: 'auto',
        inputSchema: { type: 'object' },
        execute: async () => {
          executions += 1
          return { output: { executions } }
        }
      })]
    })

    const call = { callId: 'call_1', toolName: 'counted', arguments: { value: 1 } }
    const first = await host.execute(call, context('turn-1'))
    const second = await host.execute(call, context('turn-1'))

    expect(executions).toBe(1)
    expect(first.item).toMatchObject({ output: { executions: 1 } })
    expect(second.item).toMatchObject({ output: { executions: 1 } })
  })

  it('does not reuse fallback call ids across turns in the same thread', async () => {
    let executions = 0
    const host = new LocalToolHost({
      operationJournal: new ToolOperationJournal({ nowIso: () => '2026-01-01T00:00:00.000Z' }),
      tools: [LocalToolHost.defineTool({
        name: 'counted',
        description: 'count executions',
        policy: 'auto',
        inputSchema: { type: 'object' },
        execute: async () => {
          executions += 1
          return { output: { executions } }
        }
      })]
    })

    const call = { callId: 'call_1', toolName: 'counted', arguments: { value: 1 } }
    const first = await host.execute(call, context('turn-1'))
    const second = await host.execute(call, context('turn-2'))

    expect(executions).toBe(2)
    expect(first.item).toMatchObject({ output: { executions: 1 } })
    expect(second.item).toMatchObject({ output: { executions: 2 } })
  })

  it('does not reuse the same call id when arguments change', async () => {
    let executions = 0
    const host = new LocalToolHost({
      operationJournal: new ToolOperationJournal({ nowIso: () => '2026-01-01T00:00:00.000Z' }),
      tools: [LocalToolHost.defineTool({
        name: 'counted',
        description: 'count executions',
        policy: 'auto',
        inputSchema: { type: 'object' },
        execute: async () => {
          executions += 1
          return { output: { executions } }
        }
      })]
    })

    await host.execute({ callId: 'call_1', toolName: 'counted', arguments: { value: 1 } }, context('turn-1'))
    await host.execute({ callId: 'call_1', toolName: 'counted', arguments: { value: 2 } }, context('turn-1'))

    expect(executions).toBe(2)
  })
})

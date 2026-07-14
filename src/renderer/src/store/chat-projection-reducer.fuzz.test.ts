import { describe, expect, it } from 'vitest'
import type { RuntimeProjectionAction } from '../agent/runtime-projection-actions'
import type { ChatState } from './chat-store-types'
import { reduceChatProjection } from './chat-projection-reducer'

const NOW = Date.parse('2026-07-11T00:00:00.000Z')
const context = {
  now: NOW,
  clearRecoveringError: (error: string | null) => error === 'recovering' ? null : error,
  goalTimelineText: (goal: ChatState['activeThreadGoal'], cleared?: boolean) =>
    cleared || !goal ? 'Goal cleared' : `Goal ${goal.status}: ${goal.objective}`,
  runtimeStatusText: () => 'Runtime status',
  runtimeErrorView: (event: { message: string; code?: string }) => ({
    summary: event.message,
    ...(event.code ? { code: event.code } : {})
  }),
  upsertRuntimeError: (blocks: ChatState['blocks'], block: ChatState['blocks'][number]) => {
    const index = blocks.findIndex((candidate) => candidate.id === block.id)
    if (index < 0) return [...blocks, block]
    const next = [...blocks]
    next[index] = block
    return next
  },
  formatRuntimeError: (error: unknown) => error instanceof Error ? error.message : String(error),
  runtimeErrorDetail: () => '',
  isInterruptSettledError: () => false,
  settlePendingRuntimeWork: (blocks: ChatState['blocks']) => blocks,
  threadSnapshotLooksRunning: () => false,
  hasAssistantTextForCompletedTurn: () => false
}

function state(): ChatState {
  return {
    activeThreadId: 'thread_1',
    blocks: [],
    liveReasoning: '',
    liveAssistant: '',
    threads: [{
      id: 'thread_1', title: 'Thread', updatedAt: '2026-07-10T00:00:00.000Z', model: 'model', mode: 'agent'
    }],
    usageRefreshKey: 0,
    error: 'recovering'
  } as unknown as ChatState
}

function nextRandom(seed: number): number {
  return (seed * 1664525 + 1013904223) >>> 0
}

function makeActions(seed: number): RuntimeProjectionAction[] {
  const actions: RuntimeProjectionAction[] = []
  let random = seed >>> 0
  for (let index = 0; index < 80; index += 1) {
    random = nextRandom(random)
    const id = `item_${random % 5}`
    const choice = random % 10
    if (choice === 0) {
      actions.push({ type: 'seq_observed', seq: random % 20 })
    } else if (choice === 1) {
      actions.push({
        type: 'deltas_received',
        deltas: [{ kind: random % 2 === 0 ? 'agent_message' : 'agent_reasoning', text: `delta-${index}`, seq: random % 20 }]
      })
    } else if (choice === 2) {
      actions.push({ type: 'approval_received', payload: { approvalId: id, summary: 'Run test' } })
    } else if (choice === 3) {
      actions.push({ type: 'approval_status_changed', payload: { approvalId: id, status: random % 2 === 0 ? 'allowed' : 'expired' } })
    } else if (choice === 4) {
      actions.push({ type: 'user_input_requested', payload: { itemId: id, requestId: `request_${id}`, questions: [] } })
    } else if (choice === 5) {
      actions.push({ type: 'user_input_status_changed', payload: { itemId: id, status: random % 2 === 0 ? 'submitted' : 'cancelled' } })
    } else if (choice === 6) {
      actions.push({ type: 'runtime_status_received', payload: { kind: 'model_request_retry', itemId: id, attempt: random % 4 } })
    } else if (choice === 7) {
      actions.push({ type: 'runtime_error_received', payload: { itemId: id, message: `error-${index}`, code: random % 2 ? 'E_REPLAY' : undefined } })
    } else if (choice === 8) {
      actions.push({
        type: 'thread_snapshot_reconciled',
        payload: { threadId: random % 2 ? 'thread_1' : 'other-thread', blocks: [], latestSeq: random % 20 }
      })
    } else {
      actions.push({ type: random % 2 === 0 ? 'turn_completed' : 'turn_failed', ...(random % 2 === 0 ? {} : { error: new Error(`failure-${index}`), options: { terminal: true } }) } as RuntimeProjectionAction)
    }
    if (random % 7 === 0) actions.push(actions.at(-1)!)
  }
  return actions
}

function project(actions: RuntimeProjectionAction[]): ChatState {
  return actions.reduce(
    (current, action) => ({ ...current, ...reduceChatProjection(current, action, context) }),
    state()
  )
}

describe('chat projection reducer fuzz invariants', () => {
  it.each([0x1a2b3c4d, 0x55667788, 0xdeadbeef])('is deterministic for generated replay sequence %i', (seed) => {
    const actions = makeActions(seed)
    expect(() => project(actions)).not.toThrow()
    expect(project(actions)).toEqual(project(structuredClone(actions)))
  })

  it('does not project snapshots from a different thread into the active timeline', () => {
    const projected = project([{
      type: 'thread_snapshot_reconciled',
      payload: {
        threadId: 'other-thread',
        blocks: [{ kind: 'assistant', id: 'foreign', createdAt: '2026-07-11T00:00:00.000Z', text: 'foreign' }],
        latestSeq: 100
      }
    }])
    expect(projected.blocks).toEqual([])
    expect(projected.lastSeq).not.toBe(100)
  })
})

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
    summary: `Summary: ${event.message}`,
    message: event.message,
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
  threadSnapshotLooksRunning: () => false
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
    error: null
  } as unknown as ChatState
}

function project(
  initial: ChatState,
  actions: RuntimeProjectionAction[]
): ChatState {
  return actions.reduce(
    (current, action) => ({ ...current, ...reduceChatProjection(current, action, context) }),
    initial
  )
}

describe('user_input timeout projection', () => {
  it('carries timeoutSeconds onto the pending user-input block and settles timeout status', () => {
    const projected = project(state(), [
      {
        type: 'user_input_requested',
        payload: {
          itemId: 'input_item_timeout',
          requestId: 'input_timeout',
          createdAt: '2026-07-11T00:00:00.000Z',
          timeoutSeconds: 30,
          questions: [{ header: 'Input', id: 'input_timeout', question: 'Continue?', options: [] }]
        }
      }
    ])
    expect(projected.blocks).toContainEqual(expect.objectContaining({
      kind: 'user_input',
      id: 'input_item_timeout',
      status: 'pending',
      live: true,
      timeoutSeconds: 30
    }))

    const settled = project(projected, [{
      type: 'user_input_status_changed',
      payload: { itemId: 'input_item_timeout', status: 'timeout' }
    }])
    expect(settled.blocks).toContainEqual(expect.objectContaining({
      kind: 'user_input',
      id: 'input_item_timeout',
      status: 'timeout'
    }))
  })

  it('keeps timeoutSeconds when replaying a request over an existing live block', () => {
    const request: RuntimeProjectionAction = {
      type: 'user_input_requested',
      payload: {
        itemId: 'input_item_replay',
        requestId: 'input_replay',
        createdAt: '2026-07-11T00:00:00.000Z',
        timeoutSeconds: 45,
        questions: [{ header: 'Input', id: 'input_replay', question: 'Continue?', options: [] }]
      }
    }
    const once = project(state(), [request])
    const twice = project(once, [request])
    expect(twice.blocks).toHaveLength(1)
    expect(twice.blocks[0]).toMatchObject({ timeoutSeconds: 45, live: true })
  })
})

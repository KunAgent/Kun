import { describe, expect, it } from 'vitest'
import type { RuntimeProjectionAction } from '../agent/runtime-projection-actions'
import type { ChatState } from './chat-store-types'
import { reduceChatProjection } from './chat-projection-reducer'

const NOW = Date.parse('2026-07-11T00:00:00.000Z')
const context = {
  now: NOW,
  clearRecoveringError: (error: string | null) => error === 'recovering' ? null : error,
  goalTimelineText: () => 'Goal',
  runtimeStatusText: () => 'Runtime status',
  runtimeErrorView: (event: { message: string; code?: string }) => ({
    summary: `Summary: ${event.message}`,
    message: event.message,
    ...(event.code ? { code: event.code } : {})
  }),
  upsertRuntimeError: (blocks: ChatState['blocks']) => blocks,
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
    error: 'recovering'
  } as unknown as ChatState
}

function project(
  initial: ChatState,
  actions: RuntimeProjectionAction[],
  reducerContext = context
): ChatState {
  return actions.reduce(
    (current, action) => ({ ...current, ...reduceChatProjection(current, action, reducerContext) }),
    initial
  )
}

describe('chat projection reducer concurrency guards', () => {
  it('does not settle a newer turn when an older terminal event is replayed', () => {
    const projected = project({
      ...state(),
      busy: true,
      currentTurnId: 'turn_B',
      currentTurnOrchestration: 'graph',
      threads: [{ ...state().threads[0]!, status: 'running' }]
    }, [{ type: 'turn_completed', payload: { status: 'completed', turnId: 'turn_A' } }])

    expect(projected.busy).toBe(true)
    expect(projected.currentTurnId).toBe('turn_B')
    expect(projected.currentTurnOrchestration).toBe('graph')
    expect(projected.threads[0]?.status).toBe('running')
  })

  it('does not settle a local turn from an unidentified terminal event', () => {
    const initial = {
      ...state(),
      busy: true,
      currentTurnId: 'turn_1',
      currentTurnOrchestration: 'direct' as const
    }
    const projected = reduceChatProjection(initial, {
      type: 'turn_completed',
      payload: { status: 'completed' }
    }, context)

    expect(projected).toEqual({})
  })

  it('drops an unknown old-turn block instead of creating an orphan after the active turn', () => {
    const initial = {
      ...state(),
      busy: true,
      currentTurnId: 'turn_active',
      currentTurnUserId: 'user_active',
      blocks: [
        { kind: 'user' as const, id: 'user_active', turnId: 'turn_active', text: 'Continue' },
        { kind: 'assistant' as const, id: 'assistant_active', turnId: 'turn_active', text: 'Working' }
      ]
    }

    const projected = project(initial, [{
      type: 'assistant_item_upserted',
      payload: {
        itemId: 'assistant_late',
        threadId: 'thread_1',
        turnId: 'turn_missing_from_page',
        kind: 'agent_message',
        status: 'completed',
        createdAt: '2026-07-11T00:00:00.000Z',
        text: 'Late history chunk'
      }
    }])

    expect(projected.blocks.map((block) => block.id)).toEqual(['user_active', 'assistant_active'])
    expect(projected.busy).toBe(true)
    expect(projected.currentTurnId).toBe('turn_active')
  })

  it('inserts a delayed tool update inside its owning known turn, not after the active turn', () => {
    const initial = {
      ...state(),
      busy: true,
      currentTurnId: 'turn_active',
      currentTurnUserId: 'user_active',
      blocks: [
        { kind: 'user' as const, id: 'user_old', turnId: 'turn_old', text: 'First' },
        { kind: 'assistant' as const, id: 'assistant_old', turnId: 'turn_old', text: 'Done first' },
        { kind: 'user' as const, id: 'user_active', turnId: 'turn_active', text: 'Second' },
        { kind: 'assistant' as const, id: 'assistant_active', turnId: 'turn_active', text: 'Working' }
      ]
    }

    const projected = project(initial, [{
      type: 'tool_updated',
      payload: {
        itemId: 'tool_late',
        turnId: 'turn_old',
        summary: 'late update',
        status: 'success'
      }
    }])

    expect(projected.blocks.map((block) => block.id)).toEqual([
      'user_old',
      'assistant_old',
      'tool_late',
      'user_active',
      'assistant_active'
    ])
    expect(projected.busy).toBe(true)
    expect(projected.currentTurnId).toBe('turn_active')
  })
})

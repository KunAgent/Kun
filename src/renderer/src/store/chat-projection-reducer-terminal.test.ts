import { describe, expect, it } from 'vitest'
import type { RuntimeProjectionAction } from '../agent/runtime-projection-actions'
import type { ChatState } from './chat-store-types'
import { reduceChatProjection } from './chat-projection-reducer'
import type { ChatProjectionReducerContext } from './chat-projection-reducer'

const context: ChatProjectionReducerContext = {
  now: 0,
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
    turnStartedAtByUserId: {},
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

describe('chat projection turn failure identity', () => {
  it('keeps the active turn settled-running when a stale turn failure is replayed', () => {
    const initial = {
      ...state(),
      busy: true,
      currentTurnId: 'turn_new',
      currentTurnUserId: 'user_block_new',
      threads: [{ ...state().threads[0]!, status: 'running' }]
    }
    const projected = project(initial, [{
      type: 'turn_failed',
      payload: {
        threadId: 'thread_1',
        turnId: 'turn_old',
        seq: 12,
        error: new Error('old turn failed'),
        options: { terminal: true, scope: 'conversation' }
      }
    }])

    expect(projected.busy).toBe(true)
    expect(projected.currentTurnId).toBe('turn_new')
    expect(projected.currentTurnUserId).toBe('user_block_new')
    expect(projected.threads[0]).toMatchObject({ status: 'running' })
  })

  it('settles the active turn when its own failure carries its identity', () => {
    const projected = project({
      ...state(),
      busy: true,
      currentTurnId: 'turn_new',
      currentTurnUserId: 'user_block_new',
      threads: [{ ...state().threads[0]!, status: 'running' }]
    }, [{
      type: 'turn_failed',
      payload: {
        threadId: 'thread_1',
        turnId: 'turn_new',
        seq: 13,
        error: new Error('current turn failed'),
        options: { terminal: true, scope: 'conversation' }
      }
    }])

    expect(projected.busy).toBe(false)
    expect(projected.currentTurnId).toBeNull()
    expect(projected.currentTurnUserId).toBeNull()
    expect(projected.threads[0]).toMatchObject({
      status: 'idle',
      latestTurnStatus: 'failed'
    })
  })

  it('settles an identity-less failure exactly like a transport error today', () => {
    const projected = project({
      ...state(),
      busy: true,
      currentTurnId: 'turn_new'
    }, [{
      type: 'turn_failed',
      payload: {
        error: new Error('sse error 500'),
        options: { terminal: true }
      }
    }])

    expect(projected.busy).toBe(false)
    expect(projected.currentTurnId).toBeNull()
  })
})

describe('chat projection terminal settlement by turnId', () => {
  it('repairs latestTurnId/latestTurnStatus when the local status is already idle', () => {
    const projected = project({
      ...state(),
      threads: [{ ...state().threads[0]!, status: 'idle', latestTurnId: 'turn_old', latestTurnStatus: 'running' }]
    }, [{
      type: 'turn_aborted',
      payload: { status: 'aborted', threadId: 'thread_1', turnId: 'turn_old' }
    }])

    expect(projected.threads[0]).toMatchObject({
      status: 'idle',
      latestTurnId: 'turn_old',
      latestTurnStatus: 'aborted'
    })
  })

  it('does not overwrite a newer turn that is already running', () => {
    const projected = project({
      ...state(),
      threads: [{ ...state().threads[0]!, status: 'running', latestTurnId: 'turn_new', latestTurnStatus: 'running' }]
    }, [{
      type: 'turn_completed',
      payload: { status: 'completed', threadId: 'thread_1', turnId: 'turn_old' }
    }])

    expect(projected.threads[0]).toMatchObject({
      status: 'running',
      latestTurnId: 'turn_new',
      latestTurnStatus: 'running'
    })
  })

  it('settles a failed terminal event by turnId even when the projection was idle', () => {
    const projected = project({
      ...state(),
      busy: true,
      currentTurnId: 'turn_1',
      threads: [{ ...state().threads[0]!, status: 'idle', latestTurnId: 'turn_1', latestTurnStatus: 'running' }]
    }, [{
      type: 'turn_failed',
      payload: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        seq: 13,
        error: new Error('current turn failed'),
        options: { terminal: true, scope: 'conversation' }
      }
    }])

    expect(projected.threads[0]).toMatchObject({
      status: 'idle',
      latestTurnId: 'turn_1',
      latestTurnStatus: 'failed'
    })
  })
})

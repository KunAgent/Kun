import { describe, expect, it } from 'vitest'
import type { RuntimeProjectionAction } from '../agent/runtime-projection-actions'
import type { ThreadGoal, ThreadTodoList } from '../agent/types'
import { reduceChatProjection } from './chat-projection-reducer'
import type { ChatState } from './chat-store-types'

const goal: ThreadGoal = {
  threadId: 'thread_1',
  objective: 'Finish safely',
  status: 'active',
  tokensUsed: 0,
  timeUsedSeconds: 5,
  createdAt: '2026-08-30T00:00:00.000Z',
  updatedAt: '2026-08-30T00:00:05.000Z'
}
const todos: ThreadTodoList = {
  threadId: 'thread_1',
  items: [{
    id: 'todo_1',
    content: 'Keep state canonical',
    status: 'in_progress',
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:05.000Z'
  }],
  updatedAt: '2026-08-30T00:00:05.000Z'
}
const context = {
  now: Date.parse('2026-08-30T00:00:10.000Z'),
  clearRecoveringError: (error: string | null) => error,
  goalTimelineText: () => 'Goal',
  runtimeStatusText: () => 'Runtime status',
  runtimeErrorView: (event: { message: string }) => ({
    summary: event.message,
    message: event.message
  }),
  upsertRuntimeError: (blocks: ChatState['blocks']) => blocks,
  formatRuntimeError: String,
  runtimeErrorDetail: () => '',
  isInterruptSettledError: () => false,
  settlePendingRuntimeWork: (blocks: ChatState['blocks']) => blocks,
  threadSnapshotLooksRunning: () => false
}

function initialState(): ChatState {
  return {
    activeThreadId: 'thread_1',
    activeThreadGoal: goal,
    activeThreadTodos: todos,
    blocks: [],
    threads: [{
      id: 'thread_1',
      title: 'Thread',
      updatedAt: '2026-08-30T00:00:00.000Z',
      model: 'model',
      mode: 'agent',
      goal,
      todos
    }],
    liveReasoning: '',
    liveAssistant: '',
    lastSeq: 0,
    busy: false,
    usageRefreshKey: 0,
    error: null
  } as unknown as ChatState
}

function reconcile(payload: Extract<RuntimeProjectionAction, {
  type: 'thread_snapshot_reconciled'
}>['payload']): ChatState {
  const state = initialState()
  return {
    ...state,
    ...reduceChatProjection(state, {
      type: 'thread_snapshot_reconciled',
      payload
    }, context)
  }
}

describe('canonical goal and todo reconciliation', () => {
  it('treats explicit null as an authoritative clear', () => {
    const projected = reconcile({
      threadId: 'thread_1',
      blocks: [],
      latestSeq: 1,
      goal: null,
      todos: null
    })

    expect(projected.activeThreadGoal).toBeNull()
    expect(projected.activeThreadTodos).toBeNull()
    expect(projected.threads[0]?.goal).toBeNull()
    expect(projected.threads[0]?.todos).toBeNull()
  })

  it('preserves state only when compatible providers omit the fields', () => {
    const projected = reconcile({
      threadId: 'thread_1',
      blocks: [],
      latestSeq: 1
    })

    expect(projected.activeThreadGoal).toBe(goal)
    expect(projected.activeThreadTodos).toBe(todos)
    expect(projected.threads[0]?.goal).toBe(goal)
    expect(projected.threads[0]?.todos).toBe(todos)
  })

  it('preserves canonical goal and todos when a turn settles as failed', () => {
    const state = {
      ...initialState(),
      busy: true,
      currentTurnId: 'turn_1'
    }
    const projected = {
      ...state,
      ...reduceChatProjection(state, {
        type: 'turn_failed',
        payload: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          error: new Error('owner lease expired'),
          options: { terminal: true, scope: 'conversation' }
        }
      }, context)
    }

    expect(projected.activeThreadGoal).toBe(goal)
    expect(projected.activeThreadTodos).toBe(todos)
  })

  it('does not let an older turn snapshot overwrite newer canonical state', () => {
    const state = {
      ...initialState(),
      busy: false,
      currentTurnId: null,
      lastSeq: 3,
      threads: [{
        ...initialState().threads[0]!,
        status: 'idle' as const,
        latestSeq: 3,
        latestTurnId: 'turn_newer',
        latestTurnStatus: 'completed'
      }]
    }
    const projected = {
      ...state,
      ...reduceChatProjection(state, {
        type: 'thread_snapshot_reconciled',
        payload: {
          threadId: 'thread_1',
          turnId: 'turn_older',
          blocks: [],
          latestSeq: 3,
          threadStatus: 'idle',
          latestTurnId: 'turn_older',
          latestTurnStatus: 'completed',
          goal: null,
          todos: null
        }
      }, context)
    }

    expect(projected.activeThreadGoal).toBe(goal)
    expect(projected.activeThreadTodos).toBe(todos)
    expect(projected.threads[0]?.goal).toBe(goal)
    expect(projected.threads[0]?.todos).toBe(todos)
    expect(projected.threads[0]?.latestTurnId).toBe('turn_newer')
  })

  it('projects a server-started continuation as the latest running turn', () => {
    const state = {
      ...initialState(),
      busy: false,
      currentTurnId: null,
      turnStartedAtByUserId: {},
      threads: [{
        ...initialState().threads[0]!,
        status: 'idle' as const,
        latestSeq: 4,
        latestTurnId: 'turn_older',
        latestTurnStatus: 'completed'
      }]
    }
    const projected = {
      ...state,
      ...reduceChatProjection(state, {
        type: 'user_message_received',
        seq: 5,
        payload: {
          itemId: 'item_turn_auto_user',
          turnId: 'turn_auto',
          text: 'Continue automatically'
        }
      }, context)
    }

    expect(projected.currentTurnId).toBe('turn_auto')
    expect(projected.threads[0]).toMatchObject({
      status: 'running',
      latestSeq: 5,
      latestTurnId: 'turn_auto',
      latestTurnStatus: 'running'
    })
  })

  it('accepts a newer canonical detail when its sequence advances the sidebar', () => {
    const state = {
      ...initialState(),
      busy: false,
      currentTurnId: null,
      lastSeq: 8,
      threads: [{
        ...initialState().threads[0]!,
        status: 'idle' as const,
        latestSeq: 4,
        latestTurnId: 'turn_older',
        latestTurnStatus: 'completed'
      }]
    }
    const projected = {
      ...state,
      ...reduceChatProjection(state, {
        type: 'thread_snapshot_reconciled',
        payload: {
          threadId: 'thread_1',
          turnId: 'turn_auto',
          blocks: [],
          latestSeq: 8,
          threadStatus: 'idle',
          latestTurnId: 'turn_auto',
          latestTurnStatus: 'completed',
          goal: null,
          todos: null
        }
      }, context)
    }

    expect(projected.threads[0]).toMatchObject({
      status: 'idle',
      latestTurnId: 'turn_auto',
      latestTurnStatus: 'completed'
    })
    expect(projected.activeThreadGoal).toBeNull()
    expect(projected.activeThreadTodos).toBeNull()
  })

  it('does not let a delayed older detail replace a newer settled turn', () => {
    const state = {
      ...initialState(),
      busy: false,
      currentTurnId: null,
      // The accepted SSE batch has projected turn_auto's user message but has
      // not committed its high-water cursor yet.
      lastSeq: 4,
      threads: [{
        ...initialState().threads[0]!,
        status: 'idle' as const,
        latestSeq: 5,
        latestTurnId: 'turn_auto',
        latestTurnStatus: 'completed'
      }]
    }
    const projected = {
      ...state,
      ...reduceChatProjection(state, {
        type: 'thread_snapshot_reconciled',
        payload: {
          threadId: 'thread_1',
          turnId: 'turn_older',
          blocks: [],
          latestSeq: 4,
          threadStatus: 'idle',
          latestTurnId: 'turn_older',
          latestTurnStatus: 'completed',
          goal: null,
          todos: null
        }
      }, context)
    }

    expect(projected.activeThreadGoal).toBe(goal)
    expect(projected.activeThreadTodos).toBe(todos)
    expect(projected.lastSeq).toBe(4)
    expect(projected.threads[0]).toMatchObject({
      latestSeq: 5,
      latestTurnId: 'turn_auto',
      latestTurnStatus: 'completed'
    })
  })

  it('does not advance the stream cursor from a snapshot tagged to an older turn', () => {
    const state = {
      ...initialState(),
      busy: true,
      currentTurnId: 'turn_newer',
      lastSeq: 10,
      threads: [{
        ...initialState().threads[0]!,
        status: 'running' as const,
        latestTurnId: 'turn_newer',
        latestTurnStatus: 'running'
      }]
    }
    const projected = {
      ...state,
      ...reduceChatProjection(state, {
        type: 'thread_snapshot_reconciled',
        payload: {
          threadId: 'thread_1',
          turnId: 'turn_older',
          blocks: [],
          latestSeq: 14,
          threadStatus: 'running',
          latestTurnId: 'turn_newer',
          latestTurnStatus: 'running'
        }
      }, context)
    }

    expect(projected.lastSeq).toBe(10)
    expect(projected.currentTurnId).toBe('turn_newer')
    expect(projected.threads[0]?.latestTurnId).toBe('turn_newer')
  })
})

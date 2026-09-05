import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { createThreadQueueActions } from './chat-store-thread-queue-actions'
import { threadActionSharedState } from './chat-store-thread-actions-support'

const registryMock = vi.hoisted(() => ({
  getProvider: vi.fn()
}))

vi.mock('../agent/registry', () => ({
  getProvider: registryMock.getProvider
}))

function buildHarness(initial?: Partial<ChatState>): {
  actions: ReturnType<typeof createThreadQueueActions>
  state: ChatState
} {
  let state: ChatState
  state = {
    activeThreadId: 'thr_existing',
    blocks: [],
    busy: false,
    queuedMessages: [],
    ...initial
  } as unknown as ChatState
  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: ChatStoreGet = () => state
  const actions = createThreadQueueActions(
    { set, get, sseAbortRef: { current: null } } as never,
    { persistActiveQueuedMessages: vi.fn() } as never
  )
  return { actions, state }
}

beforeEach(() => {
  registryMock.getProvider.mockReset()
  threadActionSharedState.drainingQueuedMessageThreadIds.clear()
  threadActionSharedState.guidingQueuedMessageIds.clear()
})

describe('runtime queue store actions', () => {
  it('removing an in-flight entry cancels the runtime queued turn', async () => {
    const provider = { cancelQueuedTurn: vi.fn(async () => undefined) }
    registryMock.getProvider.mockReturnValue(provider)
    const { actions, state } = buildHarness({
      queuedMessages: [{
        id: 'q-1',
        text: 'later',
        clientRequestId: 'req-1',
        deliveryState: 'in_flight',
        deliveryTurnId: 'turn_q1',
        deliveryUserMessageItemId: 'user_q1'
      }]
    })

    await actions.removeQueuedMessage('q-1')

    expect(provider.cancelQueuedTurn).toHaveBeenCalledWith('thr_existing', 'turn_q1')
    expect(state.queuedMessages).toEqual([])
  })

  it('removing a pending entry never touches the runtime queue', async () => {
    const provider = { cancelQueuedTurn: vi.fn(async () => undefined) }
    registryMock.getProvider.mockReturnValue(provider)
    const { actions, state } = buildHarness({
      queuedMessages: [{ id: 'q-1', text: 'later', deliveryState: 'pending' }]
    })

    await actions.removeQueuedMessage('q-1')

    expect(provider.cancelQueuedTurn).not.toHaveBeenCalled()
    expect(state.queuedMessages).toEqual([])
  })

  it('reordering in-flight entries propagates the queue position to the runtime', async () => {
    const provider = { moveQueuedTurn: vi.fn(async () => undefined) }
    registryMock.getProvider.mockReturnValue(provider)
    const { actions, state } = buildHarness({
      queuedMessages: [
        {
          id: 'q-1', text: 'first', clientRequestId: 'r1',
          deliveryState: 'in_flight', deliveryTurnId: 'turn_q1'
        },
        {
          id: 'q-2', text: 'second', clientRequestId: 'r2',
          deliveryState: 'in_flight', deliveryTurnId: 'turn_q2'
        }
      ]
    })

    await actions.reorderQueuedMessage('q-2', 'q-1', 'before')

    expect(state.queuedMessages.map((message) => message.id)).toEqual(['q-2', 'q-1'])
    expect(provider.moveQueuedTurn).toHaveBeenCalledWith('thr_existing', 'turn_q2', {
      beforeTurnId: 'turn_q1'
    })
  })

  it('resumeQueuedTurns starts the server queue and unparks paused runtime entries', async () => {
    const provider = {
      resumeQueuedTurns: vi.fn(async () => ({ started: true, turnId: 'turn_next' }))
    }
    registryMock.getProvider.mockReturnValue(provider)
    const recoverActiveTurn = vi.fn(async () => true)
    const { actions, state } = buildHarness({
      queuedMessages: [
        { id: 'q-1', text: 'parked', clientRequestId: 'r1', deliveryState: 'paused' },
        { id: 'q-2', text: 'local only', deliveryState: 'paused' }
      ]
    })
    state.recoverActiveTurn = recoverActiveTurn

    const resumed = await actions.resumeQueuedTurns()

    expect(resumed).toBe(true)
    expect(provider.resumeQueuedTurns).toHaveBeenCalledWith('thr_existing')
    expect(recoverActiveTurn).toHaveBeenCalled()
    expect(state.queuedMessages.map((message) => [message.id, message.deliveryState]))
      .toEqual([['q-1', 'in_flight'], ['q-2', 'paused']])
  })

  it('resumeQueuedTurns is a no-op while a turn is running', async () => {
    const provider = { resumeQueuedTurns: vi.fn(async () => ({ started: true })) }
    registryMock.getProvider.mockReturnValue(provider)
    const { actions } = buildHarness({ busy: true })

    await expect(actions.resumeQueuedTurns()).resolves.toBe(false)
    expect(provider.resumeQueuedTurns).not.toHaveBeenCalled()
  })
})

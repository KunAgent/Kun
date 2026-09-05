import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { createThreadQueueActions } from './chat-store-thread-queue-actions'
import type {
  StoreActionContext,
  ThreadActionRuntime
} from './chat-store-thread-actions-support'

const registryMock = vi.hoisted(() => ({
  getProvider: vi.fn()
}))

vi.mock('../agent/registry', () => ({
  getProvider: registryMock.getProvider
}))

type Harness = {
  set: ChatStoreSet
  get: ChatStoreGet
  persistActiveQueuedMessages: ReturnType<typeof vi.fn>
}

function makeHarness(
  queuedMessages: ChatState['queuedMessages'],
  extra: Partial<ChatState> = {}
): Harness {
  let state = { queuedMessages, ...extra } as ChatState
  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    state = { ...state, ...update }
  }
  const get: ChatStoreGet = () => state
  const persistActiveQueuedMessages = vi.fn()
  return { set, get, persistActiveQueuedMessages }
}

function makeActions(harness: Harness) {
  return createThreadQueueActions(
    { set: harness.set, get: harness.get, sseAbortRef: { current: null } } as StoreActionContext,
    { persistActiveQueuedMessages: harness.persistActiveQueuedMessages } as unknown as ThreadActionRuntime
  )
}

describe('chat store queued message edit', () => {
  beforeEach(() => {
    registryMock.getProvider.mockReset()
  })

  it('restores plain pending and plan messages, persisting the queue, and rejects missing rows', async () => {
    const harness = makeHarness([
      { id: 'q-plain', text: 'before', deliveryState: 'pending' as const },
      { id: 'q-plan', text: 'internal', displayText: 'visible', mode: 'plan' }
    ])
    const actions = makeActions(harness)

    await expect(actions.restoreQueuedMessage('q-plain')).resolves.toEqual(
      expect.objectContaining({ id: 'q-plain', text: 'before' })
    )
    expect(harness.get().queuedMessages).toEqual([
      { id: 'q-plan', text: 'internal', displayText: 'visible', mode: 'plan' }
    ])
    expect(harness.persistActiveQueuedMessages).toHaveBeenCalledOnce()

    await expect(actions.restoreQueuedMessage('q-plan')).resolves.toEqual(
      expect.objectContaining({ id: 'q-plan', text: 'internal', mode: 'plan' })
    )
    expect(harness.get().queuedMessages).toEqual([])
    expect(harness.persistActiveQueuedMessages).toHaveBeenCalledTimes(2)

    await expect(actions.restoreQueuedMessage('missing')).resolves.toBeNull()
    expect(harness.persistActiveQueuedMessages).toHaveBeenCalledTimes(2)
  })

  it('restores an image-bearing queued message, persists the queue, and rejects missing rows', async () => {
    const imageMessage = {
      id: 'q-image',
      text: 'inspect the screenshot',
      deliveryState: 'pending' as const,
      attachmentIds: ['attachment-1'],
      attachments: [{ id: 'attachment-1', kind: 'image' as const, name: 'shot.png' }]
    }
    const harness = makeHarness([imageMessage])
    const actions = makeActions(harness)

    await expect(actions.restoreQueuedMessage('q-image')).resolves.toEqual(imageMessage)
    expect(harness.get().queuedMessages).toEqual([])
    expect(harness.persistActiveQueuedMessages).toHaveBeenCalledOnce()

    await expect(actions.restoreQueuedMessage('missing')).resolves.toBeNull()
    expect(harness.persistActiveQueuedMessages).toHaveBeenCalledOnce()
  })

  it('cancels the server-side queued turn when restoring an in-flight message', async () => {
    const cancelQueuedTurn = vi.fn().mockResolvedValue(undefined)
    registryMock.getProvider.mockReturnValue({ cancelQueuedTurn })

    const harness = makeHarness([
      {
        id: 'q-flight',
        text: 'in flight',
        deliveryState: 'in_flight' as const,
        deliveryTurnId: 'turn-1',
        deliveryUserMessageItemId: 'item-1'
      }
    ], { activeThreadId: 'thr-1' })
    const actions = makeActions(harness)

    await expect(actions.restoreQueuedMessage('q-flight')).resolves.toEqual(
      expect.objectContaining({ id: 'q-flight', deliveryTurnId: 'turn-1' })
    )
    expect(cancelQueuedTurn).toHaveBeenCalledWith('thr-1', 'turn-1')
    expect(harness.get().queuedMessages).toEqual([])
  })

  it('swallows a not-found cancel error when the queued turn already started', async () => {
    registryMock.getProvider.mockReturnValue({
      cancelQueuedTurn: vi.fn().mockRejectedValue(new Error('queued turn not found'))
    })

    const harness = makeHarness([
      {
        id: 'q-flight',
        text: 'in flight',
        deliveryState: 'in_flight' as const,
        deliveryTurnId: 'turn-1'
      }
    ], { activeThreadId: 'thr-1' })
    const actions = makeActions(harness)

    await expect(actions.restoreQueuedMessage('q-flight')).resolves.toBeTruthy()
    expect(harness.get().error).toBeFalsy()
    expect(harness.get().queuedMessages).toEqual([])
  })

  it('surfaces a non-not-found cancel failure', async () => {
    registryMock.getProvider.mockReturnValue({
      cancelQueuedTurn: vi.fn().mockRejectedValue(new Error('boom'))
    })

    const harness = makeHarness([
      {
        id: 'q-flight',
        text: 'in flight',
        deliveryState: 'in_flight' as const,
        deliveryTurnId: 'turn-1'
      }
    ], { activeThreadId: 'thr-1' })
    const actions = makeActions(harness)

    await expect(actions.restoreQueuedMessage('q-flight')).resolves.toBeTruthy()
    expect(harness.get().error).toBe('boom')
    expect(harness.get().queuedMessages).toEqual([])
  })

  it('cancels the server-side queued turn when removing a runtime-owned paused message', async () => {
    const cancelQueuedTurn = vi.fn().mockResolvedValue(undefined)
    registryMock.getProvider.mockReturnValue({ cancelQueuedTurn })

    const harness = makeHarness([
      {
        id: 'q-paused',
        text: 'paused follow-up',
        deliveryState: 'paused' as const,
        deliveryTurnId: 'turn-1',
        clientRequestId: 'req-1'
      }
    ], { activeThreadId: 'thr-1' })
    const actions = makeActions(harness)

    await actions.removeQueuedMessage('q-paused')
    expect(cancelQueuedTurn).toHaveBeenCalledWith('thr-1', 'turn-1')
    expect(harness.get().queuedMessages).toEqual([])
  })

  it('cancels a just-admitted turn when the row was removed mid-drain', async () => {
    const cancelQueuedTurn = vi.fn().mockResolvedValue(undefined)
    registryMock.getProvider.mockReturnValue({ cancelQueuedTurn })

    const harness = makeHarness(
      [{ id: 'q-race', text: 'race row', deliveryState: 'pending' as const }],
      { activeThreadId: 'thr-1' }
    )
    const actions = makeActions(harness)
    const send = vi.fn(async () => {
      // Mid-send the user removes the row; the submission path re-adds it
      // with the admitted turn marker (upsert by id).
      await actions.removeQueuedMessage('q-race')
      harness.set({
        queuedMessages: [{
          id: 'q-race',
          text: 'race row',
          deliveryState: 'in_flight' as const,
          deliveryTurnId: 'turn-admitted',
          deliveryUserMessageItemId: 'item-1'
        }]
      })
      return true
    })
    harness.get().sendMessage = send

    await actions.drainQueuedMessages()
    expect(cancelQueuedTurn).toHaveBeenCalledWith('thr-1', 'turn-admitted')
    expect(harness.get().queuedMessages).toEqual([])
  })

  it('retains a failed provisional admission instead of retrying it into deletion', async () => {
    let state = {
      busy: false,
      error: null,
      queuedMessages: [{
        id: 'q-provisional',
        text: 'create the first design document',
        clientRequestId: 'request-settled',
        waitForRuntimeAdmission: true,
        deliveryState: 'failed' as const
      }]
    } as ChatState
    const set: ChatStoreSet = (partial) => {
      const update = typeof partial === 'function' ? partial(state) : partial
      state = { ...state, ...update }
    }
    const get: ChatStoreGet = () => state
    const persistActiveQueuedMessages = vi.fn()
    const actions = createThreadQueueActions(
      { set, get, sseAbortRef: { current: null } } as StoreActionContext,
      { persistActiveQueuedMessages } as unknown as ThreadActionRuntime
    )

    await expect(actions.guideQueuedMessage('q-provisional')).resolves.toBe(false)
    expect(state.queuedMessages).toEqual([
      expect.objectContaining({
        id: 'q-provisional',
        deliveryState: 'failed',
        waitForRuntimeAdmission: true
      })
    ])
    expect(state.error).toBeTruthy()
    expect(persistActiveQueuedMessages).not.toHaveBeenCalled()
  })
})

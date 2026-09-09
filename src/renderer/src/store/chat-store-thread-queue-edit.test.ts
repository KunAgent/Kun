import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { queuedMessagesForThread, reconcileQueuedMessages, isPendingQueuedMessage } from './queued-message-persistence'
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
  let state = { activeThreadId: 'thr-1', queuedMessages, ...extra } as ChatState
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
    registryMock.getProvider.mockReturnValue({})
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) }
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('restores plain pending and plan messages, persisting the queue, and rejects missing rows', async () => {
    const harness = makeHarness([
      { id: 'q-plain', text: 'before', deliveryState: 'pending' as const },
      { id: 'q-plan', text: 'internal', displayText: 'visible', mode: 'plan' }
    ])
    const actions = makeActions(harness)

    await expect(actions.restoreQueuedMessage('q-plain', () => true)).resolves.toEqual(
      expect.objectContaining({ id: 'q-plain', text: 'before' })
    )
    expect(harness.get().queuedMessages).toEqual([
      { id: 'q-plan', text: 'internal', displayText: 'visible', mode: 'plan' }
    ])
    expect(queuedMessagesForThread('thr-1')).toMatchObject(harness.get().queuedMessages)

    await expect(actions.restoreQueuedMessage('q-plan', () => true)).resolves.toEqual(
      expect.objectContaining({ id: 'q-plan', text: 'internal', mode: 'plan' })
    )
    expect(harness.get().queuedMessages).toEqual([])
    expect(queuedMessagesForThread('thr-1')).toEqual([])

    await expect(actions.restoreQueuedMessage('missing')).resolves.toBeNull()
    expect(queuedMessagesForThread('thr-1')).toEqual([])
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

    await expect(actions.restoreQueuedMessage('q-image', () => true)).resolves.toEqual({ ...imageMessage, deliveryState: 'paused', editIntent: 'restoring' })
    expect(harness.get().queuedMessages).toEqual([])
    expect(queuedMessagesForThread('thr-1')).toEqual([])

    await expect(actions.restoreQueuedMessage('missing')).resolves.toBeNull()
    expect(queuedMessagesForThread('thr-1')).toEqual([])
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

    await expect(actions.restoreQueuedMessage('q-flight', () => true)).resolves.toEqual(
      expect.objectContaining({ id: 'q-flight', deliveryTurnId: 'turn-1' })
    )
    expect(cancelQueuedTurn).toHaveBeenCalledWith('thr-1', 'turn-1')
    expect(harness.get().queuedMessages).toEqual([])
  })

  it('does not restore a message whose runtime cancellation was not confirmed', async () => {
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

    await expect(actions.restoreQueuedMessage('q-flight')).resolves.toBeNull()
    expect(harness.get().error).toBe('queued turn not found')
    expect(harness.get().queuedMessages).toHaveLength(1)
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

    await expect(actions.restoreQueuedMessage('q-flight')).resolves.toBeNull()
    expect(harness.get().error).toBe('boom')
    expect(harness.get().queuedMessages).toHaveLength(1)
  })

  it('retains cancelled payload until composer accepts, including after reconciliation', async () => {
    const cancelQueuedTurn = vi.fn(async () => undefined)
    registryMock.getProvider.mockReturnValue({ cancelQueuedTurn })
    const harness = makeHarness([{ id: 'edit', text: 'keep', deliveryState: 'in_flight', deliveryTurnId: 'turn-1' }])
    const actions = makeActions(harness)
    await expect(actions.restoreQueuedMessage('edit', () => false)).resolves.toBeNull()
    const saved = queuedMessagesForThread('thr-1')
    expect(saved[0]?.editIntent).toBe('restoring')
    expect(isPendingQueuedMessage(saved[0]!)).toBe(false)
    const recovered = reconcileQueuedMessages(saved, { busy: false }, [
      { turnId: 'turn-1', status: 'aborted', terminalCode: 'queue_cancelled' }
    ])
    expect(recovered).toHaveLength(1)
    harness.set({ queuedMessages: recovered })
    await expect(actions.restoreQueuedMessage('edit', () => true)).resolves.toBeTruthy()
    expect(cancelQueuedTurn).toHaveBeenCalledOnce()
    expect(queuedMessagesForThread('thr-1')).toEqual([])
  })

  it('does not cancel when durable handoff storage fails', async () => {
    const cancelQueuedTurn = vi.fn(async () => undefined)
    registryMock.getProvider.mockReturnValue({ cancelQueuedTurn })
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('quota') } })
    const harness = makeHarness([{ id: 'edit', text: 'keep', deliveryState: 'in_flight', deliveryTurnId: 'turn-1' }])
    await expect(makeActions(harness).restoreQueuedMessage('edit', () => true)).resolves.toBeNull()
    expect(cancelQueuedTurn).not.toHaveBeenCalled()
    expect(harness.get().queuedMessages).toHaveLength(1)
  })

  it('keeps a thread-scoped restore when the user switches threads during cancel', async () => {
    const harness = makeHarness([{ id: 'edit', text: 'keep', deliveryState: 'in_flight', deliveryTurnId: 'turn-1' }])
    registryMock.getProvider.mockReturnValue({ cancelQueuedTurn: async () => {
      harness.set({ activeThreadId: 'thr-2', queuedMessages: [] })
    } })
    const accept = vi.fn(() => true)
    await expect(makeActions(harness).restoreQueuedMessage('edit', accept)).resolves.toBeNull()
    expect(accept).not.toHaveBeenCalled()
    expect(queuedMessagesForThread('thr-1')[0]?.editIntent).toBe('restoring')
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

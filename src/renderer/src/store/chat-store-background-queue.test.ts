import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultClawSettings } from '@shared/app-settings'
import type { AgentProvider } from '../agent/types'
import { rendererRuntimeClient } from '../agent/runtime-client'
import type { ChatState } from './chat-store-types'
import { drainBackgroundQueuedMessage } from './chat-store-background-queue'
import { queuedMessagesForThread, saveQueuedMessagesForThread } from './queued-message-persistence'
import { threadActionSharedState } from './chat-store-thread-actions-support'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

function harness() {
  let state = {
    activeThreadId: 'thread-b',
    busy: true,
    blocks: [{ kind: 'assistant', id: 'b-live', text: 'working in B' }],
    queuedMessages: [{ id: 'b-queued', text: 'B follow-up', deliveryState: 'pending' }],
    threads: [
      { id: 'thread-a', title: 'A', updatedAt: '', model: 'auto', mode: 'agent', status: 'idle' },
      { id: 'thread-b', title: 'B', updatedAt: '', model: 'auto', mode: 'agent', status: 'running' }
    ],
    clawChannels: []
  } as unknown as ChatState
  return {
    get: () => state,
    set: (partial: Partial<ChatState> | ((current: ChatState) => Partial<ChatState>)) => {
      const patch = typeof partial === 'function' ? partial(state) : partial
      state = { ...state, ...patch }
    }
  }
}

function provider(sendUserMessage: AgentProvider['sendUserMessage']): AgentProvider {
  return {
    sendUserMessage,
    getThreadDetail: vi.fn(),
    getThreadState: vi.fn(async () => ({ status: 'idle', updatedAt: '', latestSeq: 1 }))
  } as unknown as AgentProvider
}

describe('background queued message delivery', () => {
  beforeEach(() => {
    rendererRuntimeClient.invalidateSettings()
    const storage = new MemoryStorage()
    vi.stubGlobal('window', {
      localStorage: storage,
      kunGui: {
        getSettings: vi.fn(async () => ({
          workspaceRoot: '/workspace/project',
          checkpointCleanup: { createEnabled: false },
          claw: defaultClawSettings()
        }))
      }
    })
    threadActionSharedState.drainingQueuedMessageThreadIds.clear()
  })

  afterEach(() => {
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
    threadActionSharedState.drainingQueuedMessageThreadIds.clear()
  })

  it('sends A next queued message after A completes without mutating active B', async () => {
    saveQueuedMessagesForThread('thread-a', [
      {
        id: 'q-finished',
        text: 'already sent',
        deliveryState: 'in_flight',
        deliveryTurnId: 'turn-a-1'
      },
      {
        id: 'q-next',
        text: 'send this next',
        clientRequestId: 'turn-client-next',
        deliveryState: 'pending',
        mode: 'agent',
        orchestration: 'direct',
        model: 'model-a',
        providerId: 'provider-a',
        reasoningEffort: 'high',
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        approvalReviewer: 'agent',
        attachmentIds: ['att-a']
      }
    ])
    const h = harness()
    const before = {
      activeThreadId: h.get().activeThreadId,
      busy: h.get().busy,
      blocks: h.get().blocks,
      queuedMessages: h.get().queuedMessages
    }
    const sendUserMessage = vi.fn(async () => ({
      threadId: 'thread-a',
      turnId: 'turn-a-2',
      userMessageItemId: 'user-a-2'
    }))
    const onTurnStarted = vi.fn()

    const result = await drainBackgroundQueuedMessage({
      threadId: 'thread-a',
      completedTurnId: 'turn-a-1',
      provider: provider(sendUserMessage),
      set: h.set,
      get: h.get,
      onTurnStarted
    })

    expect(result).toEqual({ status: 'accepted', turnId: 'turn-a-2' })
    expect(sendUserMessage).toHaveBeenCalledWith(
      'thread-a',
      expect.stringContaining('send this next'),
      expect.objectContaining({
        clientRequestId: 'turn-client-next',
        model: 'model-a',
        providerId: 'provider-a',
        reasoningEffort: 'high',
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        approvalReviewer: 'agent',
        attachmentIds: ['att-a']
      })
    )
    expect(onTurnStarted).toHaveBeenCalledWith('turn-a-2')
    expect(h.get()).toMatchObject(before)
    expect(queuedMessagesForThread('thread-a')).toEqual([
      expect.objectContaining({
        id: 'q-next',
        deliveryState: 'in_flight',
        deliveryTurnId: 'turn-a-2',
        deliveryUserMessageItemId: 'user-a-2'
      })
    ])
  })

  it('preserves messages added while the background admission request is in flight', async () => {
    saveQueuedMessagesForThread('thread-a', [
      { id: 'q-1', text: 'first', clientRequestId: 'turn-first', deliveryState: 'pending' }
    ])
    const h = harness()
    let resolveSend!: (value: { threadId: string; turnId: string }) => void
    const sendUserMessage = vi.fn(() => new Promise<{ threadId: string; turnId: string }>((resolve) => {
      resolveSend = resolve
    }))
    const sending = drainBackgroundQueuedMessage({
      threadId: 'thread-a',
      provider: provider(sendUserMessage),
      set: h.set,
      get: h.get
    })
    await vi.waitFor(() => expect(sendUserMessage).toHaveBeenCalledOnce())
    saveQueuedMessagesForThread('thread-a', [
      ...queuedMessagesForThread('thread-a'),
      { id: 'q-2', text: 'second', deliveryState: 'pending' }
    ])
    resolveSend({ threadId: 'thread-a', turnId: 'turn-a-1' })
    await sending

    expect(queuedMessagesForThread('thread-a').map((message) => [message.id, message.deliveryState])).toEqual([
      ['q-1', 'in_flight'],
      ['q-2', 'pending']
    ])
  })

  it('marks deterministic preparation failures instead of leaving starting items stuck', async () => {
    saveQueuedMessagesForThread('thread-a', [
      { id: 'q-settings', text: 'later', deliveryState: 'pending' }
    ])
    const h = harness()
    rendererRuntimeClient.invalidateSettings()
    vi.mocked(window.kunGui.getSettings).mockResolvedValueOnce({
      workspaceRoot: '/workspace/project',
      checkpointCleanup: { createEnabled: true },
      claw: defaultClawSettings()
    } as never)
    window.kunGui.createGitCheckpoint = vi.fn(() => {
      throw new Error(JSON.stringify({ code: 'task_surface_locked', message: 'bad checkpoint' }))
    }) as never

    const result = await drainBackgroundQueuedMessage({
      threadId: 'thread-a',
      provider: provider(vi.fn()),
      set: h.set,
      get: h.get
    })

    expect(result).toEqual({ status: 'failed' })
    expect(queuedMessagesForThread('thread-a')).toEqual([
      expect.objectContaining({ id: 'q-settings', deliveryState: 'failed' })
    ])
  })

  it('sends only one pending item per completed background turn', async () => {
    saveQueuedMessagesForThread('thread-a', [
      { id: 'q-1', text: 'first', deliveryState: 'pending' },
      { id: 'q-2', text: 'second', deliveryState: 'pending' }
    ])
    const h = harness()
    const sendUserMessage = vi.fn(async () => ({ threadId: 'thread-a', turnId: 'turn-a-1' }))

    await drainBackgroundQueuedMessage({
      threadId: 'thread-a',
      provider: provider(sendUserMessage),
      set: h.set,
      get: h.get
    })

    expect(sendUserMessage).toHaveBeenCalledOnce()
    expect(queuedMessagesForThread('thread-a').map((message) => [message.id, message.deliveryState])).toEqual([
      ['q-1', 'in_flight'],
      ['q-2', 'pending']
    ])
  })

  it('returns a busy rejection to pending and keeps it durable', async () => {
    saveQueuedMessagesForThread('thread-a', [
      { id: 'q-busy', text: 'later', clientRequestId: 'turn-busy', deliveryState: 'pending' }
    ])
    const h = harness()
    const busyProvider = provider(vi.fn(async () => {
      throw new Error(JSON.stringify({ code: 'thread_busy', message: 'busy' }))
    }))
    vi.mocked(busyProvider.getThreadState).mockResolvedValue({
      status: 'running', updatedAt: '', latestSeq: 2, latestTurnId: 'turn-live', latestTurnStatus: 'running'
    })
    const onTurnStarted = vi.fn()

    const result = await drainBackgroundQueuedMessage({
      threadId: 'thread-a',
      provider: busyProvider,
      set: h.set,
      get: h.get,
      onTurnStarted
    })

    expect(result).toEqual({ status: 'busy' })
    expect(queuedMessagesForThread('thread-a')).toEqual([
      expect.objectContaining({ id: 'q-busy', deliveryState: 'pending' })
    ])
    expect(onTurnStarted).toHaveBeenCalledWith('turn-live')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { useGraphStore } from '../graph/graph-store'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import type { BrowserStorageLike } from '../lib/browser-storage'
import {
  queuedMessagesForThread,
  saveQueuedMessagesForThread
} from './queued-message-persistence'
import { clearThreadSnapshotCache, getThreadSnapshot } from './thread-snapshot-cache'

const registryMock = vi.hoisted(() => ({
  getProvider: vi.fn()
}))

vi.mock('../agent/registry', () => ({
  getProvider: registryMock.getProvider
}))

import { createThreadActions } from './chat-store-thread-actions'

class MemoryStorage implements BrowserStorageLike {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function deferredValue<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function thread(id: string): NormalizedThread {
  return {
    id,
    title: id,
    updatedAt: '2026-06-09T00:00:00.000Z',
    model: 'deepseek-v4-pro',
    mode: 'agent',
    workspace: '/workspace/deepseek-gui',
    status: 'running'
  }
}

function buildHarness(): {
  actions: ReturnType<typeof createThreadActions>
  state: ChatState
} {
  let state: ChatState
  state = {
    activeThreadId: 'thr_existing',
    blocks: [],
    busy: true,
    clawChannels: [],
    codeWorkspaceRoots: [],
    composerModel: '',
    composerModelGroups: [],
    composerMode: 'agent',
    composerOrchestration: 'direct',
    composerPickList: [],
    composerProviderId: '',
    currentTurnId: null,
    currentTurnOrchestration: null,
    currentTurnUserId: null,
    error: null,
    extensionComposerContexts: [],
    lastSeq: 0,
    loadComposerModels: vi.fn(async () => undefined),
    queuedMessages: [],
    recoverActiveTurn: vi.fn(async () => true),
    refreshThreads: vi.fn(async () => undefined),
    route: 'chat',
    runtimeConnection: 'ready',
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    turnStartedAtByUserId: {},
    threads: [thread('thr_existing')]
  } as unknown as ChatState

  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: ChatStoreGet = () => state
  const actions = createThreadActions({
    set,
    get,
    sseAbortRef: { current: null }
  })
  state.sendMessage = actions.sendMessage
  return { actions, state }
}

function idleThreadDetail(threadId: string) {
  return {
    threadId,
    blocks: [],
    latestSeq: 0,
    threadStatus: 'idle' as const,
    latestTurnId: null,
    latestTurnStatus: null
  }
}

describe('chat-store-thread-actions guidance with thread switching', () => {
  beforeEach(() => {
    clearThreadSnapshotCache()
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
    registryMock.getProvider.mockReturnValue({})
    useGraphStore.setState({
      threadId: null,
      runs: [],
      selectedRunId: null,
      selectedNodeId: null,
      error: null
    })
  })

  afterEach(() => {
    useWriteWorkspaceStore.getState().resetWorkspace()
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  it('does not resurrect a guided queued message after switching away and back', async () => {
    const storage = new MemoryStorage()
    vi.stubGlobal('window', { localStorage: storage })
    const steer = deferredValue<void>()
    const provider = {
      steerUserMessage: vi.fn(() => steer.promise),
      sendUserMessage: vi.fn(),
      getThreadDetail: vi.fn(async (threadId: string) => {
        if (threadId === 'thr_existing') {
          return {
            threadId,
            blocks: [
              {
                id: 'q-guide',
                kind: 'user' as const,
                turnId: 'turn_active',
                createdAt: '2026-06-09T00:00:01.000Z',
                text: 'Use the compact logo instead',
                meta: { displayText: 'Use the compact logo instead' }
              },
              {
                id: 'a-1',
                kind: 'assistant' as const,
                turnId: 'turn_active',
                text: 'done'
              }
            ],
            latestSeq: 3,
            threadStatus: 'idle' as const,
            latestTurnId: 'turn_active',
            latestTurnOrchestration: 'direct' as const,
            latestUserMessageId: 'q-guide'
          }
        }
        return idleThreadDetail(threadId)
      }),
      subscribeThreadEvents: vi.fn(async () => ({ streamId: 'stream-1' }))
    }
    registryMock.getProvider.mockReturnValue(provider)
    const { actions, state } = buildHarness()
    const sendMessage = vi.fn(async () => false)
    state.sendMessage = sendMessage as unknown as ChatState['sendMessage']
    state.threads = [thread('thr_existing'), thread('thr_other')]
    state.currentTurnId = 'turn_active'
    state.currentTurnUserId = 'user-original'
    state.queuedMessages = [{
      id: 'q-guide',
      text: 'use the compact logo instead',
      displayText: 'Use the compact logo instead',
      mode: 'plan',
      deliveryState: 'pending'
    }]
    saveQueuedMessagesForThread('thr_existing', state.queuedMessages)

    // Guidance starts while A is active and its steer request stays pending.
    const guiding = actions.guideQueuedMessage('q-guide')
    expect(provider.steerUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'turn_active',
      'use the compact logo instead',
      { displayText: 'Use the compact logo instead' }
    )

    // Switch to B before the runtime answers; A's parked snapshot keeps Q.
    await actions.selectThread('thr_other')
    expect(state.activeThreadId).toBe('thr_other')
    expect(getThreadSnapshot('thr_existing')?.queuedMessages.map((message) => message.id))
      .toEqual(['q-guide'])

    // Guidance completes while A is inactive: durable queue drops Q and the
    // parked snapshot is invalidated.
    steer.resolve()
    await expect(guiding).resolves.toBe(true)
    expect(queuedMessagesForThread('thr_existing')).toEqual([])
    expect(getThreadSnapshot('thr_existing')).toBeNull()

    // Switching back must not restore Q from the stale snapshot or re-send it.
    await actions.selectThread('thr_existing')
    expect(state.queuedMessages).toEqual([])
    expect(queuedMessagesForThread('thr_existing')).toEqual([])
    expect(state.blocks.filter((block) => block.id === 'q-guide')).toHaveLength(1)
    expect(sendMessage).not.toHaveBeenCalled()
    expect(provider.sendUserMessage).not.toBeCalled()
  })

  it('restores the durable queue on cache hit even when the snapshot still has a message', async () => {
    const storage = new MemoryStorage()
    vi.stubGlobal('window', { localStorage: storage })
    const provider = {
      getThreadDetail: vi.fn(async (threadId: string) => {
        if (threadId === 'thr_existing') {
          return {
            threadId,
            blocks: [{ id: 'u-1', kind: 'user' as const, turnId: 'turn-1', text: 'current task' }],
            latestSeq: 2,
            threadStatus: 'running' as const,
            latestTurnId: 'turn-1',
            latestTurnOrchestration: 'direct' as const,
            latestUserMessageId: 'u-1'
          }
        }
        return idleThreadDetail(threadId)
      }),
      subscribeThreadEvents: vi.fn(async () => ({ streamId: 'stream-2' }))
    }
    registryMock.getProvider.mockReturnValue(provider)
    const { actions, state } = buildHarness()
    state.threads = [thread('thr_existing'), thread('thr_other')]
    state.currentTurnId = 'turn-1'
    state.currentTurnUserId = 'u-1'
    state.blocks = [{ id: 'u-1', kind: 'user', turnId: 'turn-1', text: 'current task' }]
    state.queuedMessages = [{ id: 'q-stale', text: 'already consumed', deliveryState: 'pending' }]
    saveQueuedMessagesForThread('thr_existing', state.queuedMessages)

    // Hydrate A so its projection (with the queued message) is parked.
    await actions.selectThread('thr_existing')
    expect(getThreadSnapshot('thr_existing')).not.toBeNull()
    // The durable queue is consumed while the parked snapshot still has Q.
    saveQueuedMessagesForThread('thr_existing', [])
    await actions.selectThread('thr_other')
    expect(getThreadSnapshot('thr_existing')?.queuedMessages.map((message) => message.id))
      .toEqual(['q-stale'])

    // Cache hit: the durable queue wins over the parked snapshot queue.
    await actions.selectThread('thr_existing')
    expect(state.queuedMessages).toEqual([])
    expect(queuedMessagesForThread('thr_existing')).toEqual([])
  })
})

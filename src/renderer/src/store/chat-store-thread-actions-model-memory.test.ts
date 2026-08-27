import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { useGraphStore } from '../graph/graph-store'
import type { BrowserStorageLike } from '../lib/browser-storage'
import { clearThreadSnapshotCache } from './thread-snapshot-cache'
import { rememberThreadComposerSelection } from './chat-store-helpers'

const registryMock = vi.hoisted(() => ({ getProvider: vi.fn() }))

vi.mock('../agent/registry', () => ({
  getProvider: registryMock.getProvider
}))

import { createThreadActions } from './chat-store-thread-actions'

const THREAD_COMPOSER_SELECTION_STORAGE_KEY = 'kun.threadComposerSelection.v1'

class MemoryStorage implements BrowserStorageLike {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
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
    composerMode: 'agent',
    composerOrchestration: 'direct',
    composerProviderId: '',
    currentTurnId: null,
    currentTurnOrchestration: null,
    currentTurnUserId: null,
    error: 'previous error',
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

function stubRuntimeWindow(): void {
  vi.stubGlobal('window', {
    kunGui: {
      getSettings: vi.fn(async () => ({
        agents: { kun: { providerId: 'deepseek', model: 'terra' } },
        codePromptPrefix: '',
        chatWelcomeMessage: ''
      })),
      workspaceDirectoryExists: vi.fn(async () => true),
      logError: vi.fn(async () => undefined)
    }
  })
}

function readStoredSelection(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(THREAD_COMPOSER_SELECTION_STORAGE_KEY) ?? '{}')
}

describe('thread send model memory', () => {
  beforeEach(() => {
    clearThreadSnapshotCache()
    vi.stubGlobal('localStorage', new MemoryStorage())
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
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  it('does not let a drained queued message overwrite a newer user model selection', async () => {
    // A message enqueued while terra was selected keeps sending with terra,
    // but draining it after the user switched to k3 must not rewrite the
    // stored per-thread selection back to terra.
    rememberThreadComposerSelection('thr_existing', 'k3', 'test-provider', 'user')
    const sendUserMessage = vi.fn(async () => ({
      threadId: 'thr_existing',
      turnId: 'turn_drain',
      userMessageItemId: 'item_drain'
    }))
    registryMock.getProvider.mockReturnValue({
      sendUserMessage,
      subscribeThreadEvents: vi.fn(async () => undefined)
    })
    stubRuntimeWindow()
    const { actions, state } = buildHarness()
    state.busy = false
    state.route = 'chat'
    state.composerModel = 'k3'
    state.composerProviderId = 'test-provider'

    const queued = {
      id: 'q-drain-1',
      text: 'queued while terra was selected',
      mode: 'agent' as const,
      deliveryState: 'starting' as const,
      model: 'terra',
      providerId: 'test-provider'
    }

    await expect(actions.sendMessage(queued.text, queued.mode, { queued }))
      .resolves.toBe(true)

    expect(sendUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      queued.text,
      expect.objectContaining({ model: 'terra' })
    )
    expect(readStoredSelection()).toEqual({
      thr_existing: { model: 'k3', providerId: 'test-provider', source: 'user' }
    })
  })

  it('still records the sending model for a non-queued send', async () => {
    const sendUserMessage = vi.fn(async () => ({
      threadId: 'thr_existing',
      turnId: 'turn_direct',
      userMessageItemId: 'item_direct'
    }))
    registryMock.getProvider.mockReturnValue({
      sendUserMessage,
      subscribeThreadEvents: vi.fn(async () => undefined)
    })
    stubRuntimeWindow()
    const { actions, state } = buildHarness()
    state.busy = false
    state.route = 'chat'
    state.composerModel = 'k3'
    state.composerProviderId = 'test-provider'

    await expect(actions.sendMessage('direct send on k3', 'agent')).resolves.toBe(true)

    expect(sendUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'direct send on k3',
      expect.objectContaining({ model: 'k3' })
    )
    expect(readStoredSelection()).toEqual({
      thr_existing: { model: 'k3', providerId: 'test-provider', source: 'user' }
    })
  })
})

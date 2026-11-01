import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { rendererRuntimeClient } from '../agent/runtime-client'
import type { BrowserStorageLike } from '../lib/browser-storage'
import { clearThreadSnapshotCache } from './thread-snapshot-cache'
import {
  EMPTY_THREAD_ACTIVATION_STORAGE_KEY,
  hydrateEmptyThreadActivations,
  resetSidebarThreadPromotions
} from '../lib/empty-thread-activation'
import { releaseThreadCreation, threadCreationIntentKey } from './thread-creation-intent'

const registryMock = vi.hoisted(() => ({ getProvider: vi.fn() }))
vi.mock('../agent/registry', () => ({ getProvider: registryMock.getProvider }))

import { createThreadActions } from './chat-store-thread-actions'

const WORKSPACE = '/workspace/deepseek-gui'

class MemoryStorage implements BrowserStorageLike {
  private readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

function emptyThread(id: string, extra: Partial<NormalizedThread> = {}): NormalizedThread {
  return {
    id,
    title: '',
    updatedAt: '2026-10-27T04:00:00.000Z',
    model: 'deepseek-v4-pro',
    mode: 'agent',
    workspace: WORKSPACE,
    status: 'idle',
    turnCount: 0,
    agentSurface: 'code',
    ...extra
  }
}

function buildHarness(init: Partial<ChatState> = {}): {
  actions: ReturnType<typeof createThreadActions>
  state: ChatState
  storage: MemoryStorage
} {
  const storage = (window as unknown as { localStorage: MemoryStorage }).localStorage
  const state = {
    activeThreadId: null,
    adeThreads: [],
    blocks: [],
    busy: false,
    busyUnconfirmed: false,
    clawChannels: [],
    codeWorkspaceRoots: [],
    composerModel: '',
    composerMode: 'agent',
    composerOrchestration: 'direct',
    composerProviderId: '',
    composerModelGroups: [],
    currentTurnId: null,
    error: null,
    extensionComposerContexts: [],
    lastSeq: 0,
    queuedMessages: [],
    route: 'chat',
    runtimeConnection: 'ready',
    threads: [],
    refreshThreads: vi.fn(async () => undefined),
    refreshAdeThreads: vi.fn(async () => undefined),
    ...init
  } as unknown as ChatState
  const set: ChatStoreSet = (partial) => {
    Object.assign(state, typeof partial === 'function' ? partial(state) : partial)
  }
  const get: ChatStoreGet = () => state
  const actions = createThreadActions({ set, get, sseAbortRef: { current: null } })
  return { actions, state, storage }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const projectDefaults = {
  workspaceRoot: WORKSPACE,
  revision: 'rev-7',
  value: { isolation: 'local' as const }
}

describe('New session reuse', () => {
  beforeEach(() => {
    clearThreadSnapshotCache()
    resetSidebarThreadPromotions()
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
    vi.stubGlobal('window', {
      localStorage: new MemoryStorage(),
      kunGui: {
        getSettings: vi.fn(async () => ({
          workspaceRoot: WORKSPACE,
          agents: { kun: { subagents: { profiles: [] } } }
        })),
        workspaceDirectoryExists: vi.fn(async () => true)
      }
    })
    hydrateEmptyThreadActivations(new MemoryStorage())
  })

  afterEach(() => {
    rendererRuntimeClient.invalidateSettings()
    clearThreadSnapshotCache()
    resetSidebarThreadPromotions()
    vi.unstubAllGlobals()
  })

  it('reuses the current empty session even when the project has default settings', async () => {
    const createThreadProvider = vi.fn()
    registryMock.getProvider.mockReturnValue({ createThread: createThreadProvider, getThreadDetail: vi.fn() })
    const selectThread = vi.fn(async () => undefined)
    const { actions, state, storage } = buildHarness()
    hydrateEmptyThreadActivations(storage)
    state.activeThreadId = 'thr_empty'
    state.threads = [emptyThread('thr_empty')]
    state.composerProjectDefaults = projectDefaults as never
    state.selectThread = selectThread as never

    await expect(actions.createThread({ workspaceRoot: WORKSPACE })).resolves.toBe('thr_empty')

    expect(createThreadProvider).not.toHaveBeenCalled()
    expect(selectThread).not.toHaveBeenCalled()
    expect(state.threads.map((thread) => thread.id)).toEqual(['thr_empty'])
    // The click still shows as recent activity without rewriting the thread row.
    expect(state.threads[0]!.updatedAt).toBe('2026-10-27T04:00:00.000Z')
    expect(JSON.parse(storage.getItem(EMPTY_THREAD_ACTIVATION_STORAGE_KEY) ?? '{}').activatedAt)
      .toHaveProperty('thr_empty')
  })

  it('shares one creation between rapid clicks and returns the same thread', async () => {
    const created = deferred<NormalizedThread>()
    const createThreadProvider = vi.fn(() => created.promise)
    registryMock.getProvider.mockReturnValue({ createThread: createThreadProvider, getThreadDetail: vi.fn() })
    const selectThread = vi.fn(async () => undefined)
    const { actions, state } = buildHarness()
    state.selectThread = selectThread as never

    const first = actions.createThread({ workspaceRoot: WORKSPACE })
    const clicks = Array.from({ length: 9 }, () => actions.createThread({ workspaceRoot: WORKSPACE }))
    created.resolve(emptyThread('thr_created'))
    const settled = await Promise.all([first, ...clicks])

    expect(createThreadProvider).toHaveBeenCalledTimes(1)
    expect(new Set(settled)).toEqual(new Set(['thr_created']))
    expect(state.threads.map((thread) => thread.id)).toEqual(['thr_created'])
    expect(selectThread).toHaveBeenCalledTimes(1)
  })

  it('keeps an in-flight creation from hijacking the view after navigation moved on', async () => {
    const created = deferred<NormalizedThread>()
    const createThreadProvider = vi.fn(() => created.promise)
    registryMock.getProvider.mockReturnValue({ createThread: createThreadProvider, getThreadDetail: vi.fn() })
    const selectThread = vi.fn(async () => undefined)
    const { actions, state } = buildHarness()
    state.selectThread = selectThread as never

    let currentRequest = 1
    const first = actions.createThread({
      workspaceRoot: WORKSPACE,
      activationGuard: () => currentRequest === 1
    })
    currentRequest = 2
    const second = actions.createThread({
      workspaceRoot: WORKSPACE,
      activationGuard: () => currentRequest === 2
    })
    created.resolve(emptyThread('thr_shared'))
    await Promise.all([first, second])

    expect(createThreadProvider).toHaveBeenCalledTimes(1)
    expect(selectThread).toHaveBeenCalledTimes(1)
    expect(state.activeThreadId).toBe('thr_shared')
  })

  it('does not reuse an empty thread that belongs to another persona', async () => {
    const createThreadProvider = vi.fn(async () => emptyThread('thr_persona'))
    registryMock.getProvider.mockReturnValue({ createThread: createThreadProvider, getThreadDetail: vi.fn() })
    const { actions, state } = buildHarness()
    state.activeThreadId = 'thr_persona_a'
    state.threads = [emptyThread('thr_persona_a', { agentId: 'agent-a' })]
    state.selectThread = vi.fn(async () => undefined) as never

    await expect(actions.createThread({ workspaceRoot: WORKSPACE, agentId: 'agent-b' }))
      .resolves.toBe('thr_persona')
    expect(createThreadProvider).toHaveBeenCalledTimes(1)
  })

  it('does not reuse a session that already queued a message', async () => {
    const createThreadProvider = vi.fn(async () => emptyThread('thr_fresh'))
    registryMock.getProvider.mockReturnValue({ createThread: createThreadProvider, getThreadDetail: vi.fn() })
    const { actions, state } = buildHarness()
    state.activeThreadId = 'thr_busy'
    state.threads = [emptyThread('thr_busy')]
    state.queuedMessages = [{ id: 'queued-1' } as never]
    state.selectThread = vi.fn(async () => undefined) as never

    await expect(actions.createThread({ workspaceRoot: WORKSPACE })).resolves.toBe('thr_fresh')
    expect(createThreadProvider).toHaveBeenCalledTimes(1)
  })

  it('keeps explicit force-new creating its own thread', async () => {
    const createThreadProvider = vi.fn(async () => emptyThread('thr_forced'))
    registryMock.getProvider.mockReturnValue({ createThread: createThreadProvider, getThreadDetail: vi.fn() })
    const { actions, state } = buildHarness()
    state.activeThreadId = 'thr_empty'
    state.threads = [emptyThread('thr_empty')]
    state.selectThread = vi.fn(async () => undefined) as never

    await expect(actions.createThread({ workspaceRoot: WORKSPACE, forceNew: true }))
      .resolves.toBe('thr_forced')
    expect(createThreadProvider).toHaveBeenCalledTimes(1)
  })

  it('fails once and allows the next click to start over', async () => {
    const createThreadProvider = vi.fn()
      .mockRejectedValueOnce(new Error('runtime down'))
      .mockResolvedValueOnce(emptyThread('thr_retry'))
    registryMock.getProvider.mockReturnValue({ createThread: createThreadProvider, getThreadDetail: vi.fn() })
    const { actions, state } = buildHarness()
    state.selectThread = vi.fn(async () => undefined) as never

    await expect(actions.createThread({ workspaceRoot: WORKSPACE })).resolves.toBeNull()
    await expect(actions.createThread({ workspaceRoot: WORKSPACE })).resolves.toBe('thr_retry')
    expect(createThreadProvider).toHaveBeenCalledTimes(2)
  })

  it('drops a release that does not match the tracked creation', async () => {
    const creation = Promise.resolve('thr_a')
    const other = Promise.resolve('thr_b')
    releaseThreadCreation('missing-intent', creation)
    releaseThreadCreation('missing-intent', other)
    expect(threadCreationIntentKey({ workspaceRoot: WORKSPACE }, { activeThreadId: null, threads: [] }))
      .toContain(WORKSPACE)
  })
})

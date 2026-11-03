import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { rendererRuntimeClient } from '../agent/runtime-client'
import type { BrowserStorageLike } from '../lib/browser-storage'
import { clearThreadSnapshotCache, getThreadSnapshot } from './thread-snapshot-cache'

const registryMock = vi.hoisted(() => ({ getProvider: vi.fn() }))
vi.mock('../agent/registry', () => ({ getProvider: registryMock.getProvider }))

import { createThreadActions } from './chat-store-thread-actions'

class MemoryStorage implements BrowserStorageLike {
  private readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

function buildHarness(): { actions: ReturnType<typeof createThreadActions>; state: ChatState } {
  const state = {
    activeThreadId: null,
    blocks: [],
    busy: false,
    clawChannels: [],
    codeWorkspaceRoots: [],
    composerModel: '',
    composerMode: 'agent',
    composerOrchestration: 'direct',
    composerProviderId: '',
    currentTurnId: null,
    error: null,
    extensionComposerContexts: [],
    lastSeq: 0,
    queuedMessages: [],
    route: 'chat',
    runtimeConnection: 'ready',
    threads: []
  } as unknown as ChatState
  const set: ChatStoreSet = (partial) => {
    Object.assign(state, typeof partial === 'function' ? partial(state) : partial)
  }
  const get: ChatStoreGet = () => state
  const actions = createThreadActions({ set, get, sseAbortRef: { current: null } })
  return { actions, state }
}

describe('createThread for a project', () => {
  beforeEach(() => {
    clearThreadSnapshotCache()
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
    vi.stubGlobal('window', {
      localStorage: new MemoryStorage(),
      kunGui: {
        getSettings: vi.fn(async () => ({
          workspaceRoot: '/workspace/deepseek-gui',
          agents: { kun: { subagents: { profiles: [] } } }
        })),
        workspaceDirectoryExists: vi.fn(async () => true)
      }
    })
  })

  afterEach(() => {
    rendererRuntimeClient.invalidateSettings()
    clearThreadSnapshotCache()
    vi.unstubAllGlobals()
  })

  it('seeds the new thread for an instant selection and does not wait for the sidebar refresh', async () => {
    const selectThread = vi.fn(async () => undefined)
    let releaseRefresh: () => void = () => undefined
    const refreshThreads = vi.fn(() => new Promise<void>((resolve) => { releaseRefresh = resolve }))
    const getThreadDetail = vi.fn()
    const createThreadProvider = vi.fn(async () => ({
      id: 'thr_new',
      title: 'New chat',
      updatedAt: '2026-10-23T00:00:00.000Z',
      model: 'deepseek-v4-pro',
      mode: 'agent',
      workspace: '/workspace/deepseek-gui',
      status: 'idle',
      turnCount: 0
    }))
    registryMock.getProvider.mockReturnValue({ createThread: createThreadProvider, getThreadDetail })
    const { actions, state } = buildHarness()
    state.selectThread = selectThread as never
    state.refreshThreads = refreshThreads as never

    await expect(actions.createThread({ workspaceRoot: '/workspace/deepseek-gui', forceNew: true }))
      .resolves.toBe('thr_new')

    // The empty page is cached before selection, so selecting needs no timeline read.
    expect(getThreadSnapshot('thr_new')).toMatchObject({ blocks: [], lastSeq: 0, busy: false })
    expect(state.activeThreadId).toBe('thr_new')
    expect(state.threads.map((thread) => thread.id)).toEqual(['thr_new'])
    expect(selectThread).toHaveBeenCalledWith('thr_new')
    expect(refreshThreads).toHaveBeenCalledTimes(1)
    expect(getThreadDetail).not.toHaveBeenCalled()
    releaseRefresh()
  })

  it('does not activate or seed a thread whose creation lost the view to newer navigation', async () => {
    const selectThread = vi.fn(async () => undefined)
    const createThreadProvider = vi.fn(async () => ({
      id: 'thr_late', title: 'New chat', updatedAt: '2026-10-23T00:00:00.000Z', model: 'deepseek-v4-pro',
      mode: 'agent', workspace: '/workspace/deepseek-gui', status: 'idle', turnCount: 0
    }))
    registryMock.getProvider.mockReturnValue({ createThread: createThreadProvider })
    const { actions, state } = buildHarness()
    state.selectThread = selectThread as never
    state.refreshThreads = vi.fn(async () => undefined) as never

    await expect(actions.createThread({
      workspaceRoot: '/workspace/deepseek-gui', forceNew: true, activationGuard: () => false
    })).resolves.toBeNull()

    expect(createThreadProvider).not.toHaveBeenCalled()
    expect(selectThread).not.toHaveBeenCalled()
    expect(getThreadSnapshot('thr_late')).toBeNull()
    expect(state.activeThreadId).toBeNull()
  })
})

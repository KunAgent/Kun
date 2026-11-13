import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentProvider } from '../agent/types'
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


describe('explicit multi-directory project creation', () => {
  afterEach(() => { rendererRuntimeClient.invalidateSettings(); clearThreadSnapshotCache(); vi.unstubAllGlobals() })
  it.each(['code', 'ade'] as const)('preserves project roots in a new local %s thread', async (workspaceMode) => {
    const createThread = vi.fn(async (options: Parameters<AgentProvider['createThread']>[0]) => ({ id: 'thr_project', title: 'New chat',
      updatedAt: '2026-11-13T00:00:00Z', model: 'model', mode: 'agent', status: 'idle', ...options }))
    registryMock.getProvider.mockReturnValue({ createThread })
    vi.stubGlobal('window', { kunGui: {
      getSettings: vi.fn(async () => ({ agents: { kun: { subagents: { profiles: [] } } } })),
      workspaceDirectoryExists: vi.fn(async () => true)
    } })
    rendererRuntimeClient.invalidateSettings()
    const { actions, state } = buildHarness()
    Object.assign(state, { composerIsolation: 'local', composerIsolationExplicitWorkspaceRoot: '/workspace/app',
      codeWorkspaceFolderSets: { version: 1, sets: [{ primary: '/workspace/app', extraRoots: ['/workspace/api'] }] },
      selectThread: vi.fn(async () => undefined), refreshThreads: vi.fn(async () => undefined),
      refreshAdeThreads: vi.fn(async () => undefined),
      threads: [{ id: 'old_empty', title: 'New chat', titleAuto: true, turnCount: 0, updatedAt: '2026-11-13T00:00:00Z',
        model: 'model', mode: 'agent', status: 'idle', workspace: '/workspace/app', additionalWorkspaces: ['/workspace/old-api'] }] })
    await expect(actions.createThread({ workspaceRoot: '/workspace/app',
      workspaceMode: workspaceMode === 'ade' ? 'ade' : undefined, forceNew: false })).resolves.toBe('thr_project')
    expect(createThread).toHaveBeenCalledWith(expect.objectContaining({
      workspace: '/workspace/app', additionalWorkspaces: ['/workspace/api']
    }))
    vi.unstubAllGlobals()
    rendererRuntimeClient.invalidateSettings()
  })
})

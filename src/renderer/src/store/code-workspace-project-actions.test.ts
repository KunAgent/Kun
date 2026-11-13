import { describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { submitCodeWorkspaceProjectDraft, syncCodeProjectCurrentThread } from './code-workspace-project-actions'

const APP = '/Users/zxy/Code/app'
const API = '/Users/zxy/Code/api'

function thread(overrides: Partial<NormalizedThread> = {}): NormalizedThread {
  return {
    id: 'thread-1',
    workspace: APP,
    status: 'idle',
    ...overrides
  } as unknown as NormalizedThread
}

function state(overrides: Partial<ChatState> = {}): ChatState {
  return {
    activeThreadId: 'thread-1',
    threads: [thread()],
    adeThreads: [],
    busy: false,
    workspaceRoot: APP,
    codeWorkspaceFolderSets: {
      version: 1,
      sets: [{ primary: APP, extraRoots: [API], displayName: 'Storefront' }]
    },
    conversationWorkspaceRoot: '',
    error: null,
    ...overrides
  } as unknown as ChatState
}

function depsWith(current: ChatState, syncThread = vi.fn(async () => true)): {
  get: ChatStoreGet
  set: ChatStoreSet
  syncThread: typeof syncThread
} {
  const set = vi.fn<ChatStoreSet>()
  return {
    get: (() => current) as ChatStoreGet,
    set,
    syncThread
  }
}

describe('syncCodeProjectCurrentThread', () => {
  it('does not report a rejected host update as synced', async () => {
    const deps = depsWith(state(), vi.fn(async () => false))
    await expect(syncCodeProjectCurrentThread(APP, deps)).resolves.toBe('failed')
  })

  it('treats an already-matching conversation scope as unchanged', async () => {
    const deps = depsWith(state({ threads: [thread({ additionalWorkspaces: [API] })] }))
    await expect(syncCodeProjectCurrentThread(APP, deps)).resolves.toBe('skipped')
    expect(deps.syncThread).not.toHaveBeenCalled()
  })

  it('syncs an idle conversation that belongs to the project', async () => {
    const deps = depsWith(state())
    await expect(syncCodeProjectCurrentThread(APP, deps)).resolves.toBe('synced')
    expect(deps.syncThread).toHaveBeenCalledWith('thread-1')
  })

  it('refuses to touch a busy or running turn', async () => {
    const busyDeps = depsWith(state({ busy: true }))
    await expect(syncCodeProjectCurrentThread(APP, busyDeps)).resolves.toBe('busy')
    expect(busyDeps.syncThread).not.toHaveBeenCalled()

    const runningDeps = depsWith(state({ threads: [thread({ status: 'running' })] }))
    await expect(syncCodeProjectCurrentThread(APP, runningDeps)).resolves.toBe('busy')
    expect(runningDeps.syncThread).not.toHaveBeenCalled()
  })

  it('does not sync a conversation from another project', async () => {
    const deps = depsWith(state({ threads: [thread({ workspace: '/Users/zxy/Code/other' })] }))
    await expect(syncCodeProjectCurrentThread(APP, deps)).resolves.toBe('skipped')
    expect(deps.syncThread).not.toHaveBeenCalled()
  })

  it('does nothing without an active conversation', async () => {
    const deps = depsWith(state({ activeThreadId: null, threads: [] }))
    await expect(syncCodeProjectCurrentThread(APP, deps)).resolves.toBe('skipped')
    expect(deps.syncThread).not.toHaveBeenCalled()
  })
})


describe('project save concurrency', () => {
  it('preserves a newer registry when directories change during validation', async () => {
    let current = state()
    const set = vi.fn<ChatStoreSet>()
    const result = await submitCodeWorkspaceProjectDraft({
      mode: 'manage', primary: APP, extraRoots: [API], displayName: 'New name'
    }, {}, {
      get: () => current,
      set,
      directoryExists: async () => {
        current = { ...current, codeWorkspaceFolderSets: { version: 1,
          sets: [{ primary: APP, extraRoots: [], displayName: 'Concurrent edit' }] } }
        return true
      }
    })
    expect(result.ok).toBe(false)
    expect(set).not.toHaveBeenCalled()
    expect(current.codeWorkspaceFolderSets.sets[0]?.displayName).toBe('Concurrent edit')
  })
})

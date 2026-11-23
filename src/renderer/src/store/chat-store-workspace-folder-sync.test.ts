import { describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import {
  retainThreadAdditionalWorkspaces,
  syncThreadAdditionalWorkspaces,
  threadFolderSetPrimary
} from './chat-store-workspace-folder-sync'

const registry = vi.hoisted(() => ({
  updateThreadAdditionalWorkspaces: vi.fn()
}))

vi.mock('../agent/registry', () => ({
  getProvider: () => ({
    updateThreadAdditionalWorkspaces: registry.updateThreadAdditionalWorkspaces
  })
}))

function thread(overrides: Partial<NormalizedThread> & Pick<NormalizedThread, 'id'>): NormalizedThread {
  return {
    title: overrides.id,
    updatedAt: 't0',
    model: 'model',
    mode: 'agent',
    ...overrides
  }
}

describe('workspace folder thread sync helpers', () => {
  it('updates an idle ADE conversation without modifying other conversations', async () => {
    registry.updateThreadAdditionalWorkspaces.mockReset()
    registry.updateThreadAdditionalWorkspaces.mockResolvedValue({ id: 'ade_1' })
    const other = thread({ id: 'code_1', workspace: '/Users/test/Code/other', status: 'idle' })
    let state = {
      activeThreadId: 'ade_1', busy: false, workspaceRoot: '/Users/test/Code/app',
      codeWorkspaceFolderSets: { version: 1, sets: [{ primary: '/Users/test/Code/app', extraRoots: ['/Users/test/Code/api'] }] },
      threads: [other], adeThreads: [thread({ id: 'ade_1', workspace: '/Users/test/Code/app', status: 'idle' })], error: null
    } as unknown as ChatState
    const set: ChatStoreSet = (partial) => { state = { ...state, ...(typeof partial === 'function' ? partial(state) : partial) } }
    await expect(syncThreadAdditionalWorkspaces({ set, get: () => state, threadId: 'ade_1' })).resolves.toBe(true)
    expect(registry.updateThreadAdditionalWorkspaces).toHaveBeenCalledWith('ade_1', ['/Users/test/Code/api'])
    expect(state.adeThreads[0]?.additionalWorkspaces).toEqual(['/Users/test/Code/api'])
    expect(state.threads).toEqual([other])
  })

  it('keeps previously loaded additional workspaces when a list payload omits them', () => {
    const retained = retainThreadAdditionalWorkspaces(
      [thread({ id: 'thr_1', workspace: '/tmp/app' }), thread({ id: 'thr_2', workspace: '/tmp/other' })],
      [thread({ id: 'thr_1', workspace: '/tmp/app', additionalWorkspaces: ['/tmp/api'] })]
    )
    expect(retained[0]?.additionalWorkspaces).toEqual(['/tmp/api'])
    expect(retained[1]?.additionalWorkspaces).toBeUndefined()
  })

  it('does not overwrite extras that the incoming payload already provided', () => {
    const retained = retainThreadAdditionalWorkspaces(
      [thread({ id: 'thr_1', additionalWorkspaces: ['/tmp/docs'] })],
      [thread({ id: 'thr_1', additionalWorkspaces: ['/tmp/api'] })]
    )
    expect(retained[0]?.additionalWorkspaces).toEqual(['/tmp/docs'])
  })

  it('resolves the folder-set primary from the thread workspace', () => {
    expect(threadFolderSetPrimary(thread({ id: 'thr_1', workspace: '/Users/zxy/Code/app/' }))).toBe('/Users/zxy/Code/app/')
    expect(threadFolderSetPrimary(null, '/Users/zxy/Code/fallback')).toBe('/Users/zxy/Code/fallback')
  })

  it('PATCHes idle threads to match the project folder set', async () => {
    registry.updateThreadAdditionalWorkspaces.mockReset()
    registry.updateThreadAdditionalWorkspaces.mockResolvedValue({
      id: 'thr_1',
      additionalWorkspaces: ['/Users/zxy/Code/api']
    })
    let state = {
      activeThreadId: 'thr_1',
      busy: false,
      workspaceRoot: '/Users/zxy/Code/app',
      codeWorkspaceFolderSets: {
        version: 1,
        sets: [{ primary: '/Users/zxy/Code/app', extraRoots: ['/Users/zxy/Code/api'] }]
      },
      threads: [thread({ id: 'thr_1', workspace: '/Users/zxy/Code/app', status: 'idle' })],
      error: null
    } as unknown as ChatState
    const set: ChatStoreSet = (partial) => {
      const update = typeof partial === 'function' ? partial(state) : partial
      state = { ...state, ...update }
    }
    const get: ChatStoreGet = () => state

    await expect(syncThreadAdditionalWorkspaces({ set, get, threadId: 'thr_1' })).resolves.toBe(true)
    expect(registry.updateThreadAdditionalWorkspaces).toHaveBeenCalledWith('thr_1', ['/Users/zxy/Code/api'])
    expect(state.threads[0]?.additionalWorkspaces).toEqual(['/Users/zxy/Code/api'])
  })

  it('defers PATCH while the thread is running', async () => {
    registry.updateThreadAdditionalWorkspaces.mockReset()
    const state = {
      activeThreadId: 'thr_1',
      busy: false,
      workspaceRoot: '/Users/zxy/Code/app',
      codeWorkspaceFolderSets: {
        version: 1,
        sets: [{ primary: '/Users/zxy/Code/app', extraRoots: ['/Users/zxy/Code/api'] }]
      },
      threads: [thread({ id: 'thr_1', workspace: '/Users/zxy/Code/app', status: 'running' })],
      error: null
    } as unknown as ChatState

    await expect(syncThreadAdditionalWorkspaces({
      set: () => undefined,
      get: () => state,
      threadId: 'thr_1'
    })).resolves.toBe(false)
    expect(registry.updateThreadAdditionalWorkspaces).not.toHaveBeenCalled()
  })

  it('drops a removed folder instead of resurrecting it from the thread snapshot', async () => {
    registry.updateThreadAdditionalWorkspaces.mockReset()
    registry.updateThreadAdditionalWorkspaces.mockResolvedValue({ id: 'thr_1' })
    let state = {
      activeThreadId: 'thr_1',
      busy: false,
      workspaceRoot: '/Users/zxy/Code/app',
      codeWorkspaceFolderSets: {
        version: 1,
        sets: [{ primary: '/Users/zxy/Code/app', extraRoots: ['/Users/zxy/Code/api'], displayName: 'Storefront' }]
      },
      threads: [thread({
        id: 'thr_1',
        workspace: '/Users/zxy/Code/app',
        status: 'idle',
        additionalWorkspaces: ['/Users/zxy/Code/api', '/Users/zxy/Code/docs']
      })],
      error: null
    } as unknown as ChatState
    const set: ChatStoreSet = (partial) => {
      const update = typeof partial === 'function' ? partial(state) : partial
      state = { ...state, ...update }
    }

    await expect(syncThreadAdditionalWorkspaces({ set, get: () => state, threadId: 'thr_1' })).resolves.toBe(true)
    expect(registry.updateThreadAdditionalWorkspaces).toHaveBeenCalledWith('thr_1', ['/Users/zxy/Code/api'])
    expect(state.threads[0]?.additionalWorkspaces).toEqual(['/Users/zxy/Code/api'])
    expect(state.codeWorkspaceFolderSets.sets[0]?.extraRoots).toEqual(['/Users/zxy/Code/api'])
  })

  it('leaves legacy threads without a project record untouched', async () => {
    registry.updateThreadAdditionalWorkspaces.mockReset()
    const state = {
      activeThreadId: 'thr_1',
      busy: false,
      workspaceRoot: '/Users/zxy/Code/legacy',
      codeWorkspaceFolderSets: { version: 1, sets: [] },
      threads: [thread({
        id: 'thr_1',
        workspace: '/Users/zxy/Code/legacy',
        status: 'idle',
        additionalWorkspaces: ['/Users/zxy/Code/docs']
      })],
      error: null
    } as unknown as ChatState

    await expect(syncThreadAdditionalWorkspaces({
      set: () => undefined,
      get: () => state,
      threadId: 'thr_1'
    })).resolves.toBe(false)
    expect(registry.updateThreadAdditionalWorkspaces).not.toHaveBeenCalled()
  })
})

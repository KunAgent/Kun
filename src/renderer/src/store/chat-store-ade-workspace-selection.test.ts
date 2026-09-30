import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskWorkspaceRecord } from '@shared/task-workspace'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { createNavigationWorkspaceActions } from './chat-store-navigation-workspace-actions'
import { useReviewStore } from './review-store'
import {
  clearThreadWorkspacePrep,
  markThreadWorkspacePreparing,
  useTaskWorkspaceStore
} from './task-workspace-store'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => { resolve = complete })
  return { promise, resolve }
}

function harness() {
  const refreshThreads = vi.fn(async () => undefined)
  const abort = vi.fn()
  let state = {
    route: 'ade',
    runtimeConnection: 'ready',
    activeThreadId: 'ade-a',
    adeDraftOpen: false,
    adeDraftRevision: 0,
    threadLoadingId: null,
    adeThreads: [{ id: 'ade-a', workspace: '/repo/a' }],
    workspaceRoot: '/repo/a',
    workspaceRootLocal: false,
    workspaceLabel: 'a',
    codeWorkspaceRoots: ['/repo/a'],
    removedCodeWorkspaces: { version: 1, removed: [] },
    conversationWorkspaceRoot: '/conversations',
    busy: false,
    queuedMessages: [],
    blocks: [{ id: 'old-block' }],
    composerIsolation: 'worktree',
    composerWorktreeStartFrom: { kind: 'branch', name: 'feature-a' },
    composerHarnessId: 'codex',
    composerModel: 'model-a',
    extensionComposerContexts: [{ threadId: 'ade-a' }],
    error: null,
    refreshThreads
  } as unknown as ChatState
  const set: ChatStoreSet = (patch) => {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
  }
  const get: ChatStoreGet = () => state
  const sseAbortRef = { current: { abort } as unknown as AbortController }
  const actions = createNavigationWorkspaceActions({ set, get, sseAbortRef })
  return { actions, get state() { return state }, set, abort, refreshThreads }
}

describe('ADE project selection', () => {
  beforeEach(() => {
    rendererRuntimeClient.invalidateSettings()
    vi.stubGlobal('window', {
      kunGui: {
        setSettings: vi.fn(async (patch: { workspaceRoot: string }) => ({
          workspaceRoot: patch.workspaceRoot
        })),
        pickWorkspaceDirectory: vi.fn(async () => ({ canceled: true }))
      }
    })
  })

  afterEach(() => {
    clearThreadWorkspacePrep('ade-a')
    useReviewStore.setState({ bindings: {} })
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  it('persists a different project and enters an ADE draft without opening Code', async () => {
    const h = harness()

    const result = await h.actions.selectAdeWorkspaceRoot('/repo/b')
    expect([result, h.state.error]).toEqual(['/repo/b', null])

    expect(window.kunGui.setSettings).toHaveBeenCalledWith({ workspaceRoot: '/repo/b' })
    expect(h.state.route).toBe('ade')
    expect(h.state.activeThreadId).toBeNull()
    expect(h.state.adeDraftOpen).toBe(true)
    expect(h.state.adeDraftRevision).toBe(1)
    expect(h.state.blocks).toEqual([])
    expect(h.state.workspaceRoot).toBe('/repo/b')
    expect(h.state.workspaceRootLocal).toBe(false)
    expect(h.state.codeWorkspaceRoots).toContain('/repo/b')
    expect(h.state.adeThreads[0]?.workspace).toBe('/repo/a')
    expect(h.state.composerIsolation).toBe('worktree')
    expect(h.state.composerWorktreeStartFrom).toBeUndefined()
    expect(h.state.composerHarnessId).toBe('codex')
    expect(h.state.composerModel).toBe('model-a')
    expect(h.state.extensionComposerContexts).toEqual([])
    expect(h.abort).toHaveBeenCalledOnce()
    expect(h.refreshThreads).toHaveBeenCalledOnce()
  })

  it('reselecting the active project preserves the session and worktree start', async () => {
    const h = harness()

    await expect(h.actions.selectAdeWorkspaceRoot('/repo/a')).resolves.toBe('/repo/a')

    expect(window.kunGui.setSettings).not.toHaveBeenCalled()
    expect(h.state.activeThreadId).toBe('ade-a')
    expect(h.state.adeDraftOpen).toBe(false)
    expect(h.state.adeDraftRevision).toBe(0)
    expect(h.state.composerWorktreeStartFrom).toEqual({ kind: 'branch', name: 'feature-a' })
    expect(h.abort).not.toHaveBeenCalled()
  })

  it('persists a renderer-local same-project pick without resetting the session', async () => {
    const h = harness()
    h.set({ workspaceRootLocal: true })

    await expect(h.actions.selectAdeWorkspaceRoot('/repo/a')).resolves.toBe('/repo/a')

    expect(window.kunGui.setSettings).toHaveBeenCalledWith({ workspaceRoot: '/repo/a' })
    expect(h.state.workspaceRootLocal).toBe(false)
    expect(h.state.activeThreadId).toBe('ade-a')
    expect(h.state.composerWorktreeStartFrom).toEqual({ kind: 'branch', name: 'feature-a' })
  })

  it('opens the ADE composer when Mission Control selects the current project', async () => {
    const h = harness()
    h.set({ activeThreadId: null, adeDraftOpen: false })

    await expect(h.actions.selectAdeWorkspaceRoot('/repo/a')).resolves.toBe('/repo/a')

    expect(h.state.adeDraftOpen).toBe(true)
    expect(h.state.adeDraftRevision).toBe(1)
    expect(window.kunGui.setSettings).not.toHaveBeenCalled()
  })

  it('keeps the draft identity when the same project is reselected', async () => {
    const h = harness()
    h.set({ activeThreadId: null, adeDraftOpen: true, adeDraftRevision: 7 })

    await expect(h.actions.selectAdeWorkspaceRoot('/repo/a')).resolves.toBe('/repo/a')

    expect(h.state.adeDraftRevision).toBe(7)
  })

  it('uses the ADE dialog and leaves state alone after cancellation', async () => {
    const h = harness()

    await expect(h.actions.chooseAdeWorkspace()).resolves.toBeNull()

    expect(window.kunGui.pickWorkspaceDirectory).toHaveBeenCalledWith('/repo/a')
    expect(window.kunGui.setSettings).not.toHaveBeenCalled()
    expect(h.state.activeThreadId).toBe('ade-a')
  })

  it('routes a directory picked in the native dialog through the same ADE selection', async () => {
    vi.mocked(window.kunGui.pickWorkspaceDirectory).mockResolvedValueOnce({
      canceled: false,
      path: '/repo/b'
    })
    const h = harness()

    await expect(h.actions.chooseAdeWorkspace()).resolves.toBe('/repo/b')

    expect(h.state.workspaceRoot).toBe('/repo/b')
    expect(h.state.route).toBe('ade')
    expect(h.state.activeThreadId).toBeNull()
  })

  it('reports persistence failures without discarding the current session', async () => {
    vi.mocked(window.kunGui.setSettings).mockRejectedValueOnce(new Error('settings unavailable'))
    const h = harness()

    await expect(h.actions.selectAdeWorkspaceRoot('/repo/b')).resolves.toBeNull()

    expect(h.state.error).toContain('settings unavailable')
    expect(h.state.activeThreadId).toBe('ade-a')
    expect(h.state.workspaceRoot).toBe('/repo/a')
  })

  it('rejects an internal temporary directory before writing settings', async () => {
    const h = harness()

    await expect(h.actions.selectAdeWorkspaceRoot('/tmp/generated-worktree')).resolves.toBeNull()

    expect(window.kunGui.setSettings).not.toHaveBeenCalled()
    expect(h.state.error).toBeTruthy()
    expect(h.state.activeThreadId).toBe('ade-a')
  })

  it('blocks a project change while running, queued, or preparing a worktree', async () => {
    const h = harness()
    h.set({ busy: true })
    await expect(h.actions.selectAdeWorkspaceRoot('/repo/b')).resolves.toBeNull()
    h.set({ busy: false, queuedMessages: [{ id: 'q1' } as ChatState['queuedMessages'][number]] })
    await expect(h.actions.selectAdeWorkspaceRoot('/repo/b')).resolves.toBeNull()
    h.set({ queuedMessages: [] })
    markThreadWorkspacePreparing('ade-a', 'task-ws')
    await expect(h.actions.selectAdeWorkspaceRoot('/repo/b')).resolves.toBeNull()

    expect(window.kunGui.setSettings).not.toHaveBeenCalled()
    expect(h.state.error).toBeTruthy()
    expect(h.state.activeThreadId).toBe('ade-a')
  })

  it('rejects a second selection while the first settings write is in flight', async () => {
    const pending = deferred<{ workspaceRoot: string }>()
    vi.mocked(window.kunGui.setSettings).mockReturnValueOnce(pending.promise as never)
    const h = harness()

    const first = h.actions.selectAdeWorkspaceRoot('/repo/b')
    await expect(h.actions.selectAdeWorkspaceRoot('/repo/c')).resolves.toBeNull()
    pending.resolve({ workspaceRoot: '/repo/b' })
    await expect(first).resolves.toBe('/repo/b')

    expect(window.kunGui.setSettings).toHaveBeenCalledOnce()
    expect(h.state.workspaceRoot).toBe('/repo/b')
  })

  it('ignores a late settings response after navigation leaves ADE', async () => {
    const pending = deferred<{ workspaceRoot: string }>()
    vi.mocked(window.kunGui.setSettings).mockReturnValueOnce(pending.promise as never)
    const h = harness()

    const selection = h.actions.selectAdeWorkspaceRoot('/repo/b')
    h.set({ route: 'chat' })
    pending.resolve({ workspaceRoot: '/repo/b' })
    await expect(selection).resolves.toBeNull()

    expect(h.state.route).toBe('chat')
    expect(h.state.workspaceRoot).toBe('/repo/a')
    expect(h.state.activeThreadId).toBe('ade-a')
  })

  it('ignores a dialog result after leaving ADE', async () => {
    const pending = deferred<{ canceled: boolean; path: string }>()
    vi.mocked(window.kunGui.pickWorkspaceDirectory).mockReturnValueOnce(pending.promise)
    const h = harness()

    const selection = h.actions.chooseAdeWorkspace()
    h.set({ route: 'chat' })
    pending.resolve({ canceled: false, path: '/repo/b' })
    await expect(selection).resolves.toBeNull()

    expect(window.kunGui.setSettings).not.toHaveBeenCalled()
    expect(h.state.workspaceRoot).toBe('/repo/a')
  })

  it('uses the bound task workspace source when comparing the active project', async () => {
    const h = harness()
    h.set({
      workspaceRoot: '/repo/other',
      adeThreads: [{ id: 'ade-a', workspace: '/task-worktrees/ade-a', taskWorkspaceId: 'task-ws' }] as ChatState['adeThreads']
    })
    useTaskWorkspaceStore.setState({
      prepByThread: {
        'ade-a': {
          ownerThreadId: 'ade-a',
          workspaceId: 'task-ws',
          state: 'ready',
          path: '/task-worktrees/ade-a',
          sourceRoot: '/repo/a'
        }
      }
    })

    await expect(h.actions.selectAdeWorkspaceRoot('/repo/a')).resolves.toBe('/repo/a')

    expect(h.state.activeThreadId).toBe('ade-a')
    expect(h.state.composerWorktreeStartFrom).toEqual({ kind: 'branch', name: 'feature-a' })
    expect(h.state.workspaceRoot).toBe('/repo/a')
    expect(h.abort).not.toHaveBeenCalled()
  })

  it('uses a reopened task workspace binding when prep state is unavailable', async () => {
    const h = harness()
    h.set({
      workspaceRoot: '/repo/other',
      adeThreads: [{ id: 'ade-a', workspace: '/task-worktrees/ade-a', taskWorkspaceId: 'task-ws' }] as ChatState['adeThreads']
    })
    useReviewStore.setState({
      bindings: {
        'ade-a': { sourceRoot: '/repo/a', workspaceId: 'task-ws' } as TaskWorkspaceRecord
      }
    })

    await expect(h.actions.selectAdeWorkspaceRoot('/repo/a')).resolves.toBe('/repo/a')

    expect(h.state.activeThreadId).toBe('ade-a')
    expect(h.state.workspaceRoot).toBe('/repo/a')
    expect(h.abort).not.toHaveBeenCalled()
  })

  it('applies non-Git fallback only to the draft isolation state', () => {
    const h = harness()
    h.set({ activeThreadId: null })

    h.actions.setComposerIsolationForWorkspace('local')

    expect(h.state.composerIsolation).toBe('local')
    expect(h.state.composerWorktreeStartFrom).toBeUndefined()
  })
})

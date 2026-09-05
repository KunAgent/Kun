import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import type { BrowserStorageLike } from '../lib/browser-storage'
import { readRemovedCodeWorkspaces } from '../lib/removed-code-workspaces'
import { createRemoveWorkspaceAction } from './chat-store-navigation-workspace-removal'
import {
  preservedRootsForReconcile,
  threadBelongsToRemovedCodeProject
} from './chat-store-navigation-workspace-removal'

vi.mock('../lib/apply-theme', () => ({
  applyCursorSpotlight: vi.fn(),
  applyCursorSpotlightColor: vi.fn(),
  applyTheme: vi.fn(),
  applyUiFontScale: vi.fn(),
  applyChatContentMaxWidth: vi.fn(),
  applyDocumentLocale: vi.fn()
}))

class MemoryStorage implements BrowserStorageLike {
  private readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

function thread(overrides: Partial<NormalizedThread> & Pick<NormalizedThread, 'id' | 'workspace'>): NormalizedThread {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    updatedAt: overrides.updatedAt ?? '2026-08-28T00:00:00.000Z',
    model: overrides.model ?? 'deepseek-v4-pro',
    mode: overrides.mode ?? 'agent',
    workspace: overrides.workspace,
    ...(overrides.archived !== undefined ? { archived: overrides.archived } : {})
  }
}

function buildHarness(options?: {
  workspaceRoot?: string
  threads?: NormalizedThread[]
  codeWorkspaceRoots?: string[]
  activeThreadId?: string | null
  lastCodeThreadId?: string | null
  setSettings?: ReturnType<typeof vi.fn>
}) {
  const storage = new MemoryStorage()
  vi.stubGlobal('window', {
    localStorage: storage,
    ...(options?.setSettings ? { kunGui: { setSettings: options.setSettings } } : {})
  })
  let state = {
    activeThreadId: options?.activeThreadId === undefined
      ? options?.threads?.[0]?.id ?? null
      : options.activeThreadId,
    lastCodeThreadId: options?.lastCodeThreadId ?? null,
    busy: false,
    codeWorkspaceRoots: options?.codeWorkspaceRoots ?? [],
    error: null,
    removedCodeWorkspaces: readRemovedCodeWorkspaces(),
    threads: options?.threads ?? [],
    workspaceLabel: options?.workspaceRoot ?? '',
    workspaceRoot: options?.workspaceRoot ?? ''
  } as unknown as ChatState
  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    state = { ...state, ...update }
  }
  const get: ChatStoreGet = () => state
  const sseAbortRef: { current: AbortController | null } = { current: null }
  const clearBusyWatchdog = vi.fn()
  const removeWorkspace = createRemoveWorkspaceAction({ set, get, sseAbortRef, clearBusyWatchdog })
  return {
    get state() { return state },
    get,
    set,
    removeWorkspace,
    sseAbortRef,
    clearBusyWatchdog
  }
}

describe('chat store workspace removal', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { localStorage: new MemoryStorage() })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('hides a non-active project without deleting any threads', async () => {
    const runtimeRequest = vi.spyOn(
      (await import('../agent/runtime-client')).rendererRuntimeClient,
      'runtimeRequest'
    )
    const harness = buildHarness({
      threads: [
        thread({ id: 'thr-a', workspace: '/Users/zxy/Code/A' }),
        thread({ id: 'thr-b', workspace: '/Users/zxy/Code/B' })
      ],
      codeWorkspaceRoots: ['/Users/zxy/Code/A', '/Users/zxy/Code/B']
    })
    // Provider must never be touched; prove it via the window bridge absence of
    // any runtime delete endpoint: guard with a spy on runtimeRequest.
    vi.spyOn(await import('../agent/runtime-client'), 'rendererRuntimeClient', 'get')
      .mockReturnValue(Object.assign(Object.create(Object.getPrototypeOf(
        (await import('../agent/runtime-client')).rendererRuntimeClient
      )), (await import('../agent/runtime-client')).rendererRuntimeClient, {
        setSettings: vi.fn(async () => ({ workspaceRoot: '' }))
      }) as typeof import('../agent/runtime-client').rendererRuntimeClient)

    await harness.removeWorkspace('/Users/zxy/Code/A', [])

    expect(runtimeRequest).not.toHaveBeenCalled()
    expect(harness.state.codeWorkspaceRoots).toEqual(['/Users/zxy/Code/B'])
    // Threads stay in memory — only the project entry is hidden.
    expect(harness.state.threads.map((item) => item.id)).toEqual(['thr-a', 'thr-b'])
    expect(readRemovedCodeWorkspaces().removed).toHaveLength(1)
    expect(readRemovedCodeWorkspaces().removed[0]?.projectPath).toBe('/Users/zxy/Code/A')
  })

  it('works while the runtime is offline and keeps the removal durable', async () => {
    const harness = buildHarness({
      threads: [thread({ id: 'thr-a', workspace: '/Users/zxy/Code/A' })],
      codeWorkspaceRoots: ['/Users/zxy/Code/A']
    })

    await harness.removeWorkspace('/Users/zxy/Code/A', [])

    expect(harness.state.workspaceRoot).toBe('')
    expect(harness.state.workspaceLabel).toBe('')
    expect(harness.state.activeThreadId).toBeNull()
    expect(harness.state.error).toBeNull()
    expect(harness.state.codeWorkspaceRoots).toEqual([])
    expect(readRemovedCodeWorkspaces().removed).toHaveLength(1)
  })

  it('clears selection and settings workspace when removing the active project', async () => {
    const setSettings = vi.fn(async () => ({ workspaceRoot: '' }))
    const harness = buildHarness({
      workspaceRoot: '/Users/zxy/Code/A',
      threads: [thread({ id: 'thr-active', workspace: '/Users/zxy/Code/A' })],
      codeWorkspaceRoots: ['/Users/zxy/Code/A'],
      setSettings
    })

    await harness.removeWorkspace('/Users/zxy/Code/A', [])

    expect(setSettings).toHaveBeenCalledWith({ workspaceRoot: '' })
    expect(harness.state.activeThreadId).toBeNull()
    expect(harness.state.workspaceRoot).toBe('')
    expect(harness.clearBusyWatchdog).toHaveBeenCalled()
  })

  it('keeps the removal when the settings sync fails and reports the error', async () => {
    const setSettings = vi.fn(async () => { throw new Error('bridge unavailable') })
    const harness = buildHarness({
      workspaceRoot: '/Users/zxy/Code/A',
      threads: [thread({ id: 'thr-active', workspace: '/Users/zxy/Code/A' })],
      codeWorkspaceRoots: ['/Users/zxy/Code/A'],
      setSettings
    })

    await harness.removeWorkspace('/Users/zxy/Code/A', [])

    expect(setSettings).toHaveBeenCalled()
    expect(harness.state.error).toBeTruthy()
    expect(harness.state.workspaceRoot).toBe('')
    expect(harness.state.workspaceLabel).toBeTruthy()
    // Removal already persisted before the failed sync.
    expect(readRemovedCodeWorkspaces().removed).toHaveLength(1)
    expect(harness.state.codeWorkspaceRoots).toEqual([])
  })

  it('does not skip removal when runtime is not ready', async () => {
    const harness = buildHarness({
      workspaceRoot: '',
      threads: [],
      codeWorkspaceRoots: ['/Users/zxy/Code/A']
    })

    await harness.removeWorkspace('/Users/zxy/Code/A', [])
    expect(harness.state.codeWorkspaceRoots).toEqual([])
  })

  it('treats authoritative custom Git worktree aliases as the same hidden project', async () => {
    const projectPath = '/Users/zxy/Code/A'
    const worktreePath = '/Users/zxy/Code/A.worktrees/feature-a'
    const worktreeThread = thread({ id: 'thr-wt', workspace: worktreePath })
    const harness = buildHarness({
      workspaceRoot: projectPath,
      threads: [worktreeThread],
      codeWorkspaceRoots: [projectPath, worktreePath]
    })

    await harness.removeWorkspace(projectPath, [worktreePath])

    expect(readRemovedCodeWorkspaces().removed[0]?.aliases).toContain(worktreePath)
    expect(threadBelongsToRemovedCodeProject(
      worktreeThread,
      harness.state.removedCodeWorkspaces
    )).toBe(true)
    expect(harness.state.codeWorkspaceRoots).toEqual([])
  })

  it('separates active-thread and selected-workspace removal effects', async () => {
    const projectA = thread({ id: 'thr-a', workspace: '/Users/zxy/Code/A' })
    const projectB = thread({ id: 'thr-b', workspace: '/Users/zxy/Code/B' })
    const harness = buildHarness({
      workspaceRoot: '/Users/zxy/Code/B',
      threads: [projectA, projectB],
      activeThreadId: 'thr-a',
      lastCodeThreadId: 'thr-a',
      codeWorkspaceRoots: ['/Users/zxy/Code/A', '/Users/zxy/Code/B']
    })

    await harness.removeWorkspace('/Users/zxy/Code/A', [])

    expect(harness.state.activeThreadId).toBeNull()
    expect(harness.state.lastCodeThreadId).toBeNull()
    expect(harness.state.workspaceRoot).toBe('/Users/zxy/Code/B')
  })

  it('keeps another active thread when only the selected workspace is removed', async () => {
    const projectB = thread({ id: 'thr-b', workspace: '/Users/zxy/Code/B' })
    const setSettings = vi.fn(async () => ({ workspaceRoot: '' }))
    const harness = buildHarness({
      workspaceRoot: '/Users/zxy/Code/A',
      threads: [projectB],
      activeThreadId: 'thr-b',
      codeWorkspaceRoots: ['/Users/zxy/Code/A', '/Users/zxy/Code/B'],
      setSettings
    })

    await harness.removeWorkspace('/Users/zxy/Code/A', [])

    expect(harness.state.workspaceRoot).toBe('')
    expect(harness.state.activeThreadId).toBe('thr-b')
    expect(setSettings).toHaveBeenCalledWith({ workspaceRoot: '' })
  })
})

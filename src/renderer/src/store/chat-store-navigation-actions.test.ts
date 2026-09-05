import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import { rendererRuntimeClient } from '../agent/runtime-client'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import type { BrowserStorageLike } from '../lib/browser-storage'
import {
  emptyDesignThreadRegistry,
  markDesignThread,
  readDesignThreadRegistry,
  saveDesignThreadRegistry
} from '../design/design-thread-registry'
import {
  activeWriteThreadForWorkspace,
  emptyWriteThreadRegistry,
  markWriteThread,
  readWriteThreadRegistry,
  saveWriteThreadRegistry
} from '../write/write-thread-registry'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import {
  isSddAssistantThread,
  markSddAssistantThread,
  readSddThreadRegistry,
  releaseSddAssistantThread,
  showSddAssistantThreadInSidebar
} from '../sdd/sdd-thread-registry'
import type { SddDraft } from '../sdd/sdd-draft-store'

const registryMock = vi.hoisted(() => ({
  getProvider: vi.fn()
}))

vi.mock('../agent/registry', () => ({
  getProvider: registryMock.getProvider
}))

const applyThemeLibMock = vi.hoisted(() => ({
  applyCursorSpotlight: vi.fn(),
  applyCursorSpotlightColor: vi.fn(),
  applyDarkUiColors: vi.fn(),
  applyTheme: vi.fn(),
  applyUiFontScale: vi.fn(),
  applyChatContentMaxWidth: vi.fn(),
  applyDocumentLocale: vi.fn(),
  applyWriteTypography: vi.fn()
}))

vi.mock('../lib/apply-theme', () => applyThemeLibMock)

import {
  REMOVED_CODE_WORKSPACES_STORAGE_KEY
} from '../lib/removed-code-workspaces'

import {
  createNavigationActions
} from './chat-store-navigation-actions'

function thread(overrides: Partial<NormalizedThread> & Pick<NormalizedThread, 'id' | 'workspace'>): NormalizedThread {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    updatedAt: overrides.updatedAt ?? '2026-06-12T00:00:00.000Z',
    model: overrides.model ?? 'deepseek-v4-pro',
    mode: overrides.mode ?? 'agent',
    workspace: overrides.workspace,
    ...(overrides.agentSurface ? { agentSurface: overrides.agentSurface } : {}),
    ...(overrides.status ? { status: overrides.status } : {}),
    ...(overrides.archived !== undefined ? { archived: overrides.archived } : {})
  }
}

class MemoryStorage implements BrowserStorageLike {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('requirement session lifecycle', () => {
  const draft: SddDraft = {
    id: 'draft-1',
    workspaceRoot: '/tmp/app',
    relativePath: '.kunsdd/requirements/draft-1/requirement.md',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
  const requirementThread = thread({
    id: 'thread-sdd-1',
    title: 'Requirement draft',
    workspace: '/tmp/app'
  })

  it('stays bound to its draft until released into Code', () => {
    const storage = new MemoryStorage()
    markSddAssistantThread(draft, requirementThread.id, storage)

    let registry = readSddThreadRegistry(storage)
    expect(isSddAssistantThread(requirementThread, registry)).toBe(true)

    showSddAssistantThreadInSidebar(requirementThread.id, storage)
    registry = readSddThreadRegistry(storage)
    expect(isSddAssistantThread(requirementThread, registry)).toBe(true)

    releaseSddAssistantThread(requirementThread.id, storage)
    registry = readSddThreadRegistry(storage)
    expect(isSddAssistantThread(requirementThread, registry)).toBe(false)
  })
})

function buildHarness(overrides?: {
  subscribeThreadEventsLive?: ReturnType<typeof vi.fn>
  recoverActiveTurn?: ReturnType<typeof vi.fn>
  applyI18nFromSettings?: ReturnType<typeof vi.fn>
  probeRuntime?: ReturnType<typeof vi.fn>
  loadComposerModels?: ReturnType<typeof vi.fn>
}): {
  actions: ReturnType<typeof createNavigationActions>
  state: ChatState
  createThread: ReturnType<typeof vi.fn>
  refreshThreads: ReturnType<typeof vi.fn>
  selectThread: ReturnType<typeof vi.fn>
  subscribeThreadEventsLive: ReturnType<typeof vi.fn>
  recoverActiveTurn: ReturnType<typeof vi.fn>
} {
  const createThread = vi.fn(async () => undefined)
  const refreshThreads = vi.fn(async () => undefined)
  const selectThread = vi.fn(async () => undefined)
  const subscribeThreadEventsLive = overrides?.subscribeThreadEventsLive ?? vi.fn(async () => undefined)
  const recoverActiveTurn = overrides?.recoverActiveTurn ?? vi.fn(async () => true)
  const applyI18nFromSettings = overrides?.applyI18nFromSettings ?? vi.fn(async () => undefined)
  const probeRuntime = overrides?.probeRuntime ?? vi.fn(async () => undefined)
  const loadComposerModels = overrides?.loadComposerModels ?? vi.fn(async () => undefined)
  let state = {
    activeThreadId: 'thr_default',
    applyI18nFromSettings,
    busy: false,
    clawChannels: [],
    codeWorkspaceRoots: ['~/.kun/default_workspace'],
    composerPickList: [],
    createThread,
    currentTurnId: null,
    currentTurnUserId: null,
    error: null,
    loadComposerModels,
    openWrite: vi.fn(async () => undefined),
    probeRuntime,
    refreshThreads,
    route: 'chat',
    runtimeConnection: 'ready',
    selectThread,
    subscribeThreadEventsLive,
    recoverActiveTurn,
    threads: [
      thread({
        id: 'thr_default',
        title: 'Only default thread',
        workspace: '~/.kun/default_workspace'
      })
    ],
    unreadThreadIds: {},
    watchTurnCompletion: {},
    workspaceLabel: 'default_workspace',
    workspaceRoot: '~/.kun/default_workspace'
  } as unknown as ChatState

  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    state = { ...state, ...update }
  }
  const get: ChatStoreGet = () => state
  return {
    actions: createNavigationActions({
      set,
      get,
      sseAbortRef: { current: null }
    }),
    get state() {
      return state
    },
    createThread,
    refreshThreads,
    selectThread,
    subscribeThreadEventsLive,
    recoverActiveTurn
  }
}

describe('chat-store navigation workspace selection', () => {
  beforeEach(() => {
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
  })

  afterEach(() => {
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  it('does not move the only default thread into a newly picked empty workspace', async () => {
    const provider = {
      updateThreadWorkspace: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    const pickWorkspaceDirectory = vi.fn(async () => ({
      canceled: false,
      path: '/Users/zxy/new-project'
    }))
    const setSettings = vi.fn(async () => ({
      workspaceRoot: '/Users/zxy/new-project'
    }))
    vi.stubGlobal('window', {
      kunGui: {
        pickWorkspaceDirectory,
        setSettings
      }
    })
    const harness = buildHarness()

    await expect(harness.actions.chooseWorkspace()).resolves.toBe('/Users/zxy/new-project')

    expect(pickWorkspaceDirectory).toHaveBeenCalledWith('~/.kun/default_workspace')
    expect(setSettings).toHaveBeenCalledWith({ workspaceRoot: '/Users/zxy/new-project' })
    expect(provider.updateThreadWorkspace).not.toHaveBeenCalled()
    expect(harness.state.threads.find((item) => item.id === 'thr_default')?.workspace)
      .toBe('~/.kun/default_workspace')
    expect(harness.createThread).toHaveBeenCalledWith({ workspaceRoot: '/Users/zxy/new-project' })
    expect(harness.selectThread).not.toHaveBeenCalled()
  })

  it('selectWorkspaceRoot persists the directory and lands on a clean new conversation', async () => {
    const setSettings = vi.fn(async () => ({ workspaceRoot: '/Users/zxy/new-project' }))
    vi.stubGlobal('window', { kunGui: { setSettings } })
    const harness = buildHarness()

    await expect(harness.actions.selectWorkspaceRoot('/Users/zxy/new-project'))
      .resolves.toBe('/Users/zxy/new-project')

    expect(setSettings).toHaveBeenCalledWith({ workspaceRoot: '/Users/zxy/new-project' })
    expect(harness.state.workspaceRoot).toBe('/Users/zxy/new-project')
    expect(harness.state.workspaceLabel).toBe('new-project')
    // Clean empty-hero state so typing starts a fresh thread in the new directory.
    expect(harness.state.activeThreadId).toBeNull()
    expect(harness.state.blocks).toEqual([])
    expect(harness.state.codeWorkspaceRoots).toContain('/Users/zxy/new-project')
    expect(harness.refreshThreads).toHaveBeenCalled()
    // The default thread is preserved in the listing, just not active.
    expect(harness.selectThread).not.toHaveBeenCalled()
    expect(harness.createThread).not.toHaveBeenCalled()
  })

  it('selectWorkspaceRoot ignores an empty path', async () => {
    const setSettings = vi.fn(async () => ({ workspaceRoot: '' }))
    vi.stubGlobal('window', { kunGui: { setSettings } })
    const harness = buildHarness()

    await expect(harness.actions.selectWorkspaceRoot('   ')).resolves.toBeNull()
    expect(setSettings).not.toHaveBeenCalled()
    expect(harness.state.activeThreadId).toBe('thr_default')
  })

  it('selectWorkspaceRoot does not warn before the user sends a message', async () => {
    const setSettings = vi.fn(async () => ({ workspaceRoot: '/Volumes/missing/project' }))
    const alertDialog = vi.fn(async () => undefined)
    const workspaceDirectoryExists = vi.fn(async () => false)
    vi.stubGlobal('window', {
      kunGui: {
        setSettings,
        workspaceDirectoryExists,
        alertDialog
      }
    })
    const harness = buildHarness()

    await expect(harness.actions.selectWorkspaceRoot('/Volumes/missing/project'))
      .resolves.toBe('/Volumes/missing/project')

    expect(setSettings).toHaveBeenCalledOnce()
    expect(workspaceDirectoryExists).not.toHaveBeenCalled()
    expect(alertDialog).not.toHaveBeenCalled()
    expect(harness.state.workspaceRoot).toBe('/Volumes/missing/project')
  })

  it('keeps a missing current workspace without warning during boot', async () => {
    const alertDialog = vi.fn(async () => undefined)
    const workspaceDirectoryExists = vi.fn(async () => false)
    const setSettings = vi.fn()
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(async () => ({
          workspaceRoot: 'E:\\missing-project',
          write: {
            defaultWorkspaceRoot: '~/.kun/write_workspace',
            activeWorkspaceRoot: '~/.kun/write_workspace',
            workspaces: []
          },
          claw: { channels: [] },
          theme: 'dark',
          uiFontScale: 1,
          chatContentMaxWidthPx: 896,
          composerSendKey: 'enter',
          locale: 'en',
          agents: { kun: { apiKey: 'test-key', model: 'deepseek-v4-pro', baseUrl: '' } },
          disabledSkillIds: []
        })),
        setSettings,
        workspaceDirectoryExists,
        alertDialog
      }
    })
    const harness = buildHarness()

    await harness.actions.boot()

    expect(harness.state.workspaceRoot).toBe('E:\\missing-project')
    expect(setSettings).not.toHaveBeenCalled()
    expect(workspaceDirectoryExists).not.toHaveBeenCalled()
    expect(alertDialog).not.toHaveBeenCalled()
    expect(harness.state.error).toBeNull()
  })

  it('does not restore a removed settings workspace during boot', async () => {
    const storage = new MemoryStorage()
    storage.setItem(REMOVED_CODE_WORKSPACES_STORAGE_KEY, JSON.stringify({
      version: 1,
      removed: [{ projectPath: '/Users/zxy/removed', aliases: [], removedAt: 'now' }]
    }))
    vi.stubGlobal('window', {
      localStorage: storage,
      kunGui: {
        getSettings: vi.fn(async () => ({
          version: 1,
          initialSetupCompleted: true,
          workspaceRoot: '/Users/zxy/removed',
          conversationWorkspaceRoot: '~/Documents/Kun',
          write: { defaultWorkspaceRoot: '', activeWorkspaceRoot: '', workspaces: [] },
          claw: { channels: [] },
          theme: 'dark',
          uiFontScale: 1,
          chatContentMaxWidthPx: 896,
          locale: 'en',
          disabledSkillIds: [],
          codeAgentPresets: [],
          agents: { kun: { graph: { enabled: false, defaultStrategy: 'direct' } } }
        }))
      }
    })
    const harness = buildHarness()

    await harness.actions.boot()

    expect(harness.state.workspaceRoot).toBe('')
    expect(harness.state.codeWorkspaceRoots).not.toContain('/Users/zxy/removed')
  })

  it('starts Kun without reopening completed onboarding when the active provider has no API key', async () => {
    vi.useFakeTimers()
    try {
      const probeRuntime = vi.fn(async () => undefined)
      vi.stubGlobal('window', {
        kunGui: {
          getSettings: vi.fn(async () => ({
            version: 1,
            initialSetupCompleted: true,
            workspaceRoot: '~/.kun/default_workspace',
            conversationWorkspaceRoot: '~/Documents/Kun',
            write: {
              defaultWorkspaceRoot: '~/.kun/write_workspace',
              activeWorkspaceRoot: '~/.kun/write_workspace',
              workspaces: []
            },
            claw: { channels: [] },
            theme: 'dark',
            uiFontScale: 1,
            chatContentMaxWidthPx: 896,
            locale: 'en',
            agents: {
              kun: {
                apiKey: '',
                providerId: 'gemini-subscription',
                model: 'auto',
                baseUrl: ''
              }
            },
            disabledSkillIds: []
          }))
        }
      })
      const harness = buildHarness({ probeRuntime })

      await harness.actions.boot()
      expect(harness.state.initialSetupOpen).not.toBe(true)

      await vi.advanceTimersByTimeAsync(900)
      expect(probeRuntime).toHaveBeenCalledWith('user')
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    { enabled: true, defaultStrategy: 'graph' as const, expected: 'graph' as const },
    { enabled: true, defaultStrategy: 'direct' as const, expected: 'direct' as const },
    { enabled: false, defaultStrategy: 'graph' as const, expected: 'direct' as const },
    { enabled: false, defaultStrategy: 'direct' as const, expected: 'direct' as const }
  ])('hydrates Graph availability and default strategy during boot ($enabled, $defaultStrategy)', async ({
    enabled,
    defaultStrategy,
    expected
  }) => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('window', {
        kunGui: {
          getSettings: vi.fn(async () => ({
            version: 1,
            initialSetupCompleted: true,
            workspaceRoot: '~/.kun/default_workspace',
            conversationWorkspaceRoot: '~/Documents/Kun',
            write: {
              defaultWorkspaceRoot: '~/.kun/write_workspace',
              activeWorkspaceRoot: '~/.kun/write_workspace',
              workspaces: []
            },
            claw: { channels: [] },
            theme: 'dark',
            uiFontScale: 1,
            chatContentMaxWidthPx: 896,
            locale: 'en',
            agents: {
              kun: {
                apiKey: 'test-key',
                model: 'deepseek-v4-pro',
                baseUrl: '',
                graph: {
                  enabled,
                  defaultStrategy
                }
              }
            },
            disabledSkillIds: []
          }))
        }
      })
      const harness = buildHarness()
      harness.state.composerOrchestration = expected === 'graph' ? 'direct' : 'graph'
      harness.state.currentTurnOrchestration = expected === 'graph' ? 'direct' : 'graph'

      await harness.actions.boot()

      expect(harness.state.graphEnabled).toBe(enabled)
      expect(harness.state.composerOrchestration).toBe(expected)
      expect(harness.state.currentTurnOrchestration).toBe(expected === 'graph' ? 'direct' : 'graph')
    } finally {
      vi.useRealTimers()
    }
  })

  it('warns when creating Write or Design threads for a missing workspace', async () => {
    const alertDialog = vi.fn(async () => undefined)
    vi.stubGlobal('window', {
      kunGui: {
        workspaceDirectoryExists: vi.fn(async () => false),
        alertDialog
      }
    })
    const harness = buildHarness()

    await expect(harness.actions.createWriteThread('/Volumes/missing/project')).resolves.toBeNull()
    await expect(harness.actions.createDesignThread('/Volumes/missing/project', 'screen-1')).resolves.toBeNull()

    expect(alertDialog).toHaveBeenCalledTimes(2)
    expect(harness.state.error).toBeTruthy()
  })

  it('can create a replacement Design thread without stealing route or selection', async () => {
    const storage = new MemoryStorage()
    const created = thread({
      id: 'thr_design_replacement',
      title: 'Design Assistant',
      workspace: '/Users/zxy/project'
    })
    registryMock.getProvider.mockReturnValue({
      createThread: vi.fn(async () => created)
    })
    vi.stubGlobal('window', {
      localStorage: storage,
      kunGui: {
        workspaceDirectoryExists: vi.fn(async () => true),
        readWorkspaceFile: vi.fn(async () => ({ ok: false as const, error: 'missing' })),
        writeWorkspaceFile: vi.fn(async (payload: { path: string; content: string }) => ({
          ok: true as const,
          path: payload.path,
          size: payload.content.length
        }))
      }
    })
    const harness = buildHarness()

    await expect(harness.actions.createDesignThread(
      '/Users/zxy/project',
      'drawing-1',
      { activate: false, suppressSettingsRedirect: true }
    )).resolves.toBe('thr_design_replacement')

    expect(harness.state.route).toBe('chat')
    expect(harness.state.activeThreadId).toBe('thr_default')
    expect(harness.selectThread).not.toHaveBeenCalled()
    expect(harness.state.threads.some((item) => item.id === created.id)).toBe(true)
  })

  it('waits for the initial Design directory binding before exposing a created thread', async () => {
    const storage = new MemoryStorage()
    const created = thread({
      id: 'thr_design_waiting',
      title: 'Design Assistant',
      workspace: '/Users/zxy/project'
    })
    const pendingWrite = deferred<{
      ok: true
      path: string
      size: number
    }>()
    const writeStarted = deferred<void>()
    registryMock.getProvider.mockReturnValue({
      createThread: vi.fn(async () => created),
      deleteThread: vi.fn(async () => undefined)
    })
    vi.stubGlobal('window', {
      localStorage: storage,
      kunGui: {
        workspaceDirectoryExists: vi.fn(async () => true),
        readWorkspaceFile: vi.fn(async () => ({ ok: false as const, error: 'missing' })),
        writeWorkspaceFile: vi.fn(() => {
          writeStarted.resolve()
          return pendingWrite.promise
        })
      }
    })
    const harness = buildHarness()
    let settled = false

    const creation = harness.actions.createDesignThread('/Users/zxy/project', 'drawing-waiting')
      .then((result) => {
        settled = true
        return result
      })
    await writeStarted.promise

    expect(settled).toBe(false)
    expect(harness.state.activeThreadId).toBe('thr_default')
    expect(harness.state.threads.some((item) => item.id === created.id)).toBe(false)

    pendingWrite.resolve({
      ok: true,
      path: '.kun-design/drawing-waiting/chat/meta.json',
      size: 1
    })
    await expect(creation).resolves.toBe('thr_design_waiting')
    expect(harness.state.activeThreadId).toBe('thr_design_waiting')
  })

  it('rejects and cleans up a new Design thread when its initial directory binding fails', async () => {
    const storage = new MemoryStorage()
    const created = thread({
      id: 'thr_design_unbound',
      title: 'Design Assistant',
      workspace: '/Users/zxy/project'
    })
    const deleteThread = vi.fn(async () => undefined)
    registryMock.getProvider.mockReturnValue({
      createThread: vi.fn(async () => created),
      deleteThread
    })
    vi.stubGlobal('window', {
      localStorage: storage,
      kunGui: {
        workspaceDirectoryExists: vi.fn(async () => true),
        readWorkspaceFile: vi.fn(async () => ({ ok: false as const, error: 'missing' })),
        writeWorkspaceFile: vi.fn(async () => ({
          ok: false as const,
          message: 'disk full'
        }))
      }
    })
    const harness = buildHarness()

    await expect(harness.actions.createDesignThread(
      '/Users/zxy/project',
      'drawing-unbound'
    )).resolves.toBeNull()

    expect(deleteThread).toHaveBeenCalledWith('thr_design_unbound')
    expect(readDesignThreadRegistry(storage).workspaces[
      `/Users/zxy/project${String.fromCharCode(0)}drawing-unbound`
    ]).toBeUndefined()
    expect(harness.state.activeThreadId).toBe('thr_default')
    expect(harness.state.threads.some((item) => item.id === created.id)).toBe(false)
    expect(harness.state.error).toContain('Design drawing conversation binding')
  })

  it('retains a recoverable registry binding when failed initial persistence cannot delete the thread', async () => {
    const storage = new MemoryStorage()
    const created = thread({
      id: 'thr_design_retry_cleanup',
      title: 'Design Assistant',
      workspace: '/Users/zxy/project'
    })
    registryMock.getProvider.mockReturnValue({
      createThread: vi.fn(async () => created),
      deleteThread: vi.fn(async () => {
        throw new Error('runtime unavailable')
      })
    })
    vi.stubGlobal('window', {
      localStorage: storage,
      kunGui: {
        workspaceDirectoryExists: vi.fn(async () => true),
        readWorkspaceFile: vi.fn(async () => ({ ok: false as const, error: 'missing' })),
        writeWorkspaceFile: vi.fn(async () => ({
          ok: false as const,
          message: 'disk full'
        }))
      }
    })
    const harness = buildHarness()

    await expect(harness.actions.createDesignThread(
      '/Users/zxy/project',
      'drawing-retry-cleanup'
    )).resolves.toBeNull()

    expect(readDesignThreadRegistry(storage).workspaces[
      `/Users/zxy/project${String.fromCharCode(0)}drawing-retry-cleanup`
    ]).toEqual({
      activeThreadId: 'thr_design_retry_cleanup',
      threadIds: ['thr_design_retry_cleanup']
    })
    expect(harness.state.error).toContain('Runtime cleanup also failed')
  })

})

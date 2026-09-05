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
import {
  emptyRemovedCodeWorkspacesRegistry,
  rememberRemovedCodeWorkspace
} from '../lib/removed-code-workspaces'

const registryMock = vi.hoisted(() => ({
  getProvider: vi.fn()
}))

vi.mock('../agent/registry', () => ({
  getProvider: registryMock.getProvider
}))

const applyThemeLibMock = vi.hoisted(() => ({
  applyCursorSpotlight: vi.fn(),
  applyCursorSpotlightColor: vi.fn(),
  applyTheme: vi.fn(),
  applyUiFontScale: vi.fn(),
  applyChatContentMaxWidth: vi.fn(),
  applyDocumentLocale: vi.fn()
}))

vi.mock('../lib/apply-theme', () => applyThemeLibMock)

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

  it('atomically activates a new Design thread and snapshots the selected Agent persona', async () => {
    const storage = new MemoryStorage()
    const created = thread({
      id: 'thr_design_new',
      title: 'Design Assistant',
      workspace: '/Users/zxy/project'
    })
    const createThread = vi.fn(async () => created)
    registryMock.getProvider.mockReturnValue({ createThread })
    vi.stubGlobal('window', {
      localStorage: storage,
      kunGui: {
        workspaceDirectoryExists: vi.fn(async () => true),
        readWorkspaceFile: vi.fn(async () => ({ ok: false as const, error: 'missing' })),
        writeWorkspaceFile: vi.fn(async (payload: { path: string; content: string }) => ({
          ok: true as const,
          path: payload.path,
          size: payload.content.length
        })),
        getSettings: vi.fn(async () => ({
          agents: {
            kun: {
              subagents: {
                profiles: [{
                  id: 'codex-primary',
                  name: 'Codex',
                  enabled: true,
                  mode: 'primary',
                  surfaces: ['design'],
                  providerId: 'codex',
                  model: 'gpt-5.6-luna',
                  systemPrompt: 'Design with Codex.'
                }]
              }
            }
          }
        }))
      }
    })
    const harness = buildHarness()
    harness.state.composerAgentId = 'codex-primary'
    harness.state.blocks = [{ kind: 'user', id: 'u-old', text: 'old conversation' }]
    harness.state.busy = true

    await expect(harness.actions.createDesignThread(
      '/Users/zxy/project',
      'drawing-new'
    )).resolves.toBe('thr_design_new')

    expect(createThread).toHaveBeenCalledWith(expect.objectContaining({
      workspace: '/Users/zxy/project',
      agentSurface: 'design',
      agentId: 'codex-primary',
      providerId: 'codex',
      model: 'gpt-5.6-luna',
      systemPrompt: 'Design with Codex.'
    }))
    expect(harness.state.activeThreadId).toBe('thr_design_new')
    expect(harness.state.route).toBe('chat')
    expect(harness.state.blocks).toEqual([])
    expect(harness.state.busy).toBe(false)
    expect(harness.state.composerAgentId).toBe('')
    expect(harness.selectThread).not.toHaveBeenCalled()
    expect(harness.refreshThreads).not.toHaveBeenCalled()
    expect(readDesignThreadRegistry(storage).workspaces[
      `/Users/zxy/project${String.fromCharCode(0)}drawing-new`
    ]?.activeThreadId).toBe('thr_design_new')
  })

  it('does not bind a Work-only primary Agent to a Design thread', async () => {
    const created = thread({
      id: 'thr_design_default',
      title: 'Design Assistant',
      workspace: '/Users/zxy/project'
    })
    const createThread = vi.fn(async (_request: unknown) => created)
    registryMock.getProvider.mockReturnValue({ createThread, deleteThread: vi.fn() })
    vi.stubGlobal('window', {
      localStorage: new MemoryStorage(),
      kunGui: {
        workspaceDirectoryExists: vi.fn(async () => true),
        readWorkspaceFile: vi.fn(async () => ({ ok: false as const, error: 'missing' })),
        writeWorkspaceFile: vi.fn(async (payload: { path: string; content: string }) => ({
          ok: true as const, path: payload.path, size: payload.content.length
        })),
        getSettings: vi.fn(async () => ({
          agents: { kun: { subagents: { profiles: [{
            id: 'work-primary', name: 'Work', enabled: true, mode: 'primary',
            surfaces: ['write'], toolPolicy: 'inherit'
          }] } } }
        }))
      }
    })
    const harness = buildHarness()
    harness.state.composerAgentId = 'work-primary'

    await harness.actions.createDesignThread('/Users/zxy/project', 'drawing-no-work-persona')

    expect(createThread).toHaveBeenCalledWith(expect.objectContaining({ agentSurface: 'design' }))
    expect(createThread.mock.calls[0]?.[0]).not.toHaveProperty('agentId')
    expect(harness.state.composerAgentId).toBe('')
  })

  it('creates Work with a write-visible primary Agent and consumes the selection', async () => {
    const storage = new MemoryStorage()
    const created = thread({
      id: 'thr_write_new',
      title: 'Write Assistant',
      workspace: '/Users/zxy/write'
    })
    const createThread = vi.fn(async () => created)
    registryMock.getProvider.mockReturnValue({ createThread })
    vi.stubGlobal('window', {
      localStorage: storage,
      kunGui: {
        workspaceDirectoryExists: vi.fn(async () => true),
        getSettings: vi.fn(async () => ({
          agents: {
            kun: {
              subagents: {
                profiles: [{
                  id: 'work-primary',
                  name: 'Work specialist',
                  enabled: true,
                  mode: 'primary',
                  surfaces: ['write'],
                  providerId: 'provider-work',
                  model: 'work-model',
                  systemPrompt: 'Work carefully.'
                }]
              }
            }
          }
        }))
      }
    })
    const harness = buildHarness()
    harness.state.composerAgentId = 'work-primary'

    await expect(harness.actions.createWriteThread('/Users/zxy/write'))
      .resolves.toBe('thr_write_new')

    expect(createThread).toHaveBeenCalledWith(expect.objectContaining({
      workspace: '/Users/zxy/write',
      agentSurface: 'write',
      agentId: 'work-primary',
      providerId: 'provider-work',
      model: 'work-model',
      systemPrompt: 'Work carefully.'
    }))
    expect(harness.state.composerAgentId).toBe('')
  })

  it('does not bind a Code-only primary Agent to a Work thread', async () => {
    const created = thread({
      id: 'thr_write_default',
      title: 'Write Assistant',
      workspace: '/Users/zxy/write'
    })
    const createThread = vi.fn(async (_request: unknown) => created)
    registryMock.getProvider.mockReturnValue({ createThread })
    vi.stubGlobal('window', {
      localStorage: new MemoryStorage(),
      kunGui: {
        workspaceDirectoryExists: vi.fn(async () => true),
        getSettings: vi.fn(async () => ({
          agents: { kun: { subagents: { profiles: [{
            id: 'code-primary', name: 'Code', enabled: true, mode: 'primary',
            surfaces: ['code'], toolPolicy: 'inherit'
          }] } } }
        }))
      }
    })
    const harness = buildHarness()
    harness.state.composerAgentId = 'code-primary'

    await harness.actions.createWriteThread('/Users/zxy/write')

    expect(createThread).toHaveBeenCalledWith(expect.objectContaining({ agentSurface: 'write' }))
    expect(createThread.mock.calls[0]?.[0]).not.toHaveProperty('agentId')
    expect(harness.state.composerAgentId).toBe('')
  })

  it('openCode keeps a registered legacy Design task active in the shared workbench', async () => {
    const storage = new MemoryStorage()
    saveDesignThreadRegistry(
      markDesignThread(
        '/Users/zxy/project',
        'login',
        'thr_design',
        emptyDesignThreadRegistry()
      ),
      storage
    )
    vi.stubGlobal('window', { localStorage: storage })
    const harness = buildHarness()
    harness.state.activeThreadId = 'thr_design'
    harness.state.workspaceRoot = '/Users/zxy/project'
    harness.state.threads = [
      thread({
        id: 'thr_design',
        title: 'Design Assistant',
        workspace: '/Users/zxy/project',
        updatedAt: '2026-06-12T10:00:00.000Z'
      }),
      thread({
        id: 'thr_code',
        title: 'Code task',
        workspace: '/Users/zxy/project',
        updatedAt: '2026-06-12T09:00:00.000Z'
      })
    ]

    await harness.actions.openCode()

    expect(harness.state.route).toBe('chat')
    expect(harness.state.activeThreadId).toBe('thr_design')
    expect(harness.selectThread).not.toHaveBeenCalled()
  })

  it('openCode keeps a standalone Design task active in the shared workbench', async () => {
    const harness = buildHarness()
    harness.state.activeThreadId = 'thr_design_durable'
    harness.state.workspaceRoot = '/Users/zxy/project'
    harness.state.threads = [
      thread({
        id: 'thr_design_durable',
        title: 'Renamed drawing conversation',
        workspace: '/Users/zxy/project',
        agentSurface: 'design',
        updatedAt: '2026-08-01T10:00:00.000Z'
      }),
      thread({
        id: 'thr_code',
        title: 'Code task',
        workspace: '/Users/zxy/project',
        agentSurface: 'code',
        updatedAt: '2026-08-01T09:00:00.000Z'
      })
    ]

    await harness.actions.openCode()

    expect(harness.state.route).toBe('chat')
    expect(harness.state.activeThreadId).toBe('thr_design_durable')
    expect(harness.selectThread).not.toHaveBeenCalled()
  })

  it('openCode keeps a migrated legacy Design task active in the shared workbench', async () => {
    const storage = new MemoryStorage()
    storage.setItem(
      'kun.design-assistant.threadRegistry.v1',
      JSON.stringify({ '/Users/zxy/project': 'thr_legacy_design' })
    )
    vi.stubGlobal('window', { localStorage: storage })
    const harness = buildHarness()
    harness.state.activeThreadId = 'thr_legacy_design'
    harness.state.workspaceRoot = '/Users/zxy/project'
    harness.state.threads = [
      thread({
        id: 'thr_legacy_design',
        title: 'Design Assistant',
        workspace: '/Users/zxy/project',
        updatedAt: '2026-06-12T10:00:00.000Z'
      }),
      thread({
        id: 'thr_code',
        title: 'Code task',
        workspace: '/Users/zxy/project',
        updatedAt: '2026-06-12T09:00:00.000Z'
      })
    ]

    await harness.actions.openCode()

    expect(harness.state.route).toBe('chat')
    expect(harness.state.activeThreadId).toBe('thr_legacy_design')
    expect(harness.selectThread).not.toHaveBeenCalled()
  })

  it('openCode clears an internal design workspace thread when no Code thread is available', async () => {
    const harness = buildHarness()
    harness.state.activeThreadId = 'thr_design'
    harness.state.workspaceRoot = '/Users/zxy/project'
    harness.state.blocks = [
      { kind: 'user', id: 'u1', text: 'design this' },
      { kind: 'assistant', id: 'a1', text: 'Done' }
    ]
    harness.state.threads = [
      thread({
        id: 'thr_design',
        title: 'Design Assistant',
        workspace: '/Users/zxy/.kun/design-workspace',
        updatedAt: '2026-06-12T10:00:00.000Z'
      })
    ]

    await harness.actions.openCode()

    expect(harness.state.route).toBe('chat')
    expect(harness.state.activeThreadId).toBeNull()
    expect(harness.state.blocks).toEqual([])
    expect(harness.selectThread).not.toHaveBeenCalled()
  })

  it('openCode restores the last selected Code thread instead of the newest one', async () => {
    const harness = buildHarness()
    harness.state.activeThreadId = null
    harness.state.lastCodeThreadId = 'thr_older'
    harness.state.threads = [
      thread({
        id: 'thr_newer',
        title: 'Newer task',
        workspace: '/Users/zxy/project',
        updatedAt: '2026-08-01T10:00:00.000Z'
      }),
      thread({
        id: 'thr_older',
        title: 'Older task',
        workspace: '/Users/zxy/project',
        updatedAt: '2026-06-12T10:00:00.000Z'
      })
    ]

    await harness.actions.openCode()

    expect(harness.state.route).toBe('chat')
    expect(harness.selectThread).toHaveBeenCalledWith('thr_older', {
      selectionGuard: expect.any(Function)
    })
  })

  it('openCode restores a requirement AI session as the Code return target', async () => {
    const storage = new MemoryStorage()
    markSddAssistantThread(
      {
        id: 'draft-1',
        workspaceRoot: '/Users/zxy/project',
        relativePath: '.kunsdd/requirements/draft-1/requirement.md'
      },
      'thr_sdd',
      storage
    )
    showSddAssistantThreadInSidebar('thr_sdd', storage)
    vi.stubGlobal('window', { localStorage: storage })
    const harness = buildHarness()
    harness.state.activeThreadId = null
    harness.state.lastCodeThreadId = 'thr_sdd'
    harness.state.workspaceRoot = '/Users/zxy/project'
    harness.state.threads = [
      thread({
        id: 'thr_sdd',
        title: 'Requirement session',
        workspace: '/Users/zxy/project',
        updatedAt: '2026-08-01T10:00:00.000Z'
      })
    ]

    await harness.actions.openCode()

    expect(harness.state.route).toBe('chat')
    expect(harness.selectThread).toHaveBeenCalledWith('thr_sdd', {
      selectionGuard: expect.any(Function)
    })
  })

  it('openCode falls back to the newest Code thread when the remembered one is archived', async () => {
    const harness = buildHarness()
    harness.state.activeThreadId = null
    harness.state.lastCodeThreadId = 'thr_archived'
    harness.state.threads = [
      thread({
        id: 'thr_newer',
        title: 'Newer task',
        workspace: '/Users/zxy/project',
        updatedAt: '2026-08-01T10:00:00.000Z'
      }),
      thread({
        id: 'thr_archived',
        title: 'Archived task',
        workspace: '/Users/zxy/project',
        updatedAt: '2026-06-12T10:00:00.000Z',
        archived: true
      })
    ]

    await harness.actions.openCode()

    expect(harness.state.route).toBe('chat')
    expect(harness.selectThread).toHaveBeenCalledWith('thr_newer', {
      selectionGuard: expect.any(Function)
    })
  })

  it('openCode falls back to a Code thread when the remembered thread no longer exists', async () => {
    const harness = buildHarness()
    harness.state.activeThreadId = null
    harness.state.lastCodeThreadId = 'thr_gone'
    harness.state.threads = [
      thread({
        id: 'thr_only',
        title: 'Only task',
        workspace: '/Users/zxy/project'
      })
    ]

    await harness.actions.openCode()

    expect(harness.state.route).toBe('chat')
    expect(harness.selectThread).toHaveBeenCalledWith('thr_only', {
      selectionGuard: expect.any(Function)
    })
  })

  it('openCode skips remembered and newer threads from a removed project', async () => {
    const harness = buildHarness()
    harness.state.activeThreadId = null
    harness.state.lastCodeThreadId = 'thr_hidden'
    harness.state.removedCodeWorkspaces = rememberRemovedCodeWorkspace(
      { projectPath: '/Users/zxy/hidden' },
      emptyRemovedCodeWorkspacesRegistry()
    )
    harness.state.threads = [
      thread({ id: 'thr_hidden', workspace: '/Users/zxy/hidden', updatedAt: '2026-08-03T00:00:00.000Z' }),
      thread({ id: 'thr_visible', workspace: '/Users/zxy/visible', updatedAt: '2026-08-01T00:00:00.000Z' })
    ]

    await harness.actions.openCode()

    expect(harness.selectThread).toHaveBeenCalledWith('thr_visible', {
      selectionGuard: expect.any(Function)
    })
    expect(harness.selectThread).not.toHaveBeenCalledWith('thr_hidden', expect.anything())
  })

})

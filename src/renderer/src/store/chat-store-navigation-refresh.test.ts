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

  it('refreshThreads reconciles stale running summaries and clears only terminal watches', async () => {
    const listed = [
      thread({ id: 'thr_done', workspace: '/Users/zxy/project', status: 'running' }),
      thread({ id: 'thr_live', workspace: '/Users/zxy/project', status: 'running' }),
      thread({ id: 'thr_retry', workspace: '/Users/zxy/project', status: 'running' })
    ]
    const provider = {
      listThreads: vi.fn(async () => listed),
      getThreadDetail: vi.fn(async () => ({ blocks: [{ kind: 'user', id: 'u', text: 'work' }] })),
      getThreadState: vi.fn(async (id: string) => {
        if (id === 'thr_done') {
          return { status: 'running', latestTurnId: 'turn_done', latestTurnStatus: 'completed' }
        }
        if (id === 'thr_live') {
          return { status: 'idle', latestTurnId: 'turn_live', latestTurnStatus: 'running' }
        }
        throw new Error('temporary failure')
      })
    }
    registryMock.getProvider.mockReturnValue(provider)
    vi.stubGlobal('window', {
      localStorage: new MemoryStorage(),
      kunGui: {
        getSettings: vi.fn(async () => ({
          write: { defaultWorkspaceRoot: '', activeWorkspaceRoot: '', workspaces: [] }
        })),
        showTurnCompleteNotification: vi.fn(async () => ({ ok: true }))
      }
    })
    const harness = buildHarness()
    harness.state.activeThreadId = null
    harness.state.threads = listed
    harness.state.watchTurnCompletion = {
      thr_done: true,
      thr_live: true,
      thr_retry: true
    }

    await harness.actions.refreshThreads()

    expect(harness.state.threads.find((item) => item.id === 'thr_done')).toMatchObject({
      status: 'idle', latestTurnId: 'turn_done', latestTurnStatus: 'completed'
    })
    expect(harness.state.threads.find((item) => item.id === 'thr_live')).toMatchObject({
      status: 'running', latestTurnId: 'turn_live', latestTurnStatus: 'running'
    })
    expect(harness.state.watchTurnCompletion).toEqual({
      thr_live: true,
      thr_retry: true
    })
  })

  it('coalesces concurrent refreshes into one request', async () => {
    const firstList = deferred<NormalizedThread[]>()
    const provider = {
      listThreads: vi.fn()
        .mockImplementationOnce(() => firstList.promise),
      getThreadDetail: vi.fn(async () => ({ blocks: [{ kind: 'user', id: 'u', text: 'work' }] })),
      getThreadState: vi.fn(async () => ({
        status: 'idle',
        latestTurnId: 'turn_new',
        latestTurnStatus: 'completed'
      }))
    }
    registryMock.getProvider.mockReturnValue(provider)
    vi.stubGlobal('window', {
      localStorage: new MemoryStorage(),
      kunGui: {
        getSettings: vi.fn(async () => ({
          write: { defaultWorkspaceRoot: '', activeWorkspaceRoot: '', workspaces: [] }
        }))
      }
    })
    const harness = buildHarness()
    harness.state.activeThreadId = null
    harness.state.threads = []
    harness.state.watchTurnCompletion = {}

    const firstRefresh = harness.actions.refreshThreads()
    const coalescedRefresh = harness.actions.refreshThreads()
    expect(provider.listThreads).toHaveBeenCalledTimes(1)
    firstList.resolve([thread({ id: 'thr_old', workspace: '/Users/zxy/project', status: 'running' })])
    await Promise.all([firstRefresh, coalescedRefresh])

    expect(provider.listThreads).toHaveBeenCalledTimes(1)
    expect(harness.state.threads.map((item) => item.id)).toEqual(['thr_old'])
  })

  it('keeps a newer running turn when a stale terminal state resolves after it started', async () => {
    const provider = {
      listThreads: vi.fn(async () => [
        thread({ id: 'thr_turn', workspace: '/Users/zxy/project', status: 'running' })
      ]),
      getThreadDetail: vi.fn(async () => ({ blocks: [{ kind: 'user', id: 'u', text: 'work' }] })),
      getThreadState: vi.fn(async () => ({
        status: 'running',
        latestTurnId: 'turn_A',
        latestTurnStatus: 'completed'
      }))
    }
    registryMock.getProvider.mockReturnValue(provider)
    vi.stubGlobal('window', {
      localStorage: new MemoryStorage(),
      kunGui: {
        getSettings: vi.fn(async () => ({
          write: { defaultWorkspaceRoot: '', activeWorkspaceRoot: '', workspaces: [] }
        }))
      }
    })
    const harness = buildHarness()
    harness.state.activeThreadId = null
    harness.state.threads = [{
      ...thread({ id: 'thr_turn', workspace: '/Users/zxy/project', status: 'running' }),
      latestTurnId: 'turn_B',
      latestTurnStatus: 'running'
    }]
    harness.state.watchTurnCompletion = {}

    await harness.actions.refreshThreads()

    // The runtime response describes the older turn A; the local projection
    // already observed the newer turn B, so the stale response is rejected and
    // the running B projection survives.
    expect(harness.state.threads[0]).toMatchObject({
      status: 'running',
      latestTurnId: 'turn_B',
      latestTurnStatus: 'running'
    })
    expect(harness.state.watchTurnCompletion).toEqual({ thr_turn: true })
  })

  it('does not roll a confirmed terminal thread back to a stale raw running summary', async () => {
    const provider = {
      listThreads: vi.fn(async () => [
        thread({ id: 'thr_terminal', workspace: '/Users/zxy/project', status: 'running' })
      ]),
      getThreadDetail: vi.fn(async () => ({ blocks: [] }))
      // No getThreadState: legacy provider path must still preserve terminal evidence.
    }
    registryMock.getProvider.mockReturnValue(provider)
    vi.stubGlobal('window', {
      localStorage: new MemoryStorage(),
      kunGui: {
        getSettings: vi.fn(async () => ({
          write: { defaultWorkspaceRoot: '', activeWorkspaceRoot: '', workspaces: [] }
        }))
      }
    })
    const harness = buildHarness()
    harness.state.activeThreadId = null
    harness.state.threads = [{
      ...thread({ id: 'thr_terminal', workspace: '/Users/zxy/project', status: 'idle' }),
      latestTurnId: 'turn_terminal',
      latestTurnStatus: 'completed'
    }]
    harness.state.watchTurnCompletion = {}

    await harness.actions.refreshThreads()

    expect(harness.state.threads[0]).toMatchObject({
      status: 'idle',
      latestTurnId: 'turn_terminal',
      latestTurnStatus: 'completed'
    })
  })

  it('refreshThreads clears Code session memory when the remembered thread disappears', async () => {
    const provider = {
      listThreads: vi.fn(async () => []),
      getThreadDetail: vi.fn(async () => ({ blocks: [] }))
    }
    registryMock.getProvider.mockReturnValue(provider)
    vi.stubGlobal('window', {
      localStorage: new MemoryStorage(),
      kunGui: {
        getSettings: vi.fn(async () => ({
          write: {
            defaultWorkspaceRoot: '~/.kun/write_workspace',
            activeWorkspaceRoot: '~/.kun/write_workspace',
            workspaces: []
          }
        }))
      }
    })
    const harness = buildHarness()
    harness.state.lastCodeThreadId = 'thr_gone'
    harness.state.threads = []

    await harness.actions.refreshThreads()

    expect(harness.state.lastCodeThreadId).toBeNull()
  })

  it('does not keep legacy plan-build side threads in the main conversation inventory', async () => {
    const source = thread({
      id: 'thr_source',
      title: 'Source conversation',
      workspace: '/Users/zxy/project'
    })
    const execution = {
      ...thread({
        id: 'thr_execution',
        title: 'Isolated plan execution',
        workspace: '/Users/zxy/.kun/worktrees/run-1/project',
        status: 'running'
      }),
      relation: 'side' as const,
      parentThreadId: source.id,
      planBuildRunId: 'run-1'
    }
    const ordinarySide = {
      ...thread({
        id: 'thr_subagent',
        title: 'Subagent',
        workspace: '/Users/zxy/project'
      }),
      relation: 'side' as const,
      parentThreadId: source.id
    }
    const provider = {
      listThreads: vi.fn(async () => [source, execution, ordinarySide]),
      getThreadDetail: vi.fn(async () => ({
        blocks: [{ kind: 'user' as const, id: 'u', text: 'Implement the plan' }]
      })),
      getThreadState: vi.fn(async () => ({
        status: 'running',
        latestTurnId: 'turn_execution',
        latestTurnStatus: 'running'
      }))
    }
    registryMock.getProvider.mockReturnValue(provider)
    vi.stubGlobal('window', {
      localStorage: new MemoryStorage(),
      kunGui: {
        getSettings: vi.fn(async () => ({
          write: { defaultWorkspaceRoot: '', activeWorkspaceRoot: '', workspaces: [] }
        }))
      }
    })
    const harness = buildHarness()
    harness.state.activeThreadId = execution.id
    harness.state.activeThreadRelation = 'side'
    harness.state.threads = [source, execution]
    harness.state.watchTurnCompletion = {}

    await harness.actions.refreshThreads()

    expect(provider.listThreads).toHaveBeenCalledWith({
      includeArchived: true,
      includeSide: true
    })
    // The currently open side thread remains visible through the ordinary
    // active-thread preservation path; its legacy run id grants no special case.
    expect(harness.state.threads.map((item) => item.id)).toEqual([
      execution.id,
      source.id
    ])
    expect(harness.state.threads.some((item) => item.id === ordinarySide.id)).toBe(false)
  })

  it.each([
    ['while its detail is loading', 'primary', 'thr_subagent'],
    ['after its side relation loads', 'side', null]
  ] as const)('preserves an active subagent process %s across inventory refresh', async (
    _label,
    relation,
    threadLoadingId
  ) => {
    const source = thread({ id: 'thr_source', title: 'Source', workspace: '/project' })
    const child = {
      ...thread({ id: 'thr_subagent', title: 'Subagent', workspace: '/project' }),
      relation: 'side' as const,
      parentThreadId: source.id
    }
    registryMock.getProvider.mockReturnValue({
      listThreads: vi.fn(async () => [source, child]),
      getThreadDetail: vi.fn(async () => ({ blocks: [] }))
    })
    vi.stubGlobal('window', {
      localStorage: new MemoryStorage(),
      kunGui: { getSettings: vi.fn(async () => ({ write: { workspaces: [] } })) }
    })
    const harness = buildHarness()
    harness.state.activeThreadId = child.id
    harness.state.activeThreadRelation = relation
    harness.state.activeThreadParentId = source.id
    harness.state.threadLoadingId = threadLoadingId
    harness.state.blocks = [{ kind: 'assistant', id: 'child_output', text: 'Child transcript' }]
    harness.state.threads = [source]
    harness.state.watchTurnCompletion = { [child.id]: true }
    harness.state.unreadThreadIds = { [child.id]: true }

    await harness.actions.refreshThreads()

    expect(harness.state.activeThreadId).toBe(child.id)
    expect(harness.state.blocks).toEqual([
      { kind: 'assistant', id: 'child_output', text: 'Child transcript' }
    ])
    expect(harness.state.threads.map((item) => item.id)).toEqual([source.id])
    expect(harness.state.watchTurnCompletion).toEqual({ [child.id]: true })
    expect(harness.state.unreadThreadIds).toEqual({ [child.id]: true })
  })

  it('openDesign keeps the Code timeline and routes into its shared workbench', () => {
    const harness = buildHarness()
    harness.state.activeThreadId = 'thr_code'
    harness.state.route = 'chat'
    harness.state.busy = true
    harness.state.blocks = [
      { kind: 'user', id: 'u1', text: 'hello' },
      { kind: 'assistant', id: 'a1', text: 'How can I help?' }
    ]
    harness.state.threads = [
      thread({
        id: 'thr_code',
        title: 'Code task',
        workspace: '/Users/zxy/project'
      })
    ]

    harness.actions.openDesign()

    expect(harness.state.route).toBe('chat')
    expect(harness.state.activeThreadId).toBe('thr_code')
    expect(harness.state.blocks).toHaveLength(2)
    expect(harness.state.busy).toBe(true)
    expect(harness.state.watchTurnCompletion).toEqual({})
    expect(harness.selectThread).not.toHaveBeenCalled()
  })

  it('clearActiveThreadSelection clears stale blocks and watches a running thread', () => {
    const harness = buildHarness()
    harness.state.activeThreadId = 'thr_old_design'
    harness.state.busy = true
    harness.state.blocks = [
      { kind: 'user', id: 'u1', text: 'old design request' },
      { kind: 'assistant', id: 'a1', text: 'old design answer' }
    ]

    harness.actions.clearActiveThreadSelection()

    expect(harness.state.activeThreadId).toBeNull()
    expect(harness.state.blocks).toEqual([])
    expect(harness.state.busy).toBe(false)
    expect(harness.state.watchTurnCompletion).toEqual({ thr_old_design: true })
  })
})

describe('write assistant file conversation selection', () => {
  beforeEach(() => {
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
  })

  afterEach(() => {
    useWriteWorkspaceStore.getState().resetWorkspace()
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  it('selects the conversation mapped to the active file', async () => {
    const storage = new MemoryStorage()
    const workspace = '/Users/zxy/write'
    const registry = markWriteThread(
      workspace,
      'thr_b',
      markWriteThread(workspace, 'thr_a', emptyWriteThreadRegistry(), `${workspace}/a.md`),
      `${workspace}/b.md`
    )
    saveWriteThreadRegistry(registry, storage)
    vi.stubGlobal('window', { localStorage: storage })
    useWriteWorkspaceStore.setState({
      workspaceRoot: workspace,
      activeFilePath: `${workspace}/b.md`,
      activeFileKind: 'text'
    })
    const harness = buildHarness()
    Object.assign(harness.state, harness.actions)
    harness.state.activeThreadId = 'thr_a'
    harness.state.workspaceRoot = workspace
    harness.state.threads = [
      thread({ id: 'thr_a', workspace }),
      thread({ id: 'thr_b', workspace })
    ]

    await expect(harness.actions.ensureWriteThreadForWorkspace(workspace)).resolves.toBe('thr_b')
    expect(harness.selectThread).toHaveBeenCalledWith('thr_b')
  })

  it('creates and records a fresh conversation for an unmapped file', async () => {
    const storage = new MemoryStorage()
    const workspace = '/Users/zxy/write'
    const activeFilePath = `${workspace}/new.md`
    vi.stubGlobal('window', { localStorage: storage })
    useWriteWorkspaceStore.setState({
      workspaceRoot: workspace,
      activeFilePath,
      activeFileKind: 'text'
    })
    const created = thread({ id: 'thr_new', workspace, title: 'Write Assistant' })
    const createThread = vi.fn(async () => created)
    registryMock.getProvider.mockReturnValue({ createThread })
    const harness = buildHarness()
    Object.assign(harness.state, harness.actions)
    harness.state.activeThreadId = null
    harness.state.workspaceRoot = workspace
    harness.state.threads = []

    await expect(harness.actions.ensureWriteThreadForWorkspace(workspace)).resolves.toBe('thr_new')

    const registry = readWriteThreadRegistry(storage)
    expect(createThread).toHaveBeenCalledWith({
      workspace,
      title: 'Write Assistant',
      titleAuto: true,
      mode: 'agent',
      agentSurface: 'write'
    })
    expect(activeWriteThreadForWorkspace(
      workspace,
      [created],
      registry,
      activeFilePath
    )?.id).toBe('thr_new')
    expect(harness.selectThread).toHaveBeenCalledWith('thr_new')
  })
})

describe('onClawChannelActivity routes through subscribeThreadEventsLive (not selectThread)', () => {
  beforeEach(() => {
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
  })

  afterEach(() => {
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  it('calls subscribeThreadEventsLive when activeThreadId differs from the bot thread', async () => {
    const subscribeThreadEventsLive = vi.fn(async () => undefined)
    const selectThread = vi.fn(async () => undefined)
    const recoverActiveTurn = vi.fn(async () => true)

    // Capture the callback registered via window.kunGui.onClawChannelActivity
    let capturedClawActivityCallback: ((payload: { channelId: string; threadId: string }) => void) | null = null
    const onClawChannelActivity = vi.fn((cb: (payload: { channelId: string; threadId: string }) => void) => {
      capturedClawActivityCallback = cb
      return () => {}
    })
    const onRuntimeStatus = vi.fn(() => () => {})
    let capturedTrayActionCallback: ((payload: { type: 'new-chat' } | { type: 'open-thread'; threadId: string }) => void) | null = null
    const onTrayAction = vi.fn((cb: typeof capturedTrayActionCallback) => {
      capturedTrayActionCallback = cb
      return () => {}
    })
    const getSettings = vi.fn(async () => ({
      workspaceRoot: '~/.kun/default_workspace',
      write: {
        defaultWorkspaceRoot: '~/.kun/default_workspace',
        activeWorkspaceRoot: '~/.kun/default_workspace',
        workspaces: []
      },
      claw: {
        channels: [
          { id: 'ch_1', enabled: true, label: 'Feishu Agent01', provider: 'feishu' }
        ]
      },
      theme: 'dark',
      uiFontScale: 1,
      chatContentMaxWidthPx: 896,
      composerSendKey: 'enter',
      locale: 'en',
      agents: { kun: { apiKey: 'test-key', model: 'deepseek-v4-pro', baseUrl: '' } },
      disabledSkillIds: []
    }))
    vi.stubGlobal('window', {
      kunGui: {
        getSettings,
        onClawChannelActivity,
        onTrayAction,
        onRuntimeStatus
      }
    })

    const harness = buildHarness({ subscribeThreadEventsLive, recoverActiveTurn })
    await harness.actions.boot()
    expect(typeof capturedClawActivityCallback).toBe('function')
    expect(onClawChannelActivity).toHaveBeenCalledTimes(1)
    expect(onTrayAction).toHaveBeenCalledTimes(1)

    harness.state.route = 'settings'
    capturedTrayActionCallback!({ type: 'open-thread', threadId: 'thr_recent' })
    expect(harness.state.route).toBe('chat')
    expect(harness.selectThread).toHaveBeenCalledWith('thr_recent')

    harness.state.route = 'settings'
    capturedTrayActionCallback!({ type: 'new-chat' })
    expect(harness.state.route).toBe('chat')
    expect(harness.createThread).toHaveBeenCalledWith({ forceNew: true })

    // Set state conditions AFTER boot so they survive the boot's set() calls:
    // route is claw, activeClawChannelId matches incoming channelId,
    // activeThreadId differs from incoming threadId — so we should auto-switch.
    harness.state.route = 'claw'
    harness.state.activeClawChannelId = 'ch_1'
    harness.state.activeThreadId = 'thr_default'

    // Trigger the captured callback with a Feishu bot event.
    await capturedClawActivityCallback!({ channelId: 'ch_1', threadId: 'thr_bot' })
    // Allow the void(async()) microtask inside the callback to flush.
    await new Promise((resolve) => setTimeout(resolve, 10))
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(subscribeThreadEventsLive).toHaveBeenCalledWith('thr_bot')
    expect(selectThread).not.toHaveBeenCalled()
  })
})

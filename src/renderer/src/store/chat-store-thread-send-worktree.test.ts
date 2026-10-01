import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtimeClientMock = vi.hoisted(() => ({
  getSettings: vi.fn(async () => ({}))
}))
const workspaceMock = vi.hoisted(() => ({
  currentCodeWorkspaceRoot: vi.fn(() => '/repo')
}))
const helpersMock = vi.hoisted(() => ({
  activeClawChannel: vi.fn(() => null),
  readThreadComposerSelection: vi.fn(() => undefined),
  rememberCodeWorkspaceRoots: vi.fn((roots: string[], next: Array<string | undefined>) =>
    [...roots, ...next.filter((v): v is string => Boolean(v))]),
  rememberThreadComposerSelection: vi.fn(),
  rememberTurnModel: vi.fn()
}))
const runtimeHelpersMock = vi.hoisted(() => ({
  findReusableEmptyThreadId: vi.fn(async (): Promise<string | null> => null),
  reconcileOptimisticUserBlock: vi.fn()
}))
const runtimeMock = vi.hoisted(() => ({
  armBusyWatchdog: vi.fn(),
  buildThreadEventSink: vi.fn(() => ({})),
  isCodeThread: vi.fn(() => true),
  looksLikeActiveTurnError: vi.fn(() => false),
  rememberPendingClawFeishuMirror: vi.fn(),
  runtimeErrorDetail: vi.fn(() => ''),
  runtimeStreamRecoveringMessage: vi.fn(() => ''),
  shouldOpenSettingsForError: vi.fn(() => false)
}))
const actionHelpersMock = vi.hoisted(() => ({
  ensureRuntimeProviderForSend: vi.fn(async () => undefined),
  subscribeThreadEventsWithRecovery: vi.fn()
}))
const navigationMock = vi.hoisted(() => ({
  settleAcceptedTurnAfterNavigation: vi.fn()
}))
const checkpointMock = vi.hoisted(() => ({
  startWorkspaceCheckpointSnapshot: vi.fn(() => 'req_cp')
}))
const schedulersMock = vi.hoisted(() => ({
  clearBusyWatchdog: vi.fn(),
  resetBusyRecoveryAttempts: vi.fn()
}))
const persistenceMock = vi.hoisted(() => ({
  saveQueuedMessagesForThread: vi.fn(),
  queuedMessagesForThread: vi.fn(() => [])
}))
const registryMock = vi.hoisted(() => ({
  readDesignThreadRegistry: vi.fn(() => ({})),
  mergeThreadDesignProfile: vi.fn((_t: unknown, _d: unknown) => undefined)
}))

vi.mock('../agent/runtime-client', () => ({
  rendererRuntimeClient: runtimeClientMock
}))
vi.mock('./chat-store-current-workspace', () => workspaceMock)
vi.mock('./chat-store-helpers', () => helpersMock)
vi.mock('./chat-store-runtime-helpers', () => runtimeHelpersMock)
vi.mock('./chat-store-runtime', () => runtimeMock)
vi.mock('./chat-store-thread-action-helpers', () => actionHelpersMock)
vi.mock('./chat-store-thread-send-navigation', () => navigationMock)
vi.mock('./chat-store-thread-send-checkpoint', () => checkpointMock)
vi.mock('./chat-store-schedulers', () => schedulersMock)
vi.mock('./queued-message-persistence', () => persistenceMock)
vi.mock('../design/design-thread-registry', () => ({
  readDesignThreadRegistry: registryMock.readDesignThreadRegistry
}))
vi.mock('../design/design-locked-profile', () => ({
  mergeThreadDesignProfile: registryMock.mergeThreadDesignProfile
}))
vi.mock('./chat-store-send-prompt', () => ({
  runtimePromptForSurface: ({ prompt }: { prompt: string }) => prompt
}))

import { performPreparedThreadSend } from './chat-store-thread-send-direct'
import { captureAdeDraftSendSnapshot } from './chat-store-ade-send-snapshot'
import type { PreparedThreadSend } from './chat-store-thread-send-direct-types'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import type { QueuedUserMessage } from './chat-store-message-types'
import { threadWorkspacePreparing, useTaskWorkspaceStore } from './task-workspace-store'

function buildHarness(initial?: Partial<ChatState>): {
  state: ChatState
  set: ChatStoreSet
  get: ChatStoreGet
} {
  const state = {
    route: 'ade',
    adeDraftOpen: true,
    adeDraftRevision: 1,
    workspaceRoot: '/repo',
    threads: [],
    adeThreads: [],
    blocks: [],
    busy: false,
    busyUnconfirmed: false,
    queuedMessages: [],
    activeThreadId: null,
    lastSeq: 0,
    codeWorkspaceRoots: [],
    clawChannels: [],
    composerIsolation: 'local',
    composerWorktreeStartFrom: undefined,
    turnStartedAtByUserId: {},
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    refreshThreads: vi.fn(async () => undefined),
    refreshAdeThreads: vi.fn(async () => undefined),
    error: null,
    ...initial
  } as unknown as ChatState
  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: ChatStoreGet = () => state
  return { state, set, get }
}

function submission(): QueuedUserMessage {
  return { id: 'q_1', text: 'ship it', clientRequestId: 'req_1', deliveryState: 'pending' }
}

function inputFor(
  harness: ReturnType<typeof buildHarness>,
  provider: PreparedThreadSend['provider']
): PreparedThreadSend {
  return {
    context: { set: harness.set, get: harness.get, sseAbortRef: { current: null } },
    adeDraft: captureAdeDraftSendSnapshot(harness.state),
    runtime: {
      threadSelectionGeneration: 0,
      fenceThreadMutation: vi.fn(() => 1),
      persistActiveQueuedMessages: vi.fn()
    },
    provider,
    trimmedText: 'ship it',
    mode: 'agent',
    overrides: undefined,
    queued: undefined,
    clientRequestId: 'req_1',
    expectedThreadId: '',
    requestedAgentSurface: 'code',
    designProfile: undefined,
    designDocumentTarget: undefined,
    designImagePlacementTarget: undefined,
    messageSource: undefined,
    expectedThreadStillActive: () => true,
    writeContext: undefined,
    now: Date.now(),
    userBlockId: 'u_1',
    attachmentIds: [],
    attachments: [],
    fileReferences: [],
    composerContexts: [],
    ackNoticeIds: undefined,
    activeThreadId: null,
    displayText: 'ship it',
    userDisplayText: undefined,
    generatedTitle: 'task',
    shouldAutoRenameForRoute: false,
    shouldRenameThreadAfterSend: false,
    composerModel: 'opus',
    composerProviderId: '',
    composerAccountId: '',
    composerHarnessId: 'claude-code',
    composerCredentialMode: 'native-login',
    reasoningEffort: undefined,
    serviceTier: undefined,
    guiDesignCanvas: false,
    guiExcalidrawCanvas: false,
    guiDesignMode: false,
    persona: '',
    orchestration: 'direct',
    userModelChip: undefined,
    submittedMessageForQueue: submission()
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', { kunGui: {
    getGitBranches: vi.fn(async () => ({
      ok: true as const, repositoryRoot: '/repo', primaryRepositoryRoot: '/repo',
      currentBranch: 'main', branches: [
        { name: 'main', current: true }, { name: 'feature', current: false }
      ], dirtyCount: 0
    })),
    logError: vi.fn(async () => undefined)
  } })
  useTaskWorkspaceStore.setState({ prepByThread: {} })
})

describe('performPreparedThreadSend ADE worktree isolation', () => {
  it('does not create a thread from Mission Control without opening a draft', async () => {
    const { state, ...harness } = buildHarness({ adeDraftOpen: false })
    const provider = { createThread: vi.fn() }
    expect(await performPreparedThreadSend(inputFor({ state, ...harness }, provider as never))).toBe(false)
    expect(provider.createThread).not.toHaveBeenCalled()
    expect(state.blocks).toEqual([])
  })

  it('creates a fresh ADE thread even when a reusable Code thread exists', async () => {
    const { state, ...harness } = buildHarness()
    runtimeHelpersMock.findReusableEmptyThreadId.mockResolvedValueOnce('thr_code')
    const provider = {
      createThread: vi.fn(async () => ({ id: 'thr_ade', workspace: '/repo', workspaceMode: 'ade' })),
      sendUserMessage: vi.fn(async () => ({ turnId: 'turn_1' }))
    }
    expect(await performPreparedThreadSend(inputFor({ state, ...harness }, provider as never))).toBe(true)
    expect(runtimeHelpersMock.findReusableEmptyThreadId).not.toHaveBeenCalled()
    expect(provider.createThread).toHaveBeenCalledWith(expect.objectContaining({ workspaceMode: 'code' }))
    expect(state.activeThreadId).toBe('thr_ade')
    expect(state.adeDraftOpen).toBe(false)
  })

  it('creates a Kun manager draft without carrying a previous one-on-one harness', async () => {
    const { state, ...harness } = buildHarness({ adeDraftOpen: true })
    const provider = {
      createThread: vi.fn(async () => ({ id: 'thr_manager', workspace: '/repo', workspaceMode: 'ade' })),
      sendUserMessage: vi.fn(async () => ({ turnId: 'turn_1' }))
    }
    const input = inputFor({ state, ...harness }, provider as never)
    input.composerHarnessId = ''
    input.composerCredentialMode = ''
    expect(await performPreparedThreadSend(input)).toBe(true)
    expect(provider.createThread).toHaveBeenCalledWith(expect.not.objectContaining({ harnessId: 'claude-code' }))
    expect(state.adeDraftOpen).toBe(false)
  })

  it('freezes an opted-in Code draft into a fresh task without reusing an unrelated empty thread', async () => {
    const { state, ...harness } = buildHarness({ route: 'chat', adeDraftOpen: false })
    const provider = {
      createThread: vi.fn(async () => ({ id: 'thr_collab', workspace: '/repo', collaboration: { enabled: true } })),
      sendUserMessage: vi.fn(async () => ({ turnId: 'turn_1' }))
    }
    const input = inputFor({ state, ...harness }, provider as never)
    input.adeDraft = undefined
    input.composerHarnessId = 'kun'
    input.composerCredentialMode = ''
    input.composerCollaborationEnabled = true
    expect(await performPreparedThreadSend(input)).toBe(true)
    expect(runtimeHelpersMock.findReusableEmptyThreadId).not.toHaveBeenCalled()
    expect(provider.createThread).toHaveBeenCalledWith(expect.objectContaining({
      harnessId: 'kun', collaboration: { enabled: true }, agentSurface: 'code'
    }))
    expect(state.composerCollaborationEnabled).toBe(false)
  })

  it('freezes an explicit collaboration off choice instead of inheriting project on', async () => {
    const { state, ...harness } = buildHarness({ route: 'chat', adeDraftOpen: false })
    const provider = {
      createThread: vi.fn(async () => ({ id: 'thr_off', workspace: '/repo', collaboration: { enabled: false } })),
      sendUserMessage: vi.fn(async () => ({ turnId: 'turn_off' }))
    }
    const input = inputFor({ state, ...harness }, provider as never)
    input.adeDraft = undefined
    input.composerHarnessId = 'kun'
    input.composerCredentialMode = ''
    input.composerCollaborationEnabled = false
    input.composerCollaborationExplicit = true
    expect(await performPreparedThreadSend(input)).toBe(true)
    expect(provider.createThread).toHaveBeenCalledWith(expect.objectContaining({ collaboration: { enabled: false } }))
    expect(runtimeHelpersMock.findReusableEmptyThreadId).not.toHaveBeenCalled()
  })

  it('queues the first send while the requested worktree is still preparing', async () => {
    const { state, ...harness } = buildHarness({ composerIsolation: 'worktree' })
    const provider = {
      createThread: vi.fn(async () => ({
        id: 'thr_new',
        workspace: '/repo',
        workspaceMode: 'ade' as const
      })),
      createTaskWorkspace: vi.fn(async () => ({
        record: {
          workspaceId: 'ws_1',
          ownerThreadId: 'thr_new',
          sourceRoot: '/repo',
          isolation: 'worktree',
          state: 'creating'
        }
      })),
      sendUserMessage: vi.fn(async () => ({ turnId: 'turn_1' }))
    }
    const result = await performPreparedThreadSend(
      inputFor({ state, ...harness }, provider as never)
    )
    expect(result).toBe(true)
    expect(provider.createThread).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceMode: 'code', harnessId: 'claude-code' })
    )
    expect(runtimeHelpersMock.findReusableEmptyThreadId).not.toHaveBeenCalled()
    expect(provider.createTaskWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ ownerThreadId: 'thr_new', isolation: 'worktree', sourceRoot: '/repo', startFrom: { kind: 'default-branch' } })
    )
    // The turn is parked locally — the runtime must not see it yet.
    expect(provider.sendUserMessage).not.toHaveBeenCalled()
    expect(state.activeThreadId).toBe('thr_new')
    expect(state.busy).toBe(false)
    expect(state.queuedMessages).toEqual([
      expect.objectContaining({ id: 'q_1', deliveryState: 'pending' })
    ])
    expect(threadWorkspacePreparing('thr_new')).toBe(true)
  })

  it.each([
    { kind: 'current-head' as const },
    { kind: 'branch' as const, name: 'feature' }
  ])('forwards the chosen $kind start point without switching the source branch', async (startFrom) => {
    const { state, ...harness } = buildHarness({
      composerIsolation: 'worktree', composerWorktreeStartFrom: startFrom
    })
    const provider = {
      createThread: vi.fn(async () => ({ id: 'thr_new', workspace: '/repo', workspaceMode: 'ade' })),
      createTaskWorkspace: vi.fn(async () => ({ record: {
        workspaceId: 'ws_1', ownerThreadId: 'thr_new', sourceRoot: '/repo',
        isolation: 'worktree', state: 'creating'
      } }))
    }
    expect(await performPreparedThreadSend(inputFor({ state, ...harness }, provider as never))).toBe(true)
    expect(window.kunGui.getGitBranches).toHaveBeenCalledWith('/repo')
    expect(provider.createTaskWorkspace).toHaveBeenCalledWith(expect.objectContaining({ startFrom }))
  })

  it('keeps the submitted worktree choice when the composer changes during settings loading', async () => {
    const { state, ...harness } = buildHarness({ composerIsolation: 'worktree' })
    const provider = {
      createThread: vi.fn(async () => ({ id: 'thr_new', workspace: '/repo', workspaceMode: 'ade' })),
      createTaskWorkspace: vi.fn(async () => ({ record: {
        workspaceId: 'ws_1', ownerThreadId: 'thr_new', sourceRoot: '/repo',
        isolation: 'worktree', state: 'creating'
      } }))
    }
    const input = inputFor({ state, ...harness }, provider as never)
    runtimeClientMock.getSettings.mockImplementationOnce(async () => {
      state.composerIsolation = 'local'
      state.composerWorktreeStartFrom = { kind: 'branch', name: 'feature' }
      return { workspaceRoot: '/host' }
    })
    expect(await performPreparedThreadSend(input)).toBe(true)
    expect(provider.createTaskWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      sourceRoot: '/repo', startFrom: { kind: 'default-branch' }
    }))
  })

  it('rejects a local branch removed before submit without creating a thread', async () => {
    const { state, ...harness } = buildHarness({
      composerIsolation: 'worktree', composerWorktreeStartFrom: { kind: 'branch', name: 'gone' }
    })
    const provider = { createThread: vi.fn(), createTaskWorkspace: vi.fn() }
    expect(await performPreparedThreadSend(inputFor({ state, ...harness }, provider as never))).toBe(false)
    expect(provider.createThread).not.toHaveBeenCalled()
    expect(state.error).toContain('gone')
    expect(state.blocks).toEqual([])
  })

  it('does not silently send locally when worktree creation is unavailable', async () => {
    const { state, ...harness } = buildHarness({ composerIsolation: 'worktree' })
    const provider = { createThread: vi.fn(), sendUserMessage: vi.fn() }
    expect(await performPreparedThreadSend(inputFor({ state, ...harness }, provider as never))).toBe(false)
    expect(provider.createThread).not.toHaveBeenCalled()
    expect(provider.sendUserMessage).not.toHaveBeenCalled()
    expect(state.error).toContain('Worktree creation is unavailable')
  })

  it('ignores a Git result for a project changed while verification was pending', async () => {
    const { state, ...harness } = buildHarness({ composerIsolation: 'worktree' })
    let resolveGit!: (result: Awaited<ReturnType<typeof window.kunGui.getGitBranches>>) => void
    vi.mocked(window.kunGui.getGitBranches).mockReturnValueOnce(new Promise((resolve) => {
      resolveGit = resolve
    }))
    const provider = { createThread: vi.fn(), createTaskWorkspace: vi.fn() }
    const send = performPreparedThreadSend(inputFor({ state, ...harness }, provider as never))
    await vi.waitFor(() => expect(window.kunGui.getGitBranches).toHaveBeenCalledWith('/repo'))
    state.workspaceRoot = '/other'
    resolveGit({
      ok: true, repositoryRoot: '/repo', primaryRepositoryRoot: '/repo',
      currentBranch: 'main', branches: [{ name: 'main', current: true }], dirtyCount: 0
    })
    expect(await send).toBe(false)
    expect(provider.createThread).not.toHaveBeenCalled()
    expect(state.blocks).toEqual([])
  })

  it('does not create a thread if the ADE draft closes during Git verification', async () => {
    const { state, ...harness } = buildHarness({ composerIsolation: 'worktree' })
    vi.mocked(window.kunGui.getGitBranches).mockImplementationOnce(async () => {
      state.adeDraftOpen = false
      return { ok: true, repositoryRoot: '/repo', primaryRepositoryRoot: '/repo',
        currentBranch: 'main', branches: [{ name: 'main', current: true }], dirtyCount: 0 }
    })
    const provider = { createThread: vi.fn(), createTaskWorkspace: vi.fn() }
    expect(await performPreparedThreadSend(inputFor({ state, ...harness }, provider as never))).toBe(false)
    expect(provider.createThread).not.toHaveBeenCalled()
    expect(state.adeDraftOpen).toBe(false)
    expect(state.blocks).toEqual([])
  })

  it('does not bind an old send after the same ADE project is reopened as a new draft', async () => {
    const { state, ...harness } = buildHarness({ composerIsolation: 'worktree' })
    vi.mocked(window.kunGui.getGitBranches).mockImplementationOnce(async () => {
      state.adeDraftOpen = false
      state.adeDraftRevision += 1
      state.adeDraftOpen = true
      state.adeDraftRevision += 1
      return { ok: true, repositoryRoot: '/repo', primaryRepositoryRoot: '/repo',
        currentBranch: 'main', branches: [{ name: 'main', current: true }], dirtyCount: 0 }
    })
    const provider = { createThread: vi.fn(), createTaskWorkspace: vi.fn() }
    expect(await performPreparedThreadSend(inputFor({ state, ...harness }, provider as never))).toBe(false)
    expect(provider.createThread).not.toHaveBeenCalled()
    expect(state.adeDraftOpen).toBe(true)
    expect(state.adeDraftRevision).toBe(3)
  })

  it('keeps a failed worktree preparation retryable and does not send locally', async () => {
    const { state, ...harness } = buildHarness({ composerIsolation: 'worktree' })
    const provider = {
      createThread: vi.fn(async () => ({ id: 'thr_new', workspace: '/repo', workspaceMode: 'ade' })),
      createTaskWorkspace: vi.fn(async () => { throw new Error('worktree failed') }),
      sendUserMessage: vi.fn()
    }
    expect(await performPreparedThreadSend(inputFor({ state, ...harness }, provider as never))).toBe(true)
    expect(provider.sendUserMessage).not.toHaveBeenCalled()
    expect(useTaskWorkspaceStore.getState().prepByThread.thr_new).toMatchObject({
      state: 'failed', error: 'worktree failed'
    })
    expect(state.queuedMessages).toEqual([expect.objectContaining({ id: 'q_1', deliveryState: 'pending' })])
  })

  it('persists the pending turn to its own thread after navigation during preparation', async () => {
    const { state, ...harness } = buildHarness({ composerIsolation: 'worktree' })
    const provider = {
      createThread: vi.fn(async () => ({ id: 'thr_new', workspace: '/repo', workspaceMode: 'ade' })),
      createTaskWorkspace: vi.fn(async () => {
        state.activeThreadId = 'thr_elsewhere'
        return { record: { workspaceId: 'ws_1', ownerThreadId: 'thr_new', sourceRoot: '/repo',
          isolation: 'worktree', state: 'creating' } }
      })
    }
    expect(await performPreparedThreadSend(inputFor({ state, ...harness }, provider as never))).toBe(true)
    expect(state.queuedMessages).toEqual([])
    expect(persistenceMock.saveQueuedMessagesForThread).toHaveBeenCalledWith(
      'thr_new', [expect.objectContaining({ id: 'q_1', deliveryState: 'pending' })]
    )
  })

  it('does not fall back to the host setting when an ADE draft has no project', async () => {
    const { state, ...harness } = buildHarness({ workspaceRoot: '' })
    runtimeClientMock.getSettings.mockResolvedValueOnce({ workspaceRoot: '/host' })
    const provider = { createThread: vi.fn() }
    expect(await performPreparedThreadSend(inputFor({ state, ...harness }, provider as never))).toBe(false)
    expect(provider.createThread).not.toHaveBeenCalled()
  })

  it('rejects a missing ADE project before creating a local thread', async () => {
    const { state, ...harness } = buildHarness()
    window.kunGui.workspaceDirectoryExists = vi.fn(async () => false)
    const provider = { createThread: vi.fn() }
    expect(await performPreparedThreadSend(inputFor({ state, ...harness }, provider as never))).toBe(false)
    expect(provider.createThread).not.toHaveBeenCalled()
    expect(state.error).toBeTruthy()
  })

  it('does not surface a stale Git error after the user navigates away', async () => {
    const { state, ...harness } = buildHarness({ composerIsolation: 'worktree' })
    vi.mocked(window.kunGui.getGitBranches).mockImplementationOnce(async () => {
      state.route = 'chat'
      state.workspaceRoot = '/elsewhere'
      state.activeThreadId = 'thr_other'
      state.currentTurnUserId = null
      state.error = 'new view error'
      throw new Error('old project Git failed')
    })
    const provider = { createThread: vi.fn(), createTaskWorkspace: vi.fn() }
    expect(await performPreparedThreadSend(inputFor({ state, ...harness }, provider as never))).toBe(false)
    expect(provider.createThread).not.toHaveBeenCalled()
    expect(state.error).toBe('new view error')
    expect(state.activeThreadId).toBe('thr_other')
    expect(window.kunGui.logError).not.toHaveBeenCalled()
  })

  it('clears its optimistic turn if project selection changes during thread creation', async () => {
    const { state, ...harness } = buildHarness()
    const provider = { createThread: vi.fn(async () => {
      state.workspaceRoot = '/other'
      return { id: 'thr_new', workspace: '/repo', workspaceMode: 'ade' }
    }) }
    expect(await performPreparedThreadSend(inputFor({ state, ...harness }, provider as never))).toBe(false)
    expect(state.activeThreadId).toBeNull()
    expect(state.blocks).toEqual([])
    expect(state.busy).toBe(false)
    expect(state.refreshAdeThreads).toHaveBeenCalled()
  })

  it('does not activate an old thread when a same-project draft reopens during creation', async () => {
    const { state, ...harness } = buildHarness()
    const provider = { createThread: vi.fn(async () => {
      state.adeDraftRevision += 2
      return { id: 'thr_old', workspace: '/repo', workspaceMode: 'ade' }
    }) }
    expect(await performPreparedThreadSend(inputFor({ state, ...harness }, provider as never))).toBe(false)
    expect(state.activeThreadId).toBeNull()
    expect(state.adeDraftRevision).toBe(3)
    expect(state.refreshAdeThreads).toHaveBeenCalled()
  })


  it('freezes the Code Git launch choice and queues the first message behind one workspace', async () => {
    const harness = buildHarness({ route: 'chat', adeDraftOpen: false, composerIsolation: 'worktree' })
    const provider = {
      createThread: vi.fn(async () => ({ id: 'thr_new', workspace: '/repo', workspaceMode: 'code' as const })),
      createTaskWorkspace: vi.fn(async () => ({ record: { workspaceId: 'ws_1', ownerThreadId: 'thr_new',
        sourceRoot: '/repo', isolation: 'worktree', state: 'creating' } })),
      sendUserMessage: vi.fn()
    }
    expect(await performPreparedThreadSend(inputFor(harness, provider as never))).toBe(true)
    expect(provider.createThread).toHaveBeenCalledWith(expect.objectContaining({ workspace: '/repo', workspaceIsolation: 'worktree' }))
    expect(provider.createTaskWorkspace).toHaveBeenCalledTimes(1)
    expect(provider.sendUserMessage).not.toHaveBeenCalled()
    expect(harness.state.queuedMessages).toHaveLength(1)
  })

  it('does not allocate a workspace for an already-created empty Code task', async () => {
    const harness = buildHarness({ route: 'chat', adeDraftOpen: false, composerIsolation: 'worktree',
      activeThreadId: 'existing', threads: [{ id: 'existing', workspace: '/repo' } as never] })
    const provider = { createThread: vi.fn(), createTaskWorkspace: vi.fn(),
      sendUserMessage: vi.fn(async () => ({ turnId: 'turn_1' })) }
    const input = inputFor(harness, provider as never)
    input.activeThreadId = 'existing'
    expect(await performPreparedThreadSend(input)).toBe(true)
    expect(provider.createThread).not.toHaveBeenCalled()
    expect(provider.createTaskWorkspace).not.toHaveBeenCalled()
  })

  it('sends immediately when the session picked local isolation', async () => {
    const { state, ...harness } = buildHarness({ composerIsolation: 'local' })
    const provider = {
      createThread: vi.fn(async () => ({
        id: 'thr_new',
        workspace: '/repo',
        workspaceMode: 'ade' as const
      })),
      createTaskWorkspace: vi.fn(),
      sendUserMessage: vi.fn(async () => ({ turnId: 'turn_1' }))
    }
    const result = await performPreparedThreadSend(
      inputFor({ state, ...harness }, provider as never)
    )
    expect(result).toBe(true)
    expect(provider.createTaskWorkspace).not.toHaveBeenCalled()
    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_new',
      'ship it',
      expect.objectContaining({ harnessId: 'claude-code', credentialMode: 'native-login' })
    )
  })

  it('forwards the frozen planBuild flag when a queued build row drains', async () => {
    const { state, ...harness } = buildHarness({
      composerIsolation: 'local',
      activeThreadId: 'thr_build',
      threads: [
        { id: 'thr_build', workspace: '/repo/wt', workspaceMode: 'ade' } as never
      ]
    })
    const provider = {
      sendUserMessage: vi.fn(async () => ({ turnId: 'turn_1' }))
    }
    const queued = {
      ...submission(),
      planBuild: true,
      harnessId: 'claude-code',
      credentialMode: 'native-login'
    }
    const input = inputFor({ state, ...harness }, provider as never)
    input.activeThreadId = 'thr_build'
    input.queued = queued
    input.submittedMessageForQueue = queued
    const result = await performPreparedThreadSend(input)
    expect(result).toBe(true)
    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_build',
      'ship it',
      expect.objectContaining({
        planBuild: true,
        harnessId: 'claude-code',
        credentialMode: 'native-login'
      })
    )
  })
})

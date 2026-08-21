import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSideActions,
  teardownAllSideSubscriptions
} from './chat-store-side-actions'
import { DEFAULT_KUN_MODEL } from '@shared/app-settings'
import type { ChatState } from './chat-store-types'
import type { AgentProvider, NormalizedThread, ThreadEventSink } from '../agent/types'

type Harness = {
  state: ChatState
  set: (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void
  get: () => ChatState
  provider: FakeProvider
  actions: ReturnType<typeof createSideActions>
}

class FakeProvider implements AgentProvider {
  readonly id = 'kun' as const
  readonly displayName = 'Fake'
  forkMock = vi.fn()
  sendMock = vi.fn()
  sendGate: Promise<void> | null = null
  deleteMock = vi.fn()
  patchMock = vi.fn()
  interruptMock = vi.fn()
  subscribeMock = vi.fn()
  submitUserInputMock = vi.fn()
  cancelUserInputMock = vi.fn()
  refreshThreadsMock = vi.fn()
  closeSideMock = vi.fn()
  forkFailure: Error | null = null
  getCapabilities() {
    return { interrupt: true, stream: true, approvals: true, attachFiles: false }
  }
  async connect() {}
  async listThreads(): Promise<NormalizedThread[]> {
    return []
  }
  async createThread(): Promise<NormalizedThread> {
    throw new Error('not used')
  }
  async getThreadDetail() {
    return { blocks: [], latestSeq: 0 }
  }
  async getThreadState() {
    return { status: 'idle', updatedAt: '', latestSeq: 0 }
  }
  async sendUserMessage(
    threadId: string,
    text: string,
    options?: {
      model?: string
      providerId?: string
      accountId?: string
      reasoningEffort?: string
      serviceTier?: 'priority'
      attachmentIds?: string[]
      guiDesignCanvas?: boolean
      guiDesignMode?: boolean
      agentSurface?: 'code' | 'write' | 'design'
      designProfile?: import('../agent/design-task-profile').DesignTaskProfileInput
      designDocumentTarget?: import('../agent/design-task-profile').DesignDocumentTarget
    }
  ) {
    this.sendMock(threadId, text, options)
    if (this.sendGate) await this.sendGate
    return { threadId, turnId: `turn_${threadId}_${Date.now()}` }
  }
  async steerUserMessage() {}
  async interruptTurn(threadId: string, turnId: string) {
    this.interruptMock(threadId, turnId)
  }
  async renameThread() {}
  async archiveThread() {}
  async deleteThread(threadId: string) {
    this.deleteMock(threadId)
  }
  async compactThread() {}
  async forkThread(
    threadId: string,
    options?: {
      relation?: 'primary' | 'fork' | 'side'
      title?: string
      designDocumentTarget?: import('../agent/design-task-profile').DesignDocumentTarget
    }
  ) {
    this.forkMock(threadId, options)
    if (this.forkFailure) throw this.forkFailure
    return {
      id: `side_${threadId}`,
      title: options?.title ?? `${threadId} · side`,
      updatedAt: '2026-06-02T00:00:00.000Z',
      model: 'deepseek-chat',
      mode: 'agent',
      workspace: '/tmp',
      status: 'idle',
      relation: 'side' as const,
      parentThreadId: threadId,
      forkedFromThreadId: threadId,
      forkedFromTitle: 'Parent',
      forkedAt: '2026-06-02T00:00:00.000Z',
      ...(options?.designDocumentTarget
        ? {
            agentSurface: 'design' as const,
            designProfile: {
              version: 1 as const,
              documentTarget: options.designDocumentTarget,
              outputMedium: 'html' as const,
              target: 'app' as const,
              preset: 'ios' as const,
              presetSource: 'explicit' as const,
              context: { tone: ['precise'] },
              lockedAtTurnId: 'turn_lock'
            }
          }
        : {})
    }
  }
  async resumeSession() {
    return { threadId: 'resumed', sessionId: 'sid' }
  }
  async subscribeThreadEvents(
    threadId: string,
    sinceSeq: number,
    sink: ThreadEventSink,
    signal: AbortSignal
  ): Promise<void> {
    this.subscribeMock(threadId, sinceSeq, sink, signal)
    signal.addEventListener('abort', () => {
      // simulate cleanup; the real implementation stops the SSE stream
    })
    return new Promise(() => {
      sink.onSeq(0)
    })
  }
  async submitApprovalDecision() {}
  async submitUserInputResponse(inputId: string, answers: unknown[]) {
    this.submitUserInputMock(inputId, answers)
  }
  async cancelUserInput(inputId: string) {
    this.cancelUserInputMock(inputId)
  }
}

function buildHarness(
  overrides: Partial<ChatState> = {},
  dependencies: Parameters<typeof createSideActions>[1] = {}
): Harness {
  const state: ChatState = {
    route: 'chat',
    settingsReturnRoute: 'chat',
    pluginHostRoute: 'chat',
    settingsSection: 'general',
    initialSetupOpen: false,
    initialSetupMode: 'required',
    workspaceRoot: '/tmp',
    workspaceLabel: '/tmp',
    runtimeConnection: 'ready',
    codeWorkspaceRoots: [],
    threads: [
      {
        id: 'thr_main',
        title: 'Parent',
        updatedAt: '2026-06-02T00:00:00.000Z',
        model: 'deepseek-chat',
        mode: 'agent',
        status: 'idle'
      }
    ],
    threadSearch: '',
    showArchivedThreads: false,
    activeThreadId: 'thr_main',
    blocks: [],
    liveReasoning: '',
    liveAssistant: '',
    lastSeq: 0,
    usageRefreshKey: 0,
    busy: true,
    error: null,
    runtimeErrorDetail: null,
    currentTurnId: 'turn_main',
    currentTurnUserId: 'item_main',
    turnStartedAtByUserId: {},
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    inspectorSelectedId: null,
    composerModel: 'deepseek-chat',
    composerProviderId: 'deepseek',
    composerPickList: ['deepseek-chat'],
    composerModelGroups: [],
    queuedMessages: [],
    watchTurnCompletion: {},
    unreadThreadIds: {},
    sideConversations: {},
    sidePanel: { open: false, activeSideId: null },
    clawChannels: [],
    activeClawChannelId: '',
    appendLocalClawTurn: () => undefined,
    setError: () => undefined,
    setComposerModel: () => undefined,
    loadComposerModels: async () => undefined,
    setRoute: () => undefined,
    openWrite: async () => undefined,
    openCode: async () => undefined,
    ensureWriteThreadForWorkspace: async () => null,
    createWriteThread: async () => null,
    selectWriteThread: async () => undefined,
    openSettings: () => undefined,
    closeSettings: () => undefined,
    openPlugins: () => undefined,
    openClaw: () => undefined,
    refreshClawChannels: async () => undefined,
    addClawChannel: async () => undefined,
    selectClawChannel: async () => undefined,
    selectClawConversation: async () => undefined,
    deleteClawChannel: async () => undefined,
    resetClawChannelSession: async () => undefined,
    setClawChannelModel: async () => undefined,
    openInitialSetup: () => undefined,
    closeInitialSetup: () => undefined,
    boot: async () => undefined,
    probeRuntime: async () => undefined,
    chooseWorkspace: async () => null,
    clearWorkspace: async () => undefined,
    deleteWorkspace: async () => undefined,
    refreshThreads: async () => {
      provider.refreshThreadsMock()
    },
    setThreadSearch: () => undefined,
    setShowArchivedThreads: () => undefined,
    createThread: async () => undefined,
    selectThread: async () => undefined,
    recoverActiveTurn: async () => false,
    sendMessage: async () => false,
    drainQueuedMessages: async () => undefined,
    removeQueuedMessage: () => undefined,
    rewindAndResend: async () => undefined,
    interrupt: async () => undefined,
    renameActiveThread: async () => undefined,
    renameThread: async () => undefined,
    archiveThread: async () => undefined,
    compactActiveThread: async () => undefined,
    forkActiveThread: async () => undefined,
    forkThreadFromTurn: async () => undefined,
    spawnSideConversation: async () => null,
    openSideConversationDraft: () => undefined,
    sendSideMessage: async () => false,
    interruptSide: async () => undefined,
    resolveSideUserInput: async () => undefined,
    setSideInput: () => undefined,
    setSideModel: () => undefined,
    setSideReasoningEffort: () => undefined,
    setSideFastMode: () => undefined,
    setSideAttachments: () => undefined,
    selectSideConversation: () => undefined,
    setSidePanelOpen: () => undefined,
    closeSideConversation: async () => undefined,
    discardSideConversation: async () => undefined,
    promoteSideConversation: async () => undefined,
    resumeSessionIntoThread: async () => null,
    deleteThread: async () => undefined,
    resolveApproval: async () => undefined,
    resolveUserInput: async () => undefined,
    selectInspectorItem: () => undefined,
    applyI18nFromSettings: async () => undefined,
    reloadUiSettings: async () => undefined,
    ...overrides
  } as ChatState
  const set: Harness['set'] = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: Harness['get'] = () => state
  const provider = new FakeProvider()
  const actions = createSideActions({
    set,
    get,
    getProvider: () => provider,
    t: (key) => key,
    formatRuntimeError: (e) => (e instanceof Error ? e.message : String(e ?? '')),
    shouldOpenSettingsForError: () => false
  }, dependencies)
  return { state, set, get, provider, actions }
}

describe('chat-store-side-actions', () => {
  beforeEach(() => {
    ;(globalThis as { window?: unknown }).window = {
      kunGui: {
        runtimeRequest: vi.fn(async () => ({ ok: true, status: 200, body: '{}' }))
      }
    }
  })
  afterEach(() => {
    teardownAllSideSubscriptions()
    vi.unstubAllGlobals()
    delete (globalThis as { window?: unknown }).window
  })

  it('uses the Kun default model when side creation has no parent or composer model to inherit', async () => {
    const { actions, state } = buildHarness({
      threads: [],
      activeThreadId: 'thr_missing',
      composerModel: '',
      composerPickList: []
    })

    const id = await actions.spawnSideConversation()

    expect(id).toBe('side_thr_missing')
    expect(state.sideConversations[id!].model).toBe(DEFAULT_KUN_MODEL)
  })

  it('a side turn updates only its own blocks/busy and tears down its subscription on close', async () => {
    const { actions, state, provider } = buildHarness()
    const id = (await actions.spawnSideConversation())!

    // The main thread is still untouched.
    expect(state.blocks).toEqual([])
    expect(state.busy).toBe(true)

    // Send a side message; only the side slice's busy flips.
    const sent = await actions.sendSideMessage(id, 'hi from side')
    expect(sent).toBe(true)
    expect(state.sideConversations[id].busy).toBe(true)
    expect(state.busy).toBe(true)

    // Close tears the subscription (abort() called on the controller).
    const lastCall = provider.subscribeMock.mock.calls.at(-1) as
      | [string, number, ThreadEventSink, AbortSignal]
      | undefined
    const signal = lastCall?.[3]
    expect(signal?.aborted).toBe(false)
    await actions.closeSideConversation(id)
    expect(state.sideConversations[id]).toBeUndefined()
    expect(signal?.aborted).toBe(true)
    expect(state.busy).toBe(true)
  })

  it('marks a hidden side completion unread and clears it when the side is opened', async () => {
    vi.stubGlobal('document', {
      visibilityState: 'hidden',
      hasFocus: () => false
    })
    const { actions, state, provider } = buildHarness()
    const id = (await actions.spawnSideConversation())!
    const sink = provider.subscribeMock.mock.calls.at(-1)?.[2] as ThreadEventSink

    sink.onTurnComplete()
    sink.onTurnComplete()
    expect(state.unreadThreadIds).toEqual({ [id]: 'completed' })

    actions.selectSideConversation(id)
    expect(state.unreadThreadIds).toEqual({})
  })

  it('keeps the focused selected side completion read', async () => {
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      hasFocus: () => true
    })
    const { actions, state, provider } = buildHarness()
    const id = (await actions.spawnSideConversation())!
    const sink = provider.subscribeMock.mock.calls.at(-1)?.[2] as ThreadEventSink

    sink.onTurnComplete()

    expect(state.unreadThreadIds).toEqual({})
  })

  it('deduplicates replayed compaction lifecycle events by item id', async () => {
    const { actions, state, provider } = buildHarness()
    const id = (await actions.spawnSideConversation())!
    const sink = provider.subscribeMock.mock.calls.at(-1)?.[2] as ThreadEventSink

    sink.onCompaction({
      itemId: 'compaction_side_1',
      summary: 'Compacting context',
      status: 'running',
      createdAt: '2026-06-02T00:00:00.000Z'
    })
    sink.onCompaction({
      itemId: 'compaction_side_1',
      summary: 'Compacted context',
      status: 'success',
      createdAt: '2026-06-02T00:00:01.000Z',
      messagesBefore: 120
    })

    const blocks = state.sideConversations[id].blocks.filter((block) => block.kind === 'compaction')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      id: 'compaction_side_1',
      status: 'success',
      summary: 'Compacted context',
      messagesBefore: 120,
      createdAt: '2026-06-02T00:00:00.000Z'
    })
  })

  it('keeps side assistant text intact across tools and replaces it from the authoritative snapshot', async () => {
    const { actions, state, provider } = buildHarness()
    const id = (await actions.spawnSideConversation())!
    const sink = provider.subscribeMock.mock.calls.at(-1)?.[2] as ThreadEventSink

    sink.onDeltas([{
      seq: 1,
      threadId: id,
      turnId: 'turn_side_1',
      itemId: 'assistant_side_1',
      createdAt: '2026-06-02T00:00:00.000Z',
      kind: 'agent_message',
      text: 'partial '
    }])
    sink.onTool({
      itemId: 'tool_side_1',
      turnId: 'turn_side_1',
      summary: 'read',
      status: 'running'
    })
    sink.onDeltas([{
      seq: 2,
      threadId: id,
      turnId: 'turn_side_1',
      itemId: 'assistant_side_1',
      kind: 'agent_message',
      text: 'text'
    }])

    expect(state.sideConversations[id].liveAssistant).toBe('partial text')
    expect(state.sideConversations[id].blocks.filter((block) => block.kind === 'assistant')).toEqual([])

    sink.onAssistantItem?.({
      itemId: 'assistant_side_1',
      threadId: id,
      turnId: 'turn_side_1',
      kind: 'agent_message',
      status: 'completed',
      createdAt: '2026-06-02T00:00:00.000Z',
      text: 'partial missing middle text'
    })

    expect(state.sideConversations[id].liveAssistant).toBe('')
    expect(state.sideConversations[id].blocks).toContainEqual({
      kind: 'assistant',
      id: 'assistant_side_1',
      turnId: 'turn_side_1',
      createdAt: '2026-06-02T00:00:00.000Z',
      text: 'partial missing middle text'
    })
  })

  it('updates approval resolution inside the matching side conversation', async () => {
    const { actions, state, provider } = buildHarness()
    const id = (await actions.spawnSideConversation())!
    const lastCall = provider.subscribeMock.mock.calls.at(-1) as
      | [string, number, ThreadEventSink, AbortSignal]
      | undefined
    const sink = lastCall?.[2]
    sink?.onApproval({ approvalId: 'appr_side', summary: 'Run remote command' })
    sink?.onApprovalStatus?.({ approvalId: 'appr_side', status: 'expired' })

    expect(state.sideConversations[id].blocks).toContainEqual(expect.objectContaining({
      kind: 'approval',
      approvalId: 'appr_side',
      status: 'expired'
    }))
    expect(state.blocks).toEqual([])
  })

  it('promoteSideConversation clears the relation by PATCH /v1/threads/{id} and refreshes the thread list', async () => {
    const { actions, state } = buildHarness()
    const id = (await actions.spawnSideConversation())!
    const runtimeRequest = globalThis.window.kunGui.runtimeRequest as ReturnType<typeof vi.fn>
    runtimeRequest.mockClear()

    await actions.promoteSideConversation(id)

    expect(runtimeRequest).toHaveBeenCalledWith(
      `/v1/threads/${id}`,
      'PATCH',
      JSON.stringify({ relation: 'primary' })
    )
    expect(state.sideConversations[id]).toBeUndefined()
  })

  it('discardSideConversation deletes the underlying thread and tears down the subscription', async () => {
    const { actions, state, provider } = buildHarness()
    const id = (await actions.spawnSideConversation())!
    const lastCall = provider.subscribeMock.mock.calls.at(-1) as
      | [string, number, ThreadEventSink, AbortSignal]
      | undefined
    const signal = lastCall?.[3]

    await actions.discardSideConversation(id)
    expect(provider.deleteMock).toHaveBeenCalledWith(id)
    expect(state.sideConversations[id]).toBeUndefined()
    expect(signal?.aborted).toBe(true)
  })

  it('clones Design metadata but starts side turns fail-closed as Code', async () => {
    const cleanup = vi.fn(async () => undefined)
    const cloneDesignDocument = vi.fn(async () => ({
      designDocumentTarget: { documentId: 'doc_side_clone', boardArtifactId: 'board_source' },
      operationId: 'design-clone-side-test',
      cleanup
    }))
    const designProfile = {
      version: 1 as const,
      documentTarget: { documentId: 'doc_source', boardArtifactId: 'board_source' },
      outputMedium: 'html' as const,
      target: 'app' as const,
      preset: 'ios' as const,
      presetSource: 'explicit' as const,
      context: { tone: ['precise'] },
      lockedAtTurnId: 'turn_lock'
    }
    const { actions, state, provider } = buildHarness({
      threads: [{
        id: 'thr_main', title: 'Parent', updatedAt: '', model: 'deepseek-chat', mode: 'agent',
        workspace: '/tmp', agentSurface: 'design', designProfile
      }]
    }, { cloneDesignDocument })

    const id = await actions.spawnSideConversation('Refine the mobile layout')

    expect(cloneDesignDocument).toHaveBeenCalledWith({
      workspaceRoot: '/tmp', sourceTarget: designProfile.documentTarget,
      operation: { kind: 'fork', sourceId: 'thr_main', relation: 'side' }
    })
    expect(provider.forkMock).toHaveBeenCalledWith('thr_main', expect.objectContaining({
      relation: 'side',
      designDocumentTarget: { documentId: 'doc_side_clone', boardArtifactId: 'board_source' },
      designCloneOperationId: 'design-clone-side-test'
    }))
    expect(state.sideConversations[id!].designProfile?.documentTarget.documentId).toBe('doc_side_clone')
    expect(provider.sendMock).toHaveBeenCalledWith(id, 'Refine the mobile layout', expect.objectContaining({
      agentSurface: 'code'
    }))
    const sideOptions = provider.sendMock.mock.calls.at(-1)?.[2]
    expect(sideOptions).not.toHaveProperty('guiDesignCanvas')
    expect(sideOptions).not.toHaveProperty('guiDesignMode')
    expect(sideOptions).not.toHaveProperty('designDocumentTarget')
    expect(sideOptions).not.toHaveProperty('designProfile')
    expect(cleanup).not.toHaveBeenCalled()
  })

  it('cleans a prepared Design side clone when runtime fork admission fails', async () => {
    const cleanup = vi.fn(async () => undefined)
    const cloneDesignDocument = vi.fn(async () => ({
      designDocumentTarget: { documentId: 'doc_side_clone', boardArtifactId: 'board_source' },
      cleanup
    }))
    const designProfile = {
      version: 1 as const,
      documentTarget: { documentId: 'doc_source', boardArtifactId: 'board_source' },
      outputMedium: 'html' as const,
      target: 'web' as const,
      preset: 'none' as const,
      presetSource: 'none' as const,
      context: { tone: [] },
      lockedAtTurnId: 'turn_lock'
    }
    const harness = buildHarness({
      threads: [{
        id: 'thr_main', title: 'Parent', updatedAt: '', model: 'deepseek-chat', mode: 'agent',
        workspace: '/tmp', agentSurface: 'design', designProfile
      }]
    }, { cloneDesignDocument })
    harness.provider.forkFailure = new Error('HTTP 409 fork rejected')

    await expect(harness.actions.spawnSideConversation()).resolves.toBeNull()
    expect(cleanup).toHaveBeenCalledOnce()
    expect(harness.state.error).toContain('fork rejected')
  })

  it('recovers a committed Design side clone after its response is lost', async () => {
    const cleanup = vi.fn(async () => undefined)
    const commit = vi.fn(async () => undefined)
    const clonedTarget = { documentId: 'doc_side_recovered', boardArtifactId: 'board_source' }
    const cloneDesignDocument = vi.fn(async () => ({
      designDocumentTarget: clonedTarget, cleanup, commit
    }))
    const designProfile = {
      version: 1 as const,
      documentTarget: { documentId: 'doc_source', boardArtifactId: 'board_source' },
      outputMedium: 'html' as const, target: 'web' as const, preset: 'none' as const,
      context: { tone: [] }, lockedAtTurnId: 'turn_lock'
    }
    const harness = buildHarness({
      threads: [{
        id: 'thr_main', title: 'Parent', updatedAt: '', model: 'deepseek-chat',
        mode: 'agent', workspace: '/tmp', agentSurface: 'code', designProfile
      }]
    }, { cloneDesignDocument })
    const recovered = {
      id: 'side_recovered', title: 'Recovered side', updatedAt: '', model: 'deepseek-chat',
      mode: 'agent' as const, workspace: '/tmp', status: 'idle', relation: 'side' as const,
      parentThreadId: 'thr_main', agentSurface: 'code' as const,
      designProfile: { ...designProfile, documentTarget: clonedTarget }
    }
    harness.provider.forkFailure = new Error('network response lost after commit')
    vi.spyOn(harness.provider, 'listThreads').mockResolvedValueOnce([recovered])

    await expect(harness.actions.spawnSideConversation()).resolves.toBe('side_recovered')
    expect(commit).toHaveBeenCalledOnce()
    expect(cleanup).not.toHaveBeenCalled()
    expect(harness.state.sideConversations.side_recovered).toBeDefined()
  })

  it('side state survives a main-thread switch: closing/discarding the side does not change activeThreadId', async () => {
    const { actions, state, provider } = buildHarness()
    const id = (await actions.spawnSideConversation())!
    // Simulate the user picking a different main thread mid-side.
    state.activeThreadId = 'thr_other'
    state.busy = false
    await actions.closeSideConversation(id)
    expect(state.activeThreadId).toBe('thr_other')
    expect(state.busy).toBe(false)
  })
})

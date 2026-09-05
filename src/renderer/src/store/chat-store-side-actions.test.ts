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
    removeWorkspace: async () => undefined,
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

  it('spawnSideConversation does not change activeThreadId or main busy, even when main is running', async () => {
    const { actions, state, provider } = buildHarness()
    expect(state.activeThreadId).toBe('thr_main')
    expect(state.busy).toBe(true)

    const id = await actions.spawnSideConversation()

    expect(id).toBe('side_thr_main')
    expect(state.activeThreadId).toBe('thr_main')
    expect(state.busy).toBe(true)
    expect(state.sideConversations[id!]).toBeDefined()
    expect(state.sideConversations[id!].parentThreadId).toBe('thr_main')
    expect(state.sidePanel.open).toBe(true)
    expect(state.sidePanel.activeSideId).toBe(id)
    expect(provider.forkMock).toHaveBeenCalledWith('thr_main', { relation: 'side', title: 'Paren · side' })
    // A dedicated subscription was started for the side thread.
    expect(provider.subscribeMock).toHaveBeenCalledWith('side_thr_main', 0, expect.anything(), expect.anything())
  })

  it('openSideConversationDraft opens the side surface without forking a thread', () => {
    const { actions, state, provider } = buildHarness()

    actions.openSideConversationDraft()

    expect(state.sidePanel.open).toBe(true)
    expect(state.sidePanel.activeSideId).toBeNull()
    expect(state.sideConversations).toEqual({})
    expect(provider.forkMock).not.toHaveBeenCalled()
  })

  it('keeps side user input live and resolves it against the side block', async () => {
    const { actions, state, provider } = buildHarness()
    const sideId = await actions.spawnSideConversation()
    const sink = provider.subscribeMock.mock.calls.at(-1)?.[2] as ThreadEventSink

    sink.onUserInput({
      requestId: 'request-side-1',
      itemId: 'item-side-1',
      turnId: 'turn-side-1',
      questions: [{
        id: 'scope',
        header: 'Scope',
        question: 'Where should this be available?',
        options: [
          { label: 'Side only', description: 'Keep it in the side conversation.' },
          { label: 'Everywhere', description: 'Share it with the main conversation.' }
        ]
      }]
    })

    expect(state.sideConversations[sideId!].blocks).toContainEqual(
      expect.objectContaining({
        kind: 'user_input',
        id: 'item-side-1',
        requestId: 'request-side-1',
        status: 'pending',
        live: true
      })
    )

    await actions.resolveSideUserInput(sideId!, 'item-side-1', {
      kind: 'submit',
      answers: [{ id: 'scope', label: 'Side only', value: 'Side only' }]
    })

    expect(provider.submitUserInputMock).toHaveBeenCalledWith(
      'request-side-1',
      [{ id: 'scope', label: 'Side only', value: 'Side only' }]
    )
    expect(state.sideConversations[sideId!].blocks).toContainEqual(
      expect.objectContaining({
        kind: 'user_input',
        id: 'item-side-1',
        status: 'submitted',
        live: false,
        answers: [{ id: 'scope', label: 'Side only', value: 'Side only' }]
      })
    )
  })

  it('spawnSideConversation with seedText immediately sends the first turn', async () => {
    const { actions, state, provider } = buildHarness()
    const id = await actions.spawnSideConversation('what is the dependency tree?')
    expect(id).toBe('side_thr_main')
    expect(provider.sendMock).toHaveBeenCalledWith(
      'side_thr_main',
      'what is the dependency tree?',
      expect.objectContaining({ model: 'deepseek-chat', reasoningEffort: 'max' })
    )
    const side = state.sideConversations[id!]
    expect(side.busy).toBe(true)
    expect(side.turnId).toMatch(/^turn_side_thr_main_/)
    expect(side.input).toBe('')
  })

  it('sends Fast mode as priority service tier for eligible Codex branch turns', async () => {
    const modelGroup = {
      providerId: 'codex-2',
      presetSource: 'codex' as const,
      label: 'ChatGPT subscription 2',
      modelIds: ['gpt-5.4'],
      modelProfiles: {
        'gpt-5.4': {
          inputModalities: ['text' as const],
          outputModalities: ['text' as const],
          supportsToolCalling: true,
          messageParts: ['text' as const],
          serviceTiers: ['priority' as const]
        }
      }
    }
    const { actions, state, provider } = buildHarness({
      composerModel: 'gpt-5.4',
      composerProviderId: 'codex-2',
      composerFastMode: true,
      composerPickList: ['gpt-5.4'],
      composerModelGroups: [modelGroup]
    })

    const id = await actions.spawnSideConversation('send the first turn fast', {
      model: 'gpt-5.4',
      providerId: 'codex-2',
      fastMode: true
    })

    expect(id).toBe('side_thr_main')
    expect(state.sideConversations[id!].fastMode).toBe(true)
    expect(provider.sendMock).toHaveBeenLastCalledWith(
      id,
      'send the first turn fast',
      expect.objectContaining({ serviceTier: 'priority' })
    )

    state.sideConversations[id!].busy = false
    actions.setSideFastMode(id!, false)
    await actions.sendSideMessage(id!, 'send the next turn normally')
    expect(provider.sendMock).toHaveBeenLastCalledWith(
      id,
      'send the next turn normally',
      expect.not.objectContaining({ serviceTier: 'priority' })
    )
  })

  it('starts an attachment-only first branch turn', async () => {
    const { actions, state, provider } = buildHarness()

    const id = await actions.spawnSideConversation('', {
      attachments: [{ id: 'att-only', kind: 'image' }]
    })

    expect(provider.sendMock).toHaveBeenCalledWith(
      id,
      '',
      expect.objectContaining({ attachmentIds: ['att-only'] })
    )
    expect(state.sideConversations[id!].attachments).toEqual([])
    expect(state.sideConversations[id!].busy).toBe(true)
  })

  it('sends branch attachments, clears them only after success, and keeps Fast mode', async () => {
    const modelGroup = {
      providerId: 'codex-2',
      presetSource: 'codex' as const,
      label: 'ChatGPT subscription 2',
      modelIds: ['gpt-5.4'],
      modelProfiles: {
        'gpt-5.4': {
          inputModalities: ['text' as const, 'image' as const],
          outputModalities: ['text' as const],
          supportsToolCalling: true,
          messageParts: ['text' as const, 'image_url' as const],
          serviceTiers: ['priority' as const]
        }
      }
    }
    const { actions, state, provider } = buildHarness({
      composerModel: 'gpt-5.4',
      composerProviderId: 'codex-2',
      composerFastMode: true,
      composerPickList: ['gpt-5.4'],
      composerModelGroups: [modelGroup]
    })
    const id = await actions.spawnSideConversation(undefined, {
      model: 'gpt-5.4',
      providerId: 'codex-2',
      fastMode: true
    })
    actions.setSideAttachments(id!, [
      { id: 'att-side', kind: 'image', previewUrl: 'data:image/png;base64,preview' }
    ])

    await actions.sendSideMessage(id!, 'inspect this image')

    expect(provider.sendMock).toHaveBeenLastCalledWith(
      id,
      'inspect this image',
      expect.objectContaining({
        serviceTier: 'priority',
        attachmentIds: ['att-side']
      })
    )
    expect(state.sideConversations[id!].attachments).toEqual([])
  })

  it('preserves attachments added while turn admission is pending', async () => {
    const { actions, state, provider } = buildHarness()
    const id = (await actions.spawnSideConversation())!
    actions.setSideAttachments(id, [{ id: 'att-submitted', kind: 'image' }])
    let releaseSend!: () => void
    provider.sendGate = new Promise<void>((resolve) => {
      releaseSend = resolve
    })

    const sending = actions.sendSideMessage(id, 'inspect the first image')
    await vi.waitFor(() => expect(provider.sendMock).toHaveBeenCalled())
    actions.setSideAttachments(id, [
      { id: 'att-submitted', kind: 'image' },
      { id: 'att-uploaded-later', kind: 'image' }
    ])
    releaseSend()
    await sending

    expect(state.sideConversations[id].attachments).toEqual([
      expect.objectContaining({ id: 'att-uploaded-later' })
    ])
  })

  it('sends draft attachments on the first branch turn and retains them when admission fails', async () => {
    const { actions, state, provider } = buildHarness()
    provider.sendMock.mockImplementationOnce(() => {
      throw new Error('turn admission failed')
    })

    const id = await actions.spawnSideConversation('inspect draft image', {
      attachments: [{ id: 'att-draft', kind: 'image' }]
    })

    expect(id).toBe('side_thr_main')
    expect(provider.sendMock).toHaveBeenCalledWith(
      id,
      'inspect draft image',
      expect.objectContaining({ attachmentIds: ['att-draft'] })
    )
    expect(state.sideConversations[id!].attachments).toEqual([
      expect.objectContaining({ id: 'att-draft' })
    ])
    expect(state.sideConversations[id!].error).toBe('turn admission failed')
  })

  it('keeps attachments isolated between side conversations and the main composer', async () => {
    const { actions, state } = buildHarness()
    const firstId = (await actions.spawnSideConversation())!
    state.sideConversations['side-other'] = {
      ...state.sideConversations[firstId],
      threadId: 'side-other',
      attachments: [{ id: 'att-other', kind: 'image' }]
    }

    actions.setSideAttachments(firstId, [{ id: 'att-first', kind: 'image' }])

    expect(state.sideConversations[firstId].attachments).toEqual([
      expect.objectContaining({ id: 'att-first' })
    ])
    expect(state.sideConversations['side-other'].attachments).toEqual([
      expect.objectContaining({ id: 'att-other' })
    ])
    expect(state.queuedMessages).toEqual([])
  })

  it('applies draft model and reasoning controls before sending the first side turn', async () => {
    const { actions, state, provider } = buildHarness()
    const id = await actions.spawnSideConversation('use the draft controls', {
      model: 'custom-side-model',
      providerId: 'custom-side-provider',
      reasoningEffort: 'low'
    })

    expect(id).toBe('side_thr_main')
    expect(state.sideConversations[id!]).toMatchObject({
      model: 'custom-side-model',
      providerId: 'custom-side-provider',
      reasoningEffort: 'low'
    })
    expect(provider.sendMock).toHaveBeenCalledWith(
      id,
      'use the draft controls',
      expect.objectContaining({
        model: 'custom-side-model',
        providerId: 'custom-side-provider',
        reasoningEffort: 'low'
      })
    )
  })

  it('keeps the selected provider bound to the side model without changing the main composer', async () => {
    const { actions, state, provider } = buildHarness({
      composerModel: 'gpt-5.6-sol',
      composerProviderId: 'codex',
      composerPickList: ['gpt-5.6-sol', 'composer-2.5'],
      composerModelGroups: [{
        providerId: 'cursor-subscription',
        accountId: 'cursor-account',
        label: 'Cursor subscription',
        modelIds: ['composer-2.5']
      }]
    })

    const id = await actions.spawnSideConversation()
    actions.setSideModel(id!, 'composer-2.5', 'cursor-subscription')
    const sent = await actions.sendSideMessage(id!, 'route through Cursor')

    expect(id).toBe('side_thr_main')
    expect(sent).toBe(true)
    expect(state.sideConversations[id!]).toMatchObject({
      model: 'composer-2.5',
      providerId: 'cursor-subscription'
    })
    expect(state.composerModel).toBe('gpt-5.6-sol')
    expect(state.composerProviderId).toBe('codex')
    expect(provider.sendMock).toHaveBeenCalledWith(
      id,
      'route through Cursor',
      expect.objectContaining({
        model: 'composer-2.5',
        providerId: 'cursor-subscription',
        accountId: 'cursor-account'
      })
    )
  })

  it('sends the selected side reasoning effort with side turns', async () => {
    const { actions, state, provider } = buildHarness()
    const id = (await actions.spawnSideConversation())!

    actions.setSideReasoningEffort(id, 'low')
    const sent = await actions.sendSideMessage(id, 'use less reasoning')

    expect(sent).toBe(true)
    expect(state.sideConversations[id].reasoningEffort).toBe('low')
    expect(provider.sendMock).toHaveBeenLastCalledWith(
      id,
      'use less reasoning',
      expect.objectContaining({
        model: 'deepseek-chat',
        reasoningEffort: 'low'
      })
    )
  })

})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatBlock, NormalizedThread, ThreadEventSink } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet, GuiPlanMessageContext } from './chat-store-types'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { graphRuntimeClient } from '../graph/graph-runtime-client'
import { useGraphStore } from '../graph/graph-store'
import type { GraphRun } from '../graph/graph-types'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import i18n from '../i18n'
import type { BrowserStorageLike } from '../lib/browser-storage'
import {
  queuedMessagesForThread,
  saveQueuedMessagesForThread
} from './queued-message-persistence'
import {
  clearThreadSnapshotCache,
  getThreadSnapshot,
  snapshotThreadProjection
} from './thread-snapshot-cache'
import { invalidatePendingTurnStarts } from './turn-start-fence'

const registryMock = vi.hoisted(() => ({
  getProvider: vi.fn()
}))

vi.mock('../agent/registry', () => ({
  getProvider: registryMock.getProvider
}))

import { createThreadActions } from './chat-store-thread-actions'

const THREAD_COMPOSER_SELECTION_STORAGE_KEY = 'kun.threadComposerSelection.v1'

class MemoryStorage implements BrowserStorageLike {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function deferredValue<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function thread(id: string): NormalizedThread {
  return {
    id,
    title: id,
    updatedAt: '2026-06-09T00:00:00.000Z',
    model: 'deepseek-v4-pro',
    mode: 'agent',
    workspace: '/workspace/deepseek-gui',
    status: 'running'
  }
}

function buildHarness(): {
  actions: ReturnType<typeof createThreadActions>
  state: ChatState
} {
  let state: ChatState
  state = {
    activeThreadId: 'thr_existing',
    blocks: [],
    busy: true,
    clawChannels: [],
    codeWorkspaceRoots: [],
    composerModel: '',
    composerMode: 'agent',
    composerOrchestration: 'direct',
    composerProviderId: '',
    currentTurnId: null,
    currentTurnOrchestration: null,
    currentTurnUserId: null,
    error: 'previous error',
    extensionComposerContexts: [],
    lastSeq: 0,
    loadComposerModels: vi.fn(async () => undefined),
    queuedMessages: [],
    recoverActiveTurn: vi.fn(async () => true),
    refreshThreads: vi.fn(async () => undefined),
    route: 'chat',
    runtimeConnection: 'ready',
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    turnStartedAtByUserId: {},
    threads: [thread('thr_existing')]
  } as unknown as ChatState

  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: ChatStoreGet = () => state
  const actions = createThreadActions({
    set,
    get,
    sseAbortRef: { current: null }
  })
  state.sendMessage = actions.sendMessage
  return { actions, state }
}

function expectSink(sink: ThreadEventSink | null): ThreadEventSink {
  expect(sink).not.toBeNull()
  return sink as ThreadEventSink
}

describe('chat-store-thread-actions queued messages', () => {
  beforeEach(() => {
    clearThreadSnapshotCache()
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
    registryMock.getProvider.mockReturnValue({})
    useGraphStore.setState({
      threadId: null,
      runs: [],
      selectedRunId: null,
      selectedNodeId: null,
      error: null
    })
  })

  afterEach(() => {
    useWriteWorkspaceStore.getState().resetWorkspace()
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  it('keeps guidance queued when the active delegated runtime cannot steer live', async () => {
    const steerUserMessage = vi.fn(async () => undefined)
    registryMock.getProvider.mockReturnValue({ steerUserMessage })
    const { actions, state } = buildHarness()
    state.currentTurnId = 'turn_active'
    state.lastDelegatedRuntimeState = {
      threadId: 'thr_existing',
      turnId: 'turn_active',
      providerKind: 'cursor-sdk',
      providerId: 'cursor-subscription',
      phase: 'resumed',
      capabilities: {
        nativeResume: true,
        structuredStreaming: true,
        kunTools: false,
        externalApproval: false,
        liveSteering: false,
        nativeContextTelemetry: false,
        fork: false
      }
    }
    state.queuedMessages = [{
      id: 'q-delegated',
      text: 'apply this on the next turn',
      mode: 'agent'
    }]

    await expect(actions.guideQueuedMessage('q-delegated')).resolves.toBe(false)

    expect(steerUserMessage).not.toHaveBeenCalled()
    expect(state.queuedMessages).toEqual([
      expect.objectContaining({ id: 'q-delegated' })
    ])
    expect(state.error).toBeTruthy()
  })

  it('does not duplicate guided input when its SSE user message wins the request race', async () => {
    const { actions, state } = buildHarness()
    state.currentTurnId = 'turn_active'
    state.currentTurnUserId = 'user-original'
    state.queuedMessages = [{
      id: 'q-guide-race',
      text: 'use the compact logo instead',
      displayText: 'Use the compact logo instead',
      mode: 'agent'
    }]
    const steerUserMessage = vi.fn(async () => {
      state.blocks = [
        ...state.blocks,
        {
          kind: 'user',
          id: 'item_guided_user',
          turnId: 'turn_active',
          createdAt: new Date().toISOString(),
          text: 'use the compact logo instead',
          meta: { displayText: 'Use the compact logo instead' }
        }
      ]
    })
    registryMock.getProvider.mockReturnValue({ steerUserMessage })

    await expect(actions.guideQueuedMessage('q-guide-race')).resolves.toBe(true)

    expect(state.queuedMessages).toEqual([])
    expect(state.blocks.filter((block) => block.kind === 'user')).toEqual([
      expect.objectContaining({ id: 'item_guided_user' })
    ])
    expect(state.currentTurnUserId).toBe('user-original')
  })

  it('guides queued image attachments through native steering without dropping metadata', async () => {
    const steerUserMessage = vi.fn(async () => undefined)
    registryMock.getProvider.mockReturnValue({ steerUserMessage })
    const { actions, state } = buildHarness()
    state.currentTurnId = 'turn_active'
    state.currentTurnOrchestration = 'graph'
    state.queuedMessages = [{
      id: 'q-attachment',
      text: 'inspect this image',
      mode: 'agent',
      attachmentIds: ['attachment-1']
    }]

    await expect(actions.guideQueuedMessage('q-attachment')).resolves.toBe(true)

    expect(steerUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'turn_active',
      'inspect this image',
      { attachmentIds: ['attachment-1'] }
    )
    expect(state.queuedMessages).toHaveLength(0)
    expect(state.error).toBeNull()
  })

  it('keeps queued input when the active turn rejects guidance', async () => {
    const { actions, state } = buildHarness()
    state.currentTurnId = 'turn_graph_lead'
    state.currentTurnOrchestration = 'graph'
    const activeRun = {
      id: 'run_reject',
      threadId: 'thr_existing',
      sourceTurnId: 'turn_graph_lead',
      status: 'running',
      lastEventSeq: 2
    } as GraphRun
    useGraphStore.setState({
      threadId: 'thr_existing',
      runs: [activeRun],
      selectedRunId: activeRun.id
    })
    vi.spyOn(graphRuntimeClient, 'steer').mockRejectedValue(
      new Error('turn is no longer accepting steering')
    )
    state.queuedMessages = [{
      id: 'q-race',
      text: 'do not lose this follow-up',
      mode: 'agent'
    }]

    await expect(actions.guideQueuedMessage('q-race')).resolves.toBe(false)

    expect(state.queuedMessages).toEqual([
      expect.objectContaining({ id: 'q-race', text: 'do not lose this follow-up' })
    ])
    expect(state.blocks).toEqual([])
    expect(state.error).toContain('turn is no longer accepting steering')
  })

  it('sends the selected composer provider with the turn without switching the global runtime provider', async () => {
    const provider = {
      connect: vi.fn(async () => undefined),
      sendUserMessage: vi.fn(async () => ({
        threadId: 'thr_existing',
        turnId: 'turn_1',
        userMessageItemId: 'user_1'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    const setSettings = vi.fn(async () => ({
      agents: { kun: { providerId: 'xiaomi-token-plan', model: 'mimo-v2.5' } },
      codePromptPrefix: '',
      chatWelcomeMessage: ''
    }))
    const restartRuntime = vi.fn(async () => undefined)
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(async () => ({
          agents: { kun: { providerId: 'minimax-token-plan', model: 'MiniMax-M2' } },
          codePromptPrefix: '',
          chatWelcomeMessage: ''
        })),
        setSettings,
        restartRuntime,
        logError: vi.fn(async () => undefined)
      }
    })
    const { actions, state } = buildHarness()
    state.busy = false
    state.composerModel = 'mimo-v2.5'
    state.composerProviderId = 'xiaomi-token-plan'

    await expect(actions.sendMessage('hello', 'agent', {
      serviceTier: 'priority'
    })).resolves.toBe(true)

    expect(setSettings).not.toHaveBeenCalled()
    expect(restartRuntime).not.toHaveBeenCalled()
    expect(provider.connect).not.toHaveBeenCalled()
    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'hello',
      expect.objectContaining({
        model: 'mimo-v2.5',
        providerId: 'xiaomi-token-plan',
        serviceTier: 'priority'
      })
    )
  })

  it('does not project a late stopped admission as running when interrupt fails', async () => {
    const pendingSend = deferredValue<{ threadId: string, turnId: string, userMessageItemId: string }>()
    const interruptTurn = vi.fn(async () => { throw new Error('interrupt unavailable') })
    const sendUserMessage = vi.fn(() => pendingSend.promise)
    registryMock.getProvider.mockReturnValue({ sendUserMessage, interruptTurn })
    vi.stubGlobal('window', { kunGui: {
      getSettings: vi.fn(async () => ({ agents: { kun: { providerId: 'deepseek', model: 'deepseek-v4-pro' } }, codePromptPrefix: '', chatWelcomeMessage: '' })),
      logError: vi.fn(async () => undefined)
    } })
    const { actions, state } = buildHarness()
    state.busy = false
    state.threads = [{ ...thread('thr_existing'), status: 'idle', latestTurnStatus: 'idle' }]
    const sending = actions.sendMessage('stop this admission', 'agent')
    await vi.waitFor(() => expect(sendUserMessage).toHaveBeenCalledOnce())
    invalidatePendingTurnStarts()
    pendingSend.resolve({ threadId: 'thr_existing', turnId: 'turn_late', userMessageItemId: 'user_late' })
    await expect(sending).resolves.toBe(true)
    expect(interruptTurn).toHaveBeenCalledWith('thr_existing', 'turn_late', { discard: false })
    expect(state.refreshThreads).toHaveBeenCalledOnce()
    expect(state.threads[0]).toMatchObject({ latestTurnStatus: 'idle' })
    expect(state.busy).toBe(false)
  })

  it('keeps a late Code admission out of Work and invalidates the parked Code snapshot', async () => {
    const pendingSend = deferredValue<{ threadId: string, turnId: string, userMessageItemId: string }>()
    const subscribeThreadEvents = vi.fn(async () => undefined)
    const sendUserMessage = vi.fn(() => pendingSend.promise)
    const getThreadDetail = vi.fn(async () => ({
      blocks: [
        { kind: 'user' as const, id: 'user_code', turnId: 'turn_code', text: 'inspect the Code thread' },
        { kind: 'reasoning' as const, id: 'reasoning_code', turnId: 'turn_code', text: 'Inspecting' }
      ],
      latestSeq: 8,
      threadStatus: 'running' as const,
      latestTurnId: 'turn_code',
      latestTurnStatus: 'running',
      latestUserMessageId: 'user_code'
    }))
    registryMock.getProvider.mockReturnValue({ sendUserMessage, subscribeThreadEvents, getThreadDetail })
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(async () => ({
          agents: { kun: { providerId: 'deepseek', model: 'deepseek-v4-pro' } },
          codePromptPrefix: '',
          chatWelcomeMessage: ''
        })),
        workspaceDirectoryExists: vi.fn(async () => true),
        logError: vi.fn(async () => undefined)
      }
    })
    const { actions, state } = buildHarness()
    state.busy = false
    state.composerPickList = []
    state.composerModelGroups = []
    state.threads = [{ ...thread('thr_existing'), status: 'idle' }]

    const sending = actions.sendMessage('inspect the Code thread', 'agent')
    await vi.waitFor(() => expect(sendUserMessage).toHaveBeenCalledOnce())
    snapshotThreadProjection(state)
    expect(getThreadSnapshot('thr_existing')).not.toBeNull()

    state.activeThreadId = 'thr_work'
    state.blocks = [{ kind: 'user', id: 'work-user', text: 'Work question' }]
    state.busy = false
    state.currentTurnId = null
    state.currentTurnUserId = null
    state.threads = [...state.threads, { ...thread('thr_work'), status: 'idle' }]
    pendingSend.resolve({
      threadId: 'thr_existing',
      turnId: 'turn_code',
      userMessageItemId: 'user_code'
    })

    await expect(sending).resolves.toBe(true)
    expect(state.activeThreadId).toBe('thr_work')
    expect(state.blocks).toEqual([{ kind: 'user', id: 'work-user', text: 'Work question' }])
    expect(state.busy).toBe(false)
    expect(state.currentTurnId).toBeNull()
    expect(getThreadSnapshot('thr_existing')).toBeNull()
    expect(subscribeThreadEvents).not.toHaveBeenCalled()

    await actions.selectThread('thr_existing')
    expect(getThreadDetail).toHaveBeenCalledWith('thr_existing', expect.objectContaining({ priority: 'foreground' }))
    expect(state.blocks).toEqual([
      expect.objectContaining({ id: 'user_code', turnId: 'turn_code' }),
      expect.objectContaining({ id: 'reasoning_code', turnId: 'turn_code' })
    ])
    expect(state.busy).toBe(true)
    expect(state.currentTurnId).toBe('turn_code')
    expect(state.currentTurnUserId).toBe('user_code')
  })

  it('forwards and projects Design continuation turns as hidden user progress', async () => {
    const provider = {
      sendUserMessage: vi.fn(async () => ({
        threadId: 'thr_existing',
        turnId: 'turn_logo',
        userMessageItemId: 'user_logo'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(async () => ({
          agents: { kun: { providerId: 'deepseek', model: 'deepseek-v4-pro' } },
          codePromptPrefix: '',
          chatWelcomeMessage: ''
        })),
        logError: vi.fn(async () => undefined)
      }
    })
    const { actions, state } = buildHarness()
    state.busy = false
    const designProfile = {
      version: 1 as const,
      documentTarget: { documentId: 'doc_logo', boardArtifactId: 'board_logo' },
      outputMedium: 'image' as const,
      target: 'web' as const,
      preset: 'none' as const,
      context: { tone: [] }
    }
    state.threads = [{ ...thread('thr_existing'), agentSurface: 'code', status: 'idle' }]

    await expect(actions.sendMessage('internal logo prompt', 'agent', {
      expectedThreadId: 'thr_existing',
      agentSurface: 'design',
      designProfile,
      designDocumentTarget: designProfile.documentTarget,
      messageSource: 'design_continuation'
    })).resolves.toBe(true)

    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'internal logo prompt',
      expect.objectContaining({ messageSource: 'design_continuation' })
    )
    expect(state.blocks).toContainEqual(expect.objectContaining({
      kind: 'user',
      meta: expect.objectContaining({ messageSource: 'design_continuation' })
    }))
  })

  it('starts a Git checkpoint without blocking turn admission', async () => {
    const sendUserMessage = vi.fn(async () => ({
      threadId: 'thr_existing',
      turnId: 'turn_1',
      userMessageItemId: 'user_1'
    }))
    registryMock.getProvider.mockReturnValue({
      sendUserMessage,
      subscribeThreadEvents: vi.fn(async () => undefined)
    })
    let finishCheckpoint!: (value: {
      ok: true
      checkpointId: string
      repositoryRoot: string
      head: string | null
      currentBranch: string | null
    }) => void
    const createGitCheckpoint = vi.fn((_input: {
      workspaceRoot: string
      threadId: string
      checkpointId?: string
    }) => new Promise<{
      ok: true
      checkpointId: string
      repositoryRoot: string
      head: string | null
      currentBranch: string | null
    }>((resolve) => { finishCheckpoint = resolve }))
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(async () => ({
          agents: { kun: { providerId: 'deepseek', model: 'deepseek-v4-pro' } },
          workspaceRoot: '/workspace/deepseek-gui',
          checkpointCleanup: { createEnabled: true, enabled: true, intervalDays: 3 },
          codePromptPrefix: '',
          chatWelcomeMessage: ''
        })),
        createGitCheckpoint,
        logError: vi.fn(async () => undefined)
      }
    })
    const { actions, state } = buildHarness()
    state.busy = false
    state.threads = [{ ...thread('thr_existing'), status: 'idle' }]

    await expect(actions.sendMessage('optimize this', 'agent')).resolves.toBe(true)

    expect(createGitCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      workspaceRoot: '/workspace/deepseek-gui',
      threadId: 'thr_existing',
      checkpointId: expect.stringMatching(/^gcp_/)
    }))
    const checkpointId = createGitCheckpoint.mock.calls[0]![0].checkpointId!
    expect(sendUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      expect.any(String),
      expect.objectContaining({ workspaceCheckpointRequestId: checkpointId })
    )

    finishCheckpoint({
      ok: true,
      checkpointId,
      repositoryRoot: '/workspace/deepseek-gui',
      head: null,
      currentBranch: null
    })
    await Promise.resolve()
  })

  it('sends Graph only while Graph is enabled and otherwise stays direct', async () => {
    const provider = {
      sendUserMessage: vi.fn(async () => ({
        threadId: 'thr_existing',
        turnId: 'turn_1',
        userMessageItemId: 'user_1'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(async () => ({
          agents: { kun: { providerId: 'deepseek', model: 'deepseek-v4-pro' } },
          codePromptPrefix: '',
          chatWelcomeMessage: ''
        })),
        logError: vi.fn(async () => undefined)
      }
    })
    const { actions, state } = buildHarness()
    state.busy = false
    state.graphEnabled = true
    state.composerOrchestration = 'graph'

    await expect(actions.sendMessage('orchestrate this', 'agent')).resolves.toBe(true)
    expect(provider.sendUserMessage).toHaveBeenLastCalledWith(
      'thr_existing',
      'orchestrate this',
      expect.objectContaining({ orchestration: 'graph' })
    )
    expect(state.currentTurnOrchestration).toBe('graph')

    const { actions: directActions, state: directState } = buildHarness()
    directState.busy = false
    directState.graphEnabled = false
    directState.composerOrchestration = 'graph'
    await expect(directActions.sendMessage('run directly', 'agent')).resolves.toBe(true)
    expect(provider.sendUserMessage).toHaveBeenLastCalledWith(
      'thr_existing',
      'run directly',
      expect.objectContaining({ orchestration: 'direct' })
    )
    expect(directState.currentTurnOrchestration).toBe('direct')
  })

  it('surfaces a Graph-disabled 503 without retrying Direct or changing the Graph preference', async () => {
    const sendUserMessage = vi.fn(async () => {
      throw Object.assign(new Error(JSON.stringify({
        code: 'capability_unavailable',
        message: 'Graph Mode is disabled; submit this turn with direct orchestration'
      })), { status: 503 })
    })
    registryMock.getProvider.mockReturnValue({ sendUserMessage })
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(async () => ({
          agents: { kun: { providerId: 'deepseek', model: 'deepseek-v4-pro' } },
          codePromptPrefix: '',
          chatWelcomeMessage: ''
        })),
        logError: vi.fn(async () => undefined)
      }
    })
    const { actions, state } = buildHarness()
    state.busy = false
    state.graphEnabled = true
    state.composerOrchestration = 'graph'

    await expect(actions.sendMessage('run this graph', 'agent')).resolves.toBe(false)

    expect(sendUserMessage).toHaveBeenCalledTimes(1)
    expect(sendUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'run this graph',
      expect.objectContaining({ orchestration: 'graph' })
    )
    expect(state.composerOrchestration).toBe('graph')
    expect(state.currentTurnOrchestration).toBeNull()
    expect(state.error).toBe('Graph Mode is disabled; submit this turn with direct orchestration')
    expect(state.blocks).toContainEqual(expect.objectContaining({
      kind: 'system',
      text: 'Graph Mode is disabled; submit this turn with direct orchestration',
      code: 'capability_unavailable'
    }))
  })

  it('keeps a rejected send visible as a non-interactive conversation error', async () => {
    const provider = {
      sendUserMessage: vi.fn(async () => {
        throw new Error('Authorization: Bearer secret-token failed with HTTP 429')
      })
    }
    registryMock.getProvider.mockReturnValue(provider)
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(async () => ({
          agents: { kun: { providerId: 'deepseek', model: 'deepseek-v4-pro' } },
          codePromptPrefix: '',
          chatWelcomeMessage: ''
        })),
        logError: vi.fn(async () => undefined)
      }
    })
    const { actions, state } = buildHarness()
    state.busy = false

    await expect(actions.sendMessage('hello', 'agent')).resolves.toBe(false)

    expect(state.currentTurnOrchestration).toBeNull()
    expect(state.blocks).toContainEqual(expect.objectContaining({
      kind: 'user',
      text: 'hello'
    }))
    const errorBlock = state.blocks.find(
      (block): block is Extract<ChatBlock, { kind: 'system' }> =>
        block.kind === 'system' && block.runtimeError === true
    )
    expect(errorBlock).toMatchObject({
      kind: 'system',
      severity: 'error',
      runtimeError: true
    })
    expect(errorBlock?.text).toContain('HTTP 429')
    expect(errorBlock?.text).toContain('<redacted>')
    expect(errorBlock?.text).not.toContain('secret-token')
  })

  it('retains the same admission key when the POST outcome is unknown', async () => {
    const sendUserMessage = vi.fn(async (
      _threadId: string,
      _text: string,
      _options?: { clientRequestId?: string }
    ) => {
      throw new Error('socket closed after request write')
    })
    registryMock.getProvider.mockReturnValue({ sendUserMessage })
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(async () => ({
          agents: { kun: { providerId: 'deepseek', model: 'deepseek-v4-pro' } },
          codePromptPrefix: '',
          chatWelcomeMessage: ''
        })),
        logError: vi.fn(async () => undefined)
      }
    })
    const { actions, state } = buildHarness()
    state.busy = false
    state.recoverActiveTurn = vi.fn(async () => false)

    await expect(actions.sendMessage('retry safely', 'agent')).resolves.toBe(false)

    const requestId = sendUserMessage.mock.calls[0]![2]?.clientRequestId
    expect(requestId).toMatch(/^turn_/)
    expect(state.queuedMessages).toEqual([
      expect.objectContaining({
        text: 'retry safely',
        clientRequestId: requestId,
        deliveryState: 'pending'
      })
    ])
    expect(state.blocks.some((block) => block.kind === 'system' && block.runtimeError)).toBe(false)
  })

})

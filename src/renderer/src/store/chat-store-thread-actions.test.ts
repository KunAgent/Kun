import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatBlock, NormalizedThread, ThreadEventSink } from '../agent/types'
import type { DesignTaskProfile } from '../agent/design-task-profile'
import type { ChatState, ChatStoreGet, ChatStoreSet, GuiPlanMessageContext } from './chat-store-types'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { graphRuntimeClient } from '../graph/graph-runtime-client'
import { useGraphStore } from '../graph/graph-store'
import type { GraphRun } from '../graph/graph-types'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import i18n from '../i18n'
import type { BrowserStorageLike } from '../lib/browser-storage'
import { queuedMessagesForThread, saveQueuedMessagesForThread } from './queued-message-persistence'
import { clearThreadSnapshotCache } from './thread-snapshot-cache'

const registryMock = vi.hoisted(() => ({ getProvider: vi.fn() }))

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

  it('never falls back to the active Code thread for a thread-bound Design send', async () => {
    const sendUserMessage = vi.fn()
    registryMock.getProvider.mockReturnValue({ sendUserMessage })
    const { actions, state } = buildHarness()
    state.busy = false
    state.route = 'design'
    state.activeThreadId = 'thr_existing'

    await expect(actions.sendMessage('draw the home page', 'agent', {
      agentSurface: 'design',
      expectedThreadId: 'thr_design'
    })).resolves.toBe(false)

    expect(sendUserMessage).not.toHaveBeenCalled()
    expect(state.blocks).toEqual([])
    expect(state.error).toContain('no longer active')
  })

  it('cancels a thread-bound Design send if the active task changes during setup', async () => {
    const pendingSettings = deferredValue<{
      agents: { kun: { providerId: string; model: string } }
      codePromptPrefix: string
      chatWelcomeMessage: string
    }>()
    const sendUserMessage = vi.fn()
    registryMock.getProvider.mockReturnValue({
      sendUserMessage,
      subscribeThreadEvents: vi.fn(async () => undefined)
    })
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(() => pendingSettings.promise),
        workspaceDirectoryExists: vi.fn(async () => true),
        logError: vi.fn(async () => undefined)
      }
    })
    const { actions, state } = buildHarness()
    state.busy = false
    state.route = 'chat'
    const designProfile = {
      version: 1 as const,
      documentTarget: { documentId: 'doc_home', boardArtifactId: 'board_home' },
      outputMedium: 'html' as const,
      target: 'web' as const,
      preset: 'none' as const,
      context: { tone: [] }
    }
    state.threads = [{ ...thread('thr_existing'), agentSurface: 'code' }]

    const sending = actions.sendMessage('draw the home page', 'agent', {
      agentSurface: 'design',
      expectedThreadId: 'thr_existing',
      designProfile,
      designDocumentTarget: designProfile.documentTarget
    })
    await vi.waitFor(() => {
      expect(state.blocks).toContainEqual(expect.objectContaining({
        kind: 'user',
        text: 'draw the home page'
      }))
    })

    state.activeThreadId = 'thr_code'
    state.threads = [...state.threads, thread('thr_code')]
    pendingSettings.resolve({
      agents: { kun: { providerId: 'deepseek', model: 'deepseek-v4-pro' } },
      codePromptPrefix: '',
      chatWelcomeMessage: ''
    })

    await expect(sending).resolves.toBe(false)
    expect(sendUserMessage).not.toHaveBeenCalled()
    // The stale task no longer owns the active projection, so the send path
    // must not overwrite the newer selection while rolling back its snapshot.
    expect(state.activeThreadId).toBe('thr_code')
    expect(state.error).toContain('no longer active')
  })

  it('does not project an accepted Design turn into a thread selected while the provider is pending', async () => {
    const pendingSend = deferredValue<{
      threadId: string
      turnId: string
      userMessageItemId: string
    }>()
    const subscribeThreadEvents = vi.fn(async () => undefined)
    const sendUserMessage = vi.fn(() => pendingSend.promise)
    registryMock.getProvider.mockReturnValue({ sendUserMessage, subscribeThreadEvents })
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
    state.route = 'chat'
    const designProfile = {
      version: 1 as const,
      documentTarget: { documentId: 'doc_home', boardArtifactId: 'board_home' },
      outputMedium: 'html' as const,
      target: 'web' as const,
      preset: 'none' as const,
      context: { tone: [] }
    }
    state.threads = [{ ...thread('thr_existing'), agentSurface: 'code' }]

    const sending = actions.sendMessage('draw the home page', 'agent', {
      agentSurface: 'design',
      expectedThreadId: 'thr_existing',
      designProfile,
      designDocumentTarget: designProfile.documentTarget
    })
    await vi.waitFor(() => expect(sendUserMessage).toHaveBeenCalledOnce())

    state.route = 'chat'
    state.activeThreadId = 'thr_code'
    state.threads = [...state.threads, thread('thr_code')]
    state.blocks = [{ kind: 'user', id: 'code-user', text: 'Code question' }]
    state.busy = false
    state.currentTurnId = null
    state.currentTurnUserId = null
    pendingSend.resolve({
      threadId: 'thr_existing',
      turnId: 'turn_design',
      userMessageItemId: 'user_design'
    })

    await expect(sending).resolves.toBe(true)
    expect(state.activeThreadId).toBe('thr_code')
    expect(state.blocks).toEqual([{ kind: 'user', id: 'code-user', text: 'Code question' }])
    expect(state.busy).toBe(false)
    expect(state.currentTurnId).toBeNull()
    expect(subscribeThreadEvents).not.toHaveBeenCalled()
  })

  it('ignores an older thread detail response after a newer selection wins', async () => {
    const first = deferredValue<{
      blocks: ChatBlock[]
      latestSeq: number
      threadStatus: 'idle'
    }>()
    const second = deferredValue<{
      blocks: ChatBlock[]
      latestSeq: number
      threadStatus: 'idle'
    }>()
    registryMock.getProvider.mockReturnValue({
      getThreadDetail: vi.fn((id: string) => id === 'thr_first' ? first.promise : second.promise),
      subscribeThreadEvents: vi.fn(async () => undefined)
    })
    const { actions, state } = buildHarness()
    state.busy = false
    state.composerPickList = []
    state.composerModelGroups = []
    state.threads = [thread('thr_existing'), thread('thr_first'), thread('thr_second')]

    const selectFirst = actions.selectThread('thr_first')
    const selectSecond = actions.selectThread('thr_second')
    second.resolve({
      blocks: [{ kind: 'user', id: 'u-second', text: 'second selection' }],
      latestSeq: 2,
      threadStatus: 'idle'
    })
    await selectSecond
    first.resolve({
      blocks: [{ kind: 'user', id: 'u-first', text: 'stale selection' }],
      latestSeq: 1,
      threadStatus: 'idle'
    })
    await selectFirst

    expect(state.activeThreadId).toBe('thr_second')
    expect(state.blocks).toEqual([
      expect.objectContaining({ id: 'u-second', text: 'second selection' })
    ])
  })

  it('does not let a pending selection replace a thread activated synchronously', async () => {
    const pending = deferredValue<{
      blocks: ChatBlock[]
      latestSeq: number
      threadStatus: 'idle'
    }>()
    registryMock.getProvider.mockReturnValue({
      getThreadDetail: vi.fn(() => pending.promise),
      subscribeThreadEvents: vi.fn(async () => undefined)
    })
    const { actions, state } = buildHarness()
    state.busy = false
    state.composerPickList = []
    state.composerModelGroups = []
    state.threads = [thread('thr_existing'), thread('thr_old'), thread('thr_drawing')]

    const selectingOldThread = actions.selectThread('thr_old')
    state.activeThreadId = 'thr_drawing'
    state.blocks = []
    pending.resolve({
      blocks: [{ kind: 'user', id: 'u-old', text: 'late old selection' }],
      latestSeq: 1,
      threadStatus: 'idle'
    })
    await selectingOldThread

    expect(state.activeThreadId).toBe('thr_drawing')
    expect(state.blocks).toEqual([])
  })

  it('selects immediately, then settles a stale running sidebar summary from idle detail', async () => {
    const detail = deferredValue<{
      blocks: ChatBlock[]
      latestSeq: number
      threadStatus: 'idle'
      latestTurnId: string
      latestTurnStatus: 'completed'
      designProfile: DesignTaskProfile
    }>()
    registryMock.getProvider.mockReturnValue({
      getThreadDetail: vi.fn(() => detail.promise),
      subscribeThreadEvents: vi.fn(async () => undefined)
    })
    const { actions, state } = buildHarness()
    state.busy = false
    state.composerPickList = []
    state.composerModelGroups = []
    state.threads = [thread('thr_existing'), { ...thread('thr_idle'), status: 'running' }]

    const selecting = actions.selectThread('thr_idle')
    expect(state.activeThreadId).toBe('thr_idle')
    expect(state.threadLoadingId).toBe('thr_idle')
    expect(state.blocks).toEqual([])

    detail.resolve({
      blocks: [{ kind: 'assistant', id: 'a-idle', text: 'already complete' }],
      latestSeq: 17,
      threadStatus: 'idle',
      latestTurnId: 'turn-idle-complete',
      latestTurnStatus: 'completed',
      designProfile: {
        version: 1,
        documentTarget: { documentId: 'doc-idle', boardArtifactId: 'board-idle' },
        outputMedium: 'html', target: 'web', preset: 'none',
        context: { tone: [] },
        lockedAtTurnId: 'turn-idle-complete'
      }
    })
    await selecting

    expect(state.threadLoadingId).toBeNull()
    expect(state.busy).toBe(false)
    expect(state.threads.find((thread) => thread.id === 'thr_idle')).toMatchObject({
      status: 'idle',
      latestTurnId: 'turn-idle-complete',
      latestTurnStatus: 'completed',
      designProfile: expect.objectContaining({ documentTarget: {
        documentId: 'doc-idle', boardArtifactId: 'board-idle'
      } })
    })
  })

  it('restores a cached thread without a second detail request and resumes SSE at its cursor', async () => {
    const subscribeThreadEvents = vi.fn(async () => undefined)
    const getThreadDetail = vi.fn(async (id: string) => {
      if (id === 'thr_b') {
        return {
          blocks: [{ kind: 'assistant' as const, id: 'b-answer', text: 'B' }],
          latestSeq: 22,
          threadStatus: 'idle'
        }
      }
      throw new Error(`unexpected detail request for ${id}`)
    })
    registryMock.getProvider.mockReturnValue({ getThreadDetail, subscribeThreadEvents })
    const { actions, state } = buildHarness()
    state.busy = false
    state.composerPickList = []
    state.composerModelGroups = []
    state.activeThreadId = 'thr_a'
    state.blocks = [{ kind: 'assistant', id: 'a-answer', text: 'A' }]
    state.lastSeq = 11
    state.liveDeltaSeqFloor = 11
    state.threads = [thread('thr_a'), thread('thr_b')]
    state.composerOrchestration = 'graph'
    state.queuedMessages = [{
      id: 'q-graph',
      text: 'queued graph task',
      deliveryState: 'paused',
      orchestration: 'graph'
    }]

    await actions.selectThread('thr_b')
    state.composerOrchestration = 'direct'
    await actions.selectThread('thr_a')

    expect(getThreadDetail).toHaveBeenCalledTimes(1)
    expect(getThreadDetail).toHaveBeenCalledWith('thr_b')
    expect(state.blocks).toEqual([{ kind: 'assistant', id: 'a-answer', text: 'A' }])
    expect(state.lastSeq).toBe(11)
    expect(state.queuedMessages).toEqual([
      expect.objectContaining({ id: 'q-graph', orchestration: 'graph' })
    ])
    expect(state.composerOrchestration).toBe('direct')
    expect(subscribeThreadEvents).toHaveBeenLastCalledWith(
      'thr_a',
      11,
      expect.anything(),
      expect.anything()
    )
  })

  it('records a Code thread selection as the last Code session memory', async () => {
    registryMock.getProvider.mockReturnValue({
      getThreadDetail: vi.fn(async () => ({ blocks: [], latestSeq: 0, threadStatus: 'idle' })),
      subscribeThreadEvents: vi.fn(async () => undefined)
    })
    const { actions, state } = buildHarness()
    state.busy = false
    state.composerPickList = []
    state.composerModelGroups = []
    state.threads = [thread('thr_existing'), thread('thr_code')]
    state.lastCodeThreadId = 'thr_existing'

    await actions.selectThread('thr_code')

    expect(state.activeThreadId).toBe('thr_code')
    expect(state.lastCodeThreadId).toBe('thr_code')
  })

  it('records a standalone Design thread as Code-workbench memory', async () => {
    registryMock.getProvider.mockReturnValue({
      getThreadDetail: vi.fn(async () => ({ blocks: [], latestSeq: 0, threadStatus: 'idle' })),
      subscribeThreadEvents: vi.fn(async () => undefined)
    })
    const { actions, state } = buildHarness()
    state.busy = false
    state.composerPickList = []
    state.composerModelGroups = []
    state.lastCodeThreadId = 'thr_code_memory'
    state.threads = [
      thread('thr_existing'),
      { ...thread('thr_design'), agentSurface: 'design' as const }
    ]

    await actions.selectThread('thr_design')

    expect(state.activeThreadId).toBe('thr_design')
    expect(state.lastCodeThreadId).toBe('thr_design')
  })

  it('snapshots active-turn model and reasoning selections into the next queued input', async () => {
    const { actions, state } = buildHarness()
    state.composerModel = 'deepseek-v4-flash'
    state.composerProviderId = 'deepseek'

    await expect(actions.sendMessage('use these next-turn settings', 'agent', {
      reasoningEffort: 'high',
      serviceTier: 'priority'
    })).resolves.toBe(true)

    expect(state.queuedMessages).toHaveLength(1)
    expect(state.queuedMessages[0]).toMatchObject({
      text: 'use these next-turn settings',
      model: 'deepseek-v4-flash',
      providerId: 'deepseek',
      reasoningEffort: 'high',
      serviceTier: 'priority'
    })

    state.composerModel = 'deepseek-v4-pro'
    expect(state.queuedMessages[0]?.model).toBe('deepseek-v4-flash')
  })

  it('snapshots Graph orchestration into queued work and preserves it when the preference changes', async () => {
    const { actions, state } = buildHarness()
    state.graphEnabled = true
    state.composerOrchestration = 'graph'
    state.currentTurnOrchestration = 'direct'

    await expect(actions.sendMessage('run this as a graph', 'agent')).resolves.toBe(true)

    expect(state.queuedMessages[0]).toMatchObject({
      text: 'run this as a graph',
      orchestration: 'graph'
    })
    state.composerOrchestration = 'direct'
    expect(state.queuedMessages[0]?.orchestration).toBe('graph')
    expect(state.currentTurnOrchestration).toBe('direct')
  })

  it('queues active Graph text until the user explicitly guides the source turn', async () => {
    const { actions, state } = buildHarness()
    state.currentTurnId = 'turn_graph_lead'
    state.currentTurnOrchestration = 'graph'
    const activeRun = {
      id: 'run_1',
      threadId: 'thr_existing',
      sourceTurnId: 'turn_graph_lead',
      status: 'running',
      lastEventSeq: 4
    } as GraphRun
    useGraphStore.setState({
      threadId: 'thr_existing',
      runs: [activeRun],
      selectedRunId: activeRun.id
    })
    const steer = vi.spyOn(graphRuntimeClient, 'steer').mockResolvedValue({
      ...activeRun,
      lastEventSeq: 5
    })

    await expect(actions.sendMessage(
      'Please reassign the blocked node.',
      'agent'
    )).resolves.toBe(true)

    expect(steer).not.toHaveBeenCalled()
    expect(state.queuedMessages).toEqual([
      expect.objectContaining({
        text: 'Please reassign the blocked node.',
        deliveryState: 'pending'
      })
    ])
    expect(state.blocks).toEqual([])

    await expect(actions.guideQueuedMessage(state.queuedMessages[0]!.id)).resolves.toBe(true)

    expect(steer).toHaveBeenCalledWith(
      'run_1',
      'Please reassign the blocked node.',
      { kind: 'lead' }
    )
    expect(state.queuedMessages).toEqual([])
    expect(state.blocks).toContainEqual(expect.objectContaining({
      kind: 'user',
      turnId: 'turn_graph_lead',
      text: 'Please reassign the blocked node.'
    }))
  })

  it('explicitly guides a suspended Graph planning turn before a GraphRun exists', async () => {
    const steerUserMessage = vi.fn(async () => undefined)
    registryMock.getProvider.mockReturnValue({ steerUserMessage })
    const listRuns = vi.spyOn(graphRuntimeClient, 'listRuns').mockResolvedValue([])
    const { actions, state } = buildHarness()
    state.currentTurnId = 'turn_graph_planning'
    state.currentTurnOrchestration = 'graph'

    await expect(actions.sendMessage(
      'Continue building the Graph.',
      'agent'
    )).resolves.toBe(true)

    expect(listRuns).not.toHaveBeenCalled()
    expect(steerUserMessage).not.toHaveBeenCalled()
    expect(state.queuedMessages).toHaveLength(1)

    await expect(actions.guideQueuedMessage(state.queuedMessages[0]!.id)).resolves.toBe(true)

    expect(listRuns).toHaveBeenCalledWith('thr_existing')
    expect(steerUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'turn_graph_planning',
      'Continue building the Graph.',
      undefined
    )
    expect(state.queuedMessages).toEqual([])
    expect(state.blocks).toContainEqual(expect.objectContaining({
      kind: 'user',
      turnId: 'turn_graph_planning',
      text: 'Continue building the Graph.'
    }))
  })

  it('does not duplicate explicit Graph guidance when its runtime user item wins the race', async () => {
    const { actions, state } = buildHarness()
    state.currentTurnId = 'turn_graph_planning'
    state.currentTurnOrchestration = 'graph'
    const steerUserMessage = vi.fn(async () => {
      state.blocks = [
        ...state.blocks,
        {
          kind: 'user',
          id: 'item_graph_guidance',
          turnId: 'turn_graph_planning',
          createdAt: new Date().toISOString(),
          text: 'Continue building the Graph.'
        }
      ]
    })
    registryMock.getProvider.mockReturnValue({ steerUserMessage })
    vi.spyOn(graphRuntimeClient, 'listRuns').mockResolvedValue([])

    await expect(actions.sendMessage(
      'Continue building the Graph.',
      'agent'
    )).resolves.toBe(true)
    await expect(actions.guideQueuedMessage(state.queuedMessages[0]!.id)).resolves.toBe(true)

    expect(state.blocks.filter((block) => block.kind === 'user')).toEqual([
      expect.objectContaining({ id: 'item_graph_guidance' })
    ])
  })

})

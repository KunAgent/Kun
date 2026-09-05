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
import { clearThreadSnapshotCache, getThreadSnapshot } from './thread-snapshot-cache'
import { resetThreadRecoveryCoordinator } from './thread-recovery-coordinator'

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

describe('chat-store-thread-actions subscribeThreadEventsLive', () => {
  beforeEach(() => {
    clearThreadSnapshotCache()
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
    registryMock.getProvider.mockReturnValue({})
  })

  afterEach(() => {
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  it('hydrates first, then replays events committed during hydration from snapshot latestSeq', async () => {
    const subscribeCalls: Array<{ threadId: string; sinceSeq: number }> = []
    const callOrder: string[] = []
    let capturedSink: ThreadEventSink | null = null
    let eventPersistedDuringHydration = false
    const snapshot = deferredValue<{
      blocks: ChatBlock[]
      latestSeq: number
      threadStatus: string
      latestTurnId: string
      latestUserMessageId: string
    }>()

    const provider = {
      getThreadDetail: vi.fn((id: string) => {
        callOrder.push(`snapshot:${id}`)
        return snapshot.promise
      }),
      subscribeThreadEvents: vi.fn(
        async (threadId: string, sinceSeq: number, sink: ThreadEventSink) => {
          callOrder.push(`subscribe:${threadId}:${sinceSeq}`)
          subscribeCalls.push({ threadId, sinceSeq })
          capturedSink = sink
          if (eventPersistedDuringHydration) {
            sink.onDeltas([{ kind: 'agent_message', text: 'replayed live event', seq: 201 }])
          }
          return { streamId: 'stream_1' }
        }
      )
    }
    registryMock.getProvider.mockReturnValue(provider)

    const { actions, state } = buildHarness()
    state.activeThreadId = 'thr_existing'
    state.busy = true
    state.runtimeConnection = 'ready'

    const hydration = actions.subscribeThreadEventsLive('thr_live')
    await Promise.resolve()

    expect(provider.getThreadDetail).toHaveBeenCalledWith('thr_live')
    expect(provider.subscribeThreadEvents).not.toHaveBeenCalled()
    // This event is durably appended after the HTTP snapshot was captured but
    // before the renderer opens SSE. sinceSeq=200 must replay it.
    eventPersistedDuringHydration = true
    snapshot.resolve({
      blocks: [],
      latestSeq: 200,
      threadStatus: 'running',
      latestTurnId: 'turn_live',
      latestUserMessageId: 'user_live'
    })
    await hydration

    expect(callOrder).toEqual(['snapshot:thr_live', 'subscribe:thr_live:200'])
    expect(subscribeCalls).toEqual([{ threadId: 'thr_live', sinceSeq: 200 }])
    expect(state.activeThreadId).toBe('thr_live')
    expect(expectSink(capturedSink)).toBeDefined()
    expect(state.liveAssistant).toBe('replayed live event')
    expect(state.lastSeq).toBe(201)
  })

  it('keeps a terminal snapshot tool monotonic if a running update is re-delivered', async () => {
    let capturedSink: ThreadEventSink | null = null
    const fetchedBlocks: ChatBlock[] = [
      {
        id: 'tool_call_1',
        kind: 'tool',
        summary: 'Read complete',
        status: 'success'
      }
    ]
    const provider = {
      getThreadDetail: vi.fn(async () => ({
        blocks: fetchedBlocks,
        latestSeq: 200,
        threadStatus: 'idle'
      })),
      subscribeThreadEvents: vi.fn(
        async (_threadId: string, sinceSeq: number, sink: ThreadEventSink) => {
          expect(sinceSeq).toBe(200)
          capturedSink = sink
          sink.onTool({
            itemId: 'tool_call_1',
            summary: 'Historical start',
            status: 'running'
          })
          return { streamId: 'stream_2' }
        }
      )
    }
    registryMock.getProvider.mockReturnValue(provider)

    const { actions, state } = buildHarness()
    state.activeThreadId = 'thr_other'
    state.busy = false
    state.runtimeConnection = 'ready'
    state.blocks = []
    state.lastSeq = 0

    await actions.subscribeThreadEventsLive('thr_live')

    expect(expectSink(capturedSink)).toBeDefined()
    expect(state.blocks).toContainEqual(expect.objectContaining({
      id: 'tool_call_1',
      kind: 'tool',
      status: 'success'
    }))
    expect(state.lastSeq).toBe(200)
  })

  it('falls back from a failed hydrate using the cursor matching the retained projection', async () => {
    let capturedSink: ThreadEventSink | null = null
    let capturedSinceSeq = -1
    const provider = {
      getThreadDetail: vi.fn(async () => {
        throw new Error('network down')
      }),
      subscribeThreadEvents: vi.fn(
        async (_threadId: string, sinceSeq: number, sink: ThreadEventSink) => {
          capturedSinceSeq = sinceSeq
          capturedSink = sink
          return { streamId: 'stream_3' }
        }
      )
    }
    registryMock.getProvider.mockReturnValue(provider)

    const { actions, state } = buildHarness()
    state.activeThreadId = 'thr_live'
    state.busy = false
    state.runtimeConnection = 'ready'
    state.lastSeq = 55
    state.blocks = [{ id: 'assistant_existing', kind: 'assistant', text: 'existing' }]

    await actions.subscribeThreadEventsLive('thr_live')

    expect(capturedSinceSeq).toBe(55)
    const sink = expectSink(capturedSink)
    sink.onDeltas([{ kind: 'agent_message', text: 'still works', seq: 56 }])
    expect(state.liveAssistant).toBe('still works')
    expect(state.error).toBeTruthy()
    expect(state.blocks).toContainEqual(expect.objectContaining({ id: 'assistant_existing' }))
  })
})

describe('chat-store-thread-actions recoverActiveTurn settles interrupted work', () => {
  beforeEach(() => {
    resetThreadRecoveryCoordinator()
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
    registryMock.getProvider.mockReturnValue({})
  })

  afterEach(() => {
    resetThreadRecoveryCoordinator()
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  function providerWith(
    threadStatus: string,
    latestTurnOrchestration: 'direct' | 'graph' = 'direct'
  ) {
    return {
      getThreadDetail: vi.fn(async () => ({
        blocks: [
          { id: 'u1', kind: 'user', text: 'do the big thing' },
          { id: 'tool1', kind: 'tool', name: 'delegate_task', status: 'running' }
        ],
        latestSeq: 3,
        threadStatus,
        latestTurnId: 'turn_1',
        latestTurnOrchestration,
        latestUserMessageId: 'u1'
      })),
      subscribeThreadEvents: vi.fn(async () => ({ streamId: 'stream_recover' }))
    }
  }

  it('does not commit a recovery result for a thread the user already left', async () => {
    const detail = deferredValue<Record<string, unknown>>()
    registryMock.getProvider.mockReturnValue({
      getThreadDetail: vi.fn(() => detail.promise as never),
      subscribeThreadEvents: vi.fn(async () => ({ streamId: 'stream_stale' }))
    })
    const { actions, state } = buildHarness()
    state.activeThreadId = 'thr_existing'
    state.busy = true
    state.watchTurnCompletion = {}

    const recovering = actions.recoverActiveTurn()
    // The user switches to another thread while recovery is in flight.
    state.activeThreadId = 'thr_other'
    detail.resolve({
      blocks: [{ id: 'u1', kind: 'user', text: 'old request' }],
      latestSeq: 4,
      threadStatus: 'idle',
      latestTurnId: 'turn_1',
      latestTurnStatus: 'completed',
      latestTurnOrchestration: 'direct',
      latestUserMessageId: 'u1'
    })
    await recovering

    // The stale recovery must not commit the old thread's projection or clear
    // the newer selection's busy state. The optimistic recovering banner may
    // have been set before the guard observed the newer selection.
    expect(state.activeThreadId).toBe('thr_other')
    expect(state.busy).toBe(true)
    expect(state.threads.find((thread) => thread.id === 'thr_existing')).toMatchObject({
      status: 'running'
    })
  })

  it('treats a terminal latest turn as authoritative during recovery', async () => {
    const provider = {
      ...providerWith('running'),
      getThreadDetail: vi.fn(async () => ({
        blocks: [
          { id: 'u1', kind: 'user', text: 'do the big thing' },
          { id: 'tool1', kind: 'tool', name: 'delegate_task', status: 'running' }
        ],
        latestSeq: 3,
        threadStatus: 'running',
        latestTurnId: 'turn_1',
        latestTurnStatus: 'completed',
        latestTurnOrchestration: 'direct',
        latestUserMessageId: 'u1'
      }))
    }
    registryMock.getProvider.mockReturnValue(provider)

    const { actions, state } = buildHarness()
    state.activeThreadId = 'thr_existing'
    state.busy = true
    state.currentTurnId = 'turn_1'
    state.watchTurnCompletion = { thr_existing: true }

    await expect(actions.recoverActiveTurn()).resolves.toBe(false)
    expect(state.busy).toBe(false)
    expect(state.currentTurnId).toBeNull()
    expect(state.watchTurnCompletion).toEqual({})
    expect(state.threads[0]).toMatchObject({
      status: 'idle', latestTurnId: 'turn_1', latestTurnStatus: 'completed'
    })
  })

  it('settles a stuck running tool block when the server has already settled (#621)', async () => {
    const provider = providerWith('idle')
    registryMock.getProvider.mockReturnValue(provider)

    const { actions, state } = buildHarness()
    state.activeThreadId = 'thr_existing'
    state.busy = true

    const busy = await actions.recoverActiveTurn()

    expect(busy).toBe(false)
    expect(state.busy).toBe(false)
    expect(state.currentTurnOrchestration).toBeNull()
    // The interrupted delegate_task block is settled, so hasPendingRuntimeWork
    // is no longer true and queued/new messages can actually send.
    const tool = state.blocks.find((block) => block.kind === 'tool')
    expect(tool?.status).toBe('error')
  })

  it('keeps a running tool block when the server reports the thread still running', async () => {
    const provider = providerWith('running')
    registryMock.getProvider.mockReturnValue(provider)

    const { actions, state } = buildHarness()
    state.activeThreadId = 'thr_existing'
    state.busy = true

    const busy = await actions.recoverActiveTurn()

    expect(busy).toBe(true)
    // A genuinely live turn must keep its running block so the GUI reconnects.
    const tool = state.blocks.find((block) => block.kind === 'tool')
    expect(tool?.status).toBe('running')
  })

  it('reuses the SSE recovery wrapper after recovering a live turn', async () => {
    vi.useFakeTimers()
    try {
      const provider = providerWith('running')
      provider.subscribeThreadEvents.mockRejectedValueOnce(
        Object.assign(new Error('sse error 404'), { status: 404 })
      )
      registryMock.getProvider.mockReturnValue(provider)

      const { actions, state } = buildHarness()
      // Keep this recovery state isolated from other tests that intentionally
      // exercise reconnects for the default harness thread.
      state.activeThreadId = 'thr_sse_recovery'
      state.busy = true

      await actions.recoverActiveTurn()
      await vi.advanceTimersByTimeAsync(500)
      expect(state.recoverActiveTurn).toHaveBeenCalledOnce()
      expect(provider.subscribeThreadEvents).toHaveBeenCalledWith(
        'thr_sse_recovery',
        3,
        expect.any(Object),
        expect.any(AbortSignal)
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-fetches a live approval snapshot and re-subscribes after an SSE 404', async () => {
    vi.useFakeTimers()
    try {
      let subscriptions = 0
      const provider = {
        getThreadDetail: vi.fn(async () => ({
          blocks: [
            { id: 'u1', kind: 'user', text: 'Run focused tests' },
            {
              id: 'approval-appr_live',
              kind: 'approval',
              approvalId: 'appr_live',
              summary: 'Run focused tests',
              status: 'pending'
            }
          ],
          latestSeq: 4,
          threadStatus: 'running',
          latestTurnId: 'turn_approval',
          latestTurnOrchestration: 'direct' as const,
          latestUserMessageId: 'u1'
        })),
        subscribeThreadEvents: vi.fn(async (
          _threadId: string,
          _sinceSeq: number,
          sink: ThreadEventSink
        ) => {
          subscriptions += 1
          if (subscriptions === 1) {
            sink.onError(Object.assign(new Error('stream route unavailable'), { status: 404 }))
            return { streamId: 'stream_404' }
          }
          return await new Promise<{ streamId: string }>(() => undefined)
        })
      }
      registryMock.getProvider.mockReturnValue(provider)

      const { actions, state } = buildHarness()
      state.activeThreadId = 'thr_sse_approval_recovery'
      state.busy = true
      state.recoverActiveTurn = actions.recoverActiveTurn

      await actions.recoverActiveTurn()
      await vi.advanceTimersByTimeAsync(500)
      await Promise.resolve()

      expect(provider.getThreadDetail).toHaveBeenCalledTimes(2)
      expect(provider.subscribeThreadEvents).toHaveBeenCalledTimes(2)
      expect(state.blocks).toContainEqual(expect.objectContaining({
        kind: 'approval', approvalId: 'appr_live', status: 'pending'
      }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('restores a running Graph turn without changing the next-turn Direct selection', async () => {
    const provider = providerWith('running', 'graph')
    registryMock.getProvider.mockReturnValue(provider)

    const { actions, state } = buildHarness()
    state.activeThreadId = 'thr_existing'
    state.busy = true
    state.composerOrchestration = 'direct'
    state.currentTurnOrchestration = null

    const busy = await actions.recoverActiveTurn()

    expect(busy).toBe(true)
    expect(state.currentTurnOrchestration).toBe('graph')
    expect(state.composerOrchestration).toBe('direct')
  })
})

describe('chat-store-thread-actions createThread conversation mode', () => {
  beforeEach(() => {
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
  })

  afterEach(() => {
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  it('refuses to create a project thread when the workspace directory is missing', async () => {
    const createThreadProvider = vi.fn()
    const alertDialog = vi.fn(async () => undefined)
    registryMock.getProvider.mockReturnValue({ createThread: createThreadProvider })
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(async () => ({
          workspaceRoot: 'E:\\missing-project',
          agents: { kun: { subagents: { profiles: [] } } }
        })),
        workspaceDirectoryExists: vi.fn(async () => false),
        alertDialog
      }
    })
    const { actions, state } = buildHarness()
    state.activeThreadId = null
    state.threads = []
    state.busy = false

    await actions.createThread({ workspaceRoot: 'E:\\missing-project', forceNew: true })

    expect(createThreadProvider).not.toHaveBeenCalled()
    expect(alertDialog).toHaveBeenCalledOnce()
    expect(state.error).toBeTruthy()
    expect(state.activeThreadId).toBeNull()
  })

  it('shows the missing workspace dialog only when sending a message', async () => {
    const alertDialog = vi.fn(async () => undefined)
    registryMock.getProvider.mockReturnValue({})
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(async () => ({ workspaceRoot: 'E:\\missing-project' })),
        workspaceDirectoryExists: vi.fn(async () => false),
        alertDialog
      }
    })
    const { actions, state } = buildHarness()
    state.activeThreadId = null
    state.threads = []
    state.busy = false

    await expect(actions.sendMessage('hello', 'agent')).resolves.toBe(false)

    expect(alertDialog).toHaveBeenCalledOnce()
    expect(state.error).toBeTruthy()
    expect(state.blocks).toEqual([])
  })

  it('resets a reused empty thread to the configured default model', async () => {
    const storage = new MemoryStorage()
    const createThreadProvider = vi.fn()
    registryMock.getProvider.mockReturnValue({ createThread: createThreadProvider })
    vi.stubGlobal('window', {
      localStorage: storage,
      kunGui: {
        getSettings: vi.fn(async () => ({
          workspaceRoot: '/workspace/deepseek-gui',
          agents: {
            kun: {
              providerId: 'gemini-cli-subscription',
              model: 'gemini-2.5-flash',
              subagents: { profiles: [] }
            }
          }
        })),
        workspaceDirectoryExists: vi.fn(async () => true)
      }
    })
    const { actions, state } = buildHarness()
    state.activeThreadId = 'thr_existing'
    state.blocks = []
    state.busy = false
    state.composerModel = 'deepseek-v4-flash'
    state.composerProviderId = 'deepseek'
    state.composerPickList = ['deepseek-v4-flash', 'gemini-2.5-flash']
    state.composerModelGroups = [{
      providerId: 'gemini-cli-subscription',
      label: 'Gemini CLI',
      modelIds: ['gemini-2.5-flash']
    }]
    state.threads = [{
      ...thread('thr_existing'),
      title: '新会话',
      model: 'deepseek-v4-flash',
      status: 'idle'
    }]

    await actions.createThread({ workspaceRoot: '/workspace/deepseek-gui' })

    expect(createThreadProvider).not.toHaveBeenCalled()
    expect(state.composerModel).toBe('gemini-2.5-flash')
    expect(state.composerProviderId).toBe('gemini-cli-subscription')
    expect(JSON.parse(storage.getItem(THREAD_COMPOSER_SELECTION_STORAGE_KEY) ?? '{}')).toEqual({
      thr_existing: {
        model: 'gemini-2.5-flash',
        providerId: 'gemini-cli-subscription',
        source: 'default'
      }
    })
  })

  it('creates a conversation thread bound to the auto-created timestamped workspace', async () => {
    const createdPath = '/home/alice/.local/share/Kun/conversations/20260626-153012'
    const selectThread = vi.fn(async () => undefined)
    const refreshThreads = vi.fn(async () => undefined)
    const createThreadProvider = vi.fn(async () => ({
      id: 'thr_new',
      title: 'New',
      updatedAt: '2026-06-26T15:30:12.000Z',
      model: 'deepseek-v4-pro',
      mode: 'agent',
      workspace: createdPath,
      status: 'idle'
    }))
    registryMock.getProvider.mockReturnValue({ createThread: createThreadProvider })

    vi.stubGlobal('window', {
      kunGui: {
        platform: 'linux',
        getSettings: vi.fn(async () => ({
          version: 1,
          locale: 'en',
          theme: 'system',
          uiFontScale: 0.82,
          chatContentMaxWidthPx: 896,
          composerSendKey: 'enter',
          provider: { providers: [], apiKey: '', baseUrl: '', proxy: { enabled: false } },
          agents: { kun: { model: 'deepseek-v4-pro', apiKey: 'k', baseUrl: '' } },
          workspaceRoot: '/tmp/workspace',
          conversationWorkspaceRoot: '~/.local/share/Kun/conversations',
          log: { enabled: false, retentionDays: 7 },
          checkpointCleanup: { createEnabled: false, enabled: false, intervalDays: 3 },
          notifications: { turnComplete: true },
          appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
          keyboardShortcuts: { bindings: [] },
          write: { workspaces: [], defaultWorkspaceRoot: '', activeWorkspaceRoot: '' },
          claw: { channels: [], tasks: [], im: { workspaceRoot: '' }, enabled: false, skills: { extraDirs: [] } },
          schedule: { tasks: [], defaultWorkspaceRoot: '', skills: { extraDirs: [] } },
          workflow: { workflows: [] },
          terminal: { colors: {} },
          guiUpdate: { channel: 'stable' },
          codePromptPrefix: '',
          chatWelcomeMessage: '',
          disabledSkillIds: []
        })),
        createConversationWorkspace: vi.fn(async () => ({ ok: true, path: createdPath }))
      }
    })

    const { actions, state } = buildHarness()
    state.selectThread = selectThread as never
    state.refreshThreads = refreshThreads as never

    await actions.createThread({ conversation: true })

    expect(window.kunGui.createConversationWorkspace).toHaveBeenCalled()
    expect(createThreadProvider).toHaveBeenCalledWith(expect.objectContaining({ workspace: createdPath }))
    expect(state.activeThreadId).toBe('thr_new')
    expect(selectThread).toHaveBeenCalledWith('thr_new')
    expect(refreshThreads).toHaveBeenCalled()
  })
})

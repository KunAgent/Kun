import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatBlock, NormalizedThread, ThreadGoal, ThreadGoalStatus } from '../agent/types'
import type {
  ChatState,
  ChatStoreGet,
  ChatStoreSet,
  CreateDesignThreadOptions,
  SendMessageOverrides
} from './chat-store-types'
import type { BrowserStorageLike } from '../lib/browser-storage'
import {
  emptyDesignThreadRegistry,
  isDesignThreadId,
  markDesignThread,
  readDesignThreadRegistry,
  saveDesignThreadRegistry
} from '../design/design-thread-registry'
import { clearDesignChatHistoryMutationsForTests } from '../design/design-chat-transcript'

const registryMock = vi.hoisted(() => ({
  getProvider: vi.fn()
}))

vi.mock('../agent/registry', () => ({
  getProvider: registryMock.getProvider
}))

import {
  createMaintenanceActions,
  type MaintenanceActionDependencies
} from './chat-store-maintenance-actions'

type GoalPatch = {
  objective?: string
  status?: ThreadGoalStatus
  tokenBudget?: number | null
}

type Harness = {
  actions: ReturnType<typeof createMaintenanceActions>
  createDesignThread: ReturnType<typeof vi.fn>
  createThread: ReturnType<typeof vi.fn>
  drainQueuedMessages: ReturnType<typeof vi.fn>
  get: ChatStoreGet
  provider: {
    deleteThread: ReturnType<typeof vi.fn>
    getThreadDetail: ReturnType<typeof vi.fn>
    setThreadGoal: ReturnType<typeof vi.fn>
    clearThreadGoal: ReturnType<typeof vi.fn>
    interruptTurn: ReturnType<typeof vi.fn>
    submitApprovalDecision: ReturnType<typeof vi.fn>
    forkThread: ReturnType<typeof vi.fn>
    rewindThread: ReturnType<typeof vi.fn>
  }
  recoverActiveTurn: ReturnType<typeof vi.fn>
  refreshThreads: ReturnType<typeof vi.fn>
  selectThread: ReturnType<typeof vi.fn>
  sendMessage: ReturnType<typeof vi.fn>
  sseAbortRef: { current: AbortController | null }
  state: ChatState
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
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function thread(id: string, goal: ThreadGoal | null = null): NormalizedThread {
  return {
    id,
    title: id,
    updatedAt: '2026-06-04T00:00:00.000Z',
    model: 'deepseek-v4-pro',
    mode: 'agent',
    workspace: '/workspace/deepseek-gui',
    status: 'idle',
    goal
  }
}

function goal(
  threadId: string,
  objective = 'ship goal mode',
  status: ThreadGoalStatus = 'active'
): ThreadGoal {
  return {
    threadId,
    objective,
    status,
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: '2026-06-04T00:00:00.000Z',
    updatedAt: '2026-06-04T00:01:00.000Z'
  }
}

function buildHarness(options: {
  activeThreadId?: string | null
  createDesignThreadSucceeds?: boolean
  createThreadSucceeds?: boolean
  initialGoal?: ThreadGoal | null
  maintenanceDependencies?: MaintenanceActionDependencies
} = {}): Harness {
  const activeThreadId = options.activeThreadId === undefined ? 'thr_existing' : options.activeThreadId
  const createThreadSucceeds = options.createThreadSucceeds ?? true
  const createDesignThreadSucceeds = options.createDesignThreadSucceeds ?? true
  const initialGoal = options.initialGoal ?? null
  let state: ChatState

  const provider = {
    deleteThread: vi.fn(async (_threadId: string) => undefined),
    getThreadDetail: vi.fn(async (threadId: string) => ({
      thread: thread(threadId),
      blocks: [],
      threadStatus: 'idle'
    })),
    setThreadGoal: vi.fn(async (threadId: string, patch: GoalPatch) =>
      goal(
        threadId,
        patch.objective ?? state.activeThreadGoal?.objective ?? initialGoal?.objective ?? 'ship goal mode',
        patch.status ?? state.activeThreadGoal?.status ?? initialGoal?.status ?? 'active'
      )
    ),
    clearThreadGoal: vi.fn(async () => true),
    interruptTurn: vi.fn(async () => undefined),
    submitApprovalDecision: vi.fn(async () => 'submitted' as const),
    rewindThread: vi.fn(async () => undefined),
    forkThread: vi.fn(async (
      threadId: string,
      options?: { turnId?: string }
    ) => ({
      ...thread('thr_forked'),
      title: 'Forked',
      forkedFromThreadId: threadId,
      forkedFromTitle: 'Parent',
      forkedAt: '2026-06-04T00:02:00.000Z',
      forkedFromTurnCount: options?.turnId ? 1 : 2
    }))
  }
  registryMock.getProvider.mockReturnValue(provider)

  const createThread = vi.fn(async () => {
    if (!createThreadSucceeds) return
    const created = thread('thr_created')
    state.activeThreadId = created.id
    state.threads = [created, ...state.threads]
  })
  const createDesignThread = vi.fn(async (
    workspaceRoot?: string,
    docId?: string,
    createOptions?: CreateDesignThreadOptions
  ) => {
    if (!createDesignThreadSucceeds) return null
    const created = thread('thr_design_recreated')
    saveDesignThreadRegistry(markDesignThread(
      workspaceRoot ?? state.workspaceRoot,
      docId ?? '',
      created.id
    ))
    if (createOptions?.activate !== false) state.activeThreadId = created.id
    state.threads = [created, ...state.threads]
    return created.id
  })
  const refreshThreads = vi.fn(async () => undefined)
  const selectThread = vi.fn(async (id: string) => {
    state.activeThreadId = id
  })
  const drainQueuedMessages = vi.fn(async () => undefined)
  const recoverActiveTurn = vi.fn(async () => false)
  const sendMessage = vi.fn(async (
    _text: string,
    _mode?: string,
    _overrides?: SendMessageOverrides
  ) => true)

  state = {
    activeThreadGoal: initialGoal,
    activeThreadId,
    createDesignThread,
    createThread,
    error: null,
    drainQueuedMessages,
    recoverActiveTurn,
    refreshThreads,
    selectThread,
    runtimeConnection: 'ready',
    sendMessage,
    settingsSection: 'general',
    workspaceRoot: '/workspace/deepseek-gui',
    threads: activeThreadId ? [thread(activeThreadId, initialGoal)] : []
  } as unknown as ChatState

  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: ChatStoreGet = () => state
  const sseAbortRef = { current: null as AbortController | null }
  const actions = createMaintenanceActions({
    set,
    get,
    sseAbortRef
  }, options.maintenanceDependencies)

  return {
    actions,
    createDesignThread,
    createThread,
    drainQueuedMessages,
    get,
    provider,
    recoverActiveTurn,
    refreshThreads,
    selectThread,
    sendMessage,
    sseAbortRef,
    state
  }
}

afterEach(() => {
  clearDesignChatHistoryMutationsForTests()
  vi.unstubAllGlobals()
})

describe('chat-store-maintenance-actions rewind and resend', () => {
  beforeEach(() => {
    registryMock.getProvider.mockReset()
  })

  it('rebuilds canvas context and preserves tool routing for edited architecture prompts', async () => {
    const prepareCodeCanvasResend = vi.fn(async () => ({
      text: 'architecture prompt with live canvas snapshot',
      displayText: '\u7ed9\u6211\u8bbe\u8ba1\u4e00\u4e2a\u5f53\u524d\u76ee\u5f55\u7684\u67b6\u6784\u56fe',
      guiDesignCanvas: true as const
    }))
    const requestCodeCanvasPanelOpen = vi.fn()
    const { actions, provider, sendMessage, state } = buildHarness({
      maintenanceDependencies: {
        prepareCodeCanvasResend,
        requestCodeCanvasPanelOpen
      }
    })
    Object.assign(state, {
      route: 'chat',
      busy: false,
      blocks: [
        {
          kind: 'user',
          id: 'user_1',
          text: 'old prompt',
          meta: { turnId: 'turn_1', guiDesignCanvas: true }
        },
        { kind: 'assistant', id: 'assistant_1', text: 'old answer' }
      ],
      queuedMessages: [],
      turnStartedAtByUserId: {},
      turnDurationByUserId: {},
      turnReasoningFirstAtByUserId: {},
      turnReasoningLastAtByUserId: {}
    })

    await actions.rewindAndResend(
      'user_1',
      '  \u7ed9\u6211\u8bbe\u8ba1\u4e00\u4e2a\u5f53\u524d\u76ee\u5f55\u7684\u67b6\u6784\u56fe  '
    )

    expect(prepareCodeCanvasResend).toHaveBeenCalledWith({
      route: 'chat',
      text: '\u7ed9\u6211\u8bbe\u8ba1\u4e00\u4e2a\u5f53\u524d\u76ee\u5f55\u7684\u67b6\u6784\u56fe',
      previousCanvasTurn: true,
      fallbackWorkspaceRoot: '/workspace/deepseek-gui',
      threadWorkspaceRoot: '/workspace/deepseek-gui',
      threadId: 'thr_existing'
    })
    expect(provider.rewindThread).toHaveBeenCalledWith('thr_existing', 'turn_1')
    expect(requestCodeCanvasPanelOpen).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledWith(
      'architecture prompt with live canvas snapshot',
      'agent',
      {
        displayText: '\u7ed9\u6211\u8bbe\u8ba1\u4e00\u4e2a\u5f53\u524d\u76ee\u5f55\u7684\u67b6\u6784\u56fe',
        guiDesignCanvas: true
      }
    )
  })

  it('keeps non-canvas edited prompts on the existing resend path', async () => {
    const prepareCodeCanvasResend = vi.fn(async () => null)
    const requestCodeCanvasPanelOpen = vi.fn()
    const { actions, provider, sendMessage, state } = buildHarness({
      maintenanceDependencies: {
        prepareCodeCanvasResend,
        requestCodeCanvasPanelOpen
      }
    })
    Object.assign(state, {
      route: 'chat',
      busy: false,
      blocks: [
        {
          kind: 'user',
          id: 'user_1',
          text: 'old prompt',
          meta: { turnId: 'turn_1' }
        },
        { kind: 'assistant', id: 'assistant_1', text: 'old answer' }
      ],
      queuedMessages: [],
      turnStartedAtByUserId: {},
      turnDurationByUserId: {},
      turnReasoningFirstAtByUserId: {},
      turnReasoningLastAtByUserId: {}
    })

    await actions.rewindAndResend('user_1', '  Refactor this module  ')

    expect(provider.rewindThread).toHaveBeenCalledWith('thr_existing', 'turn_1')
    expect(requestCodeCanvasPanelOpen).not.toHaveBeenCalled()
    expect(sendMessage).toHaveBeenCalledWith('Refactor this module')
  })

  it('preserves image attachments when editing and resending a user message', async () => {
    const prepareCodeCanvasResend = vi.fn(async () => null)
    const { actions, provider, sendMessage, state } = buildHarness({
      maintenanceDependencies: {
        prepareCodeCanvasResend
      }
    })
    const attachment = {
      id: 'att_image_1',
      kind: 'image' as const,
      name: 'reference.png',
      mimeType: 'image/png',
      width: 1280,
      height: 720,
      previewUrl: 'data:image/png;base64,AQID'
    }
    Object.assign(state, {
      route: 'chat',
      busy: false,
      blocks: [
        {
          kind: 'user',
          id: 'user_1',
          text: 'old image prompt',
          meta: {
            turnId: 'turn_1',
            attachmentIds: ['att_image_1'],
            attachments: [attachment]
          }
        },
        { kind: 'assistant', id: 'assistant_1', text: 'old answer' }
      ],
      queuedMessages: [],
      turnStartedAtByUserId: {},
      turnDurationByUserId: {},
      turnReasoningFirstAtByUserId: {},
      turnReasoningLastAtByUserId: {}
    })

    await actions.rewindAndResend('user_1', '  Redesign this reference  ')

    expect(provider.rewindThread).toHaveBeenCalledWith('thr_existing', 'turn_1')
    expect(sendMessage).toHaveBeenCalledWith('Redesign this reference', undefined, {
      attachmentIds: ['att_image_1'],
      attachments: [attachment]
    })
  })

  it('preserves ID-only historical image attachments when resending', async () => {
    const prepareCodeCanvasResend = vi.fn(async () => null)
    const { actions, sendMessage, state } = buildHarness({
      maintenanceDependencies: {
        prepareCodeCanvasResend
      }
    })
    Object.assign(state, {
      route: 'chat',
      busy: false,
      blocks: [
        {
          kind: 'user',
          id: 'user_1',
          text: 'old image prompt',
          meta: { turnId: 'turn_1', attachmentIds: ['att_image_1'] }
        }
      ],
      queuedMessages: [],
      turnStartedAtByUserId: {},
      turnDurationByUserId: {},
      turnReasoningFirstAtByUserId: {},
      turnReasoningLastAtByUserId: {}
    })

    await actions.rewindAndResend('user_1', 'Inspect this image again')

    expect(sendMessage).toHaveBeenCalledWith('Inspect this image again', undefined, {
      attachmentIds: ['att_image_1']
    })
  })

  it('preserves historical composer contexts when editing and resending', async () => {
    const prepareCodeCanvasResend = vi.fn(async () => null)
    const { actions, sendMessage, state } = buildHarness({
      maintenanceDependencies: { prepareCodeCanvasResend }
    })
    const composerContext = {
      schemaVersion: 1 as const,
      id: 'office-view-position',
      title: 'deck.pptx',
      summary: 'Current view · Slide 3 of 9',
      reference: {
        kind: 'office-view-position', schemaVersion: 1, sourceName: 'deck.pptx',
        sourceFormat: 'pptx', sourceSha256: 'a'.repeat(64),
        location: { kind: 'presentation', slide: 3, slideCount: 9 }
      },
      revision: 1,
      generation: 0,
      attachmentId: `workspace-view-context:${'b'.repeat(64)}`,
      provenance: { source: 'workspace-view' as const, workspaceId: 'c'.repeat(64) }
    }
    Object.assign(state, {
      route: 'write',
      busy: false,
      blocks: [{
        kind: 'user', id: 'user_1', text: 'old prompt',
        meta: { turnId: 'turn_1', composerContexts: [composerContext] }
      }],
      queuedMessages: [],
      turnStartedAtByUserId: {},
      turnDurationByUserId: {},
      turnReasoningFirstAtByUserId: {},
      turnReasoningLastAtByUserId: {}
    })

    await actions.rewindAndResend('user_1', 'Explain this slide again')

    expect(sendMessage).toHaveBeenCalledWith('Explain this slide again', undefined, {
      composerContexts: [composerContext]
    })
  })

  it('restores checkpoints against the thread workspace when resending under another global picker root', async () => {
    const previousWindow = globalThis.window
    const restoreGitCheckpoint = vi.fn(async () => ({
      ok: true,
      checkpointId: 'gcp_1',
      repositoryRoot: '/workspace/deepseek-gui',
      head: 'abc123',
      currentBranch: 'develop',
      rescueCheckpointId: null
    }))
    ;(globalThis as { window?: unknown }).window = {
      kunGui: {
        restoreGitCheckpoint
      }
    }
    try {
      const prepareCodeCanvasResend = vi.fn(async () => null)
      const { actions, provider, sendMessage, state } = buildHarness({
        maintenanceDependencies: {
          prepareCodeCanvasResend
        }
      })
      Object.assign(state, {
        route: 'chat',
        busy: false,
        workspaceRoot: '/workspace/kun-ui-extend',
        blocks: [
          {
            kind: 'user',
            id: 'user_1',
            text: 'old prompt',
            meta: { turnId: 'turn_1', workspaceCheckpointId: 'gcp_1' }
          },
          { kind: 'assistant', id: 'assistant_1', text: 'old answer' }
        ],
        queuedMessages: [],
        turnStartedAtByUserId: {},
        turnDurationByUserId: {},
        turnReasoningFirstAtByUserId: {},
        turnReasoningLastAtByUserId: {}
      })

      await actions.rewindAndResend('user_1', '  Retry release review  ')

      expect(restoreGitCheckpoint).toHaveBeenCalledWith({
        checkpointId: 'gcp_1',
        expectedThreadId: 'thr_existing',
        expectedWorkspaceRoot: '/workspace/deepseek-gui'
      })
      expect(provider.rewindThread).toHaveBeenCalledWith('thr_existing', 'turn_1')
      expect(sendMessage).toHaveBeenCalledWith('Retry release review')
      expect(state.error).toBeNull()
    } finally {
      ;(globalThis as { window?: unknown }).window = previousWindow
    }
  })

  it('coalesces repeated activation before checkpoint restore completes', async () => {
    const previousWindow = globalThis.window
    const restore = deferred<{
      ok: true
      checkpointId: string
      repositoryRoot: string
      head: string
      currentBranch: string
      rescueCheckpointId: null
    }>()
    const restoreGitCheckpoint = vi.fn(() => restore.promise)
    ;(globalThis as { window?: unknown }).window = {
      kunGui: { restoreGitCheckpoint }
    }
    try {
      const prepareCodeCanvasResend = vi.fn(async () => null)
      const { actions, provider, sendMessage, state } = buildHarness({
        maintenanceDependencies: { prepareCodeCanvasResend }
      })
      Object.assign(state, {
        route: 'chat',
        busy: false,
        blocks: [{
          kind: 'user', id: 'user_1', text: 'old prompt',
          meta: { turnId: 'turn_1', workspaceCheckpointId: 'gcp_1' }
        }],
        queuedMessages: [],
        turnStartedAtByUserId: {},
        turnDurationByUserId: {},
        turnReasoningFirstAtByUserId: {},
        turnReasoningLastAtByUserId: {}
      })

      const first = actions.rewindAndResend('user_1', 'Edited once')
      const duplicate = actions.rewindAndResend('user_1', 'Edited twice')

      expect(restoreGitCheckpoint).toHaveBeenCalledOnce()
      restore.resolve({
        ok: true,
        checkpointId: 'gcp_1',
        repositoryRoot: '/workspace/deepseek-gui',
        head: 'abc123',
        currentBranch: 'develop',
        rescueCheckpointId: null
      })
      await Promise.all([first, duplicate])

      expect(prepareCodeCanvasResend).toHaveBeenCalledOnce()
      expect(provider.rewindThread).toHaveBeenCalledOnce()
      expect(provider.rewindThread).toHaveBeenCalledWith('thr_existing', 'turn_1')
      expect(sendMessage).toHaveBeenCalledOnce()
      expect(sendMessage).toHaveBeenCalledWith('Edited once')
    } finally {
      ;(globalThis as { window?: unknown }).window = previousWindow
    }
  })

  it('releases the resend guard when checkpoint restoration returns early', async () => {
    const previousWindow = globalThis.window
    const restoreGitCheckpoint = vi.fn()
      .mockResolvedValueOnce({ ok: false, reason: 'error', message: 'restore failed' })
      .mockResolvedValueOnce({
        ok: true, checkpointId: 'gcp_1', repositoryRoot: '/workspace/deepseek-gui',
        head: 'abc123', currentBranch: 'develop', rescueCheckpointId: null
      })
    ;(globalThis as { window?: unknown }).window = { kunGui: { restoreGitCheckpoint } }
    try {
      const { actions, provider, sendMessage, state } = buildHarness({
        maintenanceDependencies: { prepareCodeCanvasResend: vi.fn(async () => null) }
      })
      Object.assign(state, {
        route: 'chat', busy: false,
        blocks: [{ kind: 'user', id: 'user_1', text: 'old prompt', meta: {
          turnId: 'turn_1', workspaceCheckpointId: 'gcp_1'
        } }],
        queuedMessages: [], turnStartedAtByUserId: {}, turnDurationByUserId: {},
        turnReasoningFirstAtByUserId: {}, turnReasoningLastAtByUserId: {}
      })

      await actions.rewindAndResend('user_1', 'Edited prompt')
      expect(provider.rewindThread).not.toHaveBeenCalled()
      expect(state.error).toBe('restore failed')

      await actions.rewindAndResend('user_1', 'Edited prompt')
      expect(restoreGitCheckpoint).toHaveBeenCalledTimes(2)
      expect(provider.rewindThread).toHaveBeenCalledOnce()
      expect(sendMessage).toHaveBeenCalledWith('Edited prompt')
    } finally {
      ;(globalThis as { window?: unknown }).window = previousWindow
    }
  })

  it('recovers canonical turn state and releases the guard after rewind fails', async () => {
    const prepareCodeCanvasResend = vi.fn(async () => null)
    const {
      actions,
      provider,
      recoverActiveTurn,
      sendMessage,
      sseAbortRef,
      state
    } = buildHarness({ maintenanceDependencies: { prepareCodeCanvasResend } })
    const originalBlocks: ChatBlock[] = [
      { kind: 'user', id: 'user_1', text: 'old prompt', meta: { turnId: 'turn_1' } },
      { kind: 'assistant', id: 'assistant_1', text: 'old answer' }
    ]
    Object.assign(state, {
      route: 'chat',
      busy: false,
      blocks: originalBlocks,
      queuedMessages: [],
      turnStartedAtByUserId: {},
      turnDurationByUserId: {},
      turnReasoningFirstAtByUserId: {},
      turnReasoningLastAtByUserId: {}
    })
    const staleStream = new AbortController()
    const abortSpy = vi.spyOn(staleStream, 'abort')
    sseAbortRef.current = staleStream
    const recoveredStream = new AbortController()
    recoverActiveTurn.mockImplementationOnce(async () => {
      state.busy = true
      sseAbortRef.current = recoveredStream
      return true
    })
    provider.rewindThread.mockRejectedValueOnce(new Error(JSON.stringify({
      code: 'turn_in_progress',
      message: 'cannot rewind while a turn is active: thr_existing'
    })))

    await actions.rewindAndResend('user_1', 'Retry after recovery')

    expect(abortSpy).toHaveBeenCalledOnce()
    expect(recoverActiveTurn).toHaveBeenCalledOnce()
    expect(sseAbortRef.current).toBe(recoveredStream)
    expect(state.blocks).toEqual(originalBlocks)
    expect(sendMessage).not.toHaveBeenCalled()
    expect(state.error).toBeTruthy()
    expect(state.error).not.toContain('cannot rewind while a turn is active')

    state.busy = false
    await actions.rewindAndResend('user_1', 'Retry after recovery')

    expect(provider.rewindThread).toHaveBeenCalledTimes(2)
    expect(sendMessage).toHaveBeenCalledOnce()
    expect(sendMessage).toHaveBeenCalledWith('Retry after recovery')
  })
})

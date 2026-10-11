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
  const actions = createMaintenanceActions({
    set,
    get,
    sseAbortRef: { current: null }
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
    state
  }
}

afterEach(() => {
  clearDesignChatHistoryMutationsForTests()
  vi.unstubAllGlobals()
})

describe('chat-store-maintenance-actions goal actions', () => {
  beforeEach(() => {
    registryMock.getProvider.mockReset()
  })

  it('sets a goal on the active thread, syncs snapshots, and starts the goal turn', async () => {
    const { actions, provider, refreshThreads, sendMessage, state } = buildHarness()

    const result = await actions.setActiveThreadGoal('  ship goal mode  ')

    expect(result).toBe(true)
    expect(provider.setThreadGoal).toHaveBeenCalledWith('thr_existing', {
      objective: 'ship goal mode',
      status: 'active'
    })
    expect(state.activeThreadGoal).toMatchObject({
      threadId: 'thr_existing',
      objective: 'ship goal mode',
      status: 'active'
    })
    expect(state.threads[0]?.goal).toMatchObject({
      threadId: 'thr_existing',
      objective: 'ship goal mode',
      status: 'active'
    })
    expect(refreshThreads).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledWith(
      'ship goal mode',
      'agent',
      expect.objectContaining({
        displayText: expect.stringContaining('ship goal mode')
      })
    )
  })

  it('creates a thread before setting the first goal when no thread is active', async () => {
    const { actions, createThread, provider, sendMessage, state } = buildHarness({
      activeThreadId: null
    })

    const result = await actions.setActiveThreadGoal('ship goal mode')

    expect(result).toBe(true)
    expect(createThread).toHaveBeenCalledTimes(1)
    expect(provider.setThreadGoal).toHaveBeenCalledWith('thr_created', {
      objective: 'ship goal mode',
      status: 'active'
    })
    expect(createThread.mock.invocationCallOrder[0]).toBeLessThan(
      provider.setThreadGoal.mock.invocationCallOrder[0]
    )
    expect(state.activeThreadId).toBe('thr_created')
    expect(state.activeThreadGoal?.threadId).toBe('thr_created')
    expect(state.threads[0]?.goal?.objective).toBe('ship goal mode')
    expect(sendMessage).toHaveBeenCalledWith(
      'ship goal mode',
      'agent',
      expect.objectContaining({
        displayText: expect.stringContaining('ship goal mode')
      })
    )
  })

  it('does not call goal APIs when a new thread cannot be created', async () => {
    const { actions, createThread, provider, sendMessage, state } = buildHarness({
      activeThreadId: null,
      createThreadSucceeds: false
    })

    const result = await actions.setActiveThreadGoal('ship goal mode')

    expect(result).toBe(false)
    expect(createThread).toHaveBeenCalledTimes(1)
    expect(provider.setThreadGoal).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(state.activeThreadGoal).toBeNull()
  })

  it('updates active goal status and keeps the thread snapshot in sync', async () => {
    const initialGoal = goal('thr_existing', 'finish testing', 'active')
    const { actions, provider, refreshThreads, state } = buildHarness({ initialGoal })

    const result = await actions.setActiveThreadGoalStatus('paused')

    expect(result).toBe(true)
    expect(provider.setThreadGoal).toHaveBeenCalledWith('thr_existing', { status: 'paused' })
    expect(state.activeThreadGoal).toMatchObject({
      threadId: 'thr_existing',
      objective: 'finish testing',
      status: 'paused'
    })
    expect(state.threads[0]?.goal).toMatchObject({
      threadId: 'thr_existing',
      objective: 'finish testing',
      status: 'paused'
    })
    expect(refreshThreads).toHaveBeenCalledTimes(1)
  })

  it('clears the active goal and removes it from the thread snapshot', async () => {
    const initialGoal = goal('thr_existing', 'finish testing', 'active')
    const { actions, provider, refreshThreads, state } = buildHarness({ initialGoal })

    const result = await actions.clearActiveThreadGoal()

    expect(result).toBe(true)
    expect(provider.clearThreadGoal).toHaveBeenCalledWith('thr_existing')
    expect(state.activeThreadGoal).toBeNull()
    expect(state.threads[0]?.goal).toBeNull()
    expect(refreshThreads).toHaveBeenCalledTimes(1)
  })

  it('restores a pending approval with retry feedback when the protected app prompt is cancelled', async () => {
    const { actions, provider, state } = buildHarness()
    provider.submitApprovalDecision.mockResolvedValueOnce('cancelled')
    state.blocks = [{
      kind: 'approval',
      id: 'approval-cancelled',
      approvalId: 'appr_cancelled',
      summary: 'Approve command',
      status: 'pending'
    }]

    await actions.resolveApproval('approval-cancelled', 'allow')

    expect(provider.submitApprovalDecision).toHaveBeenCalledWith(
      'appr_cancelled',
      'allow',
      true
    )
    expect(state.blocks[0]).toMatchObject({
      status: 'pending',
      errorMessage: 'Confirmation cancelled. This action is still waiting for your decision.'
    })
  })

  it('does not overwrite an SSE-expired approval when submission resolves later', async () => {
    const submission = deferred<'submitted' | 'cancelled'>()
    const { actions, provider, state } = buildHarness()
    provider.submitApprovalDecision.mockReturnValueOnce(submission.promise)
    state.blocks = [{
      kind: 'approval',
      id: 'approval-expired',
      approvalId: 'appr_expired',
      summary: 'Approve command',
      status: 'pending'
    }]

    const resolving = actions.resolveApproval('approval-expired', 'allow')
    await vi.waitFor(() => expect(state.blocks[0]).toMatchObject({ status: 'submitting' }))

    state.blocks = state.blocks.map((block) =>
      block.id === 'approval-expired' && block.kind === 'approval'
        ? {
            ...block,
            status: 'expired',
            errorMessage: 'turn aborted while awaiting approval'
          }
        : block
    )
    submission.resolve('submitted')
    await resolving

    expect(state.blocks[0]).toMatchObject({
      status: 'expired',
      errorMessage: 'turn aborted while awaiting approval'
    })
  })

  it('settles local runtime work before the backend interrupt resolves', async () => {
    const { actions, provider, recoverActiveTurn, refreshThreads, state } = buildHarness()
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'user-1', text: 'run command' },
      {
        kind: 'tool',
        id: 'tool-1',
        summary: 'Running command',
        status: 'running',
        toolKind: 'command_execution'
      },
      {
        kind: 'approval',
        id: 'approval-1',
        approvalId: 'approval-1',
        summary: 'Approve command',
        status: 'pending'
      },
      {
        kind: 'user_input',
        id: 'input-1',
        requestId: 'input-1',
        questions: [],
        status: 'pending'
      }
    ]
    Object.assign(state, {
      blocks,
      busy: true,
      currentTurnId: 'turn-1',
      currentTurnOrchestration: 'graph',
      currentTurnUserId: 'user-1',
      liveAssistant: 'partial answer',
      liveReasoning: '',
      queuedMessages: [{ id: 'q-followup', text: 'send later', deliveryState: 'pending' }],
      watchTurnCompletion: { thr_existing: true },
      unreadThreadIds: { thr_existing: true },
      threads: [{ ...thread('thr_existing'), status: 'running', latestTurnStatus: 'running' as const }],
      turnStartedAtByUserId: { 'user-1': Date.now() - 1000 },
      turnDurationByUserId: {},
      turnReasoningFirstAtByUserId: {},
      turnReasoningLastAtByUserId: {}
    })
    let busyWhenBackendCalled: boolean | null = null
    provider.interruptTurn.mockImplementation(async () => {
      busyWhenBackendCalled = state.busy
    })

    await actions.interrupt()

    expect(provider.interruptTurn).toHaveBeenCalledWith('thr_existing', 'turn-1', { discard: false })
    expect(busyWhenBackendCalled).toBe(false)
    expect(state.busy).toBe(false)
    expect(state.currentTurnId).toBeNull()
    expect(state.currentTurnOrchestration).toBeNull()
    expect(state.currentTurnUserId).toBeNull()
    expect(state.liveAssistant).toBe('')
    expect(state.blocks.map((block) => ('status' in block ? block.status : block.kind))).toEqual([
      'user',
      'error',
      'error',
      'cancelled',
      'assistant'
    ])
    expect(refreshThreads).toHaveBeenCalledTimes(1)
    expect(state.queuedMessages).toEqual([
      expect.objectContaining({ id: 'q-followup', deliveryState: 'paused' })
    ])
    expect(state.watchTurnCompletion).toEqual({})
    expect(state.unreadThreadIds).toEqual({})
    expect(state.threads[0]).toMatchObject({ status: 'idle', latestTurnStatus: 'aborted' })
    expect(recoverActiveTurn).toHaveBeenCalledTimes(1)
  })

  it('keeps the turn settled when the backend interrupt fails', async () => {
    ;(globalThis as { window?: unknown }).window = {
      kunGui: {
        logError: vi.fn(async () => undefined)
      }
    }
    try {
      const { actions, provider, recoverActiveTurn, state } = buildHarness()
      Object.assign(state, {
        blocks: [{ kind: 'user', id: 'user-1', text: 'run command' }],
        busy: true,
        currentTurnId: 'turn-1',
        currentTurnUserId: 'user-1',
        liveAssistant: '',
        liveReasoning: '',
        queuedMessages: [],
        turnStartedAtByUserId: {},
        turnDurationByUserId: {},
        turnReasoningFirstAtByUserId: {},
        turnReasoningLastAtByUserId: {}
      })
      provider.interruptTurn.mockRejectedValueOnce(new Error('runtime timeout'))

      await actions.interrupt()

      expect(state.busy).toBe(false)
      expect(state.currentTurnId).toBeNull()
      expect(state.error).toBe('runtime timeout')
      expect(recoverActiveTurn).toHaveBeenCalledTimes(1)
    } finally {
      delete (globalThis as { window?: unknown }).window
    }
  })
})

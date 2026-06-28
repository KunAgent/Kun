import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatBlock, NormalizedThread, ThreadGoal, ThreadGoalStatus } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet, SendMessageOverrides } from './chat-store-types'
import type { BrowserStorageLike } from '../lib/browser-storage'
import {
  emptyDesignThreadRegistry,
  isDesignThreadId,
  markDesignThread,
  readDesignThreadRegistry,
  saveDesignThreadRegistry
} from '../design/design-thread-registry'

const registryMock = vi.hoisted(() => ({
  getProvider: vi.fn()
}))

vi.mock('../agent/registry', () => ({
  getProvider: registryMock.getProvider
}))

import { createMaintenanceActions } from './chat-store-maintenance-actions'

type GoalPatch = {
  objective?: string
  status?: ThreadGoalStatus
  tokenBudget?: number | null
}

type Harness = {
  actions: ReturnType<typeof createMaintenanceActions>
  createThread: ReturnType<typeof vi.fn>
  drainQueuedMessages: ReturnType<typeof vi.fn>
  get: ChatStoreGet
  provider: {
    deleteThread: ReturnType<typeof vi.fn>
    setThreadGoal: ReturnType<typeof vi.fn>
    clearThreadGoal: ReturnType<typeof vi.fn>
    interruptTurn: ReturnType<typeof vi.fn>
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
  createThreadSucceeds?: boolean
  initialGoal?: ThreadGoal | null
} = {}): Harness {
  const activeThreadId = options.activeThreadId === undefined ? 'thr_existing' : options.activeThreadId
  const createThreadSucceeds = options.createThreadSucceeds ?? true
  const initialGoal = options.initialGoal ?? null
  let state: ChatState

  const provider = {
    deleteThread: vi.fn(async () => undefined),
    setThreadGoal: vi.fn(async (threadId: string, patch: GoalPatch) =>
      goal(
        threadId,
        patch.objective ?? state.activeThreadGoal?.objective ?? initialGoal?.objective ?? 'ship goal mode',
        patch.status ?? state.activeThreadGoal?.status ?? initialGoal?.status ?? 'active'
      )
    ),
    clearThreadGoal: vi.fn(async () => true),
    interruptTurn: vi.fn(async () => undefined),
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
    createThread,
    error: null,
    drainQueuedMessages,
    recoverActiveTurn,
    refreshThreads,
    selectThread,
    runtimeConnection: 'ready',
    sendMessage,
    settingsSection: 'general',
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
  })

  return { actions, createThread, drainQueuedMessages, get, provider, recoverActiveTurn, refreshThreads, selectThread, sendMessage, state }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('chat-store-maintenance-actions fork actions', () => {
  beforeEach(() => {
    registryMock.getProvider.mockReset()
  })

  it('forks the active thread from a specific turn and selects the new thread', async () => {
    const { actions, provider, refreshThreads, selectThread, state } = buildHarness()
    state.blocks = [
      { kind: 'user', id: 'user_1', turnId: 'turn_1', text: 'question' },
      { kind: 'assistant', id: 'assistant_1', turnId: 'turn_1', text: 'answer' },
      { kind: 'user', id: 'user_2', turnId: 'turn_2', text: 'later question' }
    ]

    await actions.forkThreadFromTurn(' turn_1 ')

    expect(provider.forkThread).toHaveBeenCalledWith('thr_existing', { turnId: 'turn_1' })
    expect(refreshThreads).toHaveBeenCalledTimes(1)
    expect(selectThread).toHaveBeenCalledWith('thr_forked')
    expect(state.activeThreadId).toBe('thr_forked')
  })
})

describe('chat-store-maintenance-actions delete actions', () => {
  beforeEach(() => {
    registryMock.getProvider.mockReset()
  })

  it('removes deleted design threads from the design registry', async () => {
    const storage = new MemoryStorage()
    saveDesignThreadRegistry(
      markDesignThread(
        '/workspace/deepseek-gui',
        'login',
        'thr_design',
        emptyDesignThreadRegistry()
      ),
      storage
    )
    vi.stubGlobal('window', { localStorage: storage })
    const { actions, provider, refreshThreads, state } = buildHarness({ activeThreadId: 'thr_design' })
    state.threads = [thread('thr_design')]
    state.watchTurnCompletion = { thr_design: true }
    state.unreadThreadIds = { thr_design: true }

    await actions.deleteThread(' thr_design ')

    expect(provider.deleteThread).toHaveBeenCalledWith('thr_design')
    expect(isDesignThreadId('thr_design', readDesignThreadRegistry(storage))).toBe(false)
    expect(state.threads).toEqual([])
    expect(state.activeThreadId).toBeNull()
    expect(refreshThreads).toHaveBeenCalledTimes(1)
  })
})

describe('chat-store-maintenance-actions workspace rollback', () => {
  beforeEach(() => {
    registryMock.getProvider.mockReset()
  })

  it('restores the workspace checkpoint without rewinding or resending the conversation', async () => {
    const previousWindow = globalThis.window
    const restoreGitCheckpoint = vi.fn(async () => ({
      ok: true,
      checkpointId: 'gcp_1',
      repositoryRoot: '/workspace/deepseek-gui',
      head: 'abc123',
      currentBranch: 'develop',
      rescueCheckpointId: 'gcp_rescue'
    }))
    ;(globalThis as { window?: unknown }).window = {
      confirm: vi.fn(() => true),
      kunGui: {
        restoreGitCheckpoint
      }
    }
    try {
      const { actions, provider, sendMessage, state } = buildHarness()
      state.blocks = [
        { kind: 'user', id: 'user_1', turnId: 'turn_1', text: 'question', meta: { workspaceCheckpointId: 'gcp_1' } },
        { kind: 'assistant', id: 'assistant_1', turnId: 'turn_1', text: 'answer' }
      ]

      await actions.rollbackWorkspaceToCheckpoint(' gcp_1 ')

      expect(restoreGitCheckpoint).toHaveBeenCalledWith({ checkpointId: 'gcp_1' })
      expect(provider.rewindThread).not.toHaveBeenCalled()
      expect(sendMessage).not.toHaveBeenCalled()
      expect(state.blocks).toHaveLength(2)
      expect(state.error).toBeNull()
    } finally {
      ;(globalThis as { window?: unknown }).window = previousWindow
    }
  })

  it('uses a checkpoint-specific error when rollback has no checkpoint id', async () => {
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
      confirm: vi.fn(() => true),
      kunGui: {
        restoreGitCheckpoint
      }
    }
    try {
      const { actions, state } = buildHarness()

      await actions.rollbackWorkspaceToCheckpoint('   ')

      expect(restoreGitCheckpoint).not.toHaveBeenCalled()
      expect(state.error).toBe('This turn has no file-change checkpoint to roll back.')
    } finally {
      ;(globalThis as { window?: unknown }).window = previousWindow
    }
  })

  it('short-circuits without restoring when busy flips after the confirm dialog resolves', async () => {
    const previousWindow = globalThis.window
    const restoreGitCheckpoint = vi.fn(async () => ({
      ok: true,
      checkpointId: 'gcp_1',
      repositoryRoot: '/workspace/deepseek-gui',
      head: 'abc123',
      currentBranch: 'develop',
      rescueCheckpointId: 'gcp_rescue'
    }))
    const { actions, state } = buildHarness()
    let confirmCalls = 0
    ;(globalThis as { window?: unknown }).window = {
      confirm: vi.fn(() => {
        confirmCalls += 1
        // Simulate the user typing+sending a new turn while the confirm
        // dialog is still open: by the time confirm() resolves, the store
        // is busy again. The action must NOT proceed to git reset --hard.
        state.busy = true
        return true
      }),
      kunGui: {
        restoreGitCheckpoint
      }
    }
    try {
      state.blocks = [
        { kind: 'user', id: 'user_1', turnId: 'turn_1', text: 'question', meta: { workspaceCheckpointId: 'gcp_1' } },
        { kind: 'assistant', id: 'assistant_1', turnId: 'turn_1', text: 'answer' }
      ]
      state.busy = false

      await actions.rollbackWorkspaceToCheckpoint('gcp_1')

      expect(confirmCalls).toBe(1)
      expect(restoreGitCheckpoint).not.toHaveBeenCalled()
      expect(state.error).toBe('Cannot roll back the workspace while the agent is running.')
    } finally {
      ;(globalThis as { window?: unknown }).window = previousWindow
    }
  })

  it('surfaces the rescue checkpoint id after a successful restore', async () => {
    const previousWindow = globalThis.window
    const previousConsoleInfo = console.info
    const restoreGitCheckpoint = vi.fn(async () => ({
      ok: true,
      checkpointId: 'gcp_1',
      repositoryRoot: '/workspace/deepseek-gui',
      head: 'abc123',
      currentBranch: 'develop',
      rescueCheckpointId: 'gcp_rescue_xyz'
    }))
    ;(globalThis as { window?: unknown }).window = {
      confirm: vi.fn(() => true),
      kunGui: {
        restoreGitCheckpoint
      }
    }
    const consoleInfo = vi.fn()
    console.info = consoleInfo
    try {
      const { actions, state } = buildHarness()
      state.blocks = [
        { kind: 'user', id: 'user_1', turnId: 'turn_1', text: 'question', meta: { workspaceCheckpointId: 'gcp_1' } },
        { kind: 'assistant', id: 'assistant_1', turnId: 'turn_1', text: 'answer' }
      ]

      await actions.rollbackWorkspaceToCheckpoint('gcp_1')

      expect(restoreGitCheckpoint).toHaveBeenCalledWith({ checkpointId: 'gcp_1' })
      expect(consoleInfo).toHaveBeenCalledTimes(1)
      const logArgs = consoleInfo.mock.calls[0]
      expect(logArgs[0]).toBe('[rollback] rescue checkpoint:')
      expect(logArgs[1]).toBe('gcp_rescue_xyz')
      expect(logArgs[2]).toBe('workspace:')
      expect(logArgs[4]).toBe('thread:')
      expect(logArgs[5]).toBe('thr_existing')
      expect(state.error).toBeNull()
    } finally {
      console.info = previousConsoleInfo
      ;(globalThis as { window?: unknown }).window = previousWindow
    }
  })
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
      currentTurnUserId: 'user-1',
      liveAssistant: 'partial answer',
      liveReasoning: '',
      queuedMessages: [],
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

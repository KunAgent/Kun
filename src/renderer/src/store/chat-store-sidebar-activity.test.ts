import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentProvider, NormalizedThread } from '../agent/types'
import type { ScheduleRuntimeStatus } from '@shared/app-settings'
import type { ChatState } from './chat-store-types'
import { stopTurnCompletionPoll } from './chat-store-schedulers'
import {
  createSidebarActivityActions,
  scheduledThreadActivities
} from './chat-store-sidebar-activity'

let provider: Pick<AgentProvider, 'listThreadsPage' | 'listThreads' | 'getThreadState'>

vi.mock('../agent/registry', () => ({ getProvider: () => provider }))

function thread(patch: Partial<NormalizedThread> = {}): NormalizedThread {
  return {
    id: 'thread-1', title: 'Task', workspace: '/project', model: 'model', mode: 'agent',
    status: 'idle', latestSeq: 1, updatedAt: '2026-08-20T00:00:00.000Z', ...patch
  }
}

function status(
  boundThreadTasks: ScheduleRuntimeStatus['boundThreadTasks'] = []
): ScheduleRuntimeStatus {
  return {
    internalServerRunning: true,
    internalUrl: '',
    runningTaskIds: [],
    queuedTaskIds: [],
    boundThreadTasks,
    powerSaveBlockerActive: false
  }
}

function storageFixture(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value)
  }
}

function harness(initialThread = thread()) {
  let state = {
    runtimeConnection: 'ready',
    threads: [initialThread],
    activeThreadId: null,
    activeThreadRelation: null,
    route: 'settings',
    sideConversations: {},
    sidePanel: { open: false, activeSideId: null },
    watchTurnCompletion: {},
    unreadThreadIds: {},
    scheduledThreadActivities: {},
    refreshThreads: vi.fn(async () => undefined)
  } as unknown as ChatState
  const set = (partial: Partial<ChatState> | ((value: ChatState) => Partial<ChatState>)): void => {
    state = { ...state, ...(typeof partial === 'function' ? partial(state) : partial) }
  }
  const get = (): ChatState => state
  return { get, action: createSidebarActivityActions(set, get).syncSidebarActivity }
}

describe('sidebar activity observer', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      localStorage: storageFixture(),
      kunGui: { getScheduleStatus: vi.fn(async () => status()), logError: vi.fn(async () => undefined) }
    })
  })

  afterEach(() => {
    stopTurnCompletionPoll()
    vi.unstubAllGlobals()
  })

  it('baselines old history, then notices a fast background completion by latestSeq', async () => {
    let listed = thread()
    provider = {
      listThreads: vi.fn(async () => [listed]),
      listThreadsPage: vi.fn(async () => ({ threads: [listed], hasMore: false })),
      getThreadState: vi.fn(async () => ({
        status: 'idle', updatedAt: listed.updatedAt, latestSeq: listed.latestSeq ?? 0,
        latestTurnId: 'turn-2', latestTurnStatus: 'completed'
      }))
    }
    const h = harness()

    await h.action()
    expect(h.get().unreadThreadIds).toEqual({})

    listed = thread({ latestSeq: 3, updatedAt: '2026-08-20T00:01:00.000Z' })
    await h.action()

    expect(h.get().threads[0]).toMatchObject({ latestSeq: 3, latestTurnId: 'turn-2', status: 'idle' })
    expect(h.get().unreadThreadIds).toEqual({ 'thread-1': 'completed' })
  })

  it('does not advance an activity checkpoint when the state read fails transiently', async () => {
    let listed = thread()
    const getThreadState = vi.fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue({
        status: 'idle', updatedAt: '2026-08-20T00:01:00.000Z', latestSeq: 2,
        latestTurnId: 'turn-2', latestTurnStatus: 'completed'
      })
    provider = {
      listThreads: vi.fn(async () => [listed]),
      listThreadsPage: vi.fn(async () => ({ threads: [listed], hasMore: false })),
      getThreadState
    }
    const h = harness()
    await h.action()
    listed = thread({ latestSeq: 2, updatedAt: '2026-08-20T00:01:00.000Z' })

    await h.action()
    expect(h.get().unreadThreadIds).toEqual({})
    await h.action()

    expect(getThreadState).toHaveBeenCalledTimes(2)
    expect(h.get().unreadThreadIds).toEqual({ 'thread-1': 'completed' })
  })

  it('projects a bound schedule from pending to running and reports a pre-turn failure', async () => {
    const pending = {
      taskId: 'task-1', threadId: 'thread-1', enabled: true, status: 'idle' as const,
      nextRunAt: '2099-08-20T01:00:00.000Z', lastRunAt: '', updatedAt: '2026-08-20T00:00:00.000Z'
    }
    let scheduleStatus = status([pending])
    ;(window.kunGui.getScheduleStatus as ReturnType<typeof vi.fn>).mockImplementation(async () => scheduleStatus)
    provider = {
      listThreads: vi.fn(async () => [thread()]),
      listThreadsPage: vi.fn(async () => ({ threads: [thread()], hasMore: false })),
      getThreadState: vi.fn(async () => ({ status: 'idle', updatedAt: '', latestSeq: 1 }))
    }
    const h = harness()

    await h.action()
    expect(h.get().scheduledThreadActivities['thread-1']).toMatchObject({ state: 'scheduled', taskCount: 1 })

    scheduleStatus = status([{ ...pending, status: 'running' }])
    await h.action()
    expect(h.get().scheduledThreadActivities['thread-1']?.state).toBe('running')

    scheduleStatus = status([{
      ...pending, enabled: false, status: 'error', nextRunAt: '',
      lastRunAt: '2026-08-20T00:02:00.000Z', updatedAt: '2026-08-20T00:02:00.000Z'
    }])
    await h.action()
    expect(h.get().scheduledThreadActivities).toEqual({})
    expect(h.get().unreadThreadIds).toEqual({ 'thread-1': 'failed' })
  })

  it('aggregates multiple schedules without letting queued work look running', () => {
    const activities = scheduledThreadActivities([
      {
        taskId: 'one', threadId: 'thread-1', enabled: true, status: 'queued',
        nextRunAt: '2099-08-20T02:00:00.000Z', lastRunAt: '', updatedAt: ''
      },
      {
        taskId: 'two', threadId: 'thread-1', enabled: true, status: 'idle',
        nextRunAt: '2099-08-20T01:00:00.000Z', lastRunAt: '', updatedAt: ''
      }
    ], Date.parse('2099-08-20T00:00:00.000Z'))

    expect(activities['thread-1']).toEqual({
      state: 'scheduled', taskCount: 2, nextRunAt: '2099-08-20T01:00:00.000Z', queued: true
    })
  })
})

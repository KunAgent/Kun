import type { ScheduleRuntimeStatus } from '@shared/app-settings'
import { getProvider } from '../agent/registry'
import type { NormalizedThread } from '../agent/types'
import type {
  ChatState,
  ChatStoreGet,
  ChatStoreSet,
  ScheduledThreadActivity
} from './chat-store-types'
import {
  shouldHideThreadFromSidebarByTitle,
  shouldInspectThreadForSidebarVisibility
} from '../lib/thread-sidebar-visibility'
import {
  clearUnreadCompletion,
  completionOutcomeForTurnStatus,
  completionIsCurrentlyVisible,
  markUnreadCompletion
} from './unread-completions'
import { threadLooksRunning } from './chat-store-runtime-helpers'
import {
  MAX_WATCHED_COMPLETION_NOTIFICATIONS,
  clearWatchedCompletionNotification,
  syncTurnCompletionPoll,
  turnCompleteNotificationSource,
  watchTurnCompletionNotification
} from './chat-store-runtime'
import { collectRunningWatchTargets } from './chat-store-thread-activity-reconcile'
import {
  persistSidebarActivityCheckpoints,
  readSidebarActivityCheckpoints,
  type SidebarActivityCheckpoints,
  type ThreadActivityCheckpoint
} from './sidebar-activity-checkpoints'

export const SIDEBAR_ACTIVITY_PAGE_LIMIT = 200
let syncGeneration = 0
let inFlight: Promise<boolean> | null = null

function fallbackFingerprint(thread: Pick<NormalizedThread, 'updatedAt' | 'status'>): string {
  return `${thread.updatedAt}|${thread.status ?? ''}`
}

function checkpointForThread(thread: NormalizedThread): ThreadActivityCheckpoint {
  return {
    ...(typeof thread.latestSeq === 'number' ? { latestSeq: thread.latestSeq } : {}),
    fallback: fallbackFingerprint(thread)
  }
}

function checkpointChanged(
  previous: ThreadActivityCheckpoint | undefined,
  thread: NormalizedThread
): boolean {
  if (!previous) return true
  if (typeof thread.latestSeq === 'number' && typeof previous.latestSeq === 'number') {
    return thread.latestSeq !== previous.latestSeq
  }
  return previous.fallback !== fallbackFingerprint(thread)
}

function scheduleRunKey(task: ScheduleRuntimeStatus['boundThreadTasks'][number]): string {
  if (!task.lastRunAt.trim()) return ''
  return `${task.lastRunAt}|${task.status}`
}

export function scheduledThreadActivities(
  tasks: ScheduleRuntimeStatus['boundThreadTasks'],
  now = Date.now()
): Record<string, ScheduledThreadActivity> {
  const activities: Record<string, ScheduledThreadActivity> = {}
  for (const task of tasks) {
    const threadId = task.threadId.trim()
    if (!threadId) continue
    const nextRun = Date.parse(task.nextRunAt)
    const running = task.status === 'running'
    const scheduled = task.enabled && (
      task.status === 'queued' ||
      (Number.isFinite(nextRun) && nextRun > now)
    )
    if (!running && !scheduled) continue
    const previous = activities[threadId]
    const nextRunAt = Number.isFinite(nextRun) ? task.nextRunAt : ''
    if (!previous) {
      activities[threadId] = {
        state: running ? 'running' : 'scheduled',
        taskCount: 1,
        nextRunAt,
        queued: task.status === 'queued'
      }
      continue
    }
    const previousTime = Date.parse(previous.nextRunAt)
    activities[threadId] = {
      state: previous.state === 'running' || running ? 'running' : 'scheduled',
      taskCount: previous.taskCount + 1,
      nextRunAt: !nextRunAt
        ? previous.nextRunAt
        : !Number.isFinite(previousTime) || nextRun < previousTime
          ? nextRunAt
          : previous.nextRunAt,
      queued: previous.queued || task.status === 'queued'
    }
  }
  return activities
}

async function loadRecentThreads(): Promise<NormalizedThread[]> {
  const provider = getProvider()
  if (typeof provider.listThreadsPage === 'function') {
    return (await provider.listThreadsPage({
      limit: SIDEBAR_ACTIVITY_PAGE_LIMIT,
      includeSide: false,
      lean: true
    })).threads
  }
  return provider.listThreads({ limit: SIDEBAR_ACTIVITY_PAGE_LIMIT, includeSide: false })
}

async function runSync(set: ChatStoreSet, get: ChatStoreGet, generation: number): Promise<void> {
  if (get().runtimeConnection !== 'ready') return
  const provider = getProvider()
  const [recentThreads, scheduleStatus] = await Promise.all([
    loadRecentThreads(),
    typeof window.kunGui?.getScheduleStatus === 'function'
      ? window.kunGui.getScheduleStatus().catch(() => null)
      : Promise.resolve(null)
  ])
  if (generation !== syncGeneration || get().runtimeConnection !== 'ready') return

  const checkpoints = readSidebarActivityCheckpoints()
  const baselineEstablished = checkpoints.initialized
  const stateAtStart = get()
  const localById = new Map(stateAtStart.threads.map((thread) => [thread.id, thread]))
  const candidates = recentThreads.filter((thread) => {
    const local = localById.get(thread.id)
    return !local || threadLooksRunning(thread) ||
      stateAtStart.watchTurnCompletion[thread.id] === true ||
      (baselineEstablished && checkpointChanged(checkpoints.threads[thread.id], thread))
  })
  const runtimeStates = new Map<string, Awaited<ReturnType<typeof provider.getThreadState>>>()
  const candidateIds = new Set(candidates.map((thread) => thread.id))
  if (typeof provider.getThreadState === 'function' && candidates.length > 0) {
    const settled = await Promise.allSettled(candidates.map(async (thread) => ({
      id: thread.id,
      state: await provider.getThreadState(thread.id)
    })))
    for (const result of settled) {
      if (result.status === 'fulfilled') runtimeStates.set(result.value.id, result.value.state)
    }
  }
  if (generation !== syncGeneration) return

  const nextCheckpoints: SidebarActivityCheckpoints = {
    initialized: true,
    threads: { ...checkpoints.threads },
    scheduleRuns: { ...checkpoints.scheduleRuns }
  }
  for (const thread of recentThreads) {
    if (
      candidateIds.has(thread.id) &&
      typeof provider.getThreadState === 'function' &&
      !runtimeStates.has(thread.id)
    ) continue
    nextCheckpoints.threads[thread.id] = checkpointForThread(thread)
  }
  const boundTasks = scheduleStatus?.boundThreadTasks ?? []
  for (const task of boundTasks) {
    const key = scheduleRunKey(task)
    if (key) nextCheckpoints.scheduleRuns[task.taskId] = key
  }

  let discoveredUnknownThread = false
  set((state) => {
    const recentById = new Map(recentThreads.map((thread) => [thread.id, thread]))
    const knownIds = new Set(state.threads.map((thread) => thread.id))
    discoveredUnknownThread = recentThreads.some((thread) =>
      !knownIds.has(thread.id) &&
      !shouldHideThreadFromSidebarByTitle(thread) &&
      !shouldInspectThreadForSidebarVisibility(thread)
    )
    let unreadThreadIds = state.unreadThreadIds
    const watchTurnCompletion = { ...state.watchTurnCompletion }
    const threads = state.threads.map((thread) => {
      const summary = recentById.get(thread.id)
      const runtimeState = runtimeStates.get(thread.id)
      if (!summary) return thread
      if (
        typeof thread.latestSeq === 'number' &&
        typeof summary.latestSeq === 'number' &&
        thread.latestSeq > summary.latestSeq
      ) return thread
      const changed = baselineEstablished && checkpointChanged(checkpoints.threads[thread.id], summary)
      const running = runtimeState ? threadLooksRunning(runtimeState) : threadLooksRunning(summary)
      const latestTurnStatus = runtimeState?.latestTurnStatus
      if (running && thread.id !== state.activeThreadId && watchTurnCompletion[thread.id] !== true) {
        watchTurnCompletion[thread.id] = true
        watchTurnCompletionNotification(
          thread.id,
          Date.now(),
          turnCompleteNotificationSource(thread.id, state)
        )
      }
      if (!running && runtimeState && changed) {
        delete watchTurnCompletion[thread.id]
        clearWatchedCompletionNotification(thread.id)
        const outcome = completionOutcomeForTurnStatus(latestTurnStatus)
        if (outcome) {
          unreadThreadIds = completionIsCurrentlyVisible(state, thread.id)
            ? clearUnreadCompletion(unreadThreadIds, thread.id)
            : markUnreadCompletion(unreadThreadIds, thread.id, outcome)
        }
      }
      return {
        ...thread,
        updatedAt: summary.updatedAt,
        ...(typeof summary.latestSeq === 'number' ? { latestSeq: summary.latestSeq } : {}),
        status: thread.archived ? thread.status : running ? 'running' : 'idle',
        ...(runtimeState?.latestTurnId ? { latestTurnId: runtimeState.latestTurnId } : {}),
        ...(latestTurnStatus ? { latestTurnStatus } : {})
      }
    })

    for (const task of boundTasks) {
      if (!knownIds.has(task.threadId)) continue
      const key = scheduleRunKey(task)
      if (!baselineEstablished || !key || checkpoints.scheduleRuns[task.taskId] === key) continue
      const outcome = completionOutcomeForTurnStatus(task.status)
      if (!outcome) continue
      unreadThreadIds = completionIsCurrentlyVisible(state, task.threadId)
        ? clearUnreadCompletion(unreadThreadIds, task.threadId)
        : markUnreadCompletion(unreadThreadIds, task.threadId, outcome)
    }

    const addedWatchIds = collectRunningWatchTargets(threads, {
      activeThreadId: state.activeThreadId,
      watchTurnCompletion,
      watchLimit: MAX_WATCHED_COMPLETION_NOTIFICATIONS
    })
    for (const id of addedWatchIds) {
      watchTurnCompletion[id] = true
      watchTurnCompletionNotification(id, Date.now(), turnCompleteNotificationSource(id, state))
    }
    return {
      threads,
      watchTurnCompletion,
      unreadThreadIds,
      scheduledThreadActivities: scheduleStatus
        ? scheduledThreadActivities(boundTasks)
        : state.scheduledThreadActivities
    }
  })

  persistSidebarActivityCheckpoints(nextCheckpoints)
  syncTurnCompletionPoll(set, get)
  if (discoveredUnknownThread) void get().refreshThreads()
}

export function createSidebarActivityActions(
  set: ChatStoreSet,
  get: ChatStoreGet
): Pick<ChatState, 'syncSidebarActivity'> {
  return {
    syncSidebarActivity: async () => {
      if (inFlight) return inFlight
      const generation = ++syncGeneration
      const task = runSync(set, get, generation).then(() => true).catch((error) => {
        void window.kunGui?.logError?.('sidebar-activity', 'Failed to reconcile sidebar activity', {
          message: error instanceof Error ? error.message : String(error)
        }).catch(() => undefined)
        return false
      })
      const flight = task.finally(() => {
        if (inFlight === flight) inFlight = null
      })
      inFlight = flight
      return flight
    }
  }
}

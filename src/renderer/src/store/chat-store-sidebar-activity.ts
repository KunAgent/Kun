import type { ScheduleRuntimeStatus } from '@shared/app-settings'
import { getProvider } from '../agent/registry'
import { loadThreadStates } from '../agent/thread-state-loader'
import type { NormalizedThread } from '../agent/types'
import type {
  ChatState,
  ChatStoreGet,
  ChatStoreSet,
  ScheduledThreadActivity
} from './chat-store-types'
import {
  filterThreadsForSidebar,
  shouldHideThreadFromSidebarByTitle,
  shouldInspectThreadForSidebarVisibility
} from '../lib/thread-sidebar-visibility'
import {
  clearUnreadCompletion,
  completionOutcomeForTurnStatus,
  completionIsCurrentlyVisible,
  markUnreadCompletion,
  resolveUnreadCompletionForTurn
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
const pendingThreadIds = new Set<string>()
const pendingDeletedThreadIds = new Set<string>()
let pendingLegacyScan = false
let pendingSchedule = false
let pendingScheduleStatus: ScheduleRuntimeStatus | undefined

type SyncOptions = {
threadIds?: string[]
deletedThreadIds?: string[]
includeSchedule?: boolean
scheduleStatus?: ScheduleRuntimeStatus
}

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

function scheduledActivitiesEqual(
  left: Record<string, ScheduledThreadActivity>,
  right: Record<string, ScheduledThreadActivity>
): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => {
    const a = left[key]
    const b = right[key]
    return Boolean(b) && a.state === b.state && a.taskCount === b.taskCount &&
      a.nextRunAt === b.nextRunAt && a.queued === b.queued
  })
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

async function loadTargetThreads(ids: string[], state: ChatState): Promise<NormalizedThread[]> {
  const provider = getProvider()
  const local = new Map(state.threads.map((thread) => [thread.id, thread]))
  const summaries = await Promise.all(ids.map(async (id) => {
    if (typeof provider.getThreadSummary === 'function') {
      return provider.getThreadSummary(id)
    }
    return local.get(id) ?? null
  }))
  const available = summaries.filter((thread): thread is NormalizedThread => thread !== null)
  const knownIds = new Set(state.threads.map((thread) => thread.id))
  const known = available.filter((thread) => knownIds.has(thread.id))
  const unknown = available.filter((thread) => !knownIds.has(thread.id))
  return [...known, ...await filterThreadsForSidebar(unknown, provider)]
}

async function runSync(
  set: ChatStoreSet,
  get: ChatStoreGet,
  generation: number,
  options: SyncOptions
): Promise<void> {
  if (get().runtimeConnection !== 'ready') return
  const provider = getProvider()
  const targeted = options.threadIds !== undefined || options.deletedThreadIds !== undefined ||
    options.scheduleStatus !== undefined
  const recentThreads = targeted
    ? await loadTargetThreads([...new Set(options.threadIds ?? [])], get())
    : await loadRecentThreads()
  const scheduleStatus = options.scheduleStatus ?? (
    options.includeSchedule !== false && typeof window.kunGui?.getScheduleStatus === 'function'
      ? await window.kunGui.getScheduleStatus().catch(() => null)
      : null
  )
  if (generation !== syncGeneration || get().runtimeConnection !== 'ready') return

  const checkpoints = readSidebarActivityCheckpoints()
  const baselineEstablished = checkpoints.initialized
  const stateAtStart = get()
  const localById = new Map(stateAtStart.threads.map((thread) => [thread.id, thread]))
  const candidateSet = new Set(options.threadIds ?? [])
  const candidates = recentThreads.filter((thread) => {
    if (targeted) return candidateSet.has(thread.id)
    const local = localById.get(thread.id)
    return !local || threadLooksRunning(thread) ||
      stateAtStart.watchTurnCompletion[thread.id] === true ||
      stateAtStart.awaitingUserInputThreadIds[thread.id] === true ||
      (baselineEstablished && checkpointChanged(checkpoints.threads[thread.id]?.checkpoint, thread))
  })
  const runtimeStates = new Map<string, Awaited<ReturnType<typeof provider.getThreadState>>>()
  const missingRuntimeStateIds = new Set<string>()
  const candidateIds = new Set(candidates.map((thread) => thread.id))
  if (candidates.length > 0) {
    const results = await loadThreadStates(provider, candidates.map((thread) => thread.id))
    for (const result of results) {
      if (result.ok) runtimeStates.set(result.id, result.state)
      else if (result.error.code === 'not_found') missingRuntimeStateIds.add(result.id)
    }
  }
  if (generation !== syncGeneration) return

  const checkpointUpdatedAt = Date.now()
  const nextCheckpoints: SidebarActivityCheckpoints = {
    initialized: true,
    threads: { ...checkpoints.threads },
    scheduleRuns: { ...checkpoints.scheduleRuns }
  }
  for (const thread of recentThreads) {
    if (
      candidateIds.has(thread.id) &&
      !runtimeStates.has(thread.id)
    ) continue
    nextCheckpoints.threads[thread.id] = {
      checkpoint: checkpointForThread(thread),
      updatedAt: checkpointUpdatedAt
    }
  }
  const boundTasks = scheduleStatus?.boundThreadTasks ?? []
  for (const task of boundTasks) {
    const key = scheduleRunKey(task)
    if (key) {
      nextCheckpoints.scheduleRuns[task.taskId] = { checkpoint: key, updatedAt: checkpointUpdatedAt }
    }
  }

  const directlyVisibleUnknownThreads = recentThreads.filter((thread) =>
    !localById.has(thread.id) &&
    thread.relation !== 'side' &&
    !shouldHideThreadFromSidebarByTitle(thread) &&
    (!shouldInspectThreadForSidebarVisibility(thread) || targeted)
  )
  set((state) => {
    const recentById = new Map(recentThreads.map((thread) => [thread.id, thread]))
    const knownIds = new Set(state.threads.map((thread) => thread.id))
    let unreadThreadIds = state.unreadThreadIds
    let watchTurnCompletion = state.watchTurnCompletion
    let awaitingUserInputThreadIds = state.awaitingUserInputThreadIds
    const setWatched = (id: string): void => {
      if (watchTurnCompletion[id] === true) return
      watchTurnCompletion = { ...watchTurnCompletion, [id]: true }
    }
    const clearWatched = (id: string): void => {
      if (watchTurnCompletion[id] !== true) return
      const next = { ...watchTurnCompletion }
      delete next[id]
      watchTurnCompletion = next
    }
    let threadsChanged = false
    const deletedIds = new Set(options.deletedThreadIds ?? [])
    let threads = state.threads.filter((thread) => !deletedIds.has(thread.id)).map((thread) => {
      const summary = recentById.get(thread.id)
      const runtimeState = runtimeStates.get(thread.id)
      if (!summary) return thread
      if (
        typeof thread.latestSeq === 'number' &&
        typeof summary.latestSeq === 'number' &&
        thread.latestSeq > summary.latestSeq
      ) return thread
      const changed = baselineEstablished && checkpointChanged(
        checkpoints.threads[thread.id]?.checkpoint,
        summary
      )
      const running = runtimeState ? threadLooksRunning(runtimeState) : threadLooksRunning(summary)
      const latestTurnStatus = runtimeState?.latestTurnStatus
      if (running && thread.id !== state.activeThreadId && watchTurnCompletion[thread.id] !== true) {
        setWatched(thread.id)
        watchTurnCompletionNotification(
          thread.id,
          Date.now(),
          turnCompleteNotificationSource(thread.id, state)
        )
      }
      if (!running && runtimeState && changed) {
        clearWatched(thread.id)
        clearWatchedCompletionNotification(thread.id)
        const outcome = completionOutcomeForTurnStatus(latestTurnStatus)
        if (outcome) {
          unreadThreadIds = resolveUnreadCompletionForTurn(
            unreadThreadIds,
            state,
            thread.id,
            runtimeState.latestTurnId,
            outcome
          )
        }
      }
      const updatedAt = summary.updatedAt
      const latestSeq = typeof summary.latestSeq === 'number'
        ? summary.latestSeq
        : thread.latestSeq
      const status = thread.archived ? thread.status : running ? 'running' : 'idle'
      const latestTurnId = runtimeState?.latestTurnId ?? thread.latestTurnId
      const nextLatestTurnStatus = latestTurnStatus ?? thread.latestTurnStatus
      if (
        thread.updatedAt === updatedAt &&
        thread.latestSeq === latestSeq &&
        thread.status === status &&
        thread.latestTurnId === latestTurnId &&
        thread.latestTurnStatus === nextLatestTurnStatus
      ) return thread
      threadsChanged = true
      return {
        ...thread,
        updatedAt,
        ...(typeof latestSeq === 'number' ? { latestSeq } : {}),
        status,
        ...(latestTurnId ? { latestTurnId } : {}),
        ...(nextLatestTurnStatus ? { latestTurnStatus: nextLatestTurnStatus } : {})
      }
    })
    if (threads.length !== state.threads.length) threadsChanged = true
    for (const summary of directlyVisibleUnknownThreads) {
      if (threads.some((thread) => thread.id === summary.id)) continue
      const runtimeState = runtimeStates.get(summary.id)
      const running = runtimeState ? threadLooksRunning(runtimeState) : threadLooksRunning(summary)
      threads.push({
        ...summary,
        status: summary.archived ? summary.status : running ? 'running' : 'idle',
        ...(runtimeState?.latestTurnId ? { latestTurnId: runtimeState.latestTurnId } : {}),
        ...(runtimeState?.latestTurnStatus ? { latestTurnStatus: runtimeState.latestTurnStatus } : {})
      })
      threadsChanged = true
    }
    if (threadsChanged) {
      threads = [...threads].sort((left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.id.localeCompare(right.id))
    }

    for (const id of deletedIds) {
      clearWatched(id)
      if (awaitingUserInputThreadIds[id]) {
        const next = { ...awaitingUserInputThreadIds }
        delete next[id]
        awaitingUserInputThreadIds = next
      }
      if (unreadThreadIds[id]) {
        const next = { ...unreadThreadIds }
        delete next[id]
        unreadThreadIds = next
      }
    }

    for (const [id, runtimeState] of runtimeStates) {
      if (runtimeState.pendingUserInputIds === undefined) continue
      const awaiting = runtimeState.pendingUserInputIds.length > 0
      if (awaiting === (awaitingUserInputThreadIds[id] === true)) continue
      const next = { ...awaitingUserInputThreadIds }
      if (awaiting) next[id] = true
      else delete next[id]
      awaitingUserInputThreadIds = next
    }
    for (const id of missingRuntimeStateIds) {
      clearWatched(id)
      if (awaitingUserInputThreadIds[id]) {
        const next = { ...awaitingUserInputThreadIds }
        delete next[id]
        awaitingUserInputThreadIds = next
      }
      if (unreadThreadIds[id]) {
        const next = { ...unreadThreadIds }
        delete next[id]
        unreadThreadIds = next
      }
    }

    for (const task of boundTasks) {
      if (!knownIds.has(task.threadId)) continue
      const key = scheduleRunKey(task)
      if (!baselineEstablished || !key || checkpoints.scheduleRuns[task.taskId]?.checkpoint === key) continue
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
      setWatched(id)
      watchTurnCompletionNotification(id, Date.now(), turnCompleteNotificationSource(id, state))
    }
    const nextScheduledActivities = scheduleStatus
      ? scheduledThreadActivities(boundTasks)
      : state.scheduledThreadActivities
    const stableScheduledActivities = scheduledActivitiesEqual(
      state.scheduledThreadActivities,
      nextScheduledActivities
    )
      ? state.scheduledThreadActivities
      : nextScheduledActivities
    const stableThreads = threadsChanged ? threads : state.threads
    if (
      stableThreads === state.threads &&
      watchTurnCompletion === state.watchTurnCompletion &&
      unreadThreadIds === state.unreadThreadIds &&
      awaitingUserInputThreadIds === state.awaitingUserInputThreadIds &&
      stableScheduledActivities === state.scheduledThreadActivities
    ) return state
    return {
      threads: stableThreads,
      watchTurnCompletion,
      unreadThreadIds,
      awaitingUserInputThreadIds,
      scheduledThreadActivities: stableScheduledActivities
    }
  })

  const deletedActiveThread = options.deletedThreadIds?.includes(get().activeThreadId ?? '') === true
  persistSidebarActivityCheckpoints(nextCheckpoints)
  syncTurnCompletionPoll(set, get)
  if (deletedActiveThread) get().clearActiveThreadSelection()
}

export function createSidebarActivityActions(
  set: ChatStoreSet,
  get: ChatStoreGet
): Pick<ChatState, 'syncSidebarActivity'> {
  return {
    syncSidebarActivity: async (options = {}) => {
      for (const id of options.threadIds ?? []) pendingThreadIds.add(id)
      for (const id of options.deletedThreadIds ?? []) pendingDeletedThreadIds.add(id)
      if (!options.threadIds && !options.deletedThreadIds && !options.scheduleStatus) {
        pendingLegacyScan = true
      }
      if (options.scheduleStatus) pendingScheduleStatus = options.scheduleStatus
      if (options.includeSchedule !== false || options.scheduleStatus) pendingSchedule = true
      if (inFlight) return inFlight

      const task = (async (): Promise<boolean> => {
        let ok = true
        while (
          pendingLegacyScan || pendingSchedule ||
          pendingThreadIds.size > 0 || pendingDeletedThreadIds.size > 0
        ) {
          const deletedThreadIds = [...pendingDeletedThreadIds]
          const syncOptions: SyncOptions = {
            ...(pendingLegacyScan ? {} : { threadIds: [...pendingThreadIds] }),
            ...(deletedThreadIds.length > 0 ? { deletedThreadIds } : {}),
            includeSchedule: pendingSchedule,
            ...(pendingScheduleStatus ? { scheduleStatus: pendingScheduleStatus } : {})
          }
          pendingLegacyScan = false
          pendingSchedule = false
          pendingScheduleStatus = undefined
          pendingThreadIds.clear()
          pendingDeletedThreadIds.clear()
          const generation = ++syncGeneration
          try {
            await runSync(set, get, generation, syncOptions)
          } catch (error) {
            ok = false
            void window.kunGui?.logError?.(
              'sidebar-activity',
              'Failed to reconcile sidebar activity',
              { message: error instanceof Error ? error.message : String(error) }
            ).catch(() => undefined)
          }
        }
        return ok
      })()
      const flight = task.finally(() => {
        if (inFlight === flight) inFlight = null
      })
      inFlight = flight
      return flight
    }
  }
}

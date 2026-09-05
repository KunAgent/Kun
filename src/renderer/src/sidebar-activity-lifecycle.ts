import { KUN_THREAD_ACTIVITY_EVENTS_PATH } from '@shared/kun-endpoints'
import { rendererRuntimeClient } from './agent/runtime-client'
import type { ChatState } from './store/chat-store-types'
import { recordSidebarActivityDuration, recordSidebarActivityMetric } from './sidebar-activity-metrics'

type ActivityChange = {
  threadId: string
  kind: 'created' | 'metadata' | 'runtime' | 'deleted'
}

type ActivityResponse =
  | { type: 'activity'; cursor: string; changes: ActivityChange[] }
  | { type: 'reset_required'; cursor: string; reason: string }

type StoreLike = {
  getState(): ChatState
  subscribe(listener: (state: ChatState) => void): () => void
}

const ACTIVE_DELAYS = [5_000, 15_000, 30_000] as const
const LEGACY_SCAN_MS = 30_000
const ATTENTION_COALESCE_MS = 150

export function installSidebarActivityLifecycle(store: StoreLike): () => void {
  let disposed = false
  let cursor = ''
  let observerState: 'healthy' | 'degraded' | 'unsupported' = 'degraded'
  let idleStep = 0
  let legacyTimer: number | undefined
  let attentionTimer: number | undefined
  let lastLegacyScanAt = 0
  let pendingReset = false
  let pendingResetCursor = ''
  const pendingChanges = new Map<string, ActivityChange>()
  const observerAbort = new AbortController()

  const ready = (): boolean => {
    const state = store.getState()
    return state.runtimeConnection === 'ready' && state.threadListStatus === 'ready'
  }
  const hasActiveWork = (): boolean => {
    const state = store.getState()
    return state.threads.some((thread) => thread.status === 'running') ||
      Object.keys(state.watchTurnCompletion).length > 0 ||
      Object.values(state.scheduledThreadActivities).some((activity) => activity.state === 'running')
  }
  const runTargeted = async (changes: ActivityChange[]): Promise<boolean> => {
    if (!ready()) {
      for (const change of changes) pendingChanges.set(change.threadId, change)
      return true
    }
    const started = performance.now()
    recordSidebarActivityMetric('syncRequested')
    const deletedThreadIds = changes.filter((change) => change.kind === 'deleted').map((change) => change.threadId)
    const threadIds = changes.filter((change) => change.kind !== 'deleted').map((change) => change.threadId)
    if (threadIds.length > 0) recordSidebarActivityMetric('stateBatchRequests')
    const ok = await store.getState().syncSidebarActivity({
      threadIds,
      deletedThreadIds,
      includeSchedule: false
    })
    recordSidebarActivityMetric('syncExecuted')
    recordSidebarActivityDuration(performance.now() - started)
    return ok
  }
  const observe = async (): Promise<void> => {
    while (!disposed && !observerAbort.signal.aborted) {
      try {
        const query = new URLSearchParams({ wait_ms: '25000' })
        if (cursor) query.set('cursor', cursor)
        const response = await rendererRuntimeClient.runtimeRequest(
          `${KUN_THREAD_ACTIVITY_EVENTS_PATH}?${query.toString()}`,
          'GET'
        )
        if (!response.ok) {
          observerState = response.status === 404 ? 'unsupported' : 'degraded'
          await delay(observerState === 'unsupported' ? 30_000 : 5_000, observerAbort.signal)
          continue
        }
        const payload = JSON.parse(response.body) as ActivityResponse
        observerState = 'healthy'
        idleStep = 0
        if (payload.type === 'reset_required') {
          if (ready()) {
            recordSidebarActivityMetric('fullRefreshes')
            await store.getState().refreshThreads()
            if (store.getState().threadListStatus === 'ready') cursor = payload.cursor
            else {
              pendingReset = true
              pendingResetCursor = payload.cursor
            }
          } else {
            pendingReset = true
            pendingResetCursor = payload.cursor
          }
          continue
        }
        if (payload.changes.length > 0) {
          recordSidebarActivityMetric('pushEvents', payload.changes.length)
          recordSidebarActivityMetric('coalescedEvents', Math.max(0,
            payload.changes.length - new Set(payload.changes.map((change) => change.threadId)).size))
          if (await runTargeted(payload.changes)) cursor = payload.cursor
          else observerState = 'degraded'
        } else {
          cursor = payload.cursor
        }
      } catch {
        if (disposed || observerAbort.signal.aborted) return
        observerState = 'degraded'
        await delay(5_000, observerAbort.signal)
      }
    }
  }
  const scheduleLegacy = (): void => {
    if (disposed) return
    if (legacyTimer !== undefined) window.clearTimeout(legacyTimer)
    const active = hasActiveWork()
    if (document.visibilityState !== 'visible' && !active) return
    const delayMs = active ? ACTIVE_DELAYS[Math.min(idleStep, ACTIVE_DELAYS.length - 1)] : LEGACY_SCAN_MS
    legacyTimer = window.setTimeout(() => { void runLegacy() }, delayMs)
  }
  const runLegacy = async (): Promise<void> => {
    if (observerState === 'healthy' || !ready()) {
      scheduleLegacy()
      return
    }
    const active = hasActiveWork()
    const now = Date.now()
    const shouldScan = document.visibilityState === 'visible' && now - lastLegacyScanAt >= LEGACY_SCAN_MS
    const threadIds = active
      ? store.getState().threads
        .filter((thread) => thread.status === 'running' || store.getState().watchTurnCompletion[thread.id])
        .map((thread) => thread.id)
      : []
    if (threadIds.length === 0 && !shouldScan) {
      scheduleLegacy()
      return
    }
    const before = store.getState().threads
    if (shouldScan) {
      lastLegacyScanAt = now
      recordSidebarActivityMetric('legacyDiscoveryScans')
    }
    const ok = await store.getState().syncSidebarActivity(
      shouldScan ? { includeSchedule: true } : { threadIds, includeSchedule: true }
    )
    idleStep = ok && store.getState().threads === before ? Math.min(idleStep + 1, 2) : 0
    scheduleLegacy()
  }
  const reconcileAttention = (): void => {
    if (attentionTimer !== undefined) window.clearTimeout(attentionTimer)
    attentionTimer = window.setTimeout(() => {
      if (observerState !== 'healthy') void runLegacy()
    }, ATTENTION_COALESCE_MS)
  }
  const unsubscribe = store.subscribe(() => {
    if (ready()) {
      if (pendingReset) {
        pendingReset = false
        recordSidebarActivityMetric('fullRefreshes')
        void store.getState().refreshThreads().then(() => {
          if (store.getState().threadListStatus === 'ready') cursor = pendingResetCursor
        })
      } else if (pendingChanges.size > 0) {
        const changes = [...pendingChanges.values()]
        pendingChanges.clear()
        void runTargeted(changes)
      }
    }
    if (observerState !== 'healthy') scheduleLegacy()
  })
  const offSchedule = typeof window.kunGui?.onScheduleStatusChanged === 'function'
    ? window.kunGui.onScheduleStatusChanged((scheduleStatus) => {
        void store.getState().syncSidebarActivity({ scheduleStatus, includeSchedule: false })
      })
    : () => undefined
  void window.kunGui?.getScheduleStatus?.().then((scheduleStatus) =>
    store.getState().syncSidebarActivity({ scheduleStatus, includeSchedule: false })
  ).catch(() => undefined)
  window.addEventListener('focus', reconcileAttention)
  document.addEventListener('visibilitychange', reconcileAttention)
  void observe()
  scheduleLegacy()
  return () => {
    disposed = true
    observerAbort.abort()
    offSchedule()
    unsubscribe()
    if (legacyTimer !== undefined) window.clearTimeout(legacyTimer)
    if (attentionTimer !== undefined) window.clearTimeout(attentionTimer)
    window.removeEventListener('focus', reconcileAttention)
    document.removeEventListener('visibilitychange', reconcileAttention)
  }
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })
}

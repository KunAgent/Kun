import { create } from 'zustand'
import type {
  ActivityChange,
  ActivityPollResponse,
  ActivityRow,
  ActivitySnapshotResponse
} from '@shared/activity-row'
import { getProvider } from '../agent/registry'

/**
 * Renderer-side execution-unit activity feed (docs/ade/06 §9): one shared
 * zustand slice fed by snapshot + long-poll against /v1/activity. The feed
 * keeps every desktop view on the same rows the phone and TUI see.
 */
export type ActivityFeedStatus = 'idle' | 'connecting' | 'live' | 'error'

export type ActivityFeedState = {
  rows: Record<string, ActivityRow>
  cursor: string | null
  status: ActivityFeedStatus
}

export const useActivityStore = create<ActivityFeedState>(() => ({
  rows: {},
  cursor: null,
  status: 'idle'
}))

export const ACTIVITY_POLL_WAIT_MS = 25_000
export const ACTIVITY_HIDDEN_INTERVAL_MS = 60_000
const ERROR_BACKOFF_START_MS = 1_000
const ERROR_BACKOFF_MAX_MS = 30_000

export type ActivityFeedDeps = {
  snapshot(): Promise<ActivitySnapshotResponse>
  poll(cursor: string, waitMs: number, signal: AbortSignal): Promise<ActivityPollResponse>
  isHidden(): boolean
  sleep(ms: number): Promise<void>
}

function defaultDeps(): ActivityFeedDeps {
  return {
    snapshot: () => {
      const provider = getProvider()
      if (!provider.getActivitySnapshot) return Promise.reject(new Error('activity unsupported'))
      return provider.getActivitySnapshot()
    },
    poll: (cursor, waitMs, signal) => {
      const provider = getProvider()
      if (!provider.pollActivity) return Promise.reject(new Error('activity unsupported'))
      return provider.pollActivity(cursor, waitMs, signal)
    },
    isHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  }
}

let feedGeneration = 0
let feedAbort: AbortController | null = null

/** Idempotent: restarting bumps the generation so stale loops stop writing. */
export function startActivityFeed(deps: ActivityFeedDeps = defaultDeps()): void {
  feedGeneration += 1
  feedAbort?.abort()
  const abort = new AbortController()
  feedAbort = abort
  void runFeed(feedGeneration, deps, abort.signal)
}

export function stopActivityFeed(): void {
  feedGeneration += 1
  feedAbort?.abort()
  feedAbort = null
  // Rows are feed-owned state: dropping them releases the needs-you badge and
  // hands every tracked thread back to the ordinary notification path.
  useActivityStore.setState({ rows: {}, cursor: null, status: 'idle' })
}

/**
 * True when the live feed tracks this thread (workers and task-workspace
 * threads always have rows; plain one-on-one ADE threads do once bound).
 * Callers use it to defer legacy notifications to the activity notifier; a
 * stopped or not-yet-connected feed does not suppress them.
 */
export function activityFeedCoversThread(threadId: string | null | undefined): boolean {
  const id = threadId?.trim()
  if (!id) return false
  const state = useActivityStore.getState()
  if (state.status !== 'live') return false
  return Object.values(state.rows).some((row) => row.threadId === id)
}

function applyChanges(changes: ActivityChange[]): void {
  if (changes.length === 0) return
  useActivityStore.setState((state) => {
    const rows = { ...state.rows }
    for (const change of changes) {
      if (change.removed) {
        delete rows[change.unitId]
      } else if (change.row) {
        rows[change.unitId] = change.row
      }
    }
    return { rows }
  })
}

async function runFeed(
  generation: number,
  deps: ActivityFeedDeps,
  signal: AbortSignal
): Promise<void> {
  let backoff = ERROR_BACKOFF_START_MS
  while (generation === feedGeneration && !signal.aborted) {
    try {
      if (!useActivityStore.getState().cursor) {
        useActivityStore.setState({ status: 'connecting' })
        const snapshot = await deps.snapshot()
        if (generation !== feedGeneration || signal.aborted) return
        const rows: Record<string, ActivityRow> = {}
        for (const row of snapshot.rows) rows[row.unitId] = row
        useActivityStore.setState({ rows, cursor: snapshot.cursor, status: 'live' })
        backoff = ERROR_BACKOFF_START_MS
        continue
      }
      const hidden = deps.isHidden()
      const result = await deps.poll(
        useActivityStore.getState().cursor ?? '',
        hidden ? 0 : ACTIVITY_POLL_WAIT_MS,
        signal
      )
      if (generation !== feedGeneration || signal.aborted) return
      if (result.type === 'reset_required') {
        // Cursor epoch moved or expired: replace all rows from a fresh
        // snapshot on the next iteration.
        useActivityStore.setState({ cursor: null })
        continue
      }
      applyChanges(result.changes)
      useActivityStore.setState({ cursor: result.cursor, status: 'live' })
      backoff = ERROR_BACKOFF_START_MS
      if (hidden) await deps.sleep(ACTIVITY_HIDDEN_INTERVAL_MS)
    } catch {
      if (generation !== feedGeneration || signal.aborted) return
      useActivityStore.setState({ status: 'error' })
      await deps.sleep(backoff)
      backoff = Math.min(backoff * 2, ERROR_BACKOFF_MAX_MS)
    }
  }
}

import type { ActivityRow } from '@shared/activity-row'
import { displayBucket } from '@shared/activity-display'

/**
 * Overall execution state of one thread's background work.
 *
 * `completed` requires every child to have settled, including its review
 * verdict. A finished reply, an empty child list, or a sibling child's success
 * is never enough on its own.
 */
export type SessionExecutionKind =
  | 'none'
  | 'running'
  | 'starting'
  | 'continuing'
  | 'waiting-user'
  | 'review'
  | 'failed'
  | 'completed'
  | 'unknown'

export type SessionExecutionCounts = {
  /** Children executing right now. */
  running: number
  /** Children accepted by the runtime but not executing yet. */
  starting: number
  /** Children blocked on an approval, question, or user input. */
  waiting: number
  /** Finished children whose review verdict is still open. */
  review: number
  failed: number
  completed: number
  /** Rows restored after a restart whose state the runtime has not confirmed. */
  unconfirmed: number
}

export type SessionExecutionSummary = {
  kind: SessionExecutionKind
  counts: SessionExecutionCounts
  /** Children that still need runtime or user action. */
  unfinished: number
  total: number
  /** Row the user should look at first (waiting, then failed, then running). */
  focusUnitId?: string
  /** Title of the most relevant live child, used as the current activity label. */
  activityTitle?: string
  /** Newest update among the contributing rows. */
  lastUpdatedAt?: string
}

const ZERO_COUNTS: SessionExecutionCounts = {
  running: 0,
  starting: 0,
  waiting: 0,
  review: 0,
  failed: 0,
  completed: 0,
  unconfirmed: 0
}

const BACKGROUND_KINDS: ReadonlySet<ActivityRow['kind']> = new Set([
  'worker',
  'side-chat',
  'graph-attempt',
  'terminal-agent'
])

function isRowFailed(row: ActivityRow): boolean {
  return row.state === 'failed' || row.lastOutcome === 'failed'
}

/**
 * Counts and classifies the background rows of a single thread.
 *
 * Buckets come from the shared `displayBucket` rule so this summary cannot
 * disagree with the Workers panel. Raw `state` splits the two buckets that
 * collapse distinct facts: `working` covers starting children, and
 * `needs-you` covers both waiting and failed ones.
 *
 * An empty result means "nothing to show", never "the task finished": the
 * caller decides whether the thread has any background work at all.
 */
export function selectSessionExecutionSummary(
  rows: readonly ActivityRow[],
  options: { now?: number; feedError?: boolean; mainRunning?: boolean } = {}
): SessionExecutionSummary {
  const now = options.now ?? Date.now()
  const counts: SessionExecutionCounts = { ...ZERO_COUNTS }
  let focusUnitId: string | undefined
  let activityTitle: string | undefined
  let activityAt = 0
  let lastUpdatedAt: string | undefined
  let lastUpdatedMs = 0

  const consider = (row: ActivityRow): void => {
    const updated = Date.parse(row.updatedAt)
    if (Number.isFinite(updated)) {
      if (updated > lastUpdatedMs) {
        lastUpdatedMs = updated
        lastUpdatedAt = row.updatedAt
      }
      if (updated > activityAt) {
        activityAt = updated
        activityTitle = row.title.trim() || row.progressNote?.trim() || undefined
      }
    }
    if (!focusUnitId) focusUnitId = row.unitId
  }

  for (const row of rows) {
    if (row.visibility === 'archived') continue
    // Restored facts await confirmation, so they must not drive a live spinner.
    if (row.restoredUnconfirmed) {
      counts.unconfirmed += 1
      continue
    }
    const bucket = displayBucket(row, now)
    if (bucket === 'idle') continue
    if (bucket === 'working') {
      if (row.state === 'initializing') counts.starting += 1
      else counts.running += 1
      consider(row)
      continue
    }
    if (bucket === 'needs-you') {
      if (isRowFailed(row)) counts.failed += 1
      else counts.waiting += 1
      consider(row)
      continue
    }
    if (bucket === 'review') counts.review += 1
    else counts.completed += 1
    consider(row)
  }

  const total =
    counts.running +
    counts.starting +
    counts.waiting +
    counts.review +
    counts.failed +
    counts.completed +
    counts.unconfirmed

  if (total === 0) {
    return { kind: 'none', counts, unfinished: 0, total: 0 }
  }

  // A stale feed can only report what was last confirmed; it must never claim
  // live progress or completion.
  if (options.feedError || (counts.unconfirmed > 0 && total === counts.unconfirmed)) {
    return {
      kind: 'unknown',
      counts,
      unfinished: counts.running + counts.starting + counts.waiting + counts.review,
      total: total - counts.unconfirmed,
      ...(focusUnitId ? { focusUnitId } : {}),
      ...(lastUpdatedAt ? { lastUpdatedAt } : {}),
      ...(activityTitle ? { activityTitle } : {})
    }
  }

  const unfinished = counts.running + counts.starting + counts.waiting + counts.review + counts.failed
  let kind: SessionExecutionKind
  if (counts.waiting > 0) kind = 'waiting-user'
  else if (counts.failed > 0) kind = 'failed'
  else if (counts.review > 0) kind = 'review'
  else if (counts.running > 0) kind = 'running'
  else if (counts.starting > 0) kind = 'starting'
  else if (options.mainRunning) kind = 'continuing'
  else kind = 'completed'

  return {
    kind,
    counts,
    unfinished,
    total,
    ...(focusUnitId ? { focusUnitId } : {}),
    ...(activityTitle ? { activityTitle } : {}),
    ...(lastUpdatedAt ? { lastUpdatedAt } : {})
  }
}

export type BackgroundThreadActivity = 'running' | 'waiting'

/**
 * Per-parent-thread background activity for the conversation list, derived from
 * the same rows and rules as the composer summary. Threads with only finished
 * background work are absent: their result already reaches the list through the
 * ordinary completion attention path.
 */
export function selectBackgroundActivityByThread(
  rows: Record<string, ActivityRow>,
  now: number = Date.now()
): Record<string, BackgroundThreadActivity> {
  const grouped = new Map<string, ActivityRow[]>()
  for (const row of Object.values(rows)) {
    if (row.visibility === 'archived') continue
    if (!BACKGROUND_KINDS.has(row.kind)) continue
    const parent = row.parentThreadId?.trim()
    if (!parent) continue
    const list = grouped.get(parent)
    if (list) list.push(row)
    else grouped.set(parent, [row])
  }

  const activity: Record<string, BackgroundThreadActivity> = {}
  for (const [threadId, list] of grouped) {
    const summary = selectSessionExecutionSummary(list, { now })
    if (summary.kind === 'waiting-user') activity[threadId] = 'waiting'
    else if (
      summary.kind === 'running' ||
      summary.kind === 'starting' ||
      summary.kind === 'continuing'
    ) {
      activity[threadId] = 'running'
    }
  }
  return activity
}

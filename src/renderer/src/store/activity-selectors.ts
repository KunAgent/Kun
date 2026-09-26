import type { ActivityRow } from '@shared/activity-row'
import { displayBucket, type ActivityDisplayBucket } from '@shared/activity-display'

export type ActivityBuckets = Record<ActivityDisplayBucket, ActivityRow[]>

function sortRows(rows: ActivityRow[]): ActivityRow[] {
  return [...rows].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  })
}

/** Group visible rows into the display buckets shared across clients. */
export function selectBuckets(
  rows: Record<string, ActivityRow>,
  now: number = Date.now()
): ActivityBuckets {
  const buckets: ActivityBuckets = {
    'needs-you': [],
    working: [],
    review: [],
    done: [],
    idle: []
  }
  for (const row of Object.values(rows)) {
    if (row.visibility === 'archived') continue
    buckets[displayBucket(row, now)].push(row)
  }
  for (const key of Object.keys(buckets) as ActivityDisplayBucket[]) {
    buckets[key] = sortRows(buckets[key])
  }
  return buckets
}

export function selectNeedsYouCount(
  rows: Record<string, ActivityRow>,
  now: number = Date.now()
): number {
  return Object.values(rows).filter(
    (row) => row.visibility !== 'archived' && displayBucket(row, now) === 'needs-you'
  ).length
}

export function selectRowsForParent(
  rows: Record<string, ActivityRow>,
  parentThreadId: string
): ActivityRow[] {
  return sortRows(
    Object.values(rows).filter((row) => row.parentThreadId === parentThreadId)
  )
}

/**
 * ADE workers only (12 §6.1): side-chat and graph-attempt children also set
 * `parentThreadId`, so the Workers pill/panel must filter by `kind`.
 */
export function selectWorkerRowsForParent(
  rows: Record<string, ActivityRow>,
  parentThreadId: string
): ActivityRow[] {
  return sortRows(
    Object.values(rows).filter(
      (row) => row.parentThreadId === parentThreadId && row.kind === 'worker'
    )
  )
}

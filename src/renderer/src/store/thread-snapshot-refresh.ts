import type { NormalizedThread } from '../agent/types'
import type { ThreadSnapshot } from './thread-snapshot-cache'

export const THREAD_SNAPSHOT_MAX_REPLAY_EVENTS = 128
export const THREAD_SNAPSHOT_FRESH_MS = 5_000

/** Large gaps are cheaper to replace from the cumulative server projection. */
export function threadSnapshotNeedsRefresh(thread: NormalizedThread, snapshot: ThreadSnapshot): boolean {
  if (!snapshot.busy) return false
  const gap = Math.max(0, (thread.latestSeq ?? snapshot.lastSeq) - snapshot.lastSeq)
  return gap > THREAD_SNAPSHOT_MAX_REPLAY_EVENTS ||
    (snapshot.capturedAt !== undefined && Date.now() - snapshot.capturedAt > THREAD_SNAPSHOT_FRESH_MS)
}

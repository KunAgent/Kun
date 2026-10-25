/**
 * A thread created this instant has no history, so its first selection needs
 * no timeline round trip. Seeding an empty page into the selection cache lets
 * selectThread take its cached path (no timeline or queued-turn requests) and
 * enable the composer at once; the live stream subscribes from sequence 0.
 */
import type { NormalizedThread, ThreadDetail } from '../agent/types'
import { buildPrefetchedThreadSnapshot, cacheThreadSnapshot } from './thread-snapshot-cache'

export function emptyThreadDetail(): ThreadDetail {
  return { blocks: [], latestSeq: 0, activeTurn: null, hasMoreHistory: false }
}

export function seedEmptyThreadSnapshot(thread: NormalizedThread): boolean {
  const snapshot = buildPrefetchedThreadSnapshot(thread, emptyThreadDetail())
  return snapshot ? cacheThreadSnapshot(snapshot) : false
}

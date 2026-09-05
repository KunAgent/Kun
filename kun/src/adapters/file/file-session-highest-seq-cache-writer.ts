import type { HighestSeqCacheEntry } from './file-session-cursor-checkpoint.js'
import { updateHighestSeqCache } from './file-session-cursor-checkpoint.js'

export const HIGHEST_SEQ_CACHE_MAX_THREADS = 256

/**
 * Binds the shared highest-seq cache updater to one store instance's cache
 * map so call sites stay terse on the streaming hot path.
 */
export function makeHighestSeqCacheWriter(
  cache: Map<string, HighestSeqCacheEntry>
): (
  threadId: string,
  seq: number,
  info: { size: number; mtimeMs: number | null },
  options?: { preserveHigher?: boolean }
) => void {
  return (threadId, seq, info, options = {}) =>
    updateHighestSeqCache({
      cache,
      threadId,
      seq,
      info,
      maxThreads: HIGHEST_SEQ_CACHE_MAX_THREADS,
      ...(options.preserveHigher ? { preserveHigher: true } : {})
    })
}

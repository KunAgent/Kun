import { stat } from 'node:fs/promises'
import type { RuntimeEvent } from '../../contracts/events.js'
import type { JsonlFileAccessCoordinator } from './jsonl-file-access.js'
import { scanHighestSeqFromTail } from './file-session-seq-tail-scan.js'

type HighestSeqCacheEntry = { seq: number; size: number; mtimeMs: number | null }

/** Resolve a durable event high-water without materializing the event log. */
export async function loadFileSessionHighestSeq(input: {
  path: string
  fileAccess: JsonlFileAccessCoordinator
  cached: () => HighestSeqCacheEntry | undefined
  clearCached: () => void
  cache: (seq: number, info: { size: number; mtimeMs: number | null }) => void
  iterate: () => AsyncIterable<RuntimeEvent>
}): Promise<number> {
  const info = await stat(input.path).catch(() => null)
  if (!info) {
    input.clearCached()
    return 0
  }
  const cached = input.cached()
  if (cached && cached.size === info.size && (cached.mtimeMs === null || cached.mtimeMs === info.mtimeMs)) {
    input.cache(cached.seq, info)
    return cached.seq
  }
  const tail = await input.fileAccess.withRead(
    input.path,
    () => scanHighestSeqFromTail({ path: input.path, fileSize: info.size })
  )
  if (tail.ok) {
    input.cache(tail.highestSeq, info)
    return tail.highestSeq
  }
  let highest = 0
  for await (const event of input.iterate()) highest = Math.max(highest, event.seq)
  // Cache against the pre-scan stat. A concurrent append changes the next stat
  // and forces another scan rather than pairing an old sequence with new bytes.
  input.cache(highest, info)
  return highest
}

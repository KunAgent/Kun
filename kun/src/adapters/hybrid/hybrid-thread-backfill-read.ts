import type { ThreadRecord } from '../../contracts/threads.js'
import type { ThreadIndexRecord } from './hybrid-thread-index-mapping.js'

const READ_CONCURRENCY = 8

/** Batch-read metadata for backfill: single read per thread, bounded concurrency. */
export async function readMissingIndexRecords(
  ids: string[],
  readMetadata: (threadId: string) => Promise<ThreadRecord | null>,
  indexRecordForThread: (thread: ThreadRecord) => ThreadIndexRecord
): Promise<Array<ThreadIndexRecord | null>> {
  const records = new Array<ThreadIndexRecord | null>(ids.length)
  let nextIndex = 0
  const workers = Math.min(READ_CONCURRENCY, ids.length)
  await Promise.all(Array.from({ length: workers }, async () => {
    while (nextIndex < ids.length) {
      const index = nextIndex
      nextIndex += 1
      const threadId = ids[index]
      try {
        const thread = await readMetadata(threadId)
        records[index] = thread ? indexRecordForThread(thread) : null
      } catch {
        records[index] = null
      }
    }
  }))
  return records
}

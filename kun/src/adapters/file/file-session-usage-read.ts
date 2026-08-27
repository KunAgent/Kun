import { isSafeThreadId } from '../../contracts/thread-id.js'
import type {
  SessionLatestUsageSnapshot,
  SessionUsageQueryOptions,
  SessionUsageRecord
} from '../../ports/session-store.js'

const DEFAULT_THREAD_READ_CONCURRENCY = 6

type UsageIndexReader = {
  loadUsageRecords(threadId: string, options?: SessionUsageQueryOptions): Promise<SessionUsageRecord[]>
  loadLatestUsageSnapshot(threadId: string): Promise<SessionLatestUsageSnapshot | null>
}

/** Enumerate on-disk thread directories without hydrating any session. */
export async function listThreadDirs(threadsDir: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises')
  try {
    const entries = await readdir(threadsDir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && isSafeThreadId(entry.name))
      .map((entry) => entry.name)
      .sort()
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return []
    throw error
  }
}

/**
 * Indexed usage query served from per-thread deltas. Cross-thread reads are
 * bounded and run in input order batches; flattening by batch preserves the
 * historical stable thread ordering regardless of completion timing.
 */
export async function loadUsageRecordsFromIndex(
  usageIndex: UsageIndexReader,
  listThreadIds: () => Promise<string[]>,
  options: SessionUsageQueryOptions = {}
): Promise<SessionUsageRecord[]> {
  const threadId = options.threadId?.trim()
  if (threadId) {
    if (!isSafeThreadId(threadId)) return []
    return usageIndex.loadUsageRecords(threadId, options)
  }
  const threadIds = await listThreadIds()
  const results = await readInStableBatches(threadIds, async (id) => {
    try {
      return await usageIndex.loadUsageRecords(id, options)
    } catch (error) {
      warnUsageThreadFailure('loadUsageRecords', id, error)
      return []
    }
  })
  return results.flat()
}

export async function loadLatestUsageSnapshotsFromIndex(
  usageIndex: UsageIndexReader,
  listThreadIds: () => Promise<string[]>,
  options: { threadIds?: string[] } = {}
): Promise<SessionLatestUsageSnapshot[]> {
  const threadIds = options.threadIds?.map((id) => id.trim()).filter(Boolean) ?? []
  const targets = threadIds.length > 0 ? threadIds : await listThreadIds()
  const results = await readInStableBatches(targets, async (id) => {
    if (!isSafeThreadId(id)) return []
    try {
      const snapshot = await usageIndex.loadLatestUsageSnapshot(id)
      return snapshot ? [snapshot] : []
    } catch (error) {
      warnUsageThreadFailure('loadLatestUsageSnapshot', id, error)
      return []
    }
  })
  return results.flat()
}

async function readInStableBatches<T>(
  threadIds: string[],
  read: (threadId: string) => Promise<T[]>
): Promise<T[][]> {
  const results: T[][] = []
  for (let start = 0; start < threadIds.length; start += DEFAULT_THREAD_READ_CONCURRENCY) {
    const batch = threadIds.slice(start, start + DEFAULT_THREAD_READ_CONCURRENCY)
    results.push(...await Promise.all(batch.map(read)))
  }
  return results
}

function warnUsageThreadFailure(operation: string, threadId: string, error: unknown): void {
  const source = error as NodeJS.ErrnoException
  const code = source?.code ? ` (${source.code})` : ''
  const message = error instanceof Error ? error.message : String(error)
  console.warn(`[kun] ${operation} skipped unreadable thread ${threadId}${code}: ${message}`)
}

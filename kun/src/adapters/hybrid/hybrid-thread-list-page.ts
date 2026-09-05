import type { ThreadSummary } from '../../contracts/threads.js'
import type { ThreadIndexStatusInfo } from '../../contracts/thread-index-status.js'
import type { ThreadStoreListOptions, ThreadStoreListPage } from '../../ports/thread-store.js'
import type { ThreadRow } from './hybrid-thread-index-mapping.js'
import {
  applyThreadCursor,
  encodeThreadCursor,
  filterThreadSummaries
} from '../../domain/thread-list-query.js'
import { summaryFromRow } from './hybrid-thread-index-mapping.js'

/**
 * Internal access surface for keyset pagination. The HybridThreadStore keeps
 * its SQLite plumbing private; this module reaches it through a structural
 * assertion instead of widening the public API.
 */
export interface HybridThreadListPageSource {
  hasDb(): boolean
  isIndexReady(): boolean
  hasDirtyIndexThreads(): boolean
  queryThreadRows(options: ThreadStoreListOptions): ThreadRow[]
  rowHasReadableJsonl(row: ThreadRow): Promise<boolean>
  ensureRowAgentSurface(row: ThreadRow): Promise<ThreadRow>
  deleteIndexRow(threadId: string): void
  listFromFilesystem(): Promise<ThreadSummary[]>
  filesystemThreadIds(): Promise<string[]>
  readDeltaSummaries(ids: string[]): Promise<ThreadSummary[]>
  indexStatus(): ThreadIndexStatusInfo
  indexCount(options: ThreadStoreListOptions): number | undefined
  markSqliteDegraded(action: string, error: unknown): void
  markSqliteHealthy(): void
}

/** Hydrate readable index rows into summaries, dropping stale index rows. */
export async function summariesFromRows(
  store: unknown,
  rows: ThreadRow[]
): Promise<ThreadSummary[]> {
  const source = asSource(store)
  const summaries: ThreadSummary[] = []
  for (const row of rows) {
    if (await source.rowHasReadableJsonl(row)) {
      summaries.push(summaryFromRow(await source.ensureRowAgentSurface(row)))
    } else {
      source.deleteIndexRow(row.id)
    }
  }
  return summaries
}

function pageFromSummaries(
  summaries: ThreadSummary[],
  options: ThreadStoreListOptions,
  total?: () => number | undefined
): ThreadStoreListPage {
  const pageSize = typeof options.limit === 'number'
    ? Math.max(1, Math.floor(options.limit))
    : summaries.length
  const hasMore = summaries.length > pageSize
  const page = hasMore ? summaries.slice(0, pageSize) : summaries
  const last = page[page.length - 1]
  return {
    threads: page,
    ...(hasMore && last ? { nextCursor: encodeThreadCursor(last.updatedAt, last.id) } : {}),
    hasMore,
    ...(options.cursor ? {} : { total: total ? total() : summaries.length })
  }
}

export async function hybridThreadStoreListPage(
  store: unknown,
  options: ThreadStoreListOptions
): Promise<ThreadStoreListPage> {
  const source = asSource(store)
  if (source.hasDb() && source.isIndexReady() && !source.hasDirtyIndexThreads()) {
    try {
      const pageSize = typeof options.limit === 'number' ? Math.max(1, Math.floor(options.limit)) : 0
      const wanted = pageSize > 0 ? pageSize + 1 : 0
      const readable: ThreadSummary[] = []
      let cursor = options.cursor
      while (true) {
        const rows = source.queryThreadRows({
          ...options,
          cursor,
          ...(wanted > 0 ? { limit: wanted - readable.length } : {})
        })
        readable.push(...await summariesFromRows(source, rows))
        if (wanted === 0 || readable.length >= wanted || rows.length === 0) break
        const lastRow = rows.at(-1)
        if (!lastRow) break
        cursor = encodeThreadCursor(lastRow.updated_at, lastRow.id)
      }
      const result = pageFromSummaries(
        readable,
        options,
        () => source.indexCount(options)
      )
      source.markSqliteHealthy()
      return { ...result, indexStatus: source.indexStatus() }
    } catch (error) {
      source.markSqliteDegraded('listPage', error)
    }
  }
  // During a cold index, the SQLite table is only partially populated. Merge
  // its readable rows with the not-yet-indexed filesystem threads (read in
  // parallel, bounded by the summary cache) so the first page answers without
  // waiting for the sequential reindex to finish.
  if (source.hasDb() && !source.isIndexReady()) {
    try {
      const result = await transitionPage(source, options)
      source.markSqliteHealthy()
      return { ...result, indexStatus: source.indexStatus() }
    } catch (error) {
      source.markSqliteDegraded('listPage', error)
    }
  }
  const filtered = filterThreadSummaries(
    await source.listFromFilesystem(),
    { ...options, limit: undefined }
  )
  const result = pageFromSummaries(applyThreadCursor(filtered, options.cursor), options, () => filtered.length)
  return { ...result, indexStatus: source.indexStatus() }
}

/** Merge partial SQLite rows with the dirty filesystem delta before paging. */
async function transitionPage(
  source: HybridThreadListPageSource,
  options: ThreadStoreListOptions
): Promise<ThreadStoreListPage> {
  // Read every indexed row (across status and relation) so the merge below
  // re-applies request filters uniformly over SQLite + dirty filesystem delta.
  const rows = source.queryThreadRows({ includeArchived: true, includeSide: true })
  const indexedSummaries = await summariesFromRows(source, rows)
  const filesystemIds = await source.filesystemThreadIds()
  const indexedIds = new Set(indexedSummaries.map((summary) => summary.id))
  const dirtyIds = filesystemIds.filter((id) => !indexedIds.has(id))
  const deltaSummaries = await source.readDeltaSummaries(dirtyIds)
  // Canonical JSONL metadata wins when a thread appears in both sources.
  const byId = new Map<string, ThreadSummary>()
  for (const summary of indexedSummaries) byId.set(summary.id, summary)
  for (const summary of deltaSummaries) byId.set(summary.id, summary)
  const filtered = filterThreadSummaries([...byId.values()], { ...options, limit: undefined })
  return pageFromSummaries(
    applyThreadCursor(filtered, options.cursor),
    options,
    () => filtered.length
  )
}

/** Structural assertion from the store to the pagination access surface. */
function asSource(store: unknown): HybridThreadListPageSource {
  return store as HybridThreadListPageSource
}

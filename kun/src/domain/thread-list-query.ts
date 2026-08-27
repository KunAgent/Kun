import type { ThreadSummary } from '../contracts/threads.js'
import type { ThreadStoreListOptions, ThreadStoreListPage } from '../ports/thread-store.js'

type KeysetCursor = { updatedAtMs: number; id: string }

export function threadUpdatedAtMs(thread: Pick<ThreadSummary, 'updatedAt'>): number {
  const parsed = Date.parse(thread.updatedAt)
  return Number.isFinite(parsed) ? parsed : 0
}

export function compareThreadSummaries(left: ThreadSummary, right: ThreadSummary): number {
  return threadUpdatedAtMs(right) - threadUpdatedAtMs(left) || right.id.localeCompare(left.id)
}

export function encodeThreadCursor(updatedAt: string, id: string): string {
  const updatedAtMs = Number.isFinite(Date.parse(updatedAt)) ? Date.parse(updatedAt) : 0
  return Buffer.from(JSON.stringify([updatedAtMs, id])).toString('base64url')
}

export function decodeThreadCursor(cursor: string | undefined): KeysetCursor | null {
  if (!cursor) return null
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown
    if (!Array.isArray(parsed) || parsed.length !== 2) return null
    const [updatedAtMs, id] = parsed as [unknown, unknown]
    if (typeof updatedAtMs !== 'number' || !Number.isFinite(updatedAtMs) || typeof id !== 'string' || !id) return null
    return { updatedAtMs, id }
  } catch {
    return null
  }
}

export function filterThreadSummaries(
  summaries: readonly ThreadSummary[],
  options: ThreadStoreListOptions = {}
): ThreadSummary[] {
  const query = options.search?.trim().toLowerCase()
  let out = options.archivedOnly
    ? summaries.filter((thread) => thread.status === 'archived')
    : options.includeArchived
      ? [...summaries]
      : summaries.filter((thread) => thread.status !== 'archived' && thread.status !== 'deleted')
  if (!options.includeSide) out = out.filter((thread) => (thread.relation ?? 'primary') !== 'side')
  if (options.workspace) out = out.filter((thread) => thread.workspace === options.workspace)
  if (query) out = out.filter((thread) => threadSearchText(thread).includes(query))
  return out.sort(compareThreadSummaries)
}

export function applyThreadCursor(
  summaries: readonly ThreadSummary[],
  cursorValue: string | undefined
): ThreadSummary[] {
  const cursor = decodeThreadCursor(cursorValue)
  if (!cursor) return [...summaries]
  return summaries.filter((thread) => {
    const updatedAtMs = threadUpdatedAtMs(thread)
    return updatedAtMs < cursor.updatedAtMs ||
      (updatedAtMs === cursor.updatedAtMs && thread.id < cursor.id)
  })
}

export function pageThreadSummaries(
  summaries: readonly ThreadSummary[],
  options: ThreadStoreListOptions = {},
  total = summaries.length
): ThreadStoreListPage {
  const pageSize = typeof options.limit === 'number'
    ? Math.max(1, Math.floor(options.limit))
    : summaries.length
  const hasMore = summaries.length > pageSize
  const threads = hasMore ? summaries.slice(0, pageSize) : [...summaries]
  const last = threads.at(-1)
  return {
    threads,
    ...(hasMore && last ? { nextCursor: encodeThreadCursor(last.updatedAt, last.id) } : {}),
    hasMore,
    ...(options.cursor ? {} : { total })
  }
}

export function queryThreadSummaryPage(
  summaries: readonly ThreadSummary[],
  options: ThreadStoreListOptions = {}
): ThreadStoreListPage {
  const filtered = filterThreadSummaries(summaries, options)
  return pageThreadSummaries(applyThreadCursor(filtered, options.cursor), options, filtered.length)
}

function threadSearchText(thread: ThreadSummary): string {
  return [
    thread.id,
    thread.title,
    thread.workspace,
    thread.model,
    thread.mode,
    thread.forkedFromTitle,
    thread.forkedFromThreadId,
    ...(thread.todos?.items.map((item) => item.content) ?? [])
  ].filter(Boolean).join('\n').toLowerCase()
}

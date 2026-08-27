import { collectSessionEventsOfKind } from '../adapters/session-event-query.js'
import type { UsageEvent } from '../contracts/events.js'
import { emptyUsageSnapshot } from '../contracts/usage.js'
import type { ThreadRecord, ThreadSummary } from '../contracts/threads.js'
import { diffUsage, hasUsage } from '../domain/usage.js'
import type { SessionStore, SessionUsageQueryOptions } from '../ports/session-store.js'
import type { UsageService } from './usage-service.js'
import type { ThreadUsageRecord } from './usage-service-query.js'

type UsageThreadSource = {
  id: string
  thread?: ThreadRecord
  summary?: ThreadSummary
}

export type UsageHistorySource = {
  threadService: {
    list(options?: { includeArchived?: boolean; includeSide?: boolean }): Promise<ThreadSummary[]>
    get(threadId: string): Promise<ThreadRecord | null>
  }
  sessionStore: SessionStore
  usageService: Pick<UsageService, 'forThread'>
  nowIso: () => string
}

type ThreadHydrator = (threadId: string) => Promise<ThreadRecord | null>

const usageRecordLoads = new WeakMap<object, Map<string, Promise<ThreadUsageRecord[]>>>()
const USAGE_FALLBACK_READ_CONCURRENCY = 4

/**
 * Cross-request memo of fully hydrated thread records keyed by
 * `threadId::updatedAt`. Attribution only needs `turns/providerId/model`, all
 * frozen once `updatedAt` stops moving, so a memoized record stays valid until
 * the thread changes. Without this every usage refresh re-read every thread
 * document, which made global history aggregation exceed the desktop GET
 * budget after per-turn provider attribution landed.
 */
const hydratedThreadMemo = new Map<string, ThreadRecord | null>()
const HYDRATED_THREAD_MEMO_MAX = 512

function hydratedThreadMemoKey(threadId: string, updatedAt: string): string {
  return `${threadId}::${updatedAt}`
}

function readHydratedThreadMemo(
  threadId: string,
  updatedAt: string | undefined
): ThreadRecord | null | undefined {
  if (!updatedAt) return undefined
  return hydratedThreadMemo.get(hydratedThreadMemoKey(threadId, updatedAt))
}

function writeHydratedThreadMemo(threadId: string, record: ThreadRecord | null): void {
  const updatedAt = record?.updatedAt
  if (!updatedAt) return
  const key = hydratedThreadMemoKey(threadId, updatedAt)
  if (hydratedThreadMemo.has(key)) return
  if (hydratedThreadMemo.size >= HYDRATED_THREAD_MEMO_MAX) {
    const oldest = hydratedThreadMemo.keys().next().value
    if (oldest !== undefined) hydratedThreadMemo.delete(oldest)
  }
  hydratedThreadMemo.set(key, record)
}

/**
 * Load durable differential usage with the optional SQLite index first and a
 * JSONL replay fallback. Live counters newer than persistence are appended as
 * one final delta, so quota and usage routes share identical history.
 */
export async function loadUsageHistory(
  source: UsageHistorySource,
  options: SessionUsageQueryOptions = {}
): Promise<ThreadUsageRecord[]> {
  const threadId = options.threadId?.trim()
  const key = JSON.stringify({
    threadId: threadId || null,
    fromInclusive: options.fromInclusive ?? null,
    toExclusive: options.toExclusive ?? null
  })
  const loads = usageRecordLoads.get(source) ?? new Map<string, Promise<ThreadUsageRecord[]>>()
  usageRecordLoads.set(source, loads)
  const active = loads.get(key)
  if (active) return active
  let load: Promise<ThreadUsageRecord[]>
  load = loadUsageRecords(source, {
    ...(threadId ? { threadId } : {}),
    ...(options.fromInclusive ? { fromInclusive: options.fromInclusive } : {}),
    ...(options.toExclusive ? { toExclusive: options.toExclusive } : {})
  }).finally(() => {
    if (loads.get(key) === load) loads.delete(key)
    if (loads.size === 0) usageRecordLoads.delete(source)
  })
  loads.set(key, load)
  return load
}

async function loadUsageRecords(
  source: UsageHistorySource,
  options: SessionUsageQueryOptions
): Promise<ThreadUsageRecord[]> {
  const explicitThread = options.threadId
    ? await source.threadService.get(options.threadId)
    : null
  if (options.threadId && !explicitThread) return []
  const threadSummaries = options.threadId
    ? []
    : (await source.threadService.list({ includeArchived: true, includeSide: true }))
        .filter((thread) => thread.status !== 'deleted')
  const summariesById = new Map(threadSummaries.map((thread) => [thread.id, thread]))

  // Summaries omit `turns`, so per-turn provider/model attribution needs the
  // full ThreadRecord. The cache deduplicates hydrations within one load and
  // is shared with the JSONL fallback path.
  const threadCache = new Map<string, Promise<ThreadRecord | null>>()
  const hydrateThread: ThreadHydrator = (threadId) => {
    const cached = threadCache.get(threadId)
    if (cached) return cached
    const summary = summariesById.get(threadId)
    const memoized = readHydratedThreadMemo(threadId, summary?.updatedAt)
    if (memoized !== undefined) {
      const settled = Promise.resolve(memoized)
      threadCache.set(threadId, settled)
      return settled
    }
    const load = source.threadService
      .get(threadId)
      // A corrupt thread document must degrade to the summary (thread-current
      // provider attribution) instead of failing the whole usage aggregation.
      .then(
        (record) => {
          writeHydratedThreadMemo(threadId, record)
          return record
        },
        () => {
          writeHydratedThreadMemo(threadId, null)
          return null
        }
      )
    threadCache.set(threadId, load)
    return load
  }

  if (typeof source.sessionStore.loadUsageRecords === 'function') {
    try {
      const allowedThreadIds = new Set(
        options.threadId ? [options.threadId] : threadSummaries.map((thread) => thread.id)
      )
      const indexedRaw = await source.sessionStore.loadUsageRecords(options)
      // Legacy indexed rows carry no persisted providerId; without a hydrate
      // they would be attributed to the thread's *current* provider.
      const hydrationIds: string[] = []
      for (const record of indexedRaw) {
        if (!allowedThreadIds.has(record.threadId)) continue
        if (record.providerId) continue
        if (explicitThread?.id === record.threadId) continue
        hydrationIds.push(record.threadId)
      }
      const hydrated = await hydrateThreadsWithBounds(hydrationIds, hydrateThread)
      const records: ThreadUsageRecord[] = indexedRaw
        .filter((record) =>
          allowedThreadIds.has(record.threadId) && timestampInUsageRange(record.completedAt, options)
        )
        .map((record) => {
          const thread = explicitThread?.id === record.threadId
            ? explicitThread
            : hydrated.get(record.threadId) ?? summariesById.get(record.threadId)
          const providerId = usageRecordProvider(thread, {
            turnId: record.turnId,
            providerId: record.providerId
          })
          return {
            threadId: record.threadId,
            ...(record.turnId ? { turnId: record.turnId } : {}),
            ...(record.model ? { model: record.model } : {}),
            ...(providerId ? { providerId } : {}),
            completedAt: record.completedAt,
            usage: record.usage
          }
        })
      const latest = typeof source.sessionStore.loadLatestUsageSnapshots === 'function' &&
        allowedThreadIds.size > 0
        ? await source.sessionStore.loadLatestUsageSnapshots({ threadIds: [...allowedThreadIds] })
        : []
      const latestByThread = new Map(latest.map((record) => [record.threadId, record.usage]))
      const liveThreadIds = options.threadId
        ? [options.threadId]
        : threadSummaries.map((thread) => thread.id)
      for (const threadId of liveThreadIds) {
        const liveRemainder = diffUsage(
          source.usageService.forThread(threadId),
          latestByThread.get(threadId) ?? emptyUsageSnapshot()
        )
        if (!hasUsage(liveRemainder)) continue
        const thread = explicitThread?.id === threadId
          ? explicitThread
          : await hydrateThread(threadId) ?? summariesById.get(threadId)
        if (!thread) continue
        const completedAt = thread.updatedAt || source.nowIso()
        if (!timestampInUsageRange(completedAt, options)) continue
        const turnId = latestTurnId(thread)
        records.push({
          threadId,
          ...(turnId ? { turnId } : {}),
          model: usageRecordModel(thread, { turnId }),
          ...(usageRecordProvider(thread, { turnId })
            ? { providerId: usageRecordProvider(thread, { turnId }) }
            : {}),
          completedAt,
          usage: liveRemainder
        })
      }
      return records
    } catch {
      // Fall back to JSONL replay when the optional usage index is
      // unavailable or one of its reads failed mid-aggregation.
    }
  }

  const sources: UsageThreadSource[] = explicitThread
    ? [{ id: explicitThread.id, thread: explicitThread }]
    : threadSummaries.map((thread) => ({ id: thread.id, summary: thread }))
  return loadUsageRecordsFromSources(source, sources, hydrateThread, options)
}

async function hydrateThreadsWithBounds(
  threadIds: readonly string[],
  hydrateThread: ThreadHydrator
): Promise<Map<string, ThreadRecord | null>> {
  const unique = [...new Set(threadIds)]
  const hydrated = new Map<string, ThreadRecord | null>()
  let nextIndex = 0
  const workerCount = Math.min(USAGE_FALLBACK_READ_CONCURRENCY, unique.length)
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < unique.length) {
      const threadId = unique[nextIndex]
      nextIndex += 1
      hydrated.set(threadId, await hydrateThread(threadId))
    }
  }))
  return hydrated
}

async function loadUsageRecordsFromSources(
  source: UsageHistorySource,
  sources: UsageThreadSource[],
  hydrateThread: ThreadHydrator,
  options: SessionUsageQueryOptions
): Promise<ThreadUsageRecord[]> {
  const recordsBySource: ThreadUsageRecord[][] = Array.from({ length: sources.length })
  let nextIndex = 0
  const workerCount = Math.min(USAGE_FALLBACK_READ_CONCURRENCY, sources.length)
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < sources.length) {
      const index = nextIndex
      nextIndex += 1
      recordsBySource[index] = await loadUsageRecordsForSource(
        source,
        sources[index],
        hydrateThread,
        options
      )
    }
  }))
  return recordsBySource.flat()
}

async function loadUsageRecordsForSource(
  source: UsageHistorySource,
  item: UsageThreadSource,
  hydrateThread: ThreadHydrator,
  options: SessionUsageQueryOptions
): Promise<ThreadUsageRecord[]> {
  // Hydrate the full record before falling back to the summary: the summary
  // lacks `turns`, so provider attribution on it would use the thread's
  // current provider instead of the turn's own route. A failed hydration
  // degrades to the summary instead of failing the whole aggregation.
  let hydrated: ThreadRecord | null = null
  try {
    hydrated = await hydrateThread(item.id)
  } catch {
    hydrated = null
  }
  const thread: ThreadRecord | ThreadSummary | undefined = item.thread ?? hydrated ?? item.summary
  if (!thread) return []
  const records: ThreadUsageRecord[] = []
  let latestPersisted = emptyUsageSnapshot()
  const usageEvents = (await collectSessionEventsOfKind(
    source.sessionStore,
    thread.id,
    'usage'
  )).sort((a, b) => a.seq - b.seq)

  for (const event of usageEvents) {
    const delta = diffUsage(event.usage, latestPersisted)
    latestPersisted = event.usage
    if (!hasUsage(delta) || !timestampInUsageRange(event.timestamp, options)) continue
    records.push({
      threadId: thread.id,
      ...(event.turnId ? { turnId: event.turnId } : {}),
      model: usageRecordModel(thread, event),
      ...(usageRecordProvider(thread, event)
        ? { providerId: usageRecordProvider(thread, event) }
        : {}),
      completedAt: event.timestamp,
      usage: delta
    })
  }

  const liveRemainder = diffUsage(source.usageService.forThread(thread.id), latestPersisted)
  const liveTimestamp = thread.updatedAt || source.nowIso()
  if (hasUsage(liveRemainder) && timestampInUsageRange(liveTimestamp, options)) {
    const turnId = latestTurnId(thread)
    records.push({
      threadId: thread.id,
      ...(turnId ? { turnId } : {}),
      model: usageRecordModel(thread, { turnId }),
      ...(usageRecordProvider(thread, { turnId })
        ? { providerId: usageRecordProvider(thread, { turnId }) }
        : {}),
      completedAt: thread.updatedAt || source.nowIso(),
      usage: liveRemainder
    })
  }
  return records
}

function timestampInUsageRange(timestamp: string, options: SessionUsageQueryOptions): boolean {
  if (!options.fromInclusive && !options.toExclusive) return true
  const value = Date.parse(timestamp)
  if (!Number.isFinite(value)) return false
  if (options.fromInclusive && value < Date.parse(options.fromInclusive)) return false
  if (options.toExclusive && value >= Date.parse(options.toExclusive)) return false
  return true
}

function latestTurnId(thread: unknown): string | undefined {
  if (!thread || typeof thread !== 'object') return undefined
  const turns = (thread as { turns?: unknown }).turns
  if (!Array.isArray(turns)) return undefined
  const latest = turns.at(-1) as { id?: unknown } | undefined
  return typeof latest?.id === 'string' ? latest.id : undefined
}

function usageRecordProvider(
  thread: { providerId?: string; turns?: Array<{ id: string; providerId?: string }> } | undefined,
  event?: Pick<UsageEvent, 'turnId' | 'providerId'>
): string | undefined {
  // Persisted providerId wins: it is the provider that actually served the
  // request even when the thread has since switched providers.
  const persistedProvider = event?.providerId?.trim()
  if (persistedProvider) return persistedProvider
  if (!thread) return undefined
  const turnId = event?.turnId?.trim()
  if (turnId) {
    const turnProvider = thread.turns?.find((turn) => turn.id === turnId)?.providerId?.trim()
    if (turnProvider) return turnProvider
  }
  return thread.providerId?.trim() || undefined
}

function usageRecordModel(
  thread: { model?: string; turns?: Array<{ id: string; model?: string }> },
  event?: Pick<UsageEvent, 'model' | 'turnId'>
): string {
  const eventModel = event?.model?.trim()
  if (eventModel) return eventModel
  const turnId = event?.turnId?.trim()
  if (turnId) {
    const turnModel = thread.turns?.find((turn) => turn.id === turnId)?.model?.trim()
    if (turnModel) return turnModel
  }
  const latestTurnModel = [...(thread.turns ?? [])]
    .reverse()
    .find((turn) => turn.model?.trim())
    ?.model?.trim()
  return latestTurnModel || thread.model?.trim() || 'unknown'
}

import { collectSessionEventsOfKind } from '../adapters/session-event-query.js'
import type { UsageEvent } from '../contracts/events.js'
import { emptyUsageSnapshot } from '../contracts/usage.js'
import type { ThreadRecord, ThreadSummary } from '../contracts/threads.js'
import { diffUsage, hasUsage } from '../domain/usage.js'
import { UsageIndexUnavailableError } from '../manager/usage-errors.js'
import type {
  SessionStore,
  SessionUsageQueryOptions,
  SessionUsageRecord
} from '../ports/session-store.js'
import type { UsageService } from './usage-service.js'
import type { ThreadUsageRecord } from './usage-service-query.js'

type UsageThreadSource = {
  id: string
  thread?: UsageAttributionThread
  summary?: ThreadSummary
}

type UsageAttributionThread = Pick<
  ThreadRecord,
  'id' | 'model' | 'providerId' | 'updatedAt'
> & {
  turns: Array<Pick<ThreadRecord['turns'][number], 'id' | 'model' | 'providerId'>>
}

export class UsageFallbackLimitError extends Error {
  readonly code: 'usage_fallback_limit_exceeded' | 'usage_fallback_timeout'

  constructor(code: UsageFallbackLimitError['code'], message: string) {
    super(message)
    this.name = 'UsageFallbackLimitError'
    this.code = code
  }
}

export const USAGE_FALLBACK_MAX_THREADS = 2_000
export const USAGE_FALLBACK_TIMEOUT_MS = 15_000

export type UsageHistorySource = {
  threadService: {
    list(options?: {
      limit?: number
      includeArchived?: boolean
      includeSide?: boolean
    }): Promise<ThreadSummary[]>
    listPage?(options?: {
      limit?: number
      includeArchived?: boolean
      includeSide?: boolean
    }): Promise<{ threads: ThreadSummary[]; hasMore: boolean }>
    get(threadId: string): Promise<ThreadRecord | null>
    getMetadata?(threadId: string): Promise<ThreadRecord | null>
  }
  sessionStore: SessionStore
  usageService: Pick<UsageService, 'forThread'> & {
    snapshots?: UsageService['snapshots']
  }
  nowIso: () => string
}

type ThreadHydrator = (threadId: string) => Promise<UsageAttributionThread | null>

const usageRecordLoads = new WeakMap<object, Map<string, Promise<ThreadUsageRecord[]>>>()
const fallbackLoads = new WeakMap<object, Map<string, Promise<ThreadUsageRecord[]>>>()
const USAGE_FALLBACK_READ_CONCURRENCY = 4

/**
 * Cross-request memo of compact thread/turn attribution keyed by
 * `threadId::updatedAt`. The projection deliberately excludes prompts and
 * item history, so it can cover normal multi-thousand-thread workspaces
 * without retaining fully hydrated thread documents.
 */
const hydratedThreadMemo = new Map<string, UsageAttributionThread>()
const HYDRATED_THREAD_MEMO_MAX = 4_096

function hydratedThreadMemoKey(threadId: string, updatedAt: string): string {
  return `${threadId}::${updatedAt}`
}

function readHydratedThreadMemo(
  threadId: string,
  updatedAt: string | undefined
): UsageAttributionThread | undefined {
  if (!updatedAt) return undefined
  const key = hydratedThreadMemoKey(threadId, updatedAt)
  const cached = hydratedThreadMemo.get(key)
  if (!cached) return undefined
  // Refresh recency so repeated scans do not evict the same hot tail on every
  // fixed-order pass through a workspace larger than the old 512-entry memo.
  hydratedThreadMemo.delete(key)
  hydratedThreadMemo.set(key, cached)
  return cached
}

function writeHydratedThreadMemo(threadId: string, record: UsageAttributionThread): void {
  const updatedAt = record.updatedAt
  const key = hydratedThreadMemoKey(threadId, updatedAt)
  if (hydratedThreadMemo.has(key)) hydratedThreadMemo.delete(key)
  if (hydratedThreadMemo.size >= HYDRATED_THREAD_MEMO_MAX) {
    const oldest = hydratedThreadMemo.keys().next().value
    if (oldest !== undefined) hydratedThreadMemo.delete(oldest)
  }
  hydratedThreadMemo.set(key, record)
}

function usageAttributionFromThread(thread: ThreadRecord): UsageAttributionThread {
  return {
    id: thread.id,
    model: thread.model,
    ...(thread.providerId ? { providerId: thread.providerId } : {}),
    updatedAt: thread.updatedAt,
    turns: (thread.turns ?? []).map((turn) => ({
      id: turn.id,
      ...(turn.model ? { model: turn.model } : {}),
      ...(turn.providerId ? { providerId: turn.providerId } : {})
    }))
  }
}

export type UsageHistoryReadStrategy = 'index-first' | 'jsonl-only'

/**
 * Load durable differential usage with the optional SQLite index first and a
 * JSONL replay fallback. Live counters newer than persistence are appended as
 * one final delta, so quota and usage routes share identical history.
 */
export async function loadUsageHistory(
  source: UsageHistorySource,
  options: SessionUsageQueryOptions = {},
  strategy: UsageHistoryReadStrategy = 'index-first'
): Promise<ThreadUsageRecord[]> {
  const threadId = options.threadId?.trim()
  const key = JSON.stringify({
    strategy,
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
  }, strategy).finally(() => {
    if (loads.get(key) === load) loads.delete(key)
    if (loads.size === 0) usageRecordLoads.delete(source)
  })
  loads.set(key, load)
  return load
}

/**
 * Return only the cumulative in-process usage newer than the latest indexed
 * snapshot. Aggregate workers consume these compact records alongside SQLite
 * rows so a just-finished request is visible before its event index settles.
 */
export async function loadLiveUsageRemainders(
  source: UsageHistorySource,
  options: SessionUsageQueryOptions = {},
  reconcileInWorker = false
): Promise<SessionUsageRecord[]> {
  if (typeof source.sessionStore.loadLatestUsageSnapshots !== 'function') return []
  const candidates = options.threadId
    ? [{ threadId: options.threadId, usage: source.usageService.forThread(options.threadId) }]
    : source.usageService.snapshots?.() ?? []
  if (candidates.length === 0) return []
  const latest = await source.sessionStore.loadLatestUsageSnapshots({
    threadIds: candidates.map((candidate) => candidate.threadId)
  })
  const latestByThread = new Map(latest.map((record) => [record.threadId, record.usage]))
  const pending = candidates
    .map((candidate) => ({
      threadId: candidate.threadId,
      cumulativeUsage: candidate.usage,
      remainder: diffUsage(
        candidate.usage,
        latestByThread.get(candidate.threadId) ?? emptyUsageSnapshot()
      )
    }))
    .filter((candidate) => hasUsage(candidate.remainder))
  const hydrated = await hydrateThreadsWithBounds(
    pending.map((candidate) => candidate.threadId),
    async (threadId) => {
      const record = await (
        source.threadService.getMetadata?.(threadId) ?? source.threadService.get(threadId)
      ).catch(() => null)
      return record && record.status !== 'deleted' ? usageAttributionFromThread(record) : null
    }
  )
  return pending.flatMap((candidate): SessionUsageRecord[] => {
    const thread = hydrated.get(candidate.threadId)
    if (!thread) return []
    const completedAt = thread.updatedAt || source.nowIso()
    if (!timestampInUsageRange(completedAt, options)) return []
    const turnId = latestTurnId(thread)
    const providerId = usageRecordProvider(thread, { turnId })
    return [{
      threadId: candidate.threadId,
      ...(turnId ? { turnId } : {}),
      model: usageRecordModel(thread, { turnId }),
      ...(providerId ? { providerId } : {}),
      completedAt,
      usage: reconcileInWorker ? candidate.cumulativeUsage : candidate.remainder,
      ...(reconcileInWorker ? { cumulative: true } : {})
    }]
  })
}

async function loadUsageRecords(
  source: UsageHistorySource,
  options: SessionUsageQueryOptions,
  strategy: UsageHistoryReadStrategy
): Promise<ThreadUsageRecord[]> {
  const readThreadMetadata = (threadId: string) => source.threadService.getMetadata
    ? source.threadService.getMetadata(threadId)
    : source.threadService.get(threadId)
  const explicitRecord = options.threadId
    ? await readThreadMetadata(options.threadId)
    : null
  const explicitThread = explicitRecord ? usageAttributionFromThread(explicitRecord) : null
  if (options.threadId && !explicitThread) return []
  const threadSummaries = options.threadId
    ? []
    : await listFallbackThreadSummaries(source)
  const summariesById = new Map(threadSummaries.map((thread) => [thread.id, thread]))

  // Summaries omit `turns`, so per-turn provider/model attribution uses the
  // metadata-only ThreadRecord projection. The cache deduplicates reads within
  // one load and is shared with the JSONL fallback path.
  const threadCache = new Map<string, Promise<UsageAttributionThread | null>>()
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
    const load = readThreadMetadata(threadId)
      // A corrupt thread document must degrade to the summary (thread-current
      // provider attribution) instead of failing the whole usage aggregation.
      .then(
        (record) => {
          if (!record) return null
          const attribution = usageAttributionFromThread(record)
          writeHydratedThreadMemo(threadId, attribution)
          return attribution
        },
        () => null
      )
    threadCache.set(threadId, load)
    return load
  }

  if (strategy === 'jsonl-only' || typeof source.sessionStore.loadUsageRecords !== 'function') {
    return loadUsageFallback(source, explicitThread, threadSummaries, hydrateThread, options)
  }

  let indexedRaw: Awaited<ReturnType<NonNullable<SessionStore['loadUsageRecords']>>>
  try {
    indexedRaw = await source.sessionStore.loadUsageRecords(options)
  } catch (error) {
    if (!options.threadId && source.sessionStore.aggregateUsage) {
      throw new UsageIndexUnavailableError(
        'usage_index_unavailable',
        `Usage index is unavailable: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      )
    }
    return loadUsageFallback(source, explicitThread, threadSummaries, hydrateThread, options)
  }

  const allowedThreadIds = new Set(
    options.threadId ? [options.threadId] : threadSummaries.map((thread) => thread.id)
  )
  const hydrationIds = indexedRaw
    .filter((record) => allowedThreadIds.has(record.threadId) && !record.providerId &&
      explicitThread?.id !== record.threadId)
    .map((record) => record.threadId)
  const hydrated = await hydrateThreadsWithBounds(hydrationIds, hydrateThread)
  const records: ThreadUsageRecord[] = indexedRaw
    .filter((record) =>
      allowedThreadIds.has(record.threadId) && timestampInUsageRange(record.completedAt, options)
    )
    .map((record) => {
      const thread = explicitThread?.id === record.threadId
        ? explicitThread
        : hydrated.get(record.threadId) ?? summariesById.get(record.threadId)
      const providerId = usageRecordProvider(thread, record)
      return {
        threadId: record.threadId,
        ...(record.turnId ? { turnId: record.turnId } : {}),
        ...(record.model ? { model: record.model } : {}),
        ...(providerId ? { providerId } : {}),
        completedAt: record.completedAt,
        usage: record.usage
      }
    })
  records.push(...await loadLiveUsageRemainders(source, options))
  return records
}

async function listFallbackThreadSummaries(source: UsageHistorySource): Promise<ThreadSummary[]> {
  const options = { limit: USAGE_FALLBACK_MAX_THREADS + 1, includeArchived: true, includeSide: true }
  const page = source.threadService.listPage
    ? await source.threadService.listPage(options)
    : { threads: await source.threadService.list(options), hasMore: false }
  if (page.hasMore || page.threads.length > USAGE_FALLBACK_MAX_THREADS) {
    throw new UsageFallbackLimitError(
      'usage_fallback_limit_exceeded',
      `Usage JSONL fallback is limited to ${USAGE_FALLBACK_MAX_THREADS} threads.`
    )
  }
  return page.threads.filter((thread) => thread.status !== 'deleted')
}

async function loadUsageFallback(
  source: UsageHistorySource,
  explicitThread: UsageAttributionThread | null,
  threadSummaries: ThreadSummary[],
  hydrateThread: ThreadHydrator,
  options: SessionUsageQueryOptions
): Promise<ThreadUsageRecord[]> {
  const key = explicitThread?.id ?? '__all_threads__'
  const loads = fallbackLoads.get(source) ?? new Map<string, Promise<ThreadUsageRecord[]>>()
  fallbackLoads.set(source, loads)
  let load = loads.get(key)
  if (!load) {
    const sources: UsageThreadSource[] = explicitThread
      ? [{ id: explicitThread.id, thread: explicitThread }]
      : threadSummaries.map((thread) => ({ id: thread.id, summary: thread }))
    const scanOptions = explicitThread ? { threadId: explicitThread.id } : {}
    load = loadUsageRecordsFromSources(source, sources, hydrateThread, scanOptions, Date.now())
      .finally(() => {
        if (loads.get(key) === load) loads.delete(key)
        if (loads.size === 0) fallbackLoads.delete(source)
      })
    loads.set(key, load)
  }
  return (await load).filter((record) => timestampInUsageRange(record.completedAt, options))
}

async function hydrateThreadsWithBounds(
  threadIds: readonly string[],
  hydrateThread: ThreadHydrator
): Promise<Map<string, UsageAttributionThread | null>> {
  const unique = [...new Set(threadIds)]
  const hydrated = new Map<string, UsageAttributionThread | null>()
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
  options: SessionUsageQueryOptions,
  startedAt: number
): Promise<ThreadUsageRecord[]> {
  const recordsBySource: ThreadUsageRecord[][] = Array.from({ length: sources.length })
  let nextIndex = 0
  const workerCount = Math.min(USAGE_FALLBACK_READ_CONCURRENCY, sources.length)
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < sources.length) {
      if (Date.now() - startedAt >= USAGE_FALLBACK_TIMEOUT_MS) {
        throw new UsageFallbackLimitError('usage_fallback_timeout', 'Usage JSONL fallback timed out.')
      }
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
  // Read metadata before falling back to the summary: the summary lacks
  // `turns`, so provider attribution on it would use the thread's current
  // provider instead of the turn's own route. A failed read degrades to the
  // summary instead of failing the whole aggregation.
  let hydrated: UsageAttributionThread | null = null
  try {
    hydrated = await hydrateThread(item.id)
  } catch {
    hydrated = null
  }
  const thread: UsageAttributionThread | ThreadSummary | undefined =
    item.thread ?? hydrated ?? item.summary
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

import { collectSessionEventsOfKind } from '../adapters/session-event-query.js'
import type { UsageEvent } from '../contracts/events.js'
import { emptyUsageSnapshot } from '../contracts/usage.js'
import type { ThreadRecord, ThreadSummary } from '../contracts/threads.js'
import { diffUsage, hasUsage } from '../domain/usage.js'
import type { SessionStore } from '../ports/session-store.js'
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

const usageRecordLoads = new WeakMap<object, Map<string, Promise<ThreadUsageRecord[]>>>()
const USAGE_FALLBACK_READ_CONCURRENCY = 4

/**
 * Load durable differential usage with the optional SQLite index first and a
 * JSONL replay fallback. Live counters newer than persistence are appended as
 * one final delta, so quota and usage routes share identical history.
 */
export async function loadUsageHistory(
  source: UsageHistorySource,
  options: { threadId?: string } = {}
): Promise<ThreadUsageRecord[]> {
  const threadId = options.threadId?.trim()
  const key = threadId ? `thread:${threadId}` : 'all'
  const loads = usageRecordLoads.get(source) ?? new Map<string, Promise<ThreadUsageRecord[]>>()
  usageRecordLoads.set(source, loads)
  const active = loads.get(key)
  if (active) return active
  let load: Promise<ThreadUsageRecord[]>
  load = loadUsageRecords(source, { ...(threadId ? { threadId } : {}) }).finally(() => {
    if (loads.get(key) === load) loads.delete(key)
    if (loads.size === 0) usageRecordLoads.delete(source)
  })
  loads.set(key, load)
  return load
}

async function loadUsageRecords(
  source: UsageHistorySource,
  options: { threadId?: string }
): Promise<ThreadUsageRecord[]> {
  const explicitThread = options.threadId
    ? await source.threadService.get(options.threadId)
    : null
  if (options.threadId && !explicitThread) return []
  const threadSummaries = options.threadId
    ? []
    : (await source.threadService.list({ includeArchived: true, includeSide: true }))
        .filter((thread) => thread.status !== 'deleted')

  if (typeof source.sessionStore.loadUsageRecords === 'function') {
    try {
      const allowedThreadIds = new Set(
        options.threadId ? [options.threadId] : threadSummaries.map((thread) => thread.id)
      )
      const indexedRaw = await source.sessionStore.loadUsageRecords({ threadId: options.threadId })
      const records: ThreadUsageRecord[] = indexedRaw
        .filter((record) => allowedThreadIds.has(record.threadId))
        .map((record) => ({
          threadId: record.threadId,
          ...(record.turnId ? { turnId: record.turnId } : {}),
          ...(record.model ? { model: record.model } : {}),
          completedAt: record.completedAt,
          usage: record.usage
        }))
      const latest = typeof source.sessionStore.loadLatestUsageSnapshots === 'function' &&
        allowedThreadIds.size > 0
        ? await source.sessionStore.loadLatestUsageSnapshots({ threadIds: [...allowedThreadIds] })
        : []
      const latestByThread = new Map(latest.map((record) => [record.threadId, record.usage]))
      const liveThreadIds = options.threadId
        ? [options.threadId]
        : threadSummaries.map((thread) => thread.id)
      const summariesById = new Map(threadSummaries.map((thread) => [thread.id, thread]))
      for (const threadId of liveThreadIds) {
        const liveRemainder = diffUsage(
          source.usageService.forThread(threadId),
          latestByThread.get(threadId) ?? emptyUsageSnapshot()
        )
        if (!hasUsage(liveRemainder)) continue
        const thread = explicitThread?.id === threadId
          ? explicitThread
          : summariesById.get(threadId) ?? await source.threadService.get(threadId)
        if (!thread) continue
        const turnId = latestTurnId(thread)
        records.push({
          threadId,
          ...(turnId ? { turnId } : {}),
          model: usageRecordModel(thread, { turnId }),
          completedAt: thread.updatedAt || source.nowIso(),
          usage: liveRemainder
        })
      }
      return records
    } catch {
      // Fall back to JSONL replay when the optional usage index is unavailable.
    }
  }

  const sources: UsageThreadSource[] = explicitThread
    ? [{ id: explicitThread.id, thread: explicitThread }]
    : threadSummaries.map((thread) => ({ id: thread.id, summary: thread }))
  return loadUsageRecordsFromSources(source, sources)
}

async function loadUsageRecordsFromSources(
  source: UsageHistorySource,
  sources: UsageThreadSource[]
): Promise<ThreadUsageRecord[]> {
  const recordsBySource: ThreadUsageRecord[][] = Array.from({ length: sources.length })
  let nextIndex = 0
  const workerCount = Math.min(USAGE_FALLBACK_READ_CONCURRENCY, sources.length)
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < sources.length) {
      const index = nextIndex
      nextIndex += 1
      recordsBySource[index] = await loadUsageRecordsForSource(source, sources[index])
    }
  }))
  return recordsBySource.flat()
}

async function loadUsageRecordsForSource(
  source: UsageHistorySource,
  item: UsageThreadSource
): Promise<ThreadUsageRecord[]> {
  const thread = item.thread ?? item.summary ?? await source.threadService.get(item.id)
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
    if (!hasUsage(delta)) continue
    records.push({
      threadId: thread.id,
      ...(event.turnId ? { turnId: event.turnId } : {}),
      model: usageRecordModel(thread, event),
      completedAt: event.timestamp,
      usage: delta
    })
  }

  const liveRemainder = diffUsage(source.usageService.forThread(thread.id), latestPersisted)
  if (hasUsage(liveRemainder)) {
    const turnId = latestTurnId(thread)
    records.push({
      threadId: thread.id,
      ...(turnId ? { turnId } : {}),
      model: usageRecordModel(thread, { turnId }),
      completedAt: thread.updatedAt || source.nowIso(),
      usage: liveRemainder
    })
  }
  return records
}

function latestTurnId(thread: unknown): string | undefined {
  if (!thread || typeof thread !== 'object') return undefined
  const turns = (thread as { turns?: unknown }).turns
  if (!Array.isArray(turns)) return undefined
  const latest = turns.at(-1) as { id?: unknown } | undefined
  return typeof latest?.id === 'string' ? latest.id : undefined
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

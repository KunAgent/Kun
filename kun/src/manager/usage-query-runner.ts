import Database, { type Database as BetterSqliteDatabase } from 'better-sqlite3'
import {
  SessionUsageAggregateQuerySchema,
  SessionUsageAggregateResponseSchema,
  SessionUsageRecordSchema,
  type SessionUsageAggregateQuery,
  type SessionUsageAggregateResponse
} from '../contracts/usage-query.js'
import { loadIndexedUsageRecords } from '../adapters/hybrid/hybrid-usage-query.js'
import {
  buildDailyUsageResponse,
  buildModelUsageResponse,
  buildThreadUsageResponse,
  buildTurnUsageResponse
} from '../services/usage-service.js'
import { aggregateCodexProviderLocalCosts } from '../services/provider-local-cost.js'
import type { SessionUsageRecord } from '../ports/session-store.js'
import { emptyUsageSnapshot, UsageSnapshotSchema, type UsageSnapshot } from '../contracts/usage.js'
import { diffUsage, hasUsage } from '../domain/usage.js'

export type UsageQueryWorkerInput = {
  sqlitePath: string
  query: SessionUsageAggregateQuery
  liveRecords?: SessionUsageRecord[]
}

export function runUsageAggregateQuery(
  input: UsageQueryWorkerInput
): SessionUsageAggregateResponse {
  const query = SessionUsageAggregateQuerySchema.parse(input.query)
  const liveRecords = SessionUsageRecordSchema.array().parse(input.liveRecords ?? [])
  const db = new Database(input.sqlitePath, { readonly: true, fileMustExist: true })
  try {
    const providerRange = query.groupBy === 'provider_local_cost'
      ? {
          fromInclusive: new Date(Date.parse(query.now) - 30 * 24 * 60 * 60 * 1_000).toISOString(),
          toExclusive: new Date(Date.parse(query.now) + 1).toISOString()
        }
      : null
    const indexedRecords = loadIndexedUsageRecords(
      db,
      query.groupBy === 'thread' || query.groupBy === 'turn'
        ? { ...(query.threadId ? { threadId: query.threadId } : {}) }
        : query.groupBy === 'day' || query.groupBy === 'model'
          ? { fromInclusive: query.fromInclusive, toExclusive: query.toExclusive }
          : providerRange ?? {},
      { visibleThreadsOnly: true }
    )
    const visibleThreadIds = readVisibleThreadIds(db)
    const records = [...indexedRecords, ...reconcileLiveUsageRecords(db, liveRecords)].filter((record) =>
      (!visibleThreadIds || visibleThreadIds.has(record.threadId)) &&
      recordMatchesQuery(record, query)
    )
    const result = (() => {
      switch (query.groupBy) {
        case 'thread': return buildThreadUsageResponse(records)
        case 'day': return buildDailyUsageResponse(records, query)
        case 'model': return buildModelUsageResponse(records, query)
        case 'turn': return buildTurnUsageResponse(records, query)
        case 'provider_local_cost':
          return aggregateCodexProviderLocalCosts({
            profiles: query.profiles,
            records,
            now: new Date(query.now)
          })
      }
    })()
    return SessionUsageAggregateResponseSchema.parse(result)
  } finally {
    db.close()
  }
}

function reconcileLiveUsageRecords(
  db: BetterSqliteDatabase,
  records: SessionUsageRecord[]
): SessionUsageRecord[] {
  const cumulative = records.filter((record) => record.cumulative)
  if (cumulative.length === 0) return records
  const latestByThread = readLatestUsageByThread(
    db,
    cumulative.map((record) => record.threadId)
  )
  return records.flatMap((record): SessionUsageRecord[] => {
    if (!record.cumulative) return [record]
    const usage = diffUsage(
      record.usage,
      latestByThread.get(record.threadId) ?? emptyUsageSnapshot()
    )
    if (!hasUsage(usage)) return []
    const { cumulative: _cumulative, ...differential } = record
    return [{ ...differential, usage }]
  })
}

function readLatestUsageByThread(
  db: BetterSqliteDatabase,
  threadIds: readonly string[]
): Map<string, UsageSnapshot> {
  const result = new Map<string, UsageSnapshot>()
  const unique = [...new Set(threadIds)]
  for (let offset = 0; offset < unique.length; offset += 500) {
    const chunk = unique.slice(offset, offset + 500)
    const placeholders = chunk.map(() => '?').join(', ')
    const rows = db.prepare(`
      SELECT u.thread_id, u.usage_json
      FROM usage_events u
      JOIN (
        SELECT thread_id, MAX(seq) AS seq
        FROM usage_events
        WHERE thread_id IN (${placeholders})
        GROUP BY thread_id
      ) latest ON latest.thread_id = u.thread_id AND latest.seq = u.seq
    `).all(...chunk) as Array<{ thread_id: string; usage_json: string }>
    for (const row of rows) {
      try {
        const parsed = UsageSnapshotSchema.safeParse(JSON.parse(row.usage_json))
        if (parsed.success) result.set(row.thread_id, parsed.data)
      } catch {
        // A corrupt latest row degrades to the empty baseline used by rebuild.
      }
    }
  }
  return result
}

function recordMatchesQuery(
  record: SessionUsageRecord,
  query: SessionUsageAggregateQuery
): boolean {
  if ((query.groupBy === 'thread' || query.groupBy === 'turn') &&
    query.threadId && record.threadId !== query.threadId) return false
  const range = query.groupBy === 'day' || query.groupBy === 'model'
    ? { fromInclusive: query.fromInclusive, toExclusive: query.toExclusive }
    : query.groupBy === 'provider_local_cost'
      ? {
          fromInclusive: new Date(Date.parse(query.now) - 30 * 24 * 60 * 60 * 1_000).toISOString(),
          toExclusive: new Date(Date.parse(query.now) + 1).toISOString()
        }
      : null
  if (!range) return true
  const timestamp = Date.parse(record.completedAt)
  return Number.isFinite(timestamp) &&
    timestamp >= Date.parse(range.fromInclusive) &&
    timestamp < Date.parse(range.toExclusive)
}

function readVisibleThreadIds(db: BetterSqliteDatabase): Set<string> | null {
  const table = db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'threads'
  `).get()
  if (!table) return null
  const rows = db.prepare(`
    SELECT id FROM threads WHERE status != 'deleted'
  `).all() as Array<{ id: string }>
  return new Set(rows.map((row) => row.id))
}

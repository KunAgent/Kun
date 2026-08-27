import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import type { SessionUsageQueryOptions, SessionUsageRecord } from '../../ports/session-store.js'
import { usageRecordsFromRows, type UsageRow } from './hybrid-thread-support.js'

export function loadIndexedUsageRecords(
  db: BetterSqliteDatabase,
  options: SessionUsageQueryOptions
): SessionUsageRecord[] {
  const threadId = options.threadId?.trim()
  const range = options.fromInclusive && options.toExclusive
    ? { from: options.fromInclusive, to: options.toExclusive }
    : null
  const threadClause = threadId ? 'AND thread_id = @thread_id' : ''
  const params = { thread_id: threadId, from: range?.from, to: range?.to }
  const rows = range
    ? db.prepare(`
        SELECT * FROM (
          SELECT * FROM usage_events
          WHERE timestamp >= @from AND timestamp < @to ${threadClause}
          UNION ALL
          SELECT u.* FROM usage_events u
          JOIN (
            SELECT thread_id, MAX(seq) AS seq
            FROM usage_events
            WHERE timestamp < @from ${threadClause}
            GROUP BY thread_id
          ) baseline
            ON baseline.thread_id = u.thread_id AND baseline.seq = u.seq
        )
        ORDER BY thread_id ASC, seq ASC
      `).all(params) as UsageRow[]
    : threadId
      ? db.prepare(`
          SELECT * FROM usage_events
          WHERE thread_id = @thread_id
          ORDER BY thread_id ASC, seq ASC
        `).all(params) as UsageRow[]
      : db.prepare('SELECT * FROM usage_events ORDER BY thread_id ASC, seq ASC').all() as UsageRow[]
  const records = usageRecordsFromRows(rows)
  return range
    ? records.filter((record) => record.completedAt >= range.from && record.completedAt < range.to)
    : records
}

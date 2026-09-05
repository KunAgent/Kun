import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import type { SessionUsageQueryOptions, SessionUsageRecord } from '../../ports/session-store.js'
import { usageRecordsFromRows, type UsageRow } from './hybrid-thread-support.js'

const USAGE_COLUMNS = `
  u.thread_id, u.seq, u.timestamp, u.turn_id, u.model, u.provider_id, u.usage_json
`

export function loadIndexedUsageRecords(
  db: BetterSqliteDatabase,
  options: SessionUsageQueryOptions,
  queryOptions: { visibleThreadsOnly?: boolean } = {}
): SessionUsageRecord[] {
  const threadId = options.threadId?.trim()
  const range = options.fromInclusive && options.toExclusive
    ? { from: options.fromInclusive, to: options.toExclusive }
    : null
  const hasThreads = queryOptions.visibleThreadsOnly === true && Boolean(db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'threads'
  `).get())
  const threadClause = threadId ? 'AND u.thread_id = @thread_id' : ''
  const visibilityJoin = hasThreads ? 'JOIN threads t ON t.id = u.thread_id' : ''
  const visibilityClause = hasThreads ? "AND t.status != 'deleted'" : ''
  const params = { thread_id: threadId, from: range?.from, to: range?.to }
  const rows = range
    ? db.prepare(hasThreads ? `
        SELECT ${USAGE_COLUMNS} FROM usage_events u
        JOIN threads t ON t.id = u.thread_id
        WHERE u.timestamp >= @from AND u.timestamp < @to
          ${threadClause} AND t.status != 'deleted'
        UNION ALL
        SELECT ${USAGE_COLUMNS} FROM threads t
        JOIN usage_events u ON u.rowid = (
          SELECT b.rowid FROM usage_events b
          WHERE b.thread_id = t.id AND b.timestamp < @from
          ORDER BY b.timestamp DESC, b.seq DESC
          LIMIT 1
        )
        WHERE t.status != 'deleted' ${threadId ? 'AND t.id = @thread_id' : ''}
        ORDER BY thread_id ASC, seq ASC
      ` : `
        SELECT ${USAGE_COLUMNS} FROM usage_events u
        WHERE u.timestamp >= @from AND u.timestamp < @to ${threadClause}
        UNION ALL
        SELECT ${USAGE_COLUMNS} FROM usage_events u
        JOIN (
          SELECT thread_id, MAX(seq) AS seq
          FROM usage_events
          WHERE timestamp < @from ${threadId ? 'AND thread_id = @thread_id' : ''}
          GROUP BY thread_id
        ) baseline ON baseline.thread_id = u.thread_id AND baseline.seq = u.seq
        ORDER BY thread_id ASC, seq ASC
      `).all(params) as UsageRow[]
    : threadId
      ? db.prepare(`
          SELECT ${USAGE_COLUMNS} FROM usage_events u ${visibilityJoin}
          WHERE u.thread_id = @thread_id ${visibilityClause}
          ORDER BY u.thread_id ASC, u.seq ASC
        `).all(params) as UsageRow[]
      : db.prepare(`
          SELECT ${USAGE_COLUMNS} FROM usage_events u ${visibilityJoin}
          WHERE 1 = 1 ${visibilityClause}
          ORDER BY u.thread_id ASC, u.seq ASC
        `).all() as UsageRow[]
  const records = usageRecordsFromRows(rows)
  return range
    ? records.filter((record) => record.completedAt >= range.from && record.completedAt < range.to)
    : records
}

import type { Database as BetterSqliteDatabase, Statement } from 'better-sqlite3'
import type { ThreadStoreListOptions } from '../../ports/thread-store.js'
import { decodeThreadCursor } from '../../domain/thread-list-query.js'
import {
  rowFromIndexRecord,
  type ThreadIndexRecord,
  type ThreadRow
} from './hybrid-thread-index-mapping.js'

export class HybridThreadIndexRepository {
  private upsertStatement: Statement | null = null

  constructor(
    private readonly db: BetterSqliteDatabase,
    private readonly paths: (threadId: string) => { metadataPath: string; messagesPath: string; eventsPath: string },
    private readonly warn: (action: string, error: unknown) => void
  ) {}

  query(options: ThreadStoreListOptions): ThreadRow[] {
    const { where, params } = this.buildWhere(options)
    const cursor = decodeThreadCursor(options.cursor)
    if (cursor) {
      where.push('(updated_at_ms < @cursorMs OR (updated_at_ms = @cursorMs AND id < @cursorId))')
      params.cursorMs = cursor.updatedAtMs
      params.cursorId = cursor.id
    }
    const limit = typeof options.limit === 'number' ? Math.max(1, Math.floor(options.limit)) : undefined
    if (limit !== undefined) params.limit = limit
    return this.db.prepare(`SELECT * FROM threads ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY updated_at_ms DESC, id DESC ${limit !== undefined ? 'LIMIT @limit' : ''}`).all(params) as ThreadRow[]
  }

  count(options: ThreadStoreListOptions): number {
    const { where, params } = this.buildWhere(options)
    const row = this.db.prepare(
      `SELECT COUNT(*) AS total FROM threads ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`
    ).get(params) as { total: number } | undefined
    return row?.total ?? 0
  }

  private buildWhere(options: ThreadStoreListOptions): {
    where: string[]
    params: Record<string, unknown>
  } {
    const where: string[] = []
    const params: Record<string, unknown> = {}
    if (options.archivedOnly) { where.push('status = @archivedStatus'); params.archivedStatus = 'archived' }
    else if (!options.includeArchived) where.push("status NOT IN ('archived', 'deleted')")
    if (!options.includeSide) where.push("relation != 'side'")
    if (options.workspace) { where.push('workspace = @workspace'); params.workspace = options.workspace }
    const search = options.search?.trim().toLowerCase()
    if (search) { where.push("search_text LIKE @search ESCAPE '\\'"); params.search = `%${escapeLike(search)}%` }
    return { where, params }
  }

  find(threadId: string): ThreadRow | null {
    try { return (this.db.prepare('SELECT * FROM threads WHERE id = ?').get(threadId) as ThreadRow | undefined) ?? null }
    catch (error) { this.warn('find row', error); return null }
  }

  repairPaths(threadId: string): void {
    try {
      const paths = this.paths(threadId)
      this.db.prepare(`
        UPDATE threads
        SET metadata_path = @metadataPath,
            messages_path = @messagesPath,
            events_path = @eventsPath
        WHERE id = @id
      `).run({ id: threadId, ...paths })
    } catch (error) {
      this.warn('repair row paths', error)
    }
  }

  upsert(record: ThreadIndexRecord): void {
    this.preparedUpsert().run(rowFromIndexRecord(record, this.paths(record.thread.id)))
  }

  /** Write a whole backfill batch inside a single transaction; throws on failure. */
  upsertMany(records: ThreadIndexRecord[]): void {
    if (records.length === 0) return
    const statement = this.preparedUpsert()
    const write = this.db.transaction((items: ThreadIndexRecord[]) => {
      for (const record of items) {
        statement.run(rowFromIndexRecord(record, this.paths(record.thread.id)))
      }
    })
    write(records)
  }

  private preparedUpsert(): Statement {
    if (!this.upsertStatement) {
      this.upsertStatement = this.db.prepare(`
        INSERT INTO threads (
          id, title, workspace, model, agent_surface, mode, status, approval_policy, sandbox_mode, approval_reviewer,
          model_request_capture_enabled,
          cost_budget_usd, cost_budget_warning_sent, relation, parent_thread_id,
          forked_from_thread_id, forked_from_title, forked_at, forked_from_message_count,
          forked_from_turn_count, goal_json, todos_json, extension_metadata_json, created_at, updated_at, created_at_ms,
          updated_at_ms, preview, message_count, event_seq_high_water, metadata_path,
          messages_path, events_path, search_text
        ) VALUES (
          @id, @title, @workspace, @model, @agent_surface, @mode, @status, @approval_policy, @sandbox_mode, @approval_reviewer,
          @model_request_capture_enabled,
          @cost_budget_usd, @cost_budget_warning_sent, @relation, @parent_thread_id,
          @forked_from_thread_id, @forked_from_title, @forked_at, @forked_from_message_count,
          @forked_from_turn_count, @goal_json, @todos_json, @extension_metadata_json, @created_at, @updated_at, @created_at_ms,
          @updated_at_ms, @preview, @message_count, @event_seq_high_water, @metadata_path,
          @messages_path, @events_path, @search_text
        ) ON CONFLICT(id) DO UPDATE SET
          title=excluded.title, workspace=excluded.workspace, model=excluded.model,
          agent_surface=excluded.agent_surface, mode=excluded.mode,
          status=excluded.status, approval_policy=excluded.approval_policy, sandbox_mode=excluded.sandbox_mode,
          approval_reviewer=excluded.approval_reviewer,
          model_request_capture_enabled=excluded.model_request_capture_enabled,
          cost_budget_usd=excluded.cost_budget_usd, cost_budget_warning_sent=excluded.cost_budget_warning_sent,
          relation=excluded.relation, parent_thread_id=excluded.parent_thread_id,
          forked_from_thread_id=excluded.forked_from_thread_id, forked_from_title=excluded.forked_from_title,
          forked_at=excluded.forked_at, forked_from_message_count=excluded.forked_from_message_count,
          forked_from_turn_count=excluded.forked_from_turn_count, goal_json=excluded.goal_json,
          todos_json=excluded.todos_json, extension_metadata_json=excluded.extension_metadata_json,
          created_at=excluded.created_at, updated_at=excluded.updated_at,
          created_at_ms=excluded.created_at_ms, updated_at_ms=excluded.updated_at_ms,
          preview=excluded.preview, message_count=excluded.message_count,
          event_seq_high_water=MAX(threads.event_seq_high_water, excluded.event_seq_high_water),
          metadata_path=excluded.metadata_path, messages_path=excluded.messages_path,
          events_path=excluded.events_path, search_text=excluded.search_text
      `)
    }
    return this.upsertStatement
  }

  delete(threadId: string): void {
    try {
      this.db.prepare('DELETE FROM threads WHERE id = ?').run(threadId)
      this.db.prepare('DELETE FROM usage_events WHERE thread_id = ?').run(threadId)
    } catch (error) { this.warn('delete index row', error) }
  }
}
function escapeLike(value: string): string { return value.replace(/[%_]/g, (match) => `\\${match}`) }

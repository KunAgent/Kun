import { mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Database as BetterSqliteDatabase, Statement } from 'better-sqlite3'
import type {
  ThreadGoal,
  ThreadMode,
  ThreadRecord,
  ThreadRelation,
  ThreadStatus,
  ThreadTodoList,
  ThreadSummary
} from '../../contracts/threads.js'
import { ThreadSchema } from '../../contracts/threads.js'
import type { RuntimeEvent } from '../../contracts/events.js'
import type { TurnItem } from '../../contracts/items.js'
import type { Turn } from '../../contracts/turns.js'
import type { ApprovalPolicy, SandboxMode } from '../../contracts/policy.js'
import type { ThreadStore, ThreadStoreListOptions } from '../../ports/thread-store.js'
import type { SessionLatestUsageSnapshot, SessionUsageRecord } from '../../ports/session-store.js'
import { toThreadSummary } from '../../domain/thread.js'
import { readJsonl } from '../file/file-thread-store.js'
import {
  emptyUsageSnapshot,
  UsageSnapshotSchema,
  type UsageSnapshot
} from '../../contracts/usage.js'

type ThreadMetadataLine = {
  kind: 'thread_metadata'
  version: 1
  timestamp: string
  thread: ThreadRecord
}

type ThreadRow = {
  id: string
  title: string
  workspace: string
  model: string
  mode: ThreadMode
  status: ThreadStatus
  approval_policy: ApprovalPolicy
  sandbox_mode: SandboxMode
  cost_budget_usd: number | null
  cost_budget_warning_sent: number | null
  relation: ThreadRelation
  parent_thread_id: string | null
  forked_from_thread_id: string | null
  forked_from_title: string | null
  forked_at: string | null
  forked_from_message_count: number | null
  forked_from_turn_count: number | null
  goal_json: string | null
  todos_json: string | null
  created_at: string
  updated_at: string
  created_at_ms: number
  updated_at_ms: number
  preview: string | null
  message_count: number
  event_seq_high_water: number
  metadata_path: string
  messages_path: string
  events_path: string
  search_text: string
}

type ThreadIndexRecord = {
  thread: ThreadRecord
  messageCount: number
  eventSeqHighWater: number
  preview: string
}

type UsageRuntimeEvent = Extract<RuntimeEvent, { kind: 'usage' }>

type UsageRow = {
  thread_id: string
  seq: number
  timestamp: string
  turn_id: string | null
  model: string | null
  usage_json: string
}

/**
 * Hybrid store inspired by Codex: JSONL files are canonical and SQLite
 * is a rebuildable index. SQLite writes always happen after metadata
 * JSONL has been appended.
 */
export class HybridThreadStore implements ThreadStore {
  private readonly dataDir: string
  private readonly sqlitePath: string
  private readonly nowIso: () => string
  private readonly readyPromise: Promise<void>
  private readonly metadataQueues = new Map<string, Promise<void>>()
  private backfillPromise: Promise<void> | null = null
  private db: BetterSqliteDatabase | null = null
  // Prepared-statement cache for the per-event hot paths; better-sqlite3
  // re-compiles the SQL on every prepare() call otherwise.
  private readonly statementCache = new Map<string, Statement>()
  // Reconstructed thread records keyed by the file signatures they were built
  // from. Thread detail requests re-read multi-megabyte JSONL files otherwise.
  private readonly threadRecordCache = new Map<
    string,
    { metadataSig: string; itemsSig: string; record: ThreadRecord }
  >()
  // Per-thread floor that keeps metadata compaction from re-running on every
  // append when a single snapshot is already larger than the threshold.
  private readonly metadataCompactFloor = new Map<string, number>()

  constructor(options: { dataDir: string; sqlitePath?: string; nowIso?: () => string }) {
    this.dataDir = resolve(options.dataDir, 'threads')
    this.sqlitePath = resolve(options.sqlitePath ?? join(options.dataDir, 'index.sqlite3'))
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.readyPromise = this.initialize()
  }

  async ready(): Promise<void> {
    await this.readyPromise
  }

  close(): void {
    try {
      this.db?.close()
    } finally {
      this.db = null
    }
  }

  async waitForBackfill(): Promise<void> {
    await this.ready()
    await this.backfillPromise
  }

  async list(options: ThreadStoreListOptions = {}): Promise<ThreadSummary[]> {
    await this.ready()
    if (this.db) {
      try {
        const rows = this.queryThreadRows(options)
        const summaries: ThreadSummary[] = []
        for (const row of rows) {
          if (await this.rowHasReadableJsonl(row)) {
            summaries.push(summaryFromRow(row))
          } else {
            this.deleteIndexRow(row.id)
          }
        }
        return summaries
      } catch (error) {
        warnSqlite('list', error)
      }
    }
    return filterThreadSummaries(await this.listFromFilesystem(), options)
  }

  async get(threadId: string): Promise<ThreadRecord | null> {
    await this.ready()
    if (this.db) {
      const row = this.findRow(threadId)
      if (row && !(await this.rowHasReadableJsonl(row))) {
        this.deleteIndexRow(threadId)
      }
    }

    const thread = await this.readThreadFromDisk(threadId)
    if (thread && this.db) {
      this.upsertIndexBestEffort(this.indexRecordForThread(thread))
    }
    return thread
  }

  async upsert(thread: ThreadRecord): Promise<ThreadRecord> {
    await this.ready()
    await this.appendMetadata(thread)
    if (this.db) {
      this.upsertIndexBestEffort(this.indexRecordForThread(thread))
    }
    return thread
  }

  async delete(threadId: string): Promise<boolean> {
    await this.ready()
    const dir = this.threadDir(threadId)
    const existed = await pathExists(dir)
    if (!existed) {
      this.deleteIndexRow(threadId)
      return false
    }
    await rm(dir, { recursive: true, force: true })
    this.deleteIndexRow(threadId)
    this.threadRecordCache.delete(threadId)
    this.metadataCompactFloor.delete(threadId)
    return true
  }

  async noteEventSeq(threadId: string, seq: number): Promise<void> {
    await this.noteEventHighWater(threadId, seq)
  }

  async noteEvent(event: RuntimeEvent): Promise<void> {
    await this.ready()
    if (!this.db) return
    this.noteEventHighWaterSync(event.threadId, event.seq)
    if (event.kind !== 'usage') return
    try {
      this.cachedStatement(`
        INSERT INTO usage_events (
          thread_id, seq, timestamp, turn_id, model, usage_json
        )
        VALUES (
          @thread_id, @seq, @timestamp, @turn_id, @model, @usage_json
        )
        ON CONFLICT(thread_id, seq) DO UPDATE SET
          timestamp = excluded.timestamp,
          turn_id = excluded.turn_id,
          model = excluded.model,
          usage_json = excluded.usage_json
      `).run(usageRowFromEvent(event))
    } catch (error) {
      warnSqlite('record usage event', error)
    }
  }

  async getEventSeqHighWater(threadId: string): Promise<number | null> {
    await this.ready()
    if (!this.db) return null
    try {
      const row = this.db
        .prepare('SELECT event_seq_high_water FROM threads WHERE id = ?')
        .get(threadId) as { event_seq_high_water?: number } | undefined
      return typeof row?.event_seq_high_water === 'number' ? row.event_seq_high_water : null
    } catch (error) {
      warnSqlite('read event high water', error)
      return null
    }
  }

  async loadUsageRecords(options: { threadId?: string } = {}): Promise<SessionUsageRecord[]> {
    await this.ready()
    if (!this.db) throw new Error('hybrid sqlite unavailable')
    try {
      const threadId = options.threadId?.trim()
      const rows = threadId
        ? this.db
            .prepare(`
              SELECT * FROM usage_events
              WHERE thread_id = @thread_id
              ORDER BY thread_id ASC, seq ASC
            `)
            .all({ thread_id: threadId }) as UsageRow[]
        : this.db
            .prepare('SELECT * FROM usage_events ORDER BY thread_id ASC, seq ASC')
            .all() as UsageRow[]
      return usageRecordsFromRows(rows)
    } catch (error) {
      warnSqlite('load usage records', error)
      throw error
    }
  }

  async loadLatestUsageSnapshots(options: { threadIds?: string[] } = {}): Promise<SessionLatestUsageSnapshot[]> {
    await this.ready()
    if (!this.db) throw new Error('hybrid sqlite unavailable')
    try {
      const threadIds = [...new Set((options.threadIds ?? []).map((id) => id.trim()).filter(Boolean))]
      if (threadIds.length > 0) {
        const placeholders = threadIds.map((_id, index) => `@id${index}`).join(', ')
        const params = Object.fromEntries(threadIds.map((id, index) => [`id${index}`, id]))
        const rows = this.db
          .prepare(`
            SELECT u.*
            FROM usage_events u
            JOIN (
              SELECT thread_id, MAX(seq) AS seq
              FROM usage_events
              WHERE thread_id IN (${placeholders})
              GROUP BY thread_id
            ) latest
              ON latest.thread_id = u.thread_id AND latest.seq = u.seq
            ORDER BY u.thread_id ASC
          `)
          .all(params) as UsageRow[]
        return latestUsageSnapshotsFromRows(rows)
      }
      const rows = this.db
        .prepare(`
          SELECT u.*
          FROM usage_events u
          JOIN (
            SELECT thread_id, MAX(seq) AS seq
            FROM usage_events
            GROUP BY thread_id
          ) latest
            ON latest.thread_id = u.thread_id AND latest.seq = u.seq
          ORDER BY u.thread_id ASC
        `)
        .all() as UsageRow[]
      return latestUsageSnapshotsFromRows(rows)
    } catch (error) {
      warnSqlite('load latest usage snapshots', error)
      throw error
    }
  }

  private async initialize(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true })
    await mkdir(dirname(this.sqlitePath), { recursive: true })
    try {
      const sqlite = await import('better-sqlite3')
      const Database = sqlite.default
      this.db = new Database(this.sqlitePath)
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('busy_timeout = 5000')
      this.db.pragma('foreign_keys = ON')
      this.migrate()
      this.startBackfill()
    } catch (error) {
      warnSqlite('initialize', error)
      try {
        this.db?.close()
      } catch {
        // Ignore close errors while falling back to JSONL scanning.
      }
      this.db = null
    }
  }

  private migrate(): void {
    if (!this.db) return
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        workspace TEXT NOT NULL,
        model TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        approval_policy TEXT NOT NULL,
        sandbox_mode TEXT NOT NULL,
        cost_budget_usd REAL,
        cost_budget_warning_sent INTEGER,
        relation TEXT NOT NULL,
        parent_thread_id TEXT,
        forked_from_thread_id TEXT,
        forked_from_title TEXT,
        forked_at TEXT,
        forked_from_message_count INTEGER,
        forked_from_turn_count INTEGER,
        goal_json TEXT,
        todos_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        preview TEXT,
        message_count INTEGER NOT NULL DEFAULT 0,
        event_seq_high_water INTEGER NOT NULL DEFAULT 0,
        metadata_path TEXT NOT NULL,
        messages_path TEXT NOT NULL,
        events_path TEXT NOT NULL,
        search_text TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS threads_updated_idx
        ON threads(updated_at_ms DESC, id DESC);
      CREATE INDEX IF NOT EXISTS threads_workspace_updated_idx
        ON threads(workspace, updated_at_ms DESC, id DESC);
      CREATE INDEX IF NOT EXISTS threads_status_updated_idx
        ON threads(status, updated_at_ms DESC, id DESC);
      CREATE INDEX IF NOT EXISTS threads_relation_updated_idx
        ON threads(relation, updated_at_ms DESC, id DESC);
      CREATE TABLE IF NOT EXISTS usage_events (
        thread_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        turn_id TEXT,
        model TEXT,
        usage_json TEXT NOT NULL,
        PRIMARY KEY(thread_id, seq)
      );
      CREATE INDEX IF NOT EXISTS usage_events_thread_seq_idx
        ON usage_events(thread_id, seq);
      CREATE INDEX IF NOT EXISTS usage_events_timestamp_idx
        ON usage_events(timestamp);
    `)
    addColumnIfMissing(this.db, 'threads', 'todos_json TEXT')
    addColumnIfMissing(this.db, 'threads', 'usage_backfilled INTEGER NOT NULL DEFAULT 0')
  }

  private cachedStatement(sql: string): Statement {
    if (!this.db) throw new Error('sqlite unavailable')
    let statement = this.statementCache.get(sql)
    if (!statement) {
      statement = this.db.prepare(sql)
      this.statementCache.set(sql, statement)
    }
    return statement
  }

  private startBackfill(): void {
    if (this.backfillPromise) return
    this.backfillPromise = this.backfill().catch((error) => {
      warnSqlite('background backfill', error)
    })
  }

  private async backfill(): Promise<void> {
    if (!this.db) return
    const rows = this.db
      .prepare('SELECT id, usage_backfilled FROM threads')
      .all() as Array<{ id: string; usage_backfilled?: number }>
    const indexed = new Map(rows.map((row) => [row.id, row.usage_backfilled === 1]))
    for (const threadId of await this.threadIdsFromFilesystem()) {
      const usageBackfilled = indexed.get(threadId)
      // Threads marked as backfilled never need their events.jsonl re-read;
      // without the marker every startup re-scanned the full event history
      // of threads that simply have no usage events.
      if (usageBackfilled === true) continue
      if (usageBackfilled === undefined) {
        const thread = await this.readThreadFromDisk(threadId)
        if (!thread) continue
        const scan = await this.scanEventsForBackfill(threadId)
        this.upsertIndexBestEffort({
          ...this.indexRecordForThread(thread),
          eventSeqHighWater: scan.highWater
        })
        await this.insertUsageEventsChunked(threadId, scan.usage)
      } else {
        const scan = await this.scanEventsForBackfill(threadId)
        this.noteEventHighWaterSync(threadId, scan.highWater)
        await this.insertUsageEventsChunked(threadId, scan.usage)
      }
      this.markUsageBackfilled(threadId)
      await yieldToEventLoop()
    }

    try {
      for (const row of rows) {
        if (!(await pathExists(this.threadDir(row.id)))) {
          this.deleteIndexRow(row.id)
        }
      }
    } catch (error) {
      warnSqlite('backfill cleanup', error)
    }
  }

  /** Single pass over events.jsonl: high-water mark plus usage events. */
  private async scanEventsForBackfill(
    threadId: string
  ): Promise<{ highWater: number; usage: UsageRuntimeEvent[] }> {
    let highWater = 0
    const usage: UsageRuntimeEvent[] = []
    try {
      for (const event of await readJsonl<RuntimeEvent>(this.eventsPath(threadId))) {
        if (event.seq > highWater) highWater = event.seq
        if (event.kind === 'usage') usage.push(event)
      }
    } catch (error) {
      warnSqlite(`scan events for ${threadId}`, error)
    }
    return { highWater, usage }
  }

  /**
   * Inserts usage rows in small transactions, yielding between chunks.
   * better-sqlite3 is synchronous: unchunked backfill of a large history
   * starved the event loop long enough that the HTTP server never reported
   * ready within the GUI's startup timeout.
   */
  private async insertUsageEventsChunked(threadId: string, events: UsageRuntimeEvent[]): Promise<void> {
    if (!this.db || events.length === 0) return
    const insert = this.cachedStatement(`
      INSERT OR REPLACE INTO usage_events (
        thread_id, seq, timestamp, turn_id, model, usage_json
      )
      VALUES (
        @thread_id, @seq, @timestamp, @turn_id, @model, @usage_json
      )
    `)
    const insertChunk = this.db.transaction((chunk: UsageRow[]) => {
      for (const row of chunk) insert.run(row)
    })
    const chunkSize = 200
    for (let start = 0; start < events.length; start += chunkSize) {
      const chunk = events.slice(start, start + chunkSize).map(usageRowFromEvent)
      try {
        insertChunk(chunk)
      } catch (error) {
        warnSqlite(`backfill usage events for ${threadId}`, error)
        return
      }
      await yieldToEventLoop()
    }
  }

  private markUsageBackfilled(threadId: string): void {
    if (!this.db) return
    try {
      this.db.prepare('UPDATE threads SET usage_backfilled = 1 WHERE id = ?').run(threadId)
    } catch (error) {
      warnSqlite('mark usage backfilled', error)
    }
  }

  private queryThreadRows(options: ThreadStoreListOptions): ThreadRow[] {
    if (!this.db) return []
    const where: string[] = []
    const params: Record<string, unknown> = {}
    if (options.archivedOnly) {
      where.push('status = @archivedStatus')
      params.archivedStatus = 'archived'
    } else if (!options.includeArchived) {
      where.push("status NOT IN ('archived', 'deleted')")
    }
    if (!options.includeSide) {
      where.push("relation != 'side'")
    }
    const search = options.search?.trim().toLowerCase()
    if (search) {
      where.push("search_text LIKE @search ESCAPE '\\'")
      params.search = `%${escapeLike(search)}%`
    }
    const limit = typeof options.limit === 'number' ? Math.max(1, Math.floor(options.limit)) : undefined
    if (limit !== undefined) {
      params.limit = limit
    }
    const sql = `
      SELECT * FROM threads
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY updated_at_ms DESC, id DESC
      ${limit !== undefined ? 'LIMIT @limit' : ''}
    `
    return this.db.prepare(sql).all(params) as ThreadRow[]
  }

  private findRow(threadId: string): ThreadRow | null {
    if (!this.db) return null
    try {
      return (this.db.prepare('SELECT * FROM threads WHERE id = ?').get(threadId) as ThreadRow | undefined) ?? null
    } catch (error) {
      warnSqlite('find row', error)
      return null
    }
  }

  private upsertIndexBestEffort(record: ThreadIndexRecord): void {
    if (!this.db) return
    try {
      const row = rowFromIndexRecord(record, {
        metadataPath: this.metadataPath(record.thread.id),
        messagesPath: this.messagesPath(record.thread.id),
        eventsPath: this.eventsPath(record.thread.id)
      })
      this.db
        .prepare(`
          INSERT INTO threads (
            id, title, workspace, model, mode, status, approval_policy, sandbox_mode,
            cost_budget_usd, cost_budget_warning_sent, relation, parent_thread_id,
            forked_from_thread_id, forked_from_title, forked_at, forked_from_message_count,
            forked_from_turn_count, goal_json, todos_json, created_at, updated_at, created_at_ms,
            updated_at_ms, preview, message_count, event_seq_high_water, metadata_path,
            messages_path, events_path, search_text
          )
          VALUES (
            @id, @title, @workspace, @model, @mode, @status, @approval_policy, @sandbox_mode,
            @cost_budget_usd, @cost_budget_warning_sent, @relation, @parent_thread_id,
            @forked_from_thread_id, @forked_from_title, @forked_at, @forked_from_message_count,
            @forked_from_turn_count, @goal_json, @todos_json, @created_at, @updated_at, @created_at_ms,
            @updated_at_ms, @preview, @message_count, @event_seq_high_water, @metadata_path,
            @messages_path, @events_path, @search_text
          )
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            workspace = excluded.workspace,
            model = excluded.model,
            mode = excluded.mode,
            status = excluded.status,
            approval_policy = excluded.approval_policy,
            sandbox_mode = excluded.sandbox_mode,
            cost_budget_usd = excluded.cost_budget_usd,
            cost_budget_warning_sent = excluded.cost_budget_warning_sent,
            relation = excluded.relation,
            parent_thread_id = excluded.parent_thread_id,
            forked_from_thread_id = excluded.forked_from_thread_id,
            forked_from_title = excluded.forked_from_title,
            forked_at = excluded.forked_at,
            forked_from_message_count = excluded.forked_from_message_count,
            forked_from_turn_count = excluded.forked_from_turn_count,
            goal_json = excluded.goal_json,
            todos_json = excluded.todos_json,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            created_at_ms = excluded.created_at_ms,
            updated_at_ms = excluded.updated_at_ms,
            preview = excluded.preview,
            message_count = excluded.message_count,
            event_seq_high_water = CASE
              WHEN threads.event_seq_high_water > excluded.event_seq_high_water
                THEN threads.event_seq_high_water
              ELSE excluded.event_seq_high_water
            END,
            metadata_path = excluded.metadata_path,
            messages_path = excluded.messages_path,
            events_path = excluded.events_path,
            search_text = excluded.search_text
        `)
        .run(row)
    } catch (error) {
      warnSqlite('upsert index', error)
    }
  }

  private deleteIndexRow(threadId: string): void {
    if (!this.db) return
    try {
      this.db.prepare('DELETE FROM threads WHERE id = ?').run(threadId)
      this.db.prepare('DELETE FROM usage_events WHERE thread_id = ?').run(threadId)
    } catch (error) {
      warnSqlite('delete index row', error)
    }
  }

  private async appendMetadata(thread: ThreadRecord): Promise<void> {
    const previous = this.metadataQueues.get(thread.id) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(async () => {
      await mkdir(this.threadDir(thread.id), { recursive: true })
      const line: ThreadMetadataLine = {
        kind: 'thread_metadata',
        version: 1,
        timestamp: this.nowIso(),
        thread: stripThreadItemBodies(thread)
      }
      await appendJsonlLine(this.metadataPath(thread.id), line)
      await this.maybeCompactMetadata(thread.id)
    })
    const guard = run.then(() => undefined, () => undefined)
    this.metadataQueues.set(thread.id, guard)
    try {
      await run
    } finally {
      if (this.metadataQueues.get(thread.id) === guard) {
        this.metadataQueues.delete(thread.id)
      }
    }
  }

  /**
   * Every upsert appends a full thread snapshot, so metadata.jsonl grows
   * quadratically with turn activity (observed: 4.2MB for an 8-turn thread
   * whose latest snapshot is 6KB). Once the file passes the threshold it is
   * rewritten as a single normalized snapshot. Runs inside the per-thread
   * metadata queue, so no append can interleave with the rewrite.
   */
  private async maybeCompactMetadata(threadId: string): Promise<void> {
    const path = this.metadataPath(threadId)
    const tmpPath = `${path}.compact.tmp`
    try {
      const stats = await stat(path)
      const floor = this.metadataCompactFloor.get(threadId) ?? METADATA_COMPACT_MIN_BYTES
      if (stats.size < floor) return
      const record = await this.readLatestMetadata(threadId)
      if (!record) return
      const line: ThreadMetadataLine = {
        kind: 'thread_metadata',
        version: 1,
        timestamp: this.nowIso(),
        thread: stripThreadItemBodies(record)
      }
      const handle = await open(tmpPath, 'w')
      try {
        await handle.writeFile(`${JSON.stringify(line)}\n`, 'utf-8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(tmpPath, path)
      const compacted = await stat(path)
      this.metadataCompactFloor.set(
        threadId,
        Math.max(METADATA_COMPACT_MIN_BYTES, compacted.size * 4)
      )
    } catch (error) {
      // On Windows the atomic rename can fail with EPERM while another
      // handle has the file open; the next append over the threshold simply
      // retries. Drop the temp file so failures do not accumulate litter.
      await rm(tmpPath, { force: true }).catch(() => undefined)
      console.warn(
        `[kun] metadata compaction skipped for ${threadId}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  private indexRecordForThread(thread: ThreadRecord): ThreadIndexRecord {
    const itemSource = thread.turns.flatMap((turn) => turn.items)
    return {
      thread,
      messageCount: itemSource.length,
      eventSeqHighWater: 0,
      preview: previewFromItems(itemSource)
    }
  }

  private async readThreadFromDisk(threadId: string): Promise<ThreadRecord | null> {
    const [metadataSig, itemsSig] = await Promise.all([
      fileSignature(this.metadataPath(threadId)),
      fileSignature(this.messagesPath(threadId))
    ])
    const cached = this.threadRecordCache.get(threadId)
    if (cached && cached.metadataSig === metadataSig && cached.itemsSig === itemsSig) {
      // Refresh LRU position.
      this.threadRecordCache.delete(threadId)
      this.threadRecordCache.set(threadId, cached)
      return cached.record
    }
    const metadata = await this.readLatestMetadata(threadId)
    const legacy = metadata ? null : await this.readLegacyThread(threadId)
    const source = metadata ?? legacy
    if (!source) return null
    const items = await this.loadItems(threadId)
    // Records are treated as immutable by all callers (updates flow through
    // upsert with fresh objects), so caching the reference is safe.
    const record = hydrateThreadItems(source, items, {
      preserveExistingItemsWhenNoFileItems: Boolean(legacy)
    })
    this.threadRecordCache.set(threadId, { metadataSig, itemsSig, record })
    while (this.threadRecordCache.size > THREAD_RECORD_CACHE_LIMIT) {
      const oldest = this.threadRecordCache.keys().next().value
      if (!oldest) break
      this.threadRecordCache.delete(oldest)
    }
    return record
  }

  private async readLatestMetadata(threadId: string): Promise<ThreadRecord | null> {
    const entries = await readJsonl<ThreadMetadataLine>(this.metadataPath(threadId))
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]
      if (entry?.kind !== 'thread_metadata' || entry.thread?.id !== threadId) continue
      const parsed = ThreadSchema.safeParse(entry.thread)
      if (parsed.success) {
        return normalizeThreadMetadata(parsed.data, entries.slice(0, index + 1))
      }
    }
    return null
  }

  private async readLegacyThread(threadId: string): Promise<ThreadRecord | null> {
    try {
      const raw = await readFile(this.legacyThreadPath(threadId), 'utf-8')
      const parsed = ThreadSchema.safeParse(JSON.parse(raw))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  private async loadItems(threadId: string): Promise<TurnItem[]> {
    const raw = await readJsonl<TurnItem>(this.messagesPath(threadId))
    const latestById = new Map<string, TurnItem>()
    for (const item of raw) {
      latestById.set(item.id, item)
    }
    const seen = new Set<string>()
    const ordered: TurnItem[] = []
    for (let index = raw.length - 1; index >= 0; index -= 1) {
      const item = raw[index]
      if (!item || seen.has(item.id)) continue
      seen.add(item.id)
      ordered.unshift(latestById.get(item.id)!)
    }
    return ordered
  }

  private async noteEventHighWater(threadId: string, seq: number): Promise<void> {
    await this.ready()
    this.noteEventHighWaterSync(threadId, seq)
  }

  private noteEventHighWaterSync(threadId: string, seq: number): void {
    if (!this.db) return
    try {
      this.cachedStatement(`
        UPDATE threads
        SET event_seq_high_water = CASE
          WHEN event_seq_high_water > @seq THEN event_seq_high_water
          ELSE @seq
        END
        WHERE id = @id
      `).run({ id: threadId, seq })
    } catch (error) {
      warnSqlite('note event seq', error)
    }
  }

  private async listFromFilesystem(): Promise<ThreadSummary[]> {
    const summaries: ThreadSummary[] = []
    for (const threadId of await this.threadIdsFromFilesystem()) {
      const thread = await this.readThreadFromDisk(threadId)
      if (thread) summaries.push(toThreadSummary(thread))
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  private async threadIdsFromFilesystem(): Promise<string[]> {
    try {
      const entries = await readdir(this.dataDir, { withFileTypes: true })
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    } catch {
      return []
    }
  }

  private async rowHasReadableJsonl(row: ThreadRow): Promise<boolean> {
    if (row.metadata_path !== this.metadataPath(row.id)) return false
    if (row.messages_path !== this.messagesPath(row.id)) return false
    if (row.events_path !== this.eventsPath(row.id)) return false
    if (!(await pathExists(this.threadDir(row.id)))) return false
    return (await pathExists(this.metadataPath(row.id))) || (await pathExists(this.legacyThreadPath(row.id)))
  }

  private threadDir(threadId: string): string {
    return join(this.dataDir, threadId)
  }

  private metadataPath(threadId: string): string {
    return join(this.threadDir(threadId), 'metadata.jsonl')
  }

  private legacyThreadPath(threadId: string): string {
    return join(this.threadDir(threadId), 'thread.json')
  }

  private messagesPath(threadId: string): string {
    return join(this.threadDir(threadId), 'messages.jsonl')
  }

  private eventsPath(threadId: string): string {
    return join(this.threadDir(threadId), 'events.jsonl')
  }
}

function stripThreadItemBodies(thread: ThreadRecord): ThreadRecord {
  return {
    ...thread,
    turns: thread.turns.map((turn) => ({ ...turn, prompt: '', items: [] }))
  }
}

function hydrateThreadItems(
  thread: ThreadRecord,
  items: TurnItem[],
  options: { preserveExistingItemsWhenNoFileItems: boolean }
): ThreadRecord {
  if (items.length === 0) {
    return options.preserveExistingItemsWhenNoFileItems ? thread : stripThreadItemBodies(thread)
  }
  const itemsByTurn = new Map<string, TurnItem[]>()
  for (const item of items) {
    const list = itemsByTurn.get(item.turnId) ?? []
    list.push(item)
    itemsByTurn.set(item.turnId, list)
  }

  const knownTurnIds = new Set(thread.turns.map((turn) => turn.id))
  const turns = thread.turns.map((turn): Turn => {
    const turnItems = itemsByTurn.get(turn.id) ?? []
    const attachmentIds = turn.attachmentIds.length > 0
      ? turn.attachmentIds
      : attachmentIdsFromItems(turnItems)
    return {
      ...turn,
      prompt: promptFromItems(turnItems) || turn.prompt,
      attachmentIds,
      items: turnItems
    }
  })
  for (const [turnId, turnItems] of itemsByTurn) {
    if (knownTurnIds.has(turnId)) continue
    turns.push(turnFromItems(thread.id, turnId, turnItems, thread.updatedAt))
  }
  turns.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return { ...thread, turns }
}

function normalizeThreadMetadata(thread: ThreadRecord, entries: ThreadMetadataLine[]): ThreadRecord {
  const recovery = collectTurnMetadata(entries, thread.id)
  const mergedById = new Map<string, Turn>()
  const order: string[] = []
  for (const turn of thread.turns) {
    if (!mergedById.has(turn.id)) order.push(turn.id)
    const existing = mergedById.get(turn.id)
    mergedById.set(turn.id, existing ? mergeTurnMetadata(existing, turn) : turn)
  }
  const turns = order.map((turnId) => applyRecoveredTurnMetadata(mergedById.get(turnId)!, recovery.get(turnId)))
  return turns.length === thread.turns.length && turns.every((turn, index) => turn === thread.turns[index])
    ? thread
    : { ...thread, turns }
}

type RecoveredTurnMetadata = {
  attachmentIds: string[]
  model?: string
  mode?: Turn['mode']
  guiPlan?: Turn['guiPlan']
}

function collectTurnMetadata(entries: ThreadMetadataLine[], threadId: string): Map<string, RecoveredTurnMetadata> {
  const recovered = new Map<string, RecoveredTurnMetadata>()
  for (const entry of entries) {
    if (entry?.kind !== 'thread_metadata' || entry.thread?.id !== threadId) continue
    const parsed = ThreadSchema.safeParse(entry.thread)
    if (!parsed.success) continue
    for (const turn of parsed.data.turns) {
      const current = recovered.get(turn.id) ?? { attachmentIds: [] }
      recovered.set(turn.id, {
        attachmentIds: mergeStringArrays(current.attachmentIds, turn.attachmentIds),
        ...(turn.model ? { model: turn.model } : current.model ? { model: current.model } : {}),
        ...(turn.mode ? { mode: turn.mode } : current.mode ? { mode: current.mode } : {}),
        ...(turn.guiPlan ? { guiPlan: turn.guiPlan } : current.guiPlan ? { guiPlan: current.guiPlan } : {})
      })
    }
  }
  return recovered
}

function mergeTurnMetadata(previous: Turn, next: Turn): Turn {
  return {
    ...previous,
    ...next,
    prompt: next.prompt || previous.prompt,
    attachmentIds: mergeStringArrays(previous.attachmentIds, next.attachmentIds),
    activeSkillIds: mergeStringArrays(previous.activeSkillIds, next.activeSkillIds),
    injectedMemoryIds: mergeStringArrays(previous.injectedMemoryIds, next.injectedMemoryIds),
    items: mergeTurnItems(previous.items, next.items)
  }
}

function applyRecoveredTurnMetadata(turn: Turn, recovered: RecoveredTurnMetadata | undefined): Turn {
  if (!recovered) return turn
  const attachmentIds = turn.attachmentIds.length > 0 ? turn.attachmentIds : recovered.attachmentIds
  return {
    ...turn,
    attachmentIds,
    ...(turn.model || !recovered.model ? {} : { model: recovered.model }),
    ...(turn.mode || !recovered.mode ? {} : { mode: recovered.mode }),
    ...(turn.guiPlan || !recovered.guiPlan ? {} : { guiPlan: recovered.guiPlan })
  }
}

function mergeTurnItems(previous: TurnItem[], next: TurnItem[]): TurnItem[] {
  if (previous.length === 0) return next
  if (next.length === 0) return previous
  const byId = new Map<string, TurnItem>()
  for (const item of previous) byId.set(item.id, item)
  for (const item of next) byId.set(item.id, item)
  return [...byId.values()]
}

function turnFromItems(threadId: string, turnId: string, items: TurnItem[], fallbackTime: string): Turn {
  const prompt = promptFromItems(items) || `Turn ${turnId}`
  const createdAt = items[0]?.createdAt ?? fallbackTime
  const hasOpenItem = items.some((item) => item.status === 'pending' || item.status === 'running')
  const hasFailedItem = items.some((item) => item.status === 'failed' || item.status === 'aborted')
  return {
    id: turnId,
    threadId,
    status: hasOpenItem ? 'running' : hasFailedItem ? 'failed' : 'completed',
    prompt,
    steering: [],
    attachmentIds: attachmentIdsFromItems(items),
    activeSkillIds: [],
    injectedMemoryIds: [],
    createdAt,
    finishedAt: hasOpenItem ? undefined : items[items.length - 1]?.finishedAt ?? fallbackTime,
    items
  }
}

function promptFromItems(items: TurnItem[]): string {
  return items.find((item): item is Extract<TurnItem, { kind: 'user_message' }> => item.kind === 'user_message')
    ?.text ?? ''
}

function attachmentIdsFromItems(items: TurnItem[]): string[] {
  const ids = new Set<string>()
  for (const item of items) {
    if (item.kind !== 'user_message') continue
    for (const id of item.attachmentIds ?? []) {
      const trimmed = id.trim()
      if (trimmed) ids.add(trimmed)
    }
  }
  return [...ids]
}

function mergeStringArrays(first: readonly string[], second: readonly string[]): string[] {
  const values = new Set<string>()
  for (const value of [...first, ...second]) {
    const trimmed = value.trim()
    if (trimmed) values.add(trimmed)
  }
  return [...values]
}

function rowFromIndexRecord(
  record: ThreadIndexRecord,
  paths: { metadataPath: string; messagesPath: string; eventsPath: string }
): ThreadRow {
  const thread = record.thread
  return {
    id: thread.id,
    title: thread.title,
    workspace: thread.workspace,
    model: thread.model,
    mode: thread.mode,
    status: thread.status,
    approval_policy: thread.approvalPolicy,
    sandbox_mode: thread.sandboxMode,
    cost_budget_usd: thread.costBudgetUsd ?? null,
    cost_budget_warning_sent: thread.costBudgetWarningSent === undefined
      ? null
      : thread.costBudgetWarningSent
        ? 1
        : 0,
    relation: thread.relation ?? 'primary',
    parent_thread_id: thread.parentThreadId ?? null,
    forked_from_thread_id: thread.forkedFromThreadId ?? null,
    forked_from_title: thread.forkedFromTitle ?? null,
    forked_at: thread.forkedAt ?? null,
    forked_from_message_count: thread.forkedFromMessageCount ?? null,
    forked_from_turn_count: thread.forkedFromTurnCount ?? null,
    goal_json: thread.goal ? JSON.stringify(thread.goal) : null,
    todos_json: thread.todos ? JSON.stringify(thread.todos) : null,
    created_at: thread.createdAt,
    updated_at: thread.updatedAt,
    created_at_ms: isoToMillis(thread.createdAt),
    updated_at_ms: isoToMillis(thread.updatedAt),
    preview: record.preview || null,
    message_count: record.messageCount,
    event_seq_high_water: record.eventSeqHighWater,
    metadata_path: paths.metadataPath,
    messages_path: paths.messagesPath,
    events_path: paths.eventsPath,
    search_text: searchTextForThread(thread, record.preview)
  }
}

function summaryFromRow(row: ThreadRow): ThreadSummary {
  const goal = parseGoal(row.goal_json)
  const todos = parseTodos(row.todos_json)
  return {
    id: row.id,
    title: row.title,
    workspace: row.workspace,
    model: row.model,
    mode: row.mode,
    status: row.status,
    approvalPolicy: row.approval_policy,
    sandboxMode: row.sandbox_mode,
    ...(row.cost_budget_usd !== null ? { costBudgetUsd: row.cost_budget_usd } : {}),
    ...(row.cost_budget_warning_sent !== null ? { costBudgetWarningSent: Boolean(row.cost_budget_warning_sent) } : {}),
    relation: row.relation,
    ...(row.parent_thread_id ? { parentThreadId: row.parent_thread_id } : {}),
    ...(row.forked_from_thread_id ? { forkedFromThreadId: row.forked_from_thread_id } : {}),
    ...(row.forked_from_title ? { forkedFromTitle: row.forked_from_title } : {}),
    ...(row.forked_at ? { forkedAt: row.forked_at } : {}),
    ...(row.forked_from_message_count !== null ? { forkedFromMessageCount: row.forked_from_message_count } : {}),
    ...(row.forked_from_turn_count !== null ? { forkedFromTurnCount: row.forked_from_turn_count } : {}),
    ...(goal ? { goal } : {}),
    ...(todos ? { todos } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function parseGoal(raw: string | null): ThreadGoal | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as ThreadGoal
  } catch {
    return null
  }
}

function parseTodos(raw: string | null): ThreadTodoList | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as ThreadTodoList
  } catch {
    return null
  }
}

function filterThreadSummaries(
  summaries: ThreadSummary[],
  options: ThreadStoreListOptions
): ThreadSummary[] {
  const query = options.search?.trim().toLowerCase()
  let out = summaries
  if (options.archivedOnly) {
    out = out.filter((thread) => thread.status === 'archived')
  } else if (!options.includeArchived) {
    out = out.filter((thread) => thread.status !== 'archived' && thread.status !== 'deleted')
  }
  if (!options.includeSide) {
    out = out.filter((thread) => (thread.relation ?? 'primary') !== 'side')
  }
  if (query) {
    out = out.filter((thread) => searchTextForSummary(thread).includes(query))
  }
  return typeof options.limit === 'number' ? out.slice(0, options.limit) : out
}

function searchTextForThread(thread: ThreadRecord, _preview: string): string {
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

function searchTextForSummary(thread: ThreadSummary): string {
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

function previewFromItems(items: TurnItem[]): string {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (!item) continue
    if (item.kind === 'user_message' || item.kind === 'assistant_text') {
      return item.text.slice(0, 500)
    }
    if (item.kind === 'error') return item.message.slice(0, 500)
    if (item.kind === 'tool_call') return (item.summary ?? item.toolName).slice(0, 500)
  }
  return ''
}

function usageRowFromEvent(event: RuntimeEvent & { kind: 'usage' }): UsageRow {
  return {
    thread_id: event.threadId,
    seq: event.seq,
    timestamp: event.timestamp,
    turn_id: event.turnId ?? null,
    model: event.model ?? null,
    usage_json: JSON.stringify(event.usage)
  }
}

function usageRecordsFromRows(rows: UsageRow[]): SessionUsageRecord[] {
  const previousByThread = new Map<string, UsageSnapshot>()
  const records: SessionUsageRecord[] = []
  for (const row of rows) {
    const usage = parseUsageSnapshot(row.usage_json)
    if (!usage) continue
    const previous = previousByThread.get(row.thread_id) ?? emptyUsageSnapshot()
    const delta = diffUsage(usage, previous)
    previousByThread.set(row.thread_id, usage)
    if (!hasUsage(delta)) continue
    records.push({
      threadId: row.thread_id,
      ...(row.turn_id ? { turnId: row.turn_id } : {}),
      ...(row.model ? { model: row.model } : {}),
      completedAt: row.timestamp,
      usage: delta
    })
  }
  return records
}

function latestUsageSnapshotsFromRows(rows: UsageRow[]): SessionLatestUsageSnapshot[] {
  return rows.flatMap((row) => {
    const usage = parseUsageSnapshot(row.usage_json)
    if (!usage) return []
    return [{
      threadId: row.thread_id,
      seq: row.seq,
      usage
    }]
  })
}

function parseUsageSnapshot(raw: string): UsageSnapshot | null {
  try {
    const parsed = UsageSnapshotSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function diffUsage(current: UsageSnapshot, previous: UsageSnapshot): UsageSnapshot {
  const promptTokens = diffNumber(current.promptTokens, previous.promptTokens)
  const completionTokens = diffNumber(current.completionTokens, previous.completionTokens)
  const reportedTotal = diffNumber(current.totalTokens, previous.totalTokens)
  const totalTokens = reportedTotal || promptTokens + completionTokens
  const cachedTokens = diffOptionalNumber(current.cachedTokens, previous.cachedTokens)
  const cacheHitTokens = diffOptionalNumber(current.cacheHitTokens, previous.cacheHitTokens)
  const cacheMissTokens = diffOptionalNumber(current.cacheMissTokens, previous.cacheMissTokens)
  const cacheTotal = (cacheHitTokens ?? 0) + (cacheMissTokens ?? 0)
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    ...(cachedTokens !== undefined ? { cachedTokens } : {}),
    ...(cacheHitTokens !== undefined ? { cacheHitTokens } : {}),
    ...(cacheMissTokens !== undefined ? { cacheMissTokens } : {}),
    cacheHitRate: cacheHitTokens !== undefined && cacheTotal > 0 ? cacheHitTokens / cacheTotal : null,
    ...(current.cacheableTokenHitRate !== undefined
      ? { cacheableTokenHitRate: current.cacheableTokenHitRate }
      : {}),
    ...(current.totalInputTokenHitRate !== undefined
      ? { totalInputTokenHitRate: current.totalInputTokenHitRate }
      : {}),
    ...(current.cacheMissReasons ? { cacheMissReasons: [...current.cacheMissReasons] } : {}),
    ...(current.cacheSuggestions ? { cacheSuggestions: [...current.cacheSuggestions] } : {}),
    turns: diffNumber(current.turns, previous.turns),
    ...(current.costUsd !== undefined || previous.costUsd !== undefined
      ? { costUsd: diffNumber(current.costUsd ?? 0, previous.costUsd ?? 0) }
      : {}),
    ...(current.costCny !== undefined || previous.costCny !== undefined
      ? { costCny: diffNumber(current.costCny ?? 0, previous.costCny ?? 0) }
      : {}),
    ...(current.cacheSavingsUsd !== undefined || previous.cacheSavingsUsd !== undefined
      ? { cacheSavingsUsd: diffNumber(current.cacheSavingsUsd ?? 0, previous.cacheSavingsUsd ?? 0) }
      : {}),
    ...(current.cacheSavingsCny !== undefined || previous.cacheSavingsCny !== undefined
      ? { cacheSavingsCny: diffNumber(current.cacheSavingsCny ?? 0, previous.cacheSavingsCny ?? 0) }
      : {}),
    ...(current.tokenEconomySavingsTokens !== undefined || previous.tokenEconomySavingsTokens !== undefined
      ? {
          tokenEconomySavingsTokens: diffNumber(
            current.tokenEconomySavingsTokens ?? 0,
            previous.tokenEconomySavingsTokens ?? 0
          )
        }
      : {}),
    ...(current.tokenEconomySavingsUsd !== undefined || previous.tokenEconomySavingsUsd !== undefined
      ? {
          tokenEconomySavingsUsd: diffNumber(
            current.tokenEconomySavingsUsd ?? 0,
            previous.tokenEconomySavingsUsd ?? 0
          )
        }
      : {}),
    ...(current.tokenEconomySavingsCny !== undefined || previous.tokenEconomySavingsCny !== undefined
      ? {
          tokenEconomySavingsCny: diffNumber(
            current.tokenEconomySavingsCny ?? 0,
            previous.tokenEconomySavingsCny ?? 0
          )
        }
      : {}),
    ...(current.hasError ? { hasError: true } : {})
  }
}

function diffNumber(current: number, previous: number): number {
  return Math.max(0, current - previous)
}

function diffOptionalNumber(current?: number, previous?: number): number | undefined {
  if (current === undefined && previous === undefined) return undefined
  return Math.max(0, (current ?? 0) - (previous ?? 0))
}

function hasUsage(usage: UsageSnapshot): boolean {
  return usage.promptTokens > 0
    || usage.completionTokens > 0
    || usage.totalTokens > 0
    || (usage.cachedTokens ?? 0) > 0
    || (usage.cacheHitTokens ?? 0) > 0
    || (usage.cacheMissTokens ?? 0) > 0
    || usage.turns > 0
    || (usage.costUsd ?? 0) > 0
    || (usage.costCny ?? 0) > 0
    || (usage.cacheSavingsUsd ?? 0) > 0
    || (usage.cacheSavingsCny ?? 0) > 0
    || (usage.tokenEconomySavingsTokens ?? 0) > 0
    || (usage.tokenEconomySavingsUsd ?? 0) > 0
    || (usage.tokenEconomySavingsCny ?? 0) > 0
}

function isoToMillis(value: string): number {
  const millis = Date.parse(value)
  return Number.isFinite(millis) ? millis : 0
}

function escapeLike(value: string): string {
  return value.replace(/[%_]/g, (match) => `\\${match}`)
}

function addColumnIfMissing(db: BetterSqliteDatabase, table: string, columnSql: string): void {
  const column = columnSql.trim().split(/\s+/)[0]
  if (!column) return
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    if (rows.some((row) => row.name === column)) return
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnSql}`)
  } catch (error) {
    warnSqlite(`add column ${column}`, error)
  }
}

const THREAD_RECORD_CACHE_LIMIT = 8
const METADATA_COMPACT_MIN_BYTES = 1_000_000

async function fileSignature(path: string): Promise<string> {
  try {
    const stats = await stat(path)
    return `${stats.size}:${stats.mtimeMs}`
  } catch {
    return 'missing'
  }
}

async function appendJsonlLine(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const handle = await open(path, 'a')
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf-8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

function warnSqlite(action: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.warn(`[kun] hybrid sqlite ${action} failed; using JSONL fallback: ${message}`)
}

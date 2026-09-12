import { createHash } from 'node:crypto'
import { chmod, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Database } from 'better-sqlite3'
import { z } from 'zod'
import {
  RoomDocumentKindSchema,
  RoomStoreCommitSchema,
  RoomStoreConflictError,
  RoomStoreListOptionsSchema,
  RoomListOptionsSchema,
  type RoomDocumentKind,
  type RoomStoredDocument,
  type RoomStore,
  type RoomStoreCommit,
  type RoomStoreCommitResult,
  type RoomStoreEvent,
  type RoomStoreListOptions,
  type RoomStoreRequest,
  type RoomListOptions,
  type RoomListPage
} from './room-store.js'

type DocumentRow = {
  kind: RoomDocumentKind
  id: string
  room_id: string | null
  task_id: string | null
  revision: number
  seq: number
  document: string
}
type RequestRow = { fingerprint: string; result: string; events: string }
type EventRow = { seq: number; room_id: string; kind: string; payload: string; created_at: string }

/** Only Service Manager opens the canonical database; tests may use an isolated path. */
export class SqliteRoomStore implements RoomStore {
  private opening: Promise<Database> | undefined
  private closed = false

  constructor(private readonly input: { path: string }) {}

  async get<T = unknown>(kind: RoomDocumentKind, id: string): Promise<RoomStoredDocument<T> | null> {
    RoomDocumentKindSchema.parse(kind)
    const db = await this.database()
    const row = db.prepare('SELECT * FROM room_documents WHERE kind = ? AND id = ?')
      .get(kind, id) as DocumentRow | undefined
    return row ? document<T>(row) : null
  }

  async list<T = unknown>(kind: RoomDocumentKind, options: RoomStoreListOptions = {}): Promise<RoomStoredDocument<T>[]> {
    RoomDocumentKindSchema.parse(kind)
    const parsed = RoomStoreListOptionsSchema.parse(options)
    const db = await this.database()
    const clauses = ['kind = ?']
    const args: (string | number)[] = [kind]
    if (parsed.roomId) { clauses.push('room_id = ?'); args.push(parsed.roomId) }
    if (parsed.taskId) { clauses.push('task_id = ?'); args.push(parsed.taskId) }
    if (kind === 'room') {
      if (parsed.archivedOnly) clauses.push('archived = 1')
      else if (!parsed.includeArchived) clauses.push('archived = 0')
    }
    if (parsed.beforeSeq !== undefined) { clauses.push('seq < ?'); args.push(parsed.beforeSeq) }
    if (parsed.afterSeq !== undefined) { clauses.push('seq > ?'); args.push(parsed.afterSeq) }
    if (parsed.status !== undefined) {
      const statuses = Array.isArray(parsed.status) ? parsed.status : [parsed.status]
      if (statuses.length === 0) return []
      clauses.push(`status IN (${statuses.map(() => '?').join(',')})`)
      args.push(...statuses)
    }
    args.push(parsed.limit)
    const rows = db.prepare(`SELECT * FROM room_documents WHERE ${clauses.join(' AND ')}
      ORDER BY seq ${parsed.order === 'asc' ? 'ASC' : 'DESC'} LIMIT ?`).all(...args) as DocumentRow[]
    return rows.map((row) => document<T>(row))
  }

  async listRooms(options: RoomListOptions = {}): Promise<RoomListPage> {
    const input = RoomListOptionsSchema.parse(options)
    const cursor = input.cursor ? decodeRoomCursor(input.cursor) : undefined
    const db = await this.database()
    const rows = db.prepare(`WITH candidates AS (
      SELECT room.*, COALESCE(json_extract(room.document, '$.pinned'), 0) AS pinned,
        COALESCE((SELECT MAX(message.seq) FROM room_documents message
          WHERE message.kind = 'message' AND message.room_id = room.id), 0) AS latest_message_seq
      FROM room_documents room WHERE room.kind = 'room' AND room.archived = ?
    ), ordered AS (
      SELECT *, CASE WHEN latest_message_seq > 0 THEN latest_message_seq ELSE seq END AS activity_seq FROM candidates
    ) SELECT * FROM ordered ${cursor ? 'WHERE (pinned, activity_seq, id) < (?, ?, ?)' : ''}
      ORDER BY pinned DESC, activity_seq DESC, id DESC LIMIT ?`).all(
      input.archivedOnly ? 1 : 0,
      ...(cursor ? [cursor.pinned, cursor.activitySeq, cursor.id] : []), input.limit + 1
    ) as Array<DocumentRow & { pinned: number; latest_message_seq: number; activity_seq: number }>
    const visible = rows.slice(0, input.limit)
    const last = visible.at(-1)
    return {
      rooms: visible.map((row) => ({ ...document<import('../contracts/rooms.js').Room>(row), latestMessageSeq: row.latest_message_seq })),
      ...(rows.length > input.limit && last ? { nextCursor: Buffer.from(JSON.stringify({
        pinned: last.pinned, activitySeq: last.activity_seq, id: last.id
      })).toString('base64url') } : {})
    }
  }

  async getRequest(requestId: string): Promise<RoomStoreRequest | null> {
    const db = await this.database()
    const row = this.requestRow(db, requestId)
    return row ? {
      requestId,
      fingerprint: row.fingerprint,
      result: JSON.parse(row.result),
      events: JSON.parse(row.events)
    } : null
  }

  async events(roomId: string, sinceSeq = 0, limit = 200): Promise<RoomStoreEvent[]> {
    z.number().int().nonnegative().parse(sinceSeq)
    z.number().int().min(1).max(1000).parse(limit)
    const db = await this.database()
    return (db.prepare('SELECT * FROM room_events WHERE room_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?')
      .all(roomId, sinceSeq, limit) as EventRow[]).map((row) => ({
      seq: row.seq,
      roomId: row.room_id,
      kind: row.kind,
      payload: JSON.parse(row.payload),
      createdAt: row.created_at
    }))
  }

  async commit(input: RoomStoreCommit, assertCurrent?: () => void): Promise<RoomStoreCommitResult> {
    // Snapshot caller-owned values before asynchronous initialization can yield.
    const parsed = RoomStoreCommitSchema.parse(JSON.parse(JSON.stringify(input)))
    const fingerprint = parsed.fingerprint ?? createHash('sha256')
      .update(JSON.stringify(canonical(parsed))).digest('hex')
    const db = await this.database()
    return db.transaction(() => {
      assertCurrent?.()
      // Deduplication precedes CAS: a lost response must replay its original result.
      const prior = this.requestRow(db, parsed.requestId)
      if (prior) {
        if (prior.fingerprint !== fingerprint) {
          throw new RoomStoreConflictError('room request identifier was reused with different content')
        }
        return { duplicate: true, result: JSON.parse(prior.result), events: JSON.parse(prior.events) }
      }
      const checks = new Map<string, number | null>()
      for (const check of parsed.checks) {
        const key = `${check.kind}:${check.id}`
        if (checks.has(key)) throw new RoomStoreConflictError('duplicate document revision check')
        checks.set(key, check.expectedRevision)
        const row = db.prepare('SELECT revision FROM room_documents WHERE kind = ? AND id = ?')
          .get(check.kind, check.id) as { revision: number } | undefined
        const revision = row?.revision ?? null
        if (revision !== check.expectedRevision) {
          throw new RoomStoreConflictError(`room ${check.kind} ${check.id} changed concurrently`, revision)
        }
      }
      const written = new Set<string>()
      for (const put of parsed.puts) {
        const key = `${put.kind}:${put.id}`
        if (!checks.has(key)) throw new RoomStoreConflictError('room document write requires a revision check')
        if (written.has(key)) throw new RoomStoreConflictError('duplicate document write')
        written.add(key)
        const current = db.prepare('SELECT * FROM room_documents WHERE kind = ? AND id = ?')
          .get(put.kind, put.id) as DocumentRow | undefined
        if (current && (put.kind === 'delivery' || put.kind === 'review' || put.kind === 'artifact')) {
          throw new RoomStoreConflictError(`room ${put.kind} versions are immutable`, current.revision)
        }
        const metadata = record(put.value)
        const roomId = put.roomId ?? stringValue(metadata.roomId) ?? (put.kind === 'room' ? put.id : undefined)
        const taskId = put.taskId ?? stringValue(metadata.taskId)
        if (current && (current.room_id !== (roomId ?? null) || current.task_id !== (taskId ?? null))) {
          throw new RoomStoreConflictError('room document ownership cannot change', current.revision)
        }
        const status = stringValue(metadata.status) ?? (put.kind === 'task' ? stringValue(record(metadata.task).status) : undefined)
        const args = [roomId ?? null, taskId ?? null, status ?? null,
          metadata.archivedAt ? 1 : 0, JSON.stringify(put.value)]
        if (args[4] === undefined) throw new Error('room document must be JSON serializable')
        if (current) {
          db.prepare(`UPDATE room_documents SET room_id = ?, task_id = ?, status = ?, archived = ?,
            document = ?, revision = revision + 1 WHERE kind = ? AND id = ?`).run(...args, put.kind, put.id)
        } else {
          db.prepare(`INSERT INTO room_documents
            (room_id, task_id, status, archived, document, kind, id, revision) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`)
            .run(...args, put.kind, put.id)
        }
      }
      const now = new Date().toISOString()
      const events: RoomStoreEvent[] = parsed.events.map((event) => {
        const inserted = db.prepare('INSERT INTO room_events (room_id, kind, payload, created_at) VALUES (?, ?, ?, ?)')
          .run(event.roomId, event.kind, JSON.stringify(event.payload ?? null), now)
        return { ...event, payload: event.payload ?? null, seq: Number(inserted.lastInsertRowid), createdAt: now }
      })
      const result = parsed.result ?? null
      db.prepare('INSERT INTO room_requests (id, fingerprint, result, events) VALUES (?, ?, ?, ?)')
        .run(parsed.requestId, fingerprint, JSON.stringify(result), JSON.stringify(events))
      return { duplicate: false, result, events }
    }).immediate()
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const database = await this.opening?.catch(() => undefined)
    database?.close()
  }

  async assertOwnership(): Promise<void> {
    if (this.closed) throw new Error('room store is closed')
  }

  private requestRow(db: Database, requestId: string): RequestRow | undefined {
    return db.prepare('SELECT fingerprint, result, events FROM room_requests WHERE id = ?')
      .get(requestId) as RequestRow | undefined
  }

  private database(): Promise<Database> {
    if (this.closed) return Promise.reject(new Error('room store is closed'))
    return this.opening ??= this.open()
  }

  private async open(): Promise<Database> {
    await mkdir(dirname(this.input.path), { recursive: true, mode: 0o700 })
    const { default: DatabaseConstructor } = await import('better-sqlite3')
    const db = new DatabaseConstructor(this.input.path)
    try {
      await chmod(this.input.path, 0o600)
      if (Number(db.pragma('user_version', { simple: true })) > 1) {
        throw new Error('room database was created by a newer Kun version')
      }
      db.pragma('journal_mode = WAL')
      db.pragma('synchronous = FULL')
      db.pragma('busy_timeout = 5000')
      db.exec(`
        CREATE TABLE IF NOT EXISTS room_documents (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, id TEXT NOT NULL,
          room_id TEXT, task_id TEXT, revision INTEGER NOT NULL, status TEXT,
          archived INTEGER NOT NULL DEFAULT 0, document TEXT NOT NULL, UNIQUE(kind, id)
        );
        CREATE INDEX IF NOT EXISTS room_documents_room ON room_documents(kind, room_id, seq);
        CREATE INDEX IF NOT EXISTS room_documents_task ON room_documents(kind, task_id, seq);
        CREATE INDEX IF NOT EXISTS room_documents_status ON room_documents(kind, status, seq);
        CREATE INDEX IF NOT EXISTS room_documents_archived ON room_documents(kind, archived, seq);
        CREATE TABLE IF NOT EXISTS room_events (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL, kind TEXT NOT NULL,
          payload TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS room_events_replay ON room_events(room_id, seq);
        CREATE TABLE IF NOT EXISTS room_requests (
          id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL, events TEXT NOT NULL
        );
        PRAGMA user_version = 1;
      `)
      return db
    } catch (error) {
      db.close()
      throw error
    }
  }
}

function document<T>(row: DocumentRow): RoomStoredDocument<T> {
  return {
    kind: row.kind, id: row.id, revision: row.revision, seq: row.seq,
    ...(row.room_id ? { roomId: row.room_id } : {}),
    ...(row.task_id ? { taskId: row.task_id } : {}),
    value: JSON.parse(row.document) as T
  }
}
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}
function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, canonical(child)]))
  }
  return value
}

function decodeRoomCursor(value: string) {
  try {
    return z.object({ pinned: z.union([z.literal(0), z.literal(1)]), activitySeq: z.number().int().nonnegative(),
      id: z.string().min(1).max(256) }).strict().parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')))
  } catch {
    throw new z.ZodError([{ code: 'custom', path: ['cursor'], message: 'invalid room page cursor' }])
  }
}

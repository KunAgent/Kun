import { createHash, randomUUID } from 'node:crypto'
import { lstat, open, opendir } from 'node:fs/promises'
import type { BigIntStats } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { TextDecoder } from 'node:util'
import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import { AttachmentMetadata, type AttachmentMetadata as AttachmentMetadataType } from '../contracts/attachments.js'
import { RuntimeEvent } from '../contracts/events.js'
import { TurnItem } from '../contracts/items.js'
import {
  ThreadStoreDiagnostic,
  ThreadStoreDiagnosticReport,
  type ThreadStoreArtifactStatus,
  type ThreadStoreDiagnosticIssue,
  type ThreadStoreDoctorLimits,
  type ThreadStoreMetadataSource
} from '../contracts/thread-store-diagnostics.js'
import { isSafeThreadId } from '../contracts/thread-id.js'
import { ThreadSchema, type ThreadRecord } from '../contracts/threads.js'
import { readBoundedFile, ScanBudget } from './thread-store-doctor-stability.js'
import { type ReadonlyIndexRow, type ReadonlyIndexState, REQUIRED_SQLITE_COLUMNS, REQUIRED_SQLITE_INDEXES, type SqliteColumnExpectation } from './thread-store-doctor-attachments.js'
import { inspectWal, isMissing, issue, listThreadIds, readonlySqliteBuffer, sameSnapshot, sameWalState } from './thread-store-doctor-support.js'

export async function openReadonlyIndex(
  path: string,
  budget: ScanBudget,
  maxArtifactBytes: number
): Promise<ReadonlyIndexState> {
  let handle: { close: () => void } | undefined
  const inert = (status: Exclude<ReadonlyIndexState['status'], 'ok'>): ReadonlyIndexState => ({
    status,
    index: null,
    verifyStable: async () => true
  })
  try {
    const walBefore = await inspectWal(`${path}-wal`)
    if (walBefore.kind === 'invalid') return inert('invalid')
    if (walBefore.kind === 'file' && walBefore.stat.size > 0n) return inert('changed')
    const main = await readBoundedFile(path, budget, maxArtifactBytes)
    if (main.kind === 'missing') return inert('missing')
    if (main.kind === 'artifact_limit' || main.kind === 'total_limit') return inert('limit_exceeded')
    if (main.kind === 'changed') return inert('changed')
    if (main.kind !== 'ok') return inert('invalid')
    const walAfterRead = await inspectWal(`${path}-wal`)
    if (!sameWalState(walBefore, walAfterRead)) return inert('changed')
    const sqlite = await import('better-sqlite3')
    const Database = sqlite.default
    // A Buffer-backed database is an isolated in-memory copy. Keep it writable
    // only long enough to probe the real HybridThreadStore write contract.
    const db = new Database(Buffer.from(readonlySqliteBuffer(main.bytes)))
    handle = db
    db.pragma('journal_mode = MEMORY')
    db.pragma('temp_store = MEMORY')
    const validation = validateReadonlyIndex(db)
    if (validation !== 'ok') {
      db.close()
      handle = undefined
      return inert(validation)
    }
    db.pragma('query_only = ON')
    const statement = db.prepare(
      'SELECT metadata_path, messages_path, events_path FROM threads WHERE id = ?'
    )
    const listStatement = db.prepare('SELECT id FROM threads ORDER BY id ASC LIMIT ?')
    return {
      status: 'ok',
      index: {
        getThread: (threadId) => statement.get(threadId) as ReadonlyIndexRow | undefined,
        listThreadIds: (limit) => {
          const rows = listStatement.all(limit + 1) as Array<{ id?: unknown }>
          const inspected = rows.slice(0, limit)
          return {
            threadIds: inspected
              .map((row) => row.id)
              .filter((id): id is string => typeof id === 'string' && isSafeThreadId(id)),
            overflow: rows.length > limit,
            invalidRows: rows.some((row) => (
              typeof row.id !== 'string' || !isSafeThreadId(row.id)
            ))
          }
        },
        close: () => db.close()
      },
      verifyStable: async () => {
        const [mainAfter, walAfter] = await Promise.all([
          lstat(path, { bigint: true }).catch(() => undefined),
          inspectWal(`${path}-wal`)
        ])
        return Boolean(
          mainAfter
          && sameSnapshot(main.stat, mainAfter)
          && sameWalState(walBefore, walAfter)
        )
      }
    }
  } catch (error) {
    handle?.close()
    return inert(isMissing(error) ? 'missing' : 'invalid')
  }
}

export function validateReadonlyIndex(
  db: BetterSqliteDatabase
): 'ok' | 'invalid' | 'mismatch' {
  try {
    const expectedTables = new Set(Object.keys(REQUIRED_SQLITE_COLUMNS))
    const persistedTables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' LIMIT ?
    `).all(expectedTables.size + 1) as Array<{ name?: unknown }>
    if (
      persistedTables.length !== expectedTables.size
      || persistedTables.some((table) => (
        typeof table.name !== 'string' || !expectedTables.has(table.name)
      ))
    ) return 'mismatch'

    const tableSql = db.prepare(
      "SELECT type, sql FROM sqlite_master WHERE name = ?"
    )
    for (const [table, expectedColumns] of Object.entries(REQUIRED_SQLITE_COLUMNS)) {
      const catalog = tableSql.get(table) as { type?: unknown; sql?: unknown } | undefined
      if (
        catalog?.type !== 'table'
        || typeof catalog.sql !== 'string'
        || containsSqlKeyword(catalog.sql, 'CHECK')
      ) return 'mismatch'
      const actualColumns = db.prepare(`
        SELECT name, type, "notnull", dflt_value, pk, hidden
        FROM pragma_table_xinfo(?)
      `).all(table) as Array<{
        name?: unknown
        type?: unknown
        notnull?: unknown
        pk?: unknown
        dflt_value?: unknown
        hidden?: unknown
      }>
      if (actualColumns.length !== expectedColumns.length) return 'mismatch'
      const actualByName = new Map(actualColumns.map((column) => [column.name, column]))
      for (const expected of expectedColumns) {
        const actual = actualByName.get(expected.name)
        if (
          !actual
          || String(actual.type).toUpperCase() !== expected.type
          || Number(actual.notnull) !== Number(expected.notNull)
          || Number(actual.pk) !== expected.primaryKeyPosition
          || (
            actual.dflt_value === null || actual.dflt_value === undefined
              ? null
              : String(actual.dflt_value)
          ) !== expected.defaultValue
          || Number(actual.hidden) !== 0
        ) return 'mismatch'
      }
      const foreignKey = db.prepare(
        'SELECT 1 FROM pragma_foreign_key_list(?) LIMIT 1'
      ).get(table)
      if (foreignKey) return 'mismatch'
    }

    const trigger = db.prepare(`
      SELECT 1 FROM sqlite_master
      WHERE type = 'trigger' AND tbl_name IN ('threads', 'usage_events')
      LIMIT 1
    `).get()
    if (trigger) return 'mismatch'

    for (const table of Object.keys(REQUIRED_SQLITE_COLUMNS)) {
      const indexes = readSqliteIndexList(db, table)
      if (indexes.some((index) => (
        index.partial
        || (index.unique && index.origin !== 'pk')
        || !hasSafeSqliteIndexShape(db, index.name)
      ))) return 'mismatch'
      const primary = indexes.filter((index) => index.origin === 'pk')
      if (primary.length !== 1 || !primary[0]) return 'mismatch'
      const primaryColumns = table === 'threads'
        ? [{ name: 'id', descending: false }]
        : [{ name: 'thread_id', descending: false }, { name: 'seq', descending: false }]
      if (!matchesSqliteIndex(db, primary[0].name, primaryColumns)) return 'mismatch'

      for (const expected of REQUIRED_SQLITE_INDEXES.filter((index) => index.table === table)) {
        const listed = indexes.find((index) => index.name === expected.name)
        if (
          !listed
          || listed.unique
          || listed.partial
          || listed.origin !== 'c'
          || !matchesSqliteIndex(db, expected.name, expected.columns)
        ) return 'mismatch'
      }
    }

    // At this point the database contains only the two owned tables and their
    // catalog-vetted objects, so a full check cannot evaluate unowned SQL.
    try {
      if (db.pragma('quick_check', { simple: true }) !== 'ok') return 'invalid'
    } catch {
      return 'invalid'
    }

    for (const [table, columns] of Object.entries(REQUIRED_SQLITE_COLUMNS)) {
      db.prepare(`SELECT ${columns.map((column) => column.name).join(', ')} FROM ${table} LIMIT 0`)
    }
    db.prepare('SELECT id FROM threads ORDER BY id ASC LIMIT ?')
    db.prepare('SELECT * FROM usage_events ORDER BY thread_id ASC, seq ASC')
    if (!probeHybridThreadStoreWrites(db)) return 'mismatch'
    return 'ok'
  } catch {
    return 'mismatch'
  }
}

export type SqliteListedIndex = {
  name: string
  unique: boolean
  origin: string
  partial: boolean
}

export function readSqliteIndexList(db: BetterSqliteDatabase, table: string): SqliteListedIndex[] {
  const rows = db.prepare(`
    SELECT name, "unique" AS is_unique, origin, partial
    FROM pragma_index_list(?)
  `).all(table) as Array<{
    name?: unknown
    is_unique?: unknown
    origin?: unknown
    partial?: unknown
  }>
  return rows.map((row) => ({
    name: String(row.name ?? ''),
    unique: Number(row.is_unique) === 1,
    origin: String(row.origin ?? ''),
    partial: Number(row.partial) === 1
  }))
}

export function matchesSqliteIndex(
  db: BetterSqliteDatabase,
  indexName: string,
  expected: ReadonlyArray<{ name: string; descending: boolean }>
): boolean {
  const actual = readSqliteIndexKeyColumns(db, indexName)
  if (actual.length !== expected.length) return false
  return expected.every((column, index) => {
    const candidate = actual[index]
    return Boolean(
      candidate
      && candidate.name === column.name
      && candidate.descending === column.descending
      && candidate.collation === 'BINARY'
    )
  })
}

export function readSqliteIndexKeyColumns(
  db: BetterSqliteDatabase,
  indexName: string
): Array<{ name: unknown; descending: boolean; collation: unknown }> {
  return (db.prepare(`
    SELECT seqno, name, desc, coll, key
    FROM pragma_index_xinfo(?)
  `).all(indexName) as Array<{
    seqno?: unknown
    name?: unknown
    desc?: unknown
    coll?: unknown
    key?: unknown
  }>)
    .filter((column) => Number(column.key) === 1)
    .sort((left, right) => Number(left.seqno) - Number(right.seqno))
    .map((column) => ({
      name: column.name,
      descending: Number(column.desc) === 1,
      collation: column.coll
    }))
}

export function hasSafeSqliteIndexShape(db: BetterSqliteDatabase, indexName: string): boolean {
  const columns = readSqliteIndexKeyColumns(db, indexName)
  return columns.length > 0 && columns.every((column) => (
    typeof column.name === 'string' && column.collation === 'BINARY'
  ))
}

export function probeHybridThreadStoreWrites(db: BetterSqliteDatabase): boolean {
  let savepointStarted = false
  try {
    const [firstId, secondId] = findWriteProbeThreadIds(db)
    const threadUpsert = db.prepare(`
      INSERT INTO threads (
        id, title, workspace, model, agent_surface, mode, status, approval_policy, sandbox_mode, approval_reviewer,
        model_request_capture_enabled,
        cost_budget_usd, cost_budget_warning_sent, relation, parent_thread_id,
        forked_from_thread_id, forked_from_title, forked_at, forked_from_message_count,
        forked_from_turn_count, goal_json, todos_json, extension_metadata_json,
        created_at, updated_at, created_at_ms, updated_at_ms, preview, message_count,
        event_seq_high_water, metadata_path, messages_path, events_path, search_text
      ) VALUES (
        @id, @title, @workspace, @model, @agent_surface, @mode, @status, @approval_policy, @sandbox_mode, @approval_reviewer,
        @model_request_capture_enabled,
        @cost_budget_usd, @cost_budget_warning_sent, @relation, @parent_thread_id,
        @forked_from_thread_id, @forked_from_title, @forked_at, @forked_from_message_count,
        @forked_from_turn_count, @goal_json, @todos_json, @extension_metadata_json,
        @created_at, @updated_at, @created_at_ms, @updated_at_ms, @preview, @message_count,
        @event_seq_high_water, @metadata_path, @messages_path, @events_path, @search_text
      ) ON CONFLICT(id) DO UPDATE SET
        title=excluded.title, workspace=excluded.workspace, model=excluded.model,
        agent_surface=excluded.agent_surface,
        mode=excluded.mode, status=excluded.status,
        approval_policy=excluded.approval_policy, sandbox_mode=excluded.sandbox_mode,
        approval_reviewer=excluded.approval_reviewer,
        model_request_capture_enabled=excluded.model_request_capture_enabled,
        cost_budget_usd=excluded.cost_budget_usd,
        cost_budget_warning_sent=excluded.cost_budget_warning_sent,
        relation=excluded.relation, parent_thread_id=excluded.parent_thread_id,
        forked_from_thread_id=excluded.forked_from_thread_id,
        forked_from_title=excluded.forked_from_title, forked_at=excluded.forked_at,
        forked_from_message_count=excluded.forked_from_message_count,
        forked_from_turn_count=excluded.forked_from_turn_count,
        goal_json=excluded.goal_json, todos_json=excluded.todos_json,
        extension_metadata_json=excluded.extension_metadata_json,
        created_at=excluded.created_at, updated_at=excluded.updated_at,
        created_at_ms=excluded.created_at_ms, updated_at_ms=excluded.updated_at_ms,
        preview=excluded.preview, message_count=excluded.message_count,
        event_seq_high_water=MAX(threads.event_seq_high_water, excluded.event_seq_high_water),
        metadata_path=excluded.metadata_path, messages_path=excluded.messages_path,
        events_path=excluded.events_path, search_text=excluded.search_text
    `)
    const usageUpsert = db.prepare(`
      INSERT INTO usage_events (
        thread_id, seq, timestamp, turn_id, model, usage_json
      ) VALUES (
        @thread_id, @seq, @timestamp, @turn_id, @model, @usage_json
      ) ON CONFLICT(thread_id, seq) DO UPDATE SET
        timestamp=excluded.timestamp, turn_id=excluded.turn_id,
        model=excluded.model, usage_json=excluded.usage_json
    `)

    db.exec('SAVEPOINT kun_doctor_write_probe')
    savepointStarted = true
    threadUpsert.run(threadWriteProbeRow(firstId, 'Kun doctor schema probe'))
    threadUpsert.run(threadWriteProbeRow(firstId, 'Kun doctor schema probe updated'))
    threadUpsert.run(threadWriteProbeRow(secondId, 'KUN DOCTOR SCHEMA PROBE'))
    const defaults = db.prepare(`
      SELECT id, model_request_capture_enabled, usage_backfilled, usage_backfill_high_water
      FROM threads WHERE id IN (?, ?)
    `).all(firstId, secondId) as Array<{
      id?: unknown
      model_request_capture_enabled?: unknown
      usage_backfilled?: unknown
      usage_backfill_high_water?: unknown
    }>
    if (
      defaults.length !== 2
      || defaults.some((row) => row.model_request_capture_enabled !== 0)
      || defaults.some((row) => row.usage_backfilled !== 0)
      || defaults.some((row) => row.usage_backfill_high_water !== 0)
    ) throw new Error('unexpected thread index default')

    const timestamp = '2099-01-01T00:00:00.000Z'
    const usageJson = JSON.stringify({
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
      cacheHitRate: null,
      turns: 1
    })
    usageUpsert.run(usageWriteProbeRow(firstId, 1, timestamp, usageJson))
    usageUpsert.run(usageWriteProbeRow(secondId, 1, timestamp, usageJson))

    db.exec('ROLLBACK TO kun_doctor_write_probe')
    db.exec('RELEASE kun_doctor_write_probe')
    savepointStarted = false
    return true
  } catch {
    if (savepointStarted) {
      try {
        db.exec('ROLLBACK TO kun_doctor_write_probe')
      } catch {
        // The failed statement may already have ended the savepoint.
      }
      try {
        db.exec('RELEASE kun_doctor_write_probe')
      } catch {
        // The write probe runs only on an isolated in-memory database.
      }
    }
    return false
  }
}

export function findWriteProbeThreadIds(db: BetterSqliteDatabase): [string, string] {
  const candidates = Array.from({ length: 4 }, () => {
    const suffix = randomUUID().toLowerCase()
    const first = `thr_kun_doctor_probe_${suffix}`
    const second = `thr_kun_doctor_probe_${suffix.toUpperCase()}`
    if (!isSafeThreadId(first) || !isSafeThreadId(second)) {
      throw new Error('generated invalid SQLite write-probe thread id')
    }
    return [first, second] as const
  })
  const flattened = candidates.flat()
  const placeholders = flattened.map(() => '?').join(', ')
  const rows = db.prepare(`
    SELECT id FROM threads WHERE id IN (${placeholders})
  `).all(...flattened) as Array<{ id?: unknown }>
  const occupied = new Set(rows
    .map((row) => row.id)
    .filter((id): id is string => typeof id === 'string')
    .map((id) => id.toLowerCase()))
  for (const [first, second] of candidates) {
    if (!occupied.has(first)) return [first, second]
  }
  throw new Error('no available thread id for SQLite write probe')
}

export function threadWriteProbeRow(id: string, title: string): Record<string, string | number | null> {
  const root = `/kun-doctor/${id}`
  const timestamp = '2099-01-01T00:00:00.000Z'
  return {
    id,
    title,
    workspace: root,
    model: 'deepseek-chat',
    agent_surface: 'code',
    mode: 'agent',
    status: 'idle',
    approval_policy: 'on-request',
    sandbox_mode: 'workspace-write',
    approval_reviewer: 'user',
    model_request_capture_enabled: 0,
    cost_budget_usd: null,
    cost_budget_warning_sent: null,
    relation: 'primary',
    parent_thread_id: null,
    forked_from_thread_id: null,
    forked_from_title: null,
    forked_at: null,
    forked_from_message_count: null,
    forked_from_turn_count: null,
    goal_json: null,
    todos_json: null,
    extension_metadata_json: null,
    created_at: timestamp,
    updated_at: timestamp,
    created_at_ms: Date.parse(timestamp),
    updated_at_ms: Date.parse(timestamp),
    preview: null,
    message_count: 0,
    event_seq_high_water: 0,
    metadata_path: `${root}/metadata.jsonl`,
    messages_path: `${root}/messages.jsonl`,
    events_path: `${root}/events.jsonl`,
    search_text: title.toLowerCase()
  }
}

export function usageWriteProbeRow(
  threadId: string,
  seq: number,
  timestamp: string,
  usageJson: string
): Record<string, string | number | null> {
  return {
    thread_id: threadId,
    seq,
    timestamp,
    turn_id: 'turn_kun_doctor_probe',
    model: 'deepseek-chat',
    usage_json: usageJson
  }
}

export function containsSqlKeyword(sql: string, keyword: string): boolean {
  let index = 0
  while (index < sql.length) {
    const current = sql[index]
    const next = sql[index + 1]
    if (current === "'" || current === '"' || current === '`') {
      const quote = current
      index += 1
      while (index < sql.length) {
        if (sql[index] !== quote) {
          index += 1
          continue
        }
        if (sql[index + 1] === quote) {
          index += 2
          continue
        }
        index += 1
        break
      }
      continue
    }
    if (current === '[') {
      index += 1
      while (index < sql.length && sql[index] !== ']') index += 1
      index += 1
      continue
    }
    if (current === '-' && next === '-') {
      index += 2
      while (index < sql.length && sql[index] !== '\n') index += 1
      continue
    }
    if (current === '/' && next === '*') {
      index += 2
      while (index < sql.length && !(sql[index] === '*' && sql[index + 1] === '/')) {
        index += 1
      }
      index += 2
      continue
    }
    if (isSqlIdentifierCharacter(current)) {
      const start = index
      while (index < sql.length && isSqlIdentifierCharacter(sql[index])) index += 1
      if (sql.slice(start, index).toUpperCase() === keyword) return true
      continue
    }
    index += 1
  }
  return false
}

export function isSqlIdentifierCharacter(value: string | undefined): boolean {
  if (!value) return false
  const code = value.charCodeAt(0)
  return (code >= 48 && code <= 57)
    || (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122)
    || value === '_'
    || value === '$'
}

export function sqliteColumn(
  name: string,
  type: SqliteColumnExpectation['type'],
  notNull: boolean,
  primaryKeyPosition = 0,
  defaultValue: string | null = null
): SqliteColumnExpectation {
  return {
    name,
    type,
    notNull,
    primaryKeyPosition,
    defaultValue
  }
}

export function sqliteIndex<
  const Table extends string,
  const Name extends string,
  const Columns extends ReadonlyArray<readonly [string, boolean]>
>(table: Table, name: Name, columns: Columns): {
  table: Table
  name: Name
  columns: ReadonlyArray<{ name: string; descending: boolean }>
} {
  return {
    table,
    name,
    columns: columns.map(([columnName, descending]) => ({ name: columnName, descending }))
  }
}

export function inspectSqliteIndex(
  sqlite: ReadonlyIndexState,
  threadId: string,
  threadRoot: string
): { status: ThreadStoreArtifactStatus; issues: ThreadStoreDiagnosticIssue[] } {
  if (sqlite.status === 'missing') {
    return {
      status: 'missing',
      issues: [issue('missing_sqlite_index', 'The rebuildable SQLite index is missing.', 'warning')]
    }
  }
  if (sqlite.status === 'changed') {
    return {
      status: 'changed',
      issues: [issue(
        'sqlite_index_changed',
        'The SQLite index has a non-empty or changing WAL; retry while the store is quiescent.',
        'warning'
      )]
    }
  }
  if (sqlite.status === 'limit_exceeded') {
    return {
      status: 'limit_exceeded',
      issues: [issue(
        'sqlite_index_limit_exceeded',
        'The SQLite index could not be inspected within configured byte limits.',
        'warning'
      )]
    }
  }
  if (sqlite.status === 'mismatch') {
    return {
      status: 'mismatch',
      issues: [issue(
        'sqlite_index_schema_mismatch',
        'The SQLite index does not match the schema required by HybridThreadStore.',
        'error'
      )]
    }
  }
  if (sqlite.status === 'invalid' || !sqlite.index) {
    return {
      status: 'invalid',
      issues: [issue('invalid_sqlite_index', 'The SQLite index could not be queried read-only.', 'error')]
    }
  }
  try {
    const row = sqlite.index.getThread(threadId)
    if (!row) {
      return {
        status: 'mismatch',
        issues: [issue('sqlite_index_mismatch', 'The SQLite index has no matching thread row.', 'warning')]
      }
    }
    const expected: ReadonlyIndexRow = {
      metadata_path: join(threadRoot, 'metadata.jsonl'),
      messages_path: join(threadRoot, 'messages.jsonl'),
      events_path: join(threadRoot, 'events.jsonl')
    }
    const mismatch = (Object.keys(expected) as Array<keyof ReadonlyIndexRow>)
      .some((key) => resolve(String(row[key] ?? '')) !== resolve(String(expected[key])))
    return mismatch
      ? {
          status: 'mismatch',
          issues: [issue('sqlite_index_mismatch', 'The SQLite index paths do not match canonical storage.', 'warning')]
        }
      : { status: 'ok', issues: [] }
  } catch {
    return {
      status: 'invalid',
      issues: [issue('invalid_sqlite_index', 'The SQLite index query failed.', 'error')]
    }
  }
}

export function globalSqliteIssue(
  status: ReadonlyIndexState['status']
): ThreadStoreDiagnosticIssue | undefined {
  if (status === 'changed') {
    return issue(
      'sqlite_index_changed',
      'The SQLite index has a non-empty or changing WAL; retry while the store is quiescent.',
      'warning'
    )
  }
  if (status === 'limit_exceeded') {
    return issue(
      'sqlite_index_limit_exceeded',
      'The SQLite index could not be inspected within configured byte limits.',
      'warning'
    )
  }
  if (status === 'invalid') {
    return issue(
      'invalid_sqlite_index',
      'The rebuildable SQLite index is invalid and could not be queried from a bounded in-memory snapshot.',
      'error'
    )
  }
  if (status === 'mismatch') {
    return issue(
      'sqlite_index_schema_mismatch',
      'The rebuildable SQLite index does not match the schema required by HybridThreadStore.',
      'error'
    )
  }
  return undefined
}

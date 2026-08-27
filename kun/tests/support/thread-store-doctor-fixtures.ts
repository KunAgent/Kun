import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HybridThreadDocumentRepository } from '../../src/adapters/hybrid/hybrid-thread-documents.js'
import { HybridThreadStore } from '../../src/adapters/hybrid/hybrid-thread-store.js'
import type { ThreadRecord } from '../../src/contracts/threads.js'
import { createThreadRecord } from '../../src/domain/thread.js'
import { createTurnRecord } from '../../src/domain/turn.js'
import { scanThreadStore } from '../../src/services/thread-store-doctor.js'

export const roots: string[] = []
export const NOW = '2026-07-18T00:00:00.000Z'

export async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-thread-store-doctor-'))
  roots.push(root)
  return root
}

export type TestSqliteSchemaOptions = {
  usageBackfilledDefault?: 'none' | 'zero' | 'one'
  titleCheck?: boolean
  threadIdNoCase?: boolean
  generatedThreadColumn?: 'VIRTUAL' | 'STORED'
  legacyMigratedOrder?: boolean
}

export async function createSqliteVariant(
  root: string,
  options: TestSqliteSchemaOptions = {},
  mutate?: (db: BetterSqliteDatabase) => void
): Promise<void> {
  const sqlite = await import('better-sqlite3')
  const db = new sqlite.default(join(root, 'index.sqlite3'))
  try {
    createCanonicalSqliteSchema(db, options)
    mutate?.(db)
  } finally {
    db.close()
  }
}

export async function withRuntimeStore(
  root: string,
  action: (store: HybridThreadStore) => Promise<void>
): Promise<void> {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const store = new HybridThreadStore({ dataDir: root })
  try {
    await store.ready()
    await store.waitForBackfill()
    await action(store)
  } finally {
    await store.shutdown()
    warn.mockRestore()
  }
}

export async function readSqliteRow<T>(
  root: string,
  sql: string,
  ...params: Array<string | number>
): Promise<T | undefined> {
  const sqlite = await import('better-sqlite3')
  const db = new sqlite.default(join(root, 'index.sqlite3'), { readonly: true })
  try {
    return db.prepare(sql).get(...params) as T | undefined
  } finally {
    db.close()
  }
}

export async function expectDoctorSchemaMismatch(root: string): Promise<void> {
  const report = await scanThreadStore({ dataDir: root })
  expect(report.complete).toBe(false)
  expect(report.issues).toContainEqual(expect.objectContaining({
    code: 'sqlite_index_schema_mismatch',
    severity: 'error'
  }))
  for (const diagnostic of report.threads) expect(diagnostic.sqliteIndex).toBe('mismatch')
}

export async function writeCanonicalThread(
  root: string,
  thread: ThreadRecord
): Promise<string> {
  const threadRoot = join(root, 'threads', thread.id)
  await mkdir(threadRoot, { recursive: true })
  await writeFile(join(threadRoot, 'metadata.jsonl'), `${JSON.stringify({
    kind: 'thread_metadata',
    version: 1,
    timestamp: NOW,
    thread
  })}\n`)
  await writeFile(join(threadRoot, 'messages.jsonl'), '')
  await writeFile(join(threadRoot, 'events.jsonl'), '')
  return threadRoot
}

export async function writeAttachment(
  root: string,
  id: string,
  scopes: { threadIds: string[]; workspaces: string[] }
): Promise<void> {
  const content = Buffer.from('attachment payload')
  const attachmentRoot = join(root, 'attachments')
  await mkdir(attachmentRoot, { recursive: true })
  await writeFile(join(attachmentRoot, `${id}.json`), JSON.stringify({
    id,
    name: 'file.txt',
    kind: 'document',
    mimeType: 'text/plain',
    byteSize: content.length,
    hash: createHash('sha256').update(content).digest('hex'),
    threadIds: scopes.threadIds,
    workspaces: scopes.workspaces,
    createdAt: NOW,
    updatedAt: NOW
  }))
  await writeFile(join(attachmentRoot, `${id}.bin`), content)
}

export function createCanonicalSqliteSchema(
  db: BetterSqliteDatabase,
  options: TestSqliteSchemaOptions = {}
): void {
  const usageBackfilled = options.usageBackfilledDefault === 'none'
    ? 'INTEGER NOT NULL'
    : options.usageBackfilledDefault === 'one'
      ? 'INTEGER NOT NULL DEFAULT 1'
      : 'INTEGER NOT NULL DEFAULT 0'
  const titleCheck = options.titleCheck
    ? "TEXT NOT NULL CHECK (title <> 'Kun doctor schema probe')"
    : 'TEXT NOT NULL'
  const threadId = options.threadIdNoCase
    ? 'TEXT COLLATE NOCASE PRIMARY KEY'
    : 'TEXT PRIMARY KEY'
  const generatedThreadColumn = options.generatedThreadColumn
    ? `, generated_bomb BLOB GENERATED ALWAYS AS (zeroblob(1073741824)) ${options.generatedThreadColumn}`
    : ''
  const jsonColumnsBeforeDates = options.legacyMigratedOrder
    ? ''
    : `
      todos_json TEXT,
      extension_metadata_json TEXT,`
  const jsonColumnsAfterSearch = options.legacyMigratedOrder
    ? `
      todos_json TEXT,
      extension_metadata_json TEXT,`
    : ''
  db.exec(`
    CREATE TABLE threads (
      id ${threadId},
      title ${titleCheck},
      workspace TEXT NOT NULL,
      model TEXT NOT NULL,
      agent_surface TEXT,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      approval_policy TEXT NOT NULL,
      sandbox_mode TEXT NOT NULL,
      approval_reviewer TEXT NOT NULL DEFAULT 'user',
      model_request_capture_enabled INTEGER NOT NULL DEFAULT 0,
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
      ${jsonColumnsBeforeDates}
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
      search_text TEXT NOT NULL,
      ${jsonColumnsAfterSearch}
      usage_backfilled ${usageBackfilled},
      usage_backfill_high_water INTEGER NOT NULL DEFAULT 0${generatedThreadColumn}
    );
    CREATE INDEX threads_updated_idx
      ON threads(updated_at_ms DESC, id DESC);
    CREATE INDEX threads_workspace_updated_idx
      ON threads(workspace, updated_at_ms DESC, id DESC);
    CREATE INDEX threads_status_updated_idx
      ON threads(status, updated_at_ms DESC, id DESC);
    CREATE INDEX threads_relation_updated_idx
      ON threads(relation, updated_at_ms DESC, id DESC);
    CREATE TABLE usage_events (
      thread_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      turn_id TEXT,
      model TEXT,
      provider_id TEXT,
      usage_json TEXT NOT NULL,
      PRIMARY KEY(thread_id, seq)
    );
    CREATE INDEX usage_events_thread_seq_idx
      ON usage_events(thread_id, seq);
    CREATE INDEX usage_events_timestamp_idx
      ON usage_events(timestamp);
  `)
}

export function insertCanonicalIndexRow(
  db: BetterSqliteDatabase,
  input: { id: string | Buffer; threadRoot: string; thread?: ThreadRecord }
): void {
  const thread = input.thread
  const createdAt = thread?.createdAt ?? NOW
  const updatedAt = thread?.updatedAt ?? NOW
  db.prepare(`
    INSERT INTO threads (
      id, title, workspace, model, mode, status, approval_policy, sandbox_mode,
      relation, created_at, updated_at, created_at_ms, updated_at_ms,
      message_count, event_seq_high_water, metadata_path, messages_path,
      events_path, search_text, usage_backfilled
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    thread?.title ?? 'Indexed thread',
    thread?.workspace ?? '/workspace',
    thread?.model ?? 'deepseek-chat',
    thread?.mode ?? 'agent',
    thread?.status ?? 'idle',
    thread?.approvalPolicy ?? 'on-request',
    thread?.sandboxMode ?? 'workspace-write',
    thread?.relation ?? 'primary',
    createdAt,
    updatedAt,
    Date.parse(createdAt),
    Date.parse(updatedAt),
    0,
    0,
    join(input.threadRoot, 'metadata.jsonl'),
    join(input.threadRoot, 'messages.jsonl'),
    join(input.threadRoot, 'events.jsonl'),
    thread?.title ?? 'Indexed thread',
    0
  )
}

export async function snapshotFiles(root: string): Promise<Record<string, string>> {
  const output: Record<string, string> = {}
  const visit = async (directory: string, prefix = ''): Promise<void> => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = join(prefix, entry.name)
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path, relative)
      else if (entry.isFile()) {
        const info = await stat(path)
        output[relative] = `${info.size}:${(await readFile(path)).toString('base64')}`
      }
    }
  }
  await visit(root)
  return output
}

import { readFile, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { AttachmentMetadata } from '../contracts/attachments.js'
import { RuntimeEvent } from '../contracts/events.js'
import {
  ThreadStoreDiagnostic,
  ThreadStoreDiagnosticReport,
  type ThreadStoreArtifactStatus,
  type ThreadStoreDiagnosticIssue
} from '../contracts/thread-store-diagnostics.js'
import { ThreadSchema, type ThreadRecord } from '../contracts/threads.js'
import { isSafeThreadId } from '../contracts/thread-id.js'

const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024
const MAX_JSONL_RECORDS = 100_000

export type ThreadStoreDoctorOptions = {
  dataDir: string
  sqlitePath?: string
  attachmentRootDir?: string
  nowIso?: () => string
}

type JsonlInspection = {
  status: ThreadStoreArtifactStatus
  records: unknown[]
  issues: ThreadStoreDiagnosticIssue[]
}

type AttachmentIndex = {
  valid: Map<string, { metadata: AttachmentMetadata; contentExists: boolean }>
  invalidIds: Set<string>
}

/** Read-only health scan for the JSONL/SQLite/attachment thread store. */
export async function scanThreadStore(
  options: ThreadStoreDoctorOptions
): Promise<ThreadStoreDiagnosticReport> {
  const checkedAt = options.nowIso?.() ?? new Date().toISOString()
  const threadsRoot = resolve(options.dataDir, 'threads')
  const attachmentIndex = await loadAttachmentIndex(options.attachmentRootDir)
  const sqlite = await openReadonlyIndex(options.sqlitePath ?? join(options.dataDir, 'index.sqlite3'))
  const diagnostics: ThreadStoreDiagnostic[] = []

  try {
    const entries = await readdir(threadsRoot, { withFileTypes: true })
    const threadIds = entries
      .filter((entry) => entry.isDirectory() && isSafeThreadId(entry.name))
      .map((entry) => entry.name)
      .sort()

    for (const threadId of threadIds) {
      diagnostics.push(await scanThread({
        threadId,
        threadsRoot,
        attachmentIndex,
        sqlite,
        checkedAt
      }))
    }
  } catch (error) {
    if (!isMissing(error)) throw error
  } finally {
    sqlite.index?.close()
  }

  return ThreadStoreDiagnosticReport.parse({
    schemaVersion: 1,
    checkedAt,
    threads: diagnostics
  })
}

async function scanThread(input: {
  threadId: string
  threadsRoot: string
  attachmentIndex: AttachmentIndex
  sqlite: ReadonlyIndexState
  checkedAt: string
}): Promise<ThreadStoreDiagnostic> {
  const threadRoot = join(input.threadsRoot, input.threadId)
    const metadata = await inspectMetadata(threadRoot, input.threadId)
  const events = await inspectEvents(join(threadRoot, 'events.jsonl'), input.threadId)
  const sqliteIndex = await inspectSqliteIndex(input.sqlite, input.threadId, threadRoot)
  const attachments = inspectAttachments(metadata.records, input.attachmentIndex)
  const issues = [...metadata.issues, ...events.issues, ...sqliteIndex.issues, ...attachments.issues].slice(0, 64)

  return ThreadStoreDiagnostic.parse({
    threadId: input.threadId,
    metadata: metadata.status,
    events: events.status,
    sqliteIndex: sqliteIndex.status,
    attachments: attachments.status,
    recoverable: isRecoverable(metadata.status, events.status, attachments.status),
    issues,
    checkedAt: input.checkedAt
  })
}

async function inspectMetadata(threadRoot: string, threadId: string): Promise<JsonlInspection> {
  const metadataPath = join(threadRoot, 'metadata.jsonl')
  const metadata = await inspectJsonl(metadataPath)
  if (metadata.status !== 'missing') {
    const issues = [...metadata.issues]
    let validRecord = false
    for (const entry of metadata.records) {
      if (!isRecord(entry) || entry.kind !== 'thread_metadata') continue
      const parsed = ThreadSchema.safeParse(entry.thread)
      if (parsed.success && parsed.data.id === threadId) validRecord = true
    }
    if (!validRecord) {
      issues.push(issue('invalid_metadata', 'No valid thread metadata record was found.', 'error'))
      return { status: 'invalid', records: [], issues }
    }
    return { ...metadata, issues }
  }

  const legacyPath = join(threadRoot, 'thread.json')
  try {
    const raw = await readBoundedFile(legacyPath)
    const parsed = ThreadSchema.safeParse(JSON.parse(raw))
    if (!parsed.success || parsed.data.id !== threadId) {
      return {
        status: 'invalid',
        records: [],
        issues: [issue('invalid_metadata', 'The legacy thread metadata is invalid.', 'error')]
      }
    }
    return { status: 'ok', records: [parsed.data], issues: [] }
  } catch (error) {
    if (isMissing(error)) {
      return {
        status: 'missing',
        records: [],
        issues: [issue('missing_metadata', 'No thread metadata file was found.', 'error')]
      }
    }
    return {
      status: 'invalid',
      records: [],
      issues: [issue('invalid_metadata', 'The thread metadata could not be read.', 'error')]
    }
  }
}

async function inspectEvents(path: string, threadId: string): Promise<JsonlInspection> {
  const inspection = await inspectJsonl(path)
  const issues = [...inspection.issues]
  let validEvents = 0
  for (const entry of inspection.records) {
    const parsed = RuntimeEvent.safeParse(entry)
    if (parsed.success && parsed.data.threadId === threadId) validEvents += 1
  }
  if (inspection.status === 'ok' && inspection.records.length > 0 && validEvents === 0) {
    issues.push(issue('invalid_events', 'No valid events for this thread were found.', 'error'))
    return { status: 'invalid', records: [], issues }
  }
  return { ...inspection, issues }
}

async function inspectJsonl(path: string): Promise<JsonlInspection> {
  let raw: string
  try {
    raw = await readBoundedFile(path)
  } catch (error) {
    if (isMissing(error)) return { status: 'missing', records: [], issues: [] }
    return {
      status: 'invalid',
      records: [],
      issues: [issue('unreadable_artifact', 'A persisted JSONL artifact could not be read.', 'error')]
    }
  }
  if (!raw.trim()) return { status: 'missing', records: [], issues: [] }

  const records: unknown[] = []
  let malformed = false
  let malformedFinal = false
  let malformedNonFinal = false
  const lines = raw.split('\n')
  let nonEmptyIndex = -1
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line) continue
    nonEmptyIndex = index
    try {
      records.push(JSON.parse(line))
    } catch {
      malformed = true
      const isFinal = index === lines.length - 1 || lines.slice(index + 1).every((rest) => !rest.trim())
      malformedFinal ||= isFinal
      malformedNonFinal ||= !isFinal
    }
    if (records.length > MAX_JSONL_RECORDS) {
      return {
        status: 'invalid',
        records: [],
        issues: [issue('artifact_too_large', 'A JSONL artifact contains too many records.', 'error')]
      }
    }
  }
  if (nonEmptyIndex < 0) return { status: 'missing', records: [], issues: [] }
  if (!malformed) return { status: 'ok', records, issues: [] }
  if (!malformedNonFinal && malformedFinal) {
    return {
      status: 'truncated',
      records,
      issues: [issue('truncated_artifact', 'The JSONL artifact ends with an incomplete record.', 'warning')]
    }
  }
  return {
    status: 'invalid',
    records: [],
    issues: [issue('invalid_artifact', 'The JSONL artifact contains malformed records.', 'error')]
  }
}

function inspectAttachments(records: unknown[], index: AttachmentIndex): {
  status: ThreadStoreArtifactStatus
  issues: ThreadStoreDiagnosticIssue[]
} {
  const thread = records
    .map((entry) => {
      if (isRecord(entry) && entry.kind === 'thread_metadata') return ThreadSchema.safeParse(entry.thread)
      return ThreadSchema.safeParse(entry)
    })
    .find((result): result is { success: true; data: ThreadRecord } => result.success)?.data
  if (!thread) return { status: 'ok', issues: [] }

  const ids = new Set<string>()
  for (const turn of thread.turns) {
    for (const id of turn.attachmentIds ?? []) ids.add(id)
    for (const item of turn.items) {
      if ('attachmentIds' in item) {
        for (const id of item.attachmentIds ?? []) ids.add(id)
      }
    }
  }
  if (ids.size === 0) return { status: 'ok', issues: [] }

  const issues: ThreadStoreDiagnosticIssue[] = []
  let status: ThreadStoreArtifactStatus = 'ok'
  for (const id of ids) {
    const attachment = index.valid.get(id)
    if (!attachment) {
      const nextStatus = index.invalidIds.has(id) ? 'invalid' : 'missing'
      status = worseStatus(status, nextStatus)
      issues.push(issue(nextStatus === 'invalid' ? 'invalid_attachment' : 'missing_attachment', 'A referenced attachment is unavailable.', 'error'))
      continue
    }
    if (!attachment.contentExists || !attachment.metadata.threadIds.includes(thread.id)) {
      status = worseStatus(status, 'mismatch')
      issues.push(issue('attachment_scope_mismatch', 'A referenced attachment is missing content or thread scope.', 'error'))
    }
  }
  return { status, issues }
}

function worseStatus(
  current: ThreadStoreArtifactStatus,
  next: ThreadStoreArtifactStatus
): ThreadStoreArtifactStatus {
  const rank: Record<ThreadStoreArtifactStatus, number> = {
    ok: 0,
    truncated: 1,
    missing: 2,
    mismatch: 3,
    invalid: 4
  }
  return rank[next] > rank[current] ? next : current
}

function isRecoverable(
  metadata: ThreadStoreArtifactStatus,
  events: ThreadStoreArtifactStatus,
  attachments: ThreadStoreArtifactStatus
): boolean {
  return metadata === 'ok'
    && events !== 'invalid'
    && attachments === 'ok'
}

function issue(
  code: string,
  message: string,
  severity: ThreadStoreDiagnosticIssue['severity']
): ThreadStoreDiagnosticIssue {
  return { code, message, severity }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

async function readBoundedFile(path: string): Promise<string> {
  const fileStat = await stat(path)
  if (fileStat.size > MAX_ARTIFACT_BYTES) throw new Error('artifact_too_large')
  return readFile(path, 'utf8')
}

type ReadonlyIndex = {
  getThread: (threadId: string) => ReadonlyIndexRow | undefined
  close: () => void
}

type ReadonlyIndexRow = {
  metadata_path?: string
  messages_path?: string
  events_path?: string
}

type ReadonlyIndexState = {
  status: 'ok' | 'missing' | 'invalid'
  index: ReadonlyIndex | null
}

async function openReadonlyIndex(path: string): Promise<ReadonlyIndexState> {
  let db: { close: () => void } | null = null
  try {
    await stat(path)
    const sqlite = await import('better-sqlite3')
    const Database = sqlite.default
    const handle = new Database(path, { readonly: true, fileMustExist: true })
    db = handle
    const statement = handle.prepare('SELECT metadata_path, messages_path, events_path FROM threads WHERE id = ?')
    return {
      status: 'ok',
      index: {
        getThread: (threadId) => statement.get(threadId) as ReadonlyIndexRow | undefined,
        close: () => handle.close()
      }
    }
  } catch (error) {
    db?.close()
    return { status: isMissing(error) ? 'missing' : 'invalid', index: null }
  }
}

async function inspectSqliteIndex(
  sqlite: ReadonlyIndexState,
  threadId: string,
  threadRoot: string
): Promise<{ status: ThreadStoreArtifactStatus; issues: ThreadStoreDiagnosticIssue[] }> {
  if (sqlite.status === 'missing') {
    return {
      status: 'missing',
      issues: [issue('missing_sqlite_index', 'The SQLite index is unavailable.', 'warning')]
    }
  }
  if (sqlite.status === 'invalid' || !sqlite.index) {
    return {
      status: 'invalid',
      issues: [issue('invalid_sqlite_index', 'The SQLite index could not be opened.', 'error')]
    }
  }
  try {
    const row = sqlite.index.getThread(threadId)
    if (!row) {
      return {
        status: 'mismatch',
        issues: [issue('sqlite_index_mismatch', 'The SQLite index has no row for this thread.', 'warning')]
      }
    }
    const expected = {
      metadata_path: join(threadRoot, 'metadata.jsonl'),
      messages_path: join(threadRoot, 'messages.jsonl'),
      events_path: join(threadRoot, 'events.jsonl')
    }
    if (Object.entries(expected).some(([key, value]) => resolve(String(row[key as keyof typeof row] ?? '')) !== resolve(value))) {
      return {
        status: 'mismatch',
        issues: [issue('sqlite_index_mismatch', 'The SQLite index paths do not match the thread files.', 'warning')]
      }
    }
    return { status: 'ok', issues: [] }
  } catch {
    return {
      status: 'invalid',
      issues: [issue('invalid_sqlite_index', 'The SQLite index could not be queried.', 'error')]
    }
  }
}

async function loadAttachmentIndex(rootDir: string | undefined): Promise<AttachmentIndex> {
  const valid = new Map<string, { metadata: AttachmentMetadata; contentExists: boolean }>()
  const invalidIds = new Set<string>()
  if (!rootDir) return { valid, invalidIds }
  const entries = await readdir(rootDir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const id = entry.name.slice(0, -'.json'.length)
    try {
      const metadata = AttachmentMetadata.parse(JSON.parse(await readBoundedFile(join(rootDir, entry.name))))
      valid.set(id, {
        metadata,
        contentExists: await fileExists(join(rootDir, `${id}.bin`))
      })
    } catch {
      invalidIds.add(id)
    }
  }
  return { valid, invalidIds }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

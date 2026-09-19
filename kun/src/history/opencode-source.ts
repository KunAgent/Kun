import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { OpenCodeSourceSchema, type OpenCodeSource, type OpenCodeRecordPointer } from '../contracts/history-reference.js'
import { HistorySourceError, object, string, type JsonObject } from './codex-jsonl.js'

export interface OpenCodeMessage { info: JsonObject; parts: JsonObject[] }
export interface OpenCodeSnapshot { source: OpenCodeSource; info: JsonObject; messages: OpenCodeMessage[] }
export const sourceError = (message: string) => new HistorySourceError('partial', message)
export function sourceId(value: unknown): string {
  const id = string(value)
  if (!/^[a-zA-Z0-9_-]{1,256}$/u.test(id)) throw sourceError('Invalid OpenCode record identity.')
  return id
}
export function digest(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical)
    : v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, canonical(x)])) : v
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}
export async function readSourceJson(path: string): Promise<JsonObject> {
  const before = await stat(path)
  if (!before.isFile() || before.size > 64 * 1024 * 1024) throw sourceError('OpenCode JSON source must be a regular file under 64 MiB.')
  const value = object(JSON.parse(await readFile(path, 'utf8')))
  const after = await stat(path)
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) throw new HistorySourceError('changed', 'OpenCode source changed during reading.')
  return value
}
export async function jsonFiles(path: string): Promise<string[]> {
  try { return (await readdir(path, { withFileTypes: true })).filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => join(path, e.name)).sort() }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
}
export async function legacySessionFiles(path: string): Promise<string[]> {
  const root = join(path, 'session')
  const old = await jsonFiles(join(root, 'info'))
  if (old.length) return old
  const dirs = await readdir(root, { withFileTypes: true }).catch(() => [])
  return (await Promise.all(dirs.filter((e) => e.isDirectory()).map((e) => jsonFiles(join(root, e.name))))).flat()
}
export async function resolveOpenCodeSource(path: string, sessionId?: string, kind?: OpenCodeSource['kind']): Promise<OpenCodeSource> {
  if (!isAbsolute(path)) throw sourceError('Choose an absolute OpenCode source path.')
  path = resolve(path)
  const info = await stat(path)
  kind ??= info.isDirectory() ? 'legacy' : /\.(?:db|sqlite|sqlite3)$/iu.test(path) ? 'sqlite' : 'export'
  if (kind === 'legacy' && !(await legacySessionFiles(path)).length) {
    if ((await legacySessionFiles(join(path, 'storage'))).length) path = join(path, 'storage')
  }
  if (kind === 'export') {
    const exported = await readSourceJson(path)
    const actual = sourceId(object(exported.info).id)
    if (sessionId && actual !== sessionId) throw sourceError('The export belongs to a different OpenCode session.')
    sessionId = actual
  }
  if (!sessionId) throw sourceError('Select a session from the OpenCode database or directory first.')
  return OpenCodeSourceSchema.parse({ kind, path, sessionId })
}

/** Uses the live WAL through a normal read-only SQLite connection; never initialize or migrate. */
export function withOpenCodeDatabase<T>(path: string, operation: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 1500; BEGIN')
    for (const table of ['session', 'message', 'part']) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name)
      if (!columns.includes('id') || (table !== 'session' && (!columns.includes('session_id') || !columns.includes('data')))) {
        throw sourceError('This OpenCode database schema is unsupported.')
      }
    }
    const result = operation(db)
    db.exec('COMMIT')
    return result
  } finally { db.close() }
}
export function sessionInfo(row: JsonObject): JsonObject {
  return { id: row.id, title: row.title, directory: row.directory, parentID: row.parent_id,
    time: { created: row.time_created, updated: row.time_updated, archived: row.time_archived },
    revert: typeof row.revert === 'string' ? JSON.parse(row.revert) : row.revert }
}
function normalizedMessage(info: JsonObject, parts: JsonObject[], sessionId: string): OpenCodeMessage {
  const id = sourceId(info.id)
  if (info.sessionID && info.sessionID !== sessionId) throw sourceError('OpenCode message belongs to another session.')
  return { info: { ...info, id, sessionID: sessionId }, parts: parts.map((part) => {
    if ((part.messageID && part.messageID !== id) || (part.sessionID && part.sessionID !== sessionId)) throw sourceError('OpenCode part belongs to another message or session.')
    return { ...part, id: sourceId(part.id), messageID: id, sessionID: sessionId }
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) }
}

export async function readOpenCodeSnapshot(source: OpenCodeSource, manifest?: OpenCodeRecordPointer[]): Promise<OpenCodeSnapshot> {
  let info: JsonObject
  let bytes = 0, recordCount = 0
  const budget = (size: number) => {
    bytes += size; recordCount += 1
    if (bytes > 64 * 1024 * 1024 || recordCount > 10000) throw sourceError('OpenCode snapshot exceeds 64 MiB or 10,000 records.')
  }
  const decode = (value: unknown) => {
    const text = String(value); budget(Buffer.byteLength(text))
    return object(JSON.parse(text))
  }
  const readBounded = async (path: string) => {
    budget((await stat(path)).size)
    return readSourceJson(path)
  }
  let messages: OpenCodeMessage[] = []
  const wanted = manifest?.filter((r) => r.kind === 'message')
  if (source.kind === 'sqlite') {
    if (!(await stat(source.path)).isFile()) throw sourceError('The OpenCode database is not a regular file.')
    return withOpenCodeDatabase(source.path, (db) => {
      const row = db.prepare('SELECT * FROM session WHERE id = ?').get(source.sessionId)
      if (!row) throw new HistorySourceError('changed', 'The referenced OpenCode session is missing.')
      function* messageRows() {
        if (wanted) for (const r of wanted) { const row = db.prepare('SELECT * FROM message WHERE session_id = ? AND id = ?').get(source.sessionId, r.id); if (row) yield row }
        else yield* db.prepare('SELECT * FROM message WHERE session_id = ? ORDER BY id LIMIT 10001').iterate(source.sessionId)
      }
      for (const r of messageRows()) {
        const data = decode(r.data)
        function* partRows() {
          if (manifest) for (const p of manifest.filter((p) => p.kind === 'part' && p.messageId === r.id)) {
            const row = db.prepare('SELECT * FROM part WHERE session_id = ? AND message_id = ? AND id = ?').get(source.sessionId, r.id!, p.id)
            if (row) yield row
          }
          else yield* db.prepare('SELECT * FROM part WHERE session_id = ? AND message_id = ? ORDER BY id LIMIT 10001').iterate(source.sessionId, r.id!)
        }
        const parts: JsonObject[] = []
        for (const p of partRows()) parts.push({ ...decode(p.data), id: p.id })
        messages.push(normalizedMessage({ ...data, id: r.id }, parts, source.sessionId))
      }
      return finishSnapshot(source, sessionInfo(row), messages, manifest)
    })
  }
  if (source.kind === 'export') {
    const data = await readSourceJson(source.path)
    info = object(data.info)
    if (!Array.isArray(data.messages)) throw sourceError('Select an OpenCode session export containing info and messages.')
    messages = data.messages.map((m) => normalizedMessage(object(object(m).info), Array.isArray(object(m).parts) ? object(m).parts as JsonObject[] : [], source.sessionId))
  } else {
    const candidates = await legacySessionFiles(source.path)
    const file = candidates.find((p) => p.endsWith(`/${source.sessionId}.json`))
    if (!file) throw new HistorySourceError('changed', 'The referenced OpenCode session is missing.')
    info = await readSourceJson(file)
    const old = file.includes('/session/info/')
    const messageRoot = join(source.path, ...(old ? ['session', 'message'] : ['message']), source.sessionId)
    const files = wanted ? wanted.map((r) => join(messageRoot, `${r.id}.json`)) : await jsonFiles(messageRoot)
    for (const file of files) {
      const data = await readBounded(file)
      const id = sourceId(data.id)
      const partRoot = join(source.path, ...(old ? ['session', 'part', source.sessionId] : ['part']), id)
      const parts = manifest ? manifest.filter((p) => p.kind === 'part' && p.messageId === id).map((p) => join(partRoot, `${p.id}.json`)) : await jsonFiles(partRoot)
      const values: JsonObject[] = []
      for (const part of parts) values.push(await readBounded(part))
      messages.push(normalizedMessage(data, values, source.sessionId))
    }
  }
  return finishSnapshot(source, info, messages, manifest)
}
function finishSnapshot(source: OpenCodeSource, info: JsonObject, messages: OpenCodeMessage[], manifest?: OpenCodeRecordPointer[]): OpenCodeSnapshot {
  if (info.id !== source.sessionId || info.parentID) throw sourceError('Select an OpenCode main session with matching identity.')
  const identities = messages.flatMap((m) => [`message:${m.info.id}`, ...m.parts.map((p) => `part:${p.id}`)])
  if (new Set(identities).size !== identities.length) throw sourceError('Duplicate OpenCode message or part identities are unsupported.')
  messages.sort((a, b) => String(a.info.id) < String(b.info.id) ? -1 : String(a.info.id) > String(b.info.id) ? 1 : 0)
  if (manifest) {
    const selected = new Map(manifest.map((r) => [`${r.kind}:${r.id}`, r]))
    messages = messages.filter((m) => selected.has(`message:${m.info.id}`)).map((m) => ({ ...m, parts: m.parts.filter((p) => selected.has(`part:${p.id}`)) }))
    const actual = recordManifest(messages)
    if (digest(actual) !== digest(manifest)) throw new HistorySourceError('changed', 'OpenCode records before this branch changed or were removed.')
  } else if (recordManifest(messages).length > 10000) throw sourceError('This OpenCode source exceeds the 10,000-record reference limit.')
  return { source, info, messages }
}
export function recordManifest(messages: OpenCodeMessage[]): OpenCodeRecordPointer[] {
  return messages.flatMap((m) => [{ kind: 'message' as const, id: String(m.info.id), messageId: String(m.info.id), sha256: digest(m.info) },
    ...m.parts.map((p) => ({ kind: 'part' as const, id: String(p.id), messageId: String(m.info.id), sha256: digest(p) }))])
}

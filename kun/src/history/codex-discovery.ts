import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { CodexSessionSummary } from '../contracts/history-reference.js'
import { object, readCodexLines, string } from './codex-jsonl.js'
import { itemText, projectCodexRecord } from './codex-projection.js'

export interface DiscoverCodexOptions {
  codexHome?: string
  cwd?: string
  includeArchived?: boolean
  query?: string
  after?: string
  before?: string
  limit?: number
}
export const isCodexPath = (path: string): boolean => /\.jsonl(?:\.zst)?$/i.test(path)

export async function summarizeCodexFile(path: string): Promise<CodexSessionSummary> {
  const metadata = await stat(path)
  const result: CodexSessionSummary = {
    sessionId: basename(path).replace(/\.jsonl(?:\.zst)?$/, ''), path: resolve(path),
    title: 'Codex conversation', workspace: '', updatedAt: metadata.mtime.toISOString(),
    archived: /[/\\]archived_sessions[/\\]/.test(path)
  }
  for await (const line of readCodexLines(path)) {
    if (line.ordinal > 40 || line.offset > 1024 * 1024) break
    const payload = object(line.value.payload)
    if (line.value.type === 'session_meta') {
      result.sessionId = string(payload.id) || result.sessionId
      result.workspace = string(payload.cwd)
      result.title = string(payload.title).slice(0, 120) || result.title
    }
    const firstUser = projectCodexRecord(line.value).find((item) => item.kind === 'user_message')
    if (firstUser) {
      if (result.title === 'Codex conversation') result.title = itemText(firstUser).replace(/\s+/g, ' ').slice(0, 120)
      break
    }
  }
  return result
}

async function* walk(directory: string, depth = 0): AsyncGenerator<string> {
  if (depth > 5) return
  let entries
  try { entries = await readdir(directory, { withFileTypes: true }) } catch { return }
  for (const entry of entries.sort((a, b) => b.name.localeCompare(a.name))) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) yield* walk(path, depth + 1)
    else if (entry.isFile() && isCodexPath(path)) yield path
  }
}

function iso(value: unknown): string {
  const numeric = typeof value === 'bigint' ? Number(value) : value
  const date = typeof numeric === 'number'
    ? new Date(numeric < 1e12 ? numeric * 1000 : numeric)
    : new Date(string(value))
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString()
}

async function databaseSessions(home: string, options: DiscoverCodexOptions = {}): Promise<CodexSessionSummary[] | null> {
  let names: string[]
  try { names = (await readdir(home)).filter((name) => /^state_\d+\.sqlite$/.test(name)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })) }
  catch { return null }
  for (const name of names) {
    let db: DatabaseSync | undefined
    try {
      db = new DatabaseSync(join(home, name), { readOnly: true })
      const columns = new Set((db.prepare('PRAGMA table_info(threads)').all() as Array<{ name: string }>).map((column) => column.name))
      if (!columns.has('id') || !columns.has('rollout_path')) continue
      const fields = ['id', 'rollout_path', 'title', 'cwd', 'updated_at', 'updated_at_ms', 'archived'].filter((field) => columns.has(field))
      const order = columns.has('updated_at_ms') ? 'updated_at_ms' : columns.has('updated_at') ? 'updated_at' : 'id'
      const clauses: string[] = []
      const parameters: Array<string | number> = []
      if (options.cwd && columns.has('cwd')) { clauses.push('cwd = ?'); parameters.push(resolve(options.cwd)) }
      if (!options.includeArchived && columns.has('archived')) clauses.push('(archived = 0 OR archived IS NULL)')
      if (options.query) {
        const searchable = ['title', 'id', 'cwd'].filter((field) => columns.has(field))
        clauses.push(`(${searchable.map((field) => `instr(lower(${field}), ?) > 0`).join(' OR ')})`)
        parameters.push(...searchable.map(() => options.query!.trim().toLocaleLowerCase()))
      }
      for (const [value, operator] of [[options.after, '>='], [options.before, '<=']] as const) {
        if (!value || order === 'id') continue
        const time = Date.parse(value)
        if (Number.isFinite(time)) { clauses.push(`${order} ${operator} ?`); parameters.push(order === 'updated_at_ms' ? time : Math.floor(time / 1000)) }
      }
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
      const rows = db.prepare(`SELECT ${fields.join(', ')} FROM threads${where} ORDER BY ${order} DESC LIMIT 10000`).all(...parameters)
      const sessions = rows.flatMap((row): CodexSessionSummary[] => {
        const path = string(row.rollout_path)
        if (!path || !isCodexPath(path)) return []
        return [{ sessionId: string(row.id), path: resolve(home, path),
          title: string(row.title).slice(0, 120) || 'Codex conversation', workspace: string(row.cwd),
          updatedAt: iso(row.updated_at_ms ?? row.updated_at), archived: Number(row.archived) === 1 }]
      })
      for (const session of sessions) {
        if (!session.path.endsWith('.jsonl')) continue
        try { await stat(session.path) } catch {
          try { await stat(`${session.path}.zst`); session.path += '.zst' } catch { /* Keep missing metadata visible. */ }
        }
      }
      return sessions
    } catch { /* Missing/older SQLite schemas fall back to read-only rollout discovery. */ }
    finally { db?.close() }
  }
  return null
}

export async function discoverCodexSessions(options: DiscoverCodexOptions = {}): Promise<CodexSessionSummary[]> {
  const home = resolve(options.codexHome || process.env.CODEX_HOME || join(homedir(), '.codex'))
  let sessions = await databaseSessions(home, options)
  if (!sessions?.length) {
    sessions = []
    const roots = [join(home, 'sessions'), ...(options.includeArchived ? [join(home, 'archived_sessions')] : [])]
    for (const root of roots) {
      for await (const path of walk(root)) {
        try { sessions.push(await summarizeCodexFile(path)) } catch { /* Concurrently removed/broken source. */ }
        if (sessions.length >= 10000) break
      }
    }
  }
  const query = options.query?.trim().toLocaleLowerCase()
  const seen = new Set<string>()
  return sessions.filter((session) => {
    if (seen.has(session.sessionId)) return false
    if (!options.includeArchived && session.archived) return false
    if (options.cwd && (!session.workspace || resolve(session.workspace) !== resolve(options.cwd))) return false
    if (query && !`${session.title} ${session.sessionId} ${session.workspace}`.toLocaleLowerCase().includes(query)) return false
    if (options.after && session.updatedAt < options.after) return false
    if (options.before && session.updatedAt > options.before) return false
    seen.add(session.sessionId)
    return true
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, Math.min(500, Math.max(1, options.limit ?? 100)))
}

/** Resolve only rollout files inside the selected source's Codex tree. */
export async function resolveCodexParentPath(source: string, sessionId: string): Promise<string | undefined> {
  const normalized = resolve(source)
  const marker = normalized.match(/^(.*)[/\\](?:sessions|archived_sessions)[/\\]/)
  const root = marker?.[1] || resolve(source, '..')
  const rows = await databaseSessions(root, { includeArchived: true, query: sessionId })
  const known = rows?.find((row) => row.sessionId === sessionId)
  if (known) return known.path
  const directories = marker ? [join(root, 'sessions'), join(root, 'archived_sessions')] : [root]
  for (const directory of directories) {
    let count = 0
    for await (const path of walk(directory)) {
      if (++count > 10000) break
      if (!basename(path).includes(sessionId)) continue
      try { if ((await summarizeCodexFile(path)).sessionId === sessionId) return path } catch { /* Missing parent. */ }
    }
  }
  return undefined
}

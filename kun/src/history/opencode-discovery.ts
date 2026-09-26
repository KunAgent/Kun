import { access, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { CodexSessionSummary, OpenCodeSource } from '../contracts/history-reference.js'
import { object, string } from './codex-jsonl.js'
import { legacySessionFiles, readSourceJson, sessionInfo, sourceError, withOpenCodeDatabase } from './opencode-source.js'

export interface OpenCodeDiscoveryOptions {
  path?: string; sourceKind?: OpenCodeSource['kind']; opencodeHome?: string
  cwd?: string; query?: string; after?: string; before?: string; includeArchived?: boolean; limit?: number
}
const iso = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? new Date(value).toISOString() : new Date(0).toISOString()
async function exists(path: string) { try { await access(path); return true } catch { return false } }

export async function discoverOpenCodeSessions(options: OpenCodeDiscoveryOptions = {}): Promise<CodexSessionSummary[]> {
  const home = resolve(options.opencodeHome || join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'opencode'))
  const sources: Array<{ path: string; kind: OpenCodeSource['kind'] }> = []
  if (options.path) {
    const path = resolve(options.path), info = await stat(path)
    const kind = options.sourceKind ?? (info.isDirectory() ? 'legacy' : /\.(?:db|sqlite|sqlite3)$/iu.test(path) ? 'sqlite' : 'export')
    if (kind === 'legacy' && !(await legacySessionFiles(path)).length && (await legacySessionFiles(join(path, 'storage'))).length) sources.push({ path: join(path, 'storage'), kind })
    else sources.push({ path, kind })
  } else {
    if (await exists(join(home, 'opencode.db'))) sources.push({ path: join(home, 'opencode.db'), kind: 'sqlite' })
    if (await exists(join(home, 'storage'))) sources.push({ path: join(home, 'storage'), kind: 'legacy' })
    for (const entry of await readdir(join(home, 'project'), { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory()) sources.push({ path: join(home, 'project', entry.name, 'storage'), kind: 'legacy' })
    }
  }
  const found = new Map<string, CodexSessionSummary>()
  const add = (info: Record<string, unknown>, source: typeof sources[number]) => {
    const id = string(info.id)
    if (!id || found.has(id)) return
    found.set(id, { sessionId: id, path: source.path, sourceKind: source.kind, title: string(info.title).slice(0, 120) || 'OpenCode conversation',
      workspace: string(info.directory), updatedAt: iso(object(info.time).updated), archived: Boolean(object(info.time).archived),
      ...{ parentID: info.parentID } })
  }
  for (const source of sources) {
    try {
      if (source.kind === 'sqlite') withOpenCodeDatabase(source.path, (db) => {
        for (const row of db.prepare('SELECT * FROM session').iterate()) add(sessionInfo(row), source)
      })
      else if (source.kind === 'export') {
        const data = await readSourceJson(source.path)
        if (!Array.isArray(data.messages)) throw sourceError('Select an OpenCode export with info and messages.')
        add(object(data.info), source)
      } else for (const file of await legacySessionFiles(source.path)) add(await readSourceJson(file), source)
    } catch (error) { if (options.path || source.kind === 'sqlite') throw error }
  }
  return [...found.values()].filter((s) => {
    if ((s as CodexSessionSummary & { parentID?: string }).parentID) return false
    if (!options.includeArchived && s.archived) return false
    if (options.cwd && (!s.workspace || resolve(s.workspace) !== resolve(options.cwd))) return false
    if (options.query && !`${s.title} ${s.sessionId} ${s.workspace}`.toLocaleLowerCase().includes(options.query.toLocaleLowerCase())) return false
    return (!options.after || Date.parse(s.updatedAt) >= Date.parse(options.after)) && (!options.before || Date.parse(s.updatedAt) <= Date.parse(options.before))
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, Math.min(200, Math.max(1, options.limit ?? 100)))
}

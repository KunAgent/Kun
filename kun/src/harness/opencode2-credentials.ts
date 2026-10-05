import { createHash } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

type Evidence = { configured: boolean; fingerprint: string }
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const empty = (): Evidence => ({ configured: false, fingerprint: digest([]) })
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

export function openCode2DatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME || env.USERPROFILE || homedir()
  return env.OPENCODE_DB === ':memory:' ? ':memory:'
    : resolve(join(env.XDG_DATA_HOME || join(home, '.local/share'), 'opencode'), env.OPENCODE_DB || 'opencode.db')
}

function configuredValue(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entry = value as Record<string, unknown>
  if (entry.type === 'key') return nonempty(entry.key)
  return entry.type === 'oauth' && nonempty(entry.access) && nonempty(entry.refresh) &&
    typeof entry.expires === 'number' && Number.isFinite(entry.expires) && entry.expires >= 0
}

/**
 * V2 owns authentication and refresh. Read only its credential rows (including
 * live WAL state), never initialize/migrate its DB or read session content.
 * Values only enter this private hash; the caller receives no credential data.
 */
export function openCode2CredentialEvidence(env: NodeJS.ProcessEnv = process.env): Evidence {
  const path = openCode2DatabasePath(env)
  if (path === ':memory:') return empty()
  let db: DatabaseSync | undefined
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink()) return empty()
    db = new DatabaseSync(path, { readOnly: true })
    db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 100; BEGIN')
    const columns = new Set(db.prepare('PRAGMA table_info(credential)').all().map((row) => row.name))
    if (!['id', 'value', 'integration_id'].every((column) => columns.has(column))) return empty()
    const active = columns.has('active') ? 'active' : 'NULL AS active'
    const rows = db.prepare(`SELECT id, integration_id, ${active}, value FROM credential
      WHERE length(value) <= 65536 ORDER BY id LIMIT 129`).all()
    if (rows.length > 128) return empty()
    const configured = rows.some((row) => {
      if (row.active === 0 || !nonempty(row.integration_id) || typeof row.value !== 'string') return false
      try { return configuredValue(JSON.parse(row.value)) } catch { return false }
    })
    return { configured, fingerprint: digest(rows) }
  } catch {
    return empty()
  } finally { db?.close() }
}

/**
 * OpenCode's ACP server (OpenCode, OpenCode2 and forks such as CodeMaker)
 * answers any exception inside a request with `Internal error: Internal
 * service failure`, empty error data and nothing on stderr. The real cause
 * only reaches its own log file, so the explanation reads that log for the
 * probe's run and reports whether a clean configuration still fails.
 */
import { closeSync, openSync, readdirSync, readSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ProviderEnv, ProviderFailure, ProviderFailureContext } from './provider-module.js'
import { xdgDataHome } from './support.js'

export type OpenCodeEngine = { displayName: string; command: string; apps: readonly string[] }

// OpenCode2 says "Internal service failure"; OpenCode 1.18 says "OpenCode service failure".
const SERVICE_FAILURE = /(?:internal|opencode) service failure/i
// SQLite errors from a database whose schema another OpenCode version changed.
const SCHEMA_FAILURE = /no such (?:column|table): [\w.]+|has no session table/i
const TAIL_BYTES = 256 * 1024
const MAX_LINES = 4
const CLIP = 160
const NOISE = [/configuration normalization diagnostic/i, /duplicate skill name/i]
const FIELD = /(\S+?)=("(?:[^"\\]|\\.)*"|\S*)/g

export function isOpenCodeServiceFailure(message: string): boolean {
  return SERVICE_FAILURE.test(message)
}

/**
 * Every configuration source points at an empty directory; data (credentials,
 * database, cache) stays, so a passing retry blames configuration or plugins.
 * `~/.opencode/opencode.json` and a project `.opencode/` are not covered.
 */
export function openCodeIsolationEnv(input: { dir: string; message: string }): Record<string, string> | undefined {
  if (!isOpenCodeServiceFailure(input.message)) return undefined
  const file = join(input.dir, 'opencode.json')
  writeFileSync(file, '{}\n')
  return { XDG_CONFIG_HOME: input.dir, OPENCODE_CONFIG_DIR: input.dir, OPENCODE_CONFIG: file, OPENCODE_CONFIG_CONTENT: '{}' }
}

export type OpenCodeLogEvidence = { file: string; lines: string[] }

function tail(path: string): string {
  const fd = openSync(path, 'r')
  try {
    const size = statSync(path).size
    const length = Math.min(size, TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    readSync(fd, buffer, 0, length, size - length)
    const text = buffer.toString('utf8')
    return length < size ? text.slice(text.indexOf('\n') + 1) : text
  } finally { closeSync(fd) }
}

function fields(line: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const match of line.matchAll(FIELD)) {
    const raw = match[2]!
    out[match[1]!] = raw.startsWith('"') ? raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, ' ') : raw
  }
  return out
}

const clip = (value: string): string => value.length > CLIP ? `${value.slice(0, CLIP)}...` : value

/** One readable line per log entry; undefined when the entry is not evidence. */
export function summarizeOpenCodeLogLine(line: string, sinceMs: number): string | undefined {
  if (NOISE.some((pattern) => pattern.test(line))) return undefined
  // OpenCode2: `timestamp=... level=WARN ... message="..." key=value`.
  const structured = line.match(/\btimestamp=(\S+)\s+level=(\w+)/)
  if (structured) {
    if (Date.parse(structured[1]!) < sinceMs) return undefined
    const entry = fields(line)
    const status = Number(entry['http.status'])
    if (status >= 400) return `${entry['http.method'] ?? ''} ${entry['http.url'] ?? ''} -> ${status}`.trim()
    const level = structured[2]!.toUpperCase()
    if (level !== 'ERROR' && level !== 'WARN' && level !== 'FATAL') return undefined
    const text = entry.message ?? entry.msg ?? ''
    const subject = entry.target ?? entry.name ?? entry.plugin ?? entry.id
    const cause = entry.cause ?? entry.error ?? entry.err
    return clip(`${level} ${text}${subject ? ` ${subject}` : ''}${cause ? `: ${cause}` : ''}`.trim())
  }
  // OpenCode 1: `ERROR 2026-10-08T03:13:06 +4ms service=db ... free text`.
  const classic = line.match(/^\s*(ERROR|WARN|FATAL)\s+(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z?)\s+\+\d+ms\s+(.*)$/)
  if (!classic) return undefined
  const stamp = Date.parse(classic[2]!.endsWith('Z') ? classic[2]! : `${classic[2]!}Z`)
  // Local timestamps without a zone cannot be compared reliably; keep them.
  if (Number.isFinite(stamp) && classic[2]!.endsWith('Z') && stamp < sinceMs) return undefined
  return clip(`${classic[1]} ${classic[3]!.trim()}`)
}

/** The engine's own warnings, errors and failed HTTP calls since the probe started. */
export function openCodeLogEvidence(input: { env: ProviderEnv; apps: readonly string[]; sinceMs: number }): OpenCodeLogEvidence | undefined {
  const home = input.env.HOME || input.env.USERPROFILE || homedir()
  const since = input.sinceMs - 2_000
  for (const app of input.apps) {
    const dir = join(xdgDataHome(input.env, home), app, 'log')
    let names: string[]
    try { names = readdirSync(dir).filter((name) => name.endsWith('.log')) } catch { continue }
    const recent = names.flatMap((name) => {
      const path = join(dir, name)
      try { return [{ path, mtimeMs: statSync(path).mtimeMs }] } catch { return [] }
    }).filter((entry) => entry.mtimeMs >= since).sort((a, b) => b.mtimeMs - a.mtimeMs)
    for (const entry of recent) {
      let text: string
      try { text = tail(entry.path) } catch { continue }
      const lines = [...new Set(text.split('\n').flatMap((line) => summarizeOpenCodeLogLine(line, since) ?? []))]
      if (lines.length) return { file: entry.path, lines: lines.slice(-MAX_LINES) }
    }
  }
  return undefined
}

export function openCodeLogDirectory(env: ProviderEnv, app: string): string {
  return join(xdgDataHome(env, env.HOME || env.USERPROFILE || homedir()), app, 'log')
}

/** Turns the opaque wrapper error into the engine's own evidence and a next step. */
export function explainOpenCodeServiceFailure(
  engine: OpenCodeEngine,
  message: string,
  context: ProviderFailureContext | undefined
): ProviderFailure | undefined {
  if (!isOpenCodeServiceFailure(message)) return undefined
  const env = context?.env ?? {}
  const evidence = context ? openCodeLogEvidence({ env, apps: engine.apps, sinceMs: context.startedAtMs }) : undefined
  const verdict = context?.isolated === 'passes'
    ? 'It works with a clean configuration, so a setting or plugin in its opencode.json (global config directory, OPENCODE_CONFIG, ~/.opencode or a project .opencode directory) breaks it.'
    : context?.isolated === 'fails'
      ? `It fails even with a clean configuration: check its network or proxy access (it loads its model catalog online), its database under ${xdgDataHome(env, env.HOME || env.USERPROFILE || homedir())}/${engine.apps[0]}, or reinstall it.`
      : undefined
  const detail = [
    `${engine.displayName} failed inside its own service${context ? ` during ${context.stage}` : ''} and hid the cause ("${message.match(SERVICE_FAILURE)?.[0] ?? 'service failure'}").`,
    verdict,
    evidence
      ? `Its log says: ${evidence.lines.join('; ')} (${evidence.file}).`
      : `Its log directory ${openCodeLogDirectory(env, engine.apps[0]!)} has no error for this run.`,
    `Run \`${engine.command}\` in a terminal inside any project to see the real error, then check again.`
  ].filter((part): part is string => Boolean(part)).join(' ')
  return { detail, authRequired: false }
}

/**
 * OpenCode and OpenCode2 share `opencode.db` in OpenCode's data directory.
 * Each migrates it for itself: OpenCode2's newer migrations rebuild tables
 * OpenCode 1 still reads (for example `workspace` without `project_id`), and
 * a file OpenCode2 created first has no `session` table. Only the user can
 * decide what happens to that file, so this explains and stops there.
 */
export function explainOpenCodeDatabaseFailure(
  engine: OpenCodeEngine & { other: string },
  message: string,
  env: ProviderEnv = process.env
): ProviderFailure | undefined {
  const schema = message.match(SCHEMA_FAILURE)?.[0]
  if (!schema) return undefined
  const home = env.HOME || env.USERPROFILE || homedir()
  const database = env.OPENCODE_DB && env.OPENCODE_DB !== ':memory:'
    ? env.OPENCODE_DB : join(xdgDataHome(env, home), 'opencode', 'opencode.db')
  return { authRequired: false, detail: `${engine.displayName} cannot use its database ${database} (${schema}). ` +
    `${engine.other} shares this file and changed tables ${engine.displayName} still reads. ` +
    `Back up the file, then move it out of that directory together with its -wal and -shm files; ${engine.displayName} creates a new one (old sessions stay in the backup). ` +
    `Running \`${engine.command}\` once in a terminal shows the same error.` }
}

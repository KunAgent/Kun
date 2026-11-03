/**
 * Per-call usage of a Devin turn, read from Devin's own session store while
 * the turn runs.
 *
 * Devin's `session/prompt` result carries the usage of the run's last model
 * call only: a turn of 26 calls (~895k prompt tokens, 15k output) was booked
 * as one ~51k call, and nothing at all showed until the turn ended. Devin
 * keeps every call in `<data>/devin/cli/sessions.db` (`message_nodes`): each
 * assistant node's `metadata.metrics` has the exact input / cache-read /
 * output tokens plus the call's own TTFT and duration. This reader books one
 * usage per call as it lands, live, like Codex's per-call token reports. It
 * never writes the database and goes quiet when the store is missing or
 * unsupported; the runtime then keeps the prompt-result usage.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { UsageSnapshot } from '../../contracts/usage.js'
import type { OpenCodeCallUsage, OpenCodeSessionUsage } from './opencode-session-usage.js'

const POLL_INTERVAL_MS = 1_500
const MAX_FAILURES = 3
/** Compaction re-inserts earlier calls as new nodes; their generation time gives them away. */
const GENERATION_CLOCK_SLACK_MS = 2_000
/** Same sanity bounds as the arrival-time tracker (harness-turn-timing.ts). */
const MIN_GENERATION_MS = 250
const MAX_TOKENS_PER_SECOND = 3_000

type NodeRow = {
  row_id: number
  role: string | null
  message_id: string | null
  request_id: string | null
  created_at: string | null
  metrics: string | null
}

/** Devin's session store, beside its credentials file; undefined when absent. */
export function devinSessionDatabasePath(harnessId: string, env: NodeJS.ProcessEnv): string | undefined {
  if (harnessId !== 'devin') return undefined
  const dataHome = process.platform === 'win32'
    ? env.APPDATA || join(homedir(), 'AppData/Roaming')
    : env.XDG_DATA_HOME || join(homedir(), '.local/share')
  const path = join(dataHome, 'devin', 'cli', 'sessions.db')
  return existsSync(path) ? path : undefined
}

function withDevinDatabase<T>(path: string, operation: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 1500')
    const columns = db.prepare('PRAGMA table_info(message_nodes)').all().map((row) => row.name)
    if (!['row_id', 'session_id', 'chat_message'].every((name) => columns.includes(name))) {
      throw new Error('unsupported Devin session store schema')
    }
    return operation(db)
  } finally { db.close() }
}

export function startDevinSessionUsage(input: {
  dbPath: string
  acpSessionId: string
  onCalls: (calls: OpenCodeCallUsage[]) => void
  debug?: (summary: string) => void
  intervalMs?: number
  now?: () => number
}): OpenCodeSessionUsage | undefined {
  const seen = new Set<string>()
  const startedAt = (input.now ?? Date.now)()
  let baseline: number
  try {
    // Nodes that already exist belong to earlier turns.
    baseline = withDevinDatabase(input.dbPath, (db) => {
      const row = db.prepare('SELECT max(row_id) AS id FROM message_nodes WHERE session_id = ?')
        .get(input.acpSessionId) as { id?: number | null } | undefined
      return row?.id ?? 0
    })
  } catch (error) {
    input.debug?.(`devin usage reader disabled: ${String(error).slice(0, 200)}`)
    return undefined
  }
  let failures = 0
  let calls = 0
  let stopped = false

  const read = (): OpenCodeCallUsage[] => {
    if (failures >= MAX_FAILURES) return []
    try {
      // Only the small fields: tool results make whole nodes large.
      const rows = withDevinDatabase(input.dbPath, (db) => db.prepare(`SELECT row_id,
          json_extract(chat_message, '$.role') AS role,
          json_extract(chat_message, '$.message_id') AS message_id,
          json_extract(chat_message, '$.metadata.request_id') AS request_id,
          json_extract(chat_message, '$.metadata.created_at') AS created_at,
          json_extract(chat_message, '$.metadata.metrics') AS metrics
        FROM message_nodes WHERE session_id = ? AND row_id > ? ORDER BY row_id`)
        .all(input.acpSessionId, baseline) as NodeRow[])
      const booked: OpenCodeCallUsage[] = []
      for (const row of rows) {
        const key = row.request_id ?? row.message_id
        if (row.role !== 'assistant' || !key || seen.has(key)) continue
        const generatedAt = row.created_at ? Date.parse(row.created_at) : NaN
        if (generatedAt < startedAt - GENERATION_CLOCK_SLACK_MS) continue
        const usage = devinCallUsage(row.metrics)
        if (!usage) continue
        seen.add(key)
        booked.push({ messageId: key, usage })
      }
      calls += booked.length
      return booked
    } catch (error) {
      failures += 1
      input.debug?.(`devin usage read failed: ${String(error).slice(0, 200)}`)
      return []
    }
  }

  const timer = setInterval(() => {
    if (stopped) return
    const booked = read()
    if (booked.length) input.onCalls(booked)
  }, input.intervalMs ?? POLL_INTERVAL_MS)
  timer.unref?.()

  const stop = (): void => {
    stopped = true
    clearInterval(timer)
  }
  return {
    get calls() { return calls },
    finish() {
      stop()
      return read()
    },
    stop
  }
}

/**
 * One assistant node's `metadata.metrics` as one model call. Devin's
 * `input_tokens` excludes cache reads and writes; Kun's prompt side includes them.
 */
export function devinCallUsage(metricsJson: string | null): UsageSnapshot | undefined {
  let metrics: Record<string, unknown>
  try {
    const parsed = metricsJson ? JSON.parse(metricsJson) as unknown : undefined
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    metrics = parsed as Record<string, unknown>
  } catch {
    return undefined
  }
  const input = count(metrics.input_tokens)
  const cacheRead = count(metrics.cache_read_tokens)
  const cacheWrite = count(metrics.cache_creation_tokens)
  const output = count(metrics.output_tokens)
  const promptTokens = input + cacheRead + cacheWrite
  if (promptTokens + output <= 0) return undefined
  const ttft = finite(metrics.ttft_ms)
  const total = finite(metrics.total_time_ms)
  const span = ttft !== undefined && total !== undefined ? total - ttft : 0
  // A tool-call-only reply arrives in one burst; its rate says nothing.
  const generation = output > 0 && span >= MIN_GENERATION_MS &&
    output / (span / 1_000) <= MAX_TOKENS_PER_SECOND ? Math.round(span) : undefined
  return {
    promptTokens,
    completionTokens: output,
    totalTokens: promptTokens + output,
    cachedTokens: cacheRead,
    cacheHitTokens: cacheRead,
    cacheMissTokens: input + cacheWrite,
    ...(cacheWrite > 0 ? { cacheWriteTokens: cacheWrite } : {}),
    cacheHitRate: promptTokens > 0 ? cacheRead / promptTokens : null,
    turns: 1,
    ...(ttft !== undefined ? { requestTtftMs: Math.round(ttft) } : {}),
    ...(generation !== undefined ? { requestGenerationMs: generation } : {})
  }
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
}

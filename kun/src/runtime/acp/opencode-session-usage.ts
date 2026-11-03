/**
 * Per-call usage of an OpenCode-family turn, read from the Agent's own SQLite
 * store while the turn runs.
 *
 * OpenCode's `session/prompt` result carries the usage of the run's last
 * assistant message only, and that message's `tokens.input` excludes cache
 * reads. A turn of forty model calls was therefore booked as one small call
 * with a 100% cache hit, and the composer counted one request per turn. Each
 * OpenCode assistant message is one model call, so this reader books one
 * usage per message as it completes: exact input/cache/output, one request
 * each, live while the turn runs. It never writes the database and goes
 * quiet when the store is missing or unsupported; the runtime then keeps the
 * prompt-result usage.
 */
import type { UsageSnapshot } from '../../contracts/usage.js'
import { withOpenCodeDatabase } from '../../history/opencode-source.js'

const POLL_INTERVAL_MS = 1_500
const MAX_FAILURES = 3

export type OpenCodeCallUsage = { messageId: string; usage: UsageSnapshot }

export type OpenCodeSessionUsage = {
  /** Calls booked so far. */
  readonly calls: number
  /** Book every message that has usage, finished or not, then stop polling. */
  finish(): OpenCodeCallUsage[]
  stop(): void
}

type MessageRow = { id: string; data: string }

export function startOpenCodeSessionUsage(input: {
  dbPath: string
  acpSessionId: string
  onCalls: (calls: OpenCodeCallUsage[]) => void
  debug?: (summary: string) => void
  intervalMs?: number
}): OpenCodeSessionUsage | undefined {
  const seen = new Set<string>()
  let baseline: string
  try {
    // Messages that already exist belong to earlier turns.
    baseline = withOpenCodeDatabase(input.dbPath, (db) => {
      const row = db.prepare('SELECT max(id) AS id FROM message WHERE session_id = ?').get(input.acpSessionId) as { id?: string | null } | undefined
      return row?.id ?? ''
    })
  } catch (error) {
    input.debug?.(`opencode usage reader disabled: ${String(error).slice(0, 200)}`)
    return undefined
  }
  let failures = 0
  let calls = 0
  let stopped = false

  const read = (final: boolean): OpenCodeCallUsage[] => {
    if (failures >= MAX_FAILURES) return []
    try {
      const rows = withOpenCodeDatabase(input.dbPath, (db) => db
        .prepare('SELECT id, data FROM message WHERE session_id = ? AND id > ? ORDER BY id')
        .all(input.acpSessionId, baseline) as MessageRow[])
      const booked: OpenCodeCallUsage[] = []
      for (const row of rows) {
        if (seen.has(row.id)) continue
        const call = openCodeCallUsage(row, final)
        if (!call) continue
        seen.add(row.id)
        booked.push(call)
      }
      calls += booked.length
      return booked
    } catch (error) {
      failures += 1
      input.debug?.(`opencode usage read failed: ${String(error).slice(0, 200)}`)
      return []
    }
  }

  const timer = setInterval(() => {
    if (stopped) return
    const booked = read(false)
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
      return read(true)
    },
    stop
  }
}

/**
 * One assistant message as one model call. A message still streaming is
 * booked once it completes, or at turn end with whatever it consumed.
 */
export function openCodeCallUsage(row: MessageRow, final: boolean): OpenCodeCallUsage | undefined {
  let info: Record<string, unknown>
  try {
    info = JSON.parse(row.data) as Record<string, unknown>
  } catch {
    return undefined
  }
  if (info.role !== 'assistant') return undefined
  const time = record(info.time)
  if (!final && typeof time.completed !== 'number' && typeof info.finish !== 'string') return undefined
  const tokens = record(info.tokens)
  const cache = record(tokens.cache)
  const input = count(tokens.input)
  const output = count(tokens.output)
  const reasoning = count(tokens.reasoning)
  const cacheRead = count(cache.read)
  const cacheWrite = count(cache.write)
  // OpenCode's input excludes both cache reads and writes; Kun's prompt side
  // includes them, and its completion includes reasoning.
  const promptTokens = input + cacheRead + cacheWrite
  const completionTokens = output + reasoning
  if (promptTokens + completionTokens <= 0) return undefined
  const cacheMissTokens = input + cacheWrite
  const usage: UsageSnapshot = {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    ...(reasoning > 0 ? { reasoningTokens: reasoning } : {}),
    cachedTokens: cacheRead,
    cacheHitTokens: cacheRead,
    cacheMissTokens,
    ...(cacheWrite > 0 ? { cacheWriteTokens: cacheWrite } : {}),
    cacheHitRate: promptTokens > 0 ? cacheRead / promptTokens : null,
    turns: 1
  }
  return { messageId: row.id, usage }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
}

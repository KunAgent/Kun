import { lstat, open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { zstdDecompressSync } from 'node:zlib'
import type { UsageSnapshot } from '../contracts/usage.js'
import { deepSeekHarnessHome } from './deepseek-harness-profile.js'
import type {
  AcpSessionUsageInput,
  AcpSessionUsageSample,
  AcpSessionUsageSource
} from './providers/provider-module.js'

/**
 * DeepSeek Harness (dsh-acp 0.2.0-rc.2) reports no usage over ACP: a prompt
 * result is just `{ stopReason }`. It does keep every model call in its own
 * session log, `<home>/sessions/<workspace>/<session id>/session.v4.jsonl.zstd`:
 * one `assistant/message` record per call, with exact token usage and the
 * provider stream's chunk times. That is the source of truth for both the token
 * counts and TTFT / tok/s, so Kun reads it instead of estimating.
 */
const LOG_FILE = 'session.v4.jsonl.zstd'
const SESSION_ID = /^[A-Za-z0-9_-]{8,128}$/
/** The writer appends complete zstd frames and flushes within milliseconds of the prompt result. */
const FLUSH_WAIT_MS = 1_500
const FLUSH_POLL_MS = 25
const MAX_TURN_BYTES = 64 * 1024 * 1024
const MAX_CACHED_LOGS = 64

type LogMark = { path?: string; size: number }
type LogRecord = { type?: unknown; time?: unknown; data?: Record<string, unknown> }

const knownLogs = new Map<string, string>()

/** Frame lengths of back-to-back zstd frames (a one-shot decoder only reads the first). */
export function splitZstdFrames(buffer: Buffer): Buffer[] {
  const frames: Buffer[] = []
  let start = 0
  while (start + 6 <= buffer.length && buffer.readUInt32LE(start) === 0xfd2fb528) {
    let position = start + 4
    const descriptor = buffer[position++]!
    const contentSizeFlag = descriptor >> 6
    const singleSegment = (descriptor >> 5) & 1
    const checksum = (descriptor >> 2) & 1
    if (!singleSegment) position += 1
    position += [0, 1, 2, 4][descriptor & 3]!
    position += contentSizeFlag === 0 ? singleSegment : [0, 2, 4, 8][contentSizeFlag]!
    for (;;) {
      if (position + 3 > buffer.length) return frames
      const header = buffer[position]! | (buffer[position + 1]! << 8) | (buffer[position + 2]! << 16)
      // Block types: 0 raw, 1 RLE (one byte of payload), 2 compressed; the size is in bits 3+.
      position += 3 + (((header >> 1) & 3) === 1 ? 1 : header >> 3)
      if (header & 1) break
    }
    if (checksum) position += 4
    if (position > buffer.length) return frames // the writer is mid-frame
    frames.push(buffer.subarray(start, position))
    start = position
  }
  return frames
}

function records(bytes: Buffer): LogRecord[] {
  const out: LogRecord[] = []
  for (const frame of splitZstdFrames(bytes)) {
    let text: string
    try { text = zstdDecompressSync(frame).toString('utf8') } catch { continue }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try { out.push(JSON.parse(line) as LogRecord) } catch { /* partial or foreign line */ }
    }
  }
  return out
}

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0

/** When the provider stream first produced output and when it ended (epoch ms). */
function streamWindow(stream: unknown): { first: number; last: number } | undefined {
  let first = Infinity
  let last = -Infinity
  for (const entry of Array.isArray(stream) ? stream as Array<Record<string, unknown>> : []) {
    if (!entry || typeof entry !== 'object') continue
    if (entry.type === 'chunk' && typeof entry.time === 'number') {
      if ((entry.chunk as { type?: unknown } | undefined)?.type === 'block-start') first = Math.min(first, entry.time)
      last = Math.max(last, entry.time)
    } else if (typeof entry.time0 === 'number' && Array.isArray(entry.dt)) {
      // `dt` are the gaps between chunks, so the last chunk is `time0 + sum(dt)`.
      first = Math.min(first, entry.time0)
      last = Math.max(last, entry.time0 + (entry.dt as unknown[]).reduce<number>((total, gap) => total + count(gap), 0))
    }
  }
  return first <= last ? { first, last } : undefined
}

/** One sample per model call (`assistant/message` record) of the given log records. */
export function deepSeekHarnessUsageSamples(log: readonly LogRecord[]): AcpSessionUsageSample[] {
  const stepStarts = new Map<string, number>()
  const samples: AcpSessionUsageSample[] = []
  for (const record of log) {
    const data = record.data
    if (!data || typeof record.time !== 'number') continue
    if (record.type === 'step/start') stepStarts.set(`${String(data.turn)}:${String(data.step)}`, record.time)
    if (record.type !== 'assistant/message' || !data.usage || typeof data.usage !== 'object') continue
    const reported = data.usage as Record<string, unknown>
    const input = count(reported.inputTokens)
    const output = count(reported.outputTokens)
    const cacheRead = count(reported.cacheReadTokens)
    const cacheWrite = count(reported.cacheWriteTokens)
    const prompt = input + cacheRead + cacheWrite
    if (prompt + output <= 0) continue
    const window = streamWindow(data.stream)
    const stepStart = stepStarts.get(`${String(data.turn)}:${String(data.step)}`)
    const usage: UsageSnapshot = {
      promptTokens: prompt,
      completionTokens: output,
      totalTokens: count(reported.totalTokens) || prompt + output,
      cacheHitRate: prompt > 0 && cacheRead > 0 ? cacheRead / prompt : null,
      turns: 0,
      ...(cacheRead > 0 ? { cachedTokens: cacheRead, cacheHitTokens: cacheRead, cacheMissTokens: input + cacheWrite } : {}),
      ...(cacheWrite > 0 ? { cacheWriteTokens: cacheWrite } : {}),
      ...(window && stepStart !== undefined && window.first >= stepStart ? { requestTtftMs: window.first - stepStart } : {}),
      ...(window && output > 0 && window.last > window.first ? { requestGenerationMs: window.last - window.first } : {})
    }
    const message = data.message as { source?: { model?: unknown } } | undefined
    const model = message?.source?.model
    samples.push({ ...(typeof model === 'string' && model ? { model } : {}), usage })
  }
  return samples
}

async function regularFile(path: string): Promise<{ size: number } | undefined> {
  try {
    const stat = await lstat(path)
    return stat.isFile() && !stat.isSymbolicLink() ? { size: stat.size } : undefined
  } catch { return undefined }
}

/** The session directory is named after the workspace; fall back to a scan when the naming differs. */
async function findLog(input: AcpSessionUsageInput): Promise<string | undefined> {
  if (!SESSION_ID.test(input.sessionId)) return undefined
  const home = deepSeekHarnessHome(input.env)
  const key = `${home}\0${input.sessionId}`
  const known = knownLogs.get(key)
  if (known && await regularFile(known)) return known
  const sessions = join(home, 'sessions')
  const named = join(sessions, `--${input.workspace.replace(/^[\\/]+/, '').replace(/[\\/:]+/g, '-')}--`, input.sessionId, LOG_FILE)
  let found = await regularFile(named) ? named : undefined
  if (!found) {
    for (const directory of await readdir(sessions).catch(() => [] as string[])) {
      const candidate = join(sessions, directory, input.sessionId, LOG_FILE)
      if (await regularFile(candidate)) { found = candidate; break }
    }
  }
  if (found) {
    if (knownLogs.size >= MAX_CACHED_LOGS) knownLogs.delete(knownLogs.keys().next().value!)
    knownLogs.set(key, found)
  }
  return found
}

async function readFrom(path: string, from: number): Promise<LogRecord[]> {
  const size = (await regularFile(path))?.size ?? 0
  if (size <= from || size - from > MAX_TURN_BYTES) return []
  const file = await open(path, 'r')
  try {
    const bytes = Buffer.alloc(size - from)
    const { bytesRead } = await file.read(bytes, 0, bytes.length, from)
    return records(bytes.subarray(0, bytesRead))
  } finally { await file.close() }
}

export function createDeepSeekHarnessSessionUsage(
  options: { flushWaitMs?: number; pollMs?: number } = {}
): AcpSessionUsageSource {
  const flushWaitMs = options.flushWaitMs ?? FLUSH_WAIT_MS
  const pollMs = options.pollMs ?? FLUSH_POLL_MS
  return {
    async begin(input) {
      const path = await findLog(input)
      const mark: LogMark = { ...(path ? { path } : {}), size: path ? (await regularFile(path))?.size ?? 0 : 0 }
      return mark
    },

    async collect(raw, input) {
      const mark = raw as LogMark
      const path = mark.path ?? await findLog(input)
      if (!path) return []
      const deadline = Date.now() + flushWaitMs
      let log = await readFrom(path, mark.size)
      // The log is flushed with the prompt result; wait briefly for the turn's last record.
      while (!log.some((record) => record.type === 'turn/end') && Date.now() < deadline) {
        await sleep(pollMs)
        log = await readFrom(path, mark.size)
      }
      return deepSeekHarnessUsageSamples(log)
    }
  }
}

export const deepSeekHarnessSessionUsage = createDeepSeekHarnessSessionUsage()

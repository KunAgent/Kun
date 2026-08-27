import { appendFile, mkdir, readFile, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import type { Stats } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import type { UsageEvent } from '../../contracts/events.js'
import { emptyUsageSnapshot, UsageSnapshotSchema, type UsageSnapshot } from '../../contracts/usage.js'
import { diffUsage, hasUsage } from '../../domain/usage.js'
import type {
  SessionLatestUsageSnapshot,
  SessionUsageQueryOptions,
  SessionUsageRecord
} from '../../ports/session-store.js'
import { atomicWriteFile } from './atomic-write.js'
import {
  appendUsageIndexHashes,
  hashUsageIndexFile,
  usageIndexStatSignature,
  verifyUsageIndexHashes,
  verifyUsageIndexTail,
} from './file-session-usage-index-hashing.js'

const DEFAULT_INDEX_MAX_RECORD_BYTES = 4 * 1024 * 1024
const USAGE_INDEX_STATE_VERSION = 2

type UsageIndexCorruptionKind = 'invalid-json' | 'invalid-schema' | 'record-too-large'

class UsageIndexCorruptionError extends Error {
  constructor(
    readonly path: string,
    readonly line: number,
    readonly kind: UsageIndexCorruptionKind,
    detail: string
  ) {
    super(`usage index ${kind} at ${path}:${line}: ${detail}`)
    this.name = 'UsageIndexCorruptionError'
  }
}

/**
 * Per-thread usage index row. Delta rows carry the differential usage that
 * was computed at append time, so a ranged read never replays events.jsonl.
 */
const UsageIndexRowSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('delta'),
    seq: z.number().int().nonnegative(),
    timestamp: z.string(),
    turnId: z.string().optional(),
    model: z.string().optional(),
    providerId: z.string().optional(),
    usage: UsageSnapshotSchema,
    cumulative: UsageSnapshotSchema
  }),
  z.object({
    type: z.literal('checkpoint'),
    date: z.string(),
    seq: z.number().int().nonnegative(),
    timestamp: z.string(),
    cumulative: UsageSnapshotSchema
  })
])
export type UsageIndexRow = z.infer<typeof UsageIndexRowSchema>

export type UsageIndexState = {
  lastSeq: number
  cumulative: UsageSnapshot
  /** UTC day (YYYY-MM-DD) of the latest indexed event; drives checkpoints. */
  lastDay: string
}

type UsageIndexMetadata = {
  indexedBytes: number
  days: Record<string, number>
  monotonicTimestamps: boolean
  lastTimestamp: string
  statSignature: string
  segments: string[]
  tailDigest: string
}

type UsageIndexSidecar = UsageIndexMetadata & {
  version: typeof USAGE_INDEX_STATE_VERSION
  state: UsageIndexState
}

type LegacyUsageIndexSidecar = {
  version: 1
  indexedBytes: number
  days: Record<string, number>
  monotonicTimestamps: boolean
  lastTimestamp: string
  sha256: string
  state: UsageIndexState
}

type UsageIndexSnapshot = {
  state: UsageIndexState
  metadata: UsageIndexMetadata
}

type UsageEventSource = (threadId: string, sinceSeq: number) => AsyncIterable<UsageEvent>

export function emptyUsageIndexState(): UsageIndexState {
  return { lastSeq: 0, cumulative: emptyUsageSnapshot(), lastDay: '' }
}

/**
 * Append-only per-thread usage index (`usage-index.jsonl`). The sidecar is a
 * derived cursor, never a source of truth: events.jsonl remains authoritative.
 */
export class FileSessionUsageIndex {
  private readonly snapshots = new Map<string, { statSignature: string; snapshot: UsageIndexSnapshot }>()
  private readonly ensureQueues = new Map<string, Promise<unknown>>()

  constructor(
    private readonly threadsDir: string,
    private readonly eventsSince: UsageEventSource
  ) {}

  /** Record one usage event inside the caller's per-thread write queue. */
  async recordUsage(threadId: string, event: UsageEvent): Promise<void> {
    const snapshot = await this.ensureCurrent(threadId)
    const state = snapshot.state
    if (event.seq < state.lastSeq) return
    if (event.seq === state.lastSeq) {
      if (!sameUsageSnapshot(event.usage, state.cumulative)) {
        console.error(`[kun] usage index cumulative mismatch for ${threadId} at seq ${event.seq}; rebuilding from events.jsonl`)
        await this.rebuildFromEvents(threadId)
      }
      return
    }
    const next = appendRowsForEvent(event, state)
    const metadata = await this.appendRows(threadId, next.rows, next.state, snapshot.metadata)
    this.snapshots.set(threadId, { statSignature: await this.currentIndexSignature(threadId), snapshot: { state: next.state, metadata } })
  }

  async loadUsageRecords(
    threadId: string,
    options: SessionUsageQueryOptions = {}
  ): Promise<SessionUsageRecord[]> {
    const snapshot = await this.ensureCurrent(threadId)
    const fromMs = options.fromInclusive ? Date.parse(options.fromInclusive) : undefined
    const toMs = options.toExclusive ? Date.parse(options.toExclusive) : undefined
    if (fromMs !== undefined && toMs !== undefined && toMs <= fromMs) return []
    const start = canUseSparseStart(snapshot.metadata, fromMs)
      ? offsetForDay(snapshot.metadata.days, utcDayFromMs(fromMs!))
      : 0
    const records: SessionUsageRecord[] = []
    await this.streamRows(threadId, start, (row) => {
      if (row.type !== 'delta') return
      const atMs = Date.parse(row.timestamp)
      if (!Number.isFinite(atMs)) return
      if (fromMs !== undefined && atMs < fromMs) return
      if (toMs !== undefined && atMs >= toMs) {
        if (snapshot.metadata.monotonicTimestamps) return 'stop'
        return
      }
      if (!hasUsage(row.usage)) return
      records.push({
        threadId,
        ...(row.turnId ? { turnId: row.turnId } : {}),
        ...(row.model ? { model: row.model } : {}),
        ...(row.providerId ? { providerId: row.providerId } : {}),
        completedAt: row.timestamp,
        usage: row.usage
      })
    })
    return records
  }

  async loadLatestUsageSnapshot(threadId: string): Promise<SessionLatestUsageSnapshot | null> {
    const { state } = await this.ensureCurrent(threadId)
    if (state.lastSeq <= 0) return null
    return { threadId, seq: state.lastSeq, usage: state.cumulative }
  }

  /** Drop in-memory state; the on-disk index and sidecar remain derived data. */
  clearThreadMemory(threadId: string): void {
    this.snapshots.delete(threadId)
    this.ensureQueues.delete(threadId)
  }

  resetMemory(): void {
    this.snapshots.clear()
    this.ensureQueues.clear()
  }

  private indexDir(threadId: string): string {
    return join(this.threadsDir, threadId)
  }

  private indexPath(threadId: string): string {
    return join(this.indexDir(threadId), 'usage-index.jsonl')
  }

  private statePath(threadId: string): string {
    return join(this.indexDir(threadId), 'usage-index.state.json')
  }

  private async indexStat(threadId: string): Promise<Stats | null> {
    try { return await stat(this.indexPath(threadId)) } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return null
      throw error
    }
  }

  private async currentIndexSignature(threadId: string): Promise<string> {
    const info = await this.indexStat(threadId)
    return info ? usageIndexStatSignature(info) : 'missing'
  }

  /** Serialize readers, rebuilds, and tail repairs for one thread. */
  private ensureCurrent(threadId: string): Promise<UsageIndexSnapshot> {
    const queued = this.ensureQueues.get(threadId) ?? Promise.resolve()
    const run = queued.catch(() => undefined).then(() => this.ensureCurrentUnlocked(threadId))
    const guard = run.then(() => undefined, () => undefined)
    this.ensureQueues.set(threadId, guard)
    return run.finally(() => {
      if (this.ensureQueues.get(threadId) === guard) this.ensureQueues.delete(threadId)
    })
  }

  private async ensureCurrentUnlocked(threadId: string): Promise<UsageIndexSnapshot> {
    const info = await this.indexStat(threadId)
    const statSignature = info ? usageIndexStatSignature(info) : 'missing'
    const cached = this.snapshots.get(threadId)
    if (cached?.statSignature === statSignature) return cached.snapshot

    let snapshot: UsageIndexSnapshot
    try {
      snapshot = await this.readIndexSnapshot(threadId)
    } catch (error) {
      if (!(error instanceof UsageIndexCorruptionError)) throw error
      console.warn(
        `[kun] rebuilding corrupt usage index for ${threadId} from events.jsonl ` +
        `(line ${error.line}, ${error.kind})`
      )
      return this.rebuildFromEvents(threadId)
    }

    const backfilled = await this.buildRowsFromEvents(threadId, snapshot.state)
    if (backfilled.rows.length === 0) {
      this.snapshots.set(threadId, { statSignature, snapshot })
      return snapshot
    }
    const metadata = await this.appendRows(threadId, backfilled.rows, backfilled.state, snapshot.metadata)
    const current = { state: backfilled.state, metadata }
    this.snapshots.set(threadId, { statSignature: await this.currentIndexSignature(threadId), snapshot: current })
    return current
  }

  private async buildRowsFromEvents(
    threadId: string,
    initial: UsageIndexState
  ): Promise<{ rows: UsageIndexRow[]; state: UsageIndexState }> {
    const rows: UsageIndexRow[] = []
    let state = initial
    for await (const event of this.eventsSince(threadId, initial.lastSeq)) {
      const appended = appendRowsForEvent(event, state)
      rows.push(...appended.rows)
      state = appended.state
    }
    return { rows, state }
  }

  private async rebuildFromEvents(threadId: string): Promise<UsageIndexSnapshot> {
    const rebuilt = await this.buildRowsFromEvents(threadId, emptyUsageIndexState())
    const metadata = metadataFromRows(rebuilt.rows)
    const completeMetadata = await this.replaceRowsAndState(threadId, rebuilt.rows, rebuilt.state, metadata)
    const snapshot = { state: rebuilt.state, metadata: completeMetadata }
    this.snapshots.set(threadId, { statSignature: await this.currentIndexSignature(threadId), snapshot })
    return snapshot
  }

  private async appendRows(
    threadId: string,
    rows: UsageIndexRow[],
    state: UsageIndexState,
    metadata: UsageIndexMetadata
  ): Promise<UsageIndexMetadata> {
    if (rows.length === 0) return metadata
    const nextMetadata = metadataAfterAppend(metadata, rows, `${serializeRows(rows)}\n`)
    return this.appendRowsAndState(threadId, serializeRows(rows), state, nextMetadata)
  }

  private async appendRowsAndState(
    threadId: string,
    serialized: string,
    state: UsageIndexState,
    metadata: UsageIndexMetadata
  ): Promise<UsageIndexMetadata> {
    await mkdir(this.indexDir(threadId), { recursive: true, mode: 0o700 })
    await appendFile(this.indexPath(threadId), `${serialized}\n`, { encoding: 'utf-8', mode: 0o600 })
    const info = await stat(this.indexPath(threadId))
    const hashes = await appendUsageIndexHashes(this.indexPath(threadId), { segments: metadata.segments, tailDigest: metadata.tailDigest }, metadata.indexedBytes - Buffer.byteLength(`${serialized}\n`, 'utf-8'), info.size)
    const completeMetadata = { ...metadata, indexedBytes: info.size, statSignature: usageIndexStatSignature(info), segments: hashes.segments, tailDigest: hashes.tailDigest }
    await writeSidecar(this.statePath(threadId), { ...completeMetadata, state, version: USAGE_INDEX_STATE_VERSION })
    return completeMetadata
  }

  private async replaceRowsAndState(
    threadId: string,
    rows: UsageIndexRow[],
    state: UsageIndexState,
    metadata: UsageIndexMetadata
  ): Promise<UsageIndexMetadata> {
    await atomicWriteFile(this.indexPath(threadId), rows.length > 0 ? `${serializeRows(rows)}\n` : '', {
      allowDirectWriteFallback: false
    })
    const info = await stat(this.indexPath(threadId))
    const hashes = await hashUsageIndexFile(this.indexPath(threadId), info.size)
    const completeMetadata = { ...metadata, indexedBytes: info.size, statSignature: usageIndexStatSignature(info), segments: hashes.segments, tailDigest: hashes.tailDigest }
    await writeSidecar(this.statePath(threadId), { ...completeMetadata, state, version: USAGE_INDEX_STATE_VERSION })
    return completeMetadata
  }

  private async readIndexSnapshot(threadId: string): Promise<UsageIndexSnapshot> {
    const path = this.indexPath(threadId)
    const info = await this.indexStat(threadId)
    if (!info) return { state: emptyUsageIndexState(), metadata: emptyMetadata() }
    const fileBytes = info.size
    const sidecar = await readSidecar(this.statePath(threadId))
    if (sidecar && sidecar.indexedBytes > fileBytes) {
      throw new UsageIndexCorruptionError(path, 0, 'invalid-schema', 'sidecar points past truncated index')
    }

    if (sidecar && sidecar.indexedBytes === fileBytes && sidecar.statSignature === usageIndexStatSignature(info)) {
      const valid = await verifyUsageIndexTail(path, fileBytes, sidecar.tailDigest)
      if (!valid) throw new UsageIndexCorruptionError(path, 0, 'invalid-schema', 'sidecar tail digest does not match index')
      return { state: sidecar.state, metadata: sidecar }
    }

    if (sidecar && sidecar.indexedBytes === fileBytes) {
      const valid = await verifyUsageIndexHashes(path, fileBytes, { segments: sidecar.segments, tailDigest: sidecar.tailDigest })
      if (!valid) throw new UsageIndexCorruptionError(path, 0, 'invalid-schema', 'segment hash does not match index')
      const metadata = { ...sidecar, statSignature: usageIndexStatSignature(info) }
      await writeSidecar(this.statePath(threadId), { ...metadata, version: USAGE_INDEX_STATE_VERSION })
      return { state: sidecar.state, metadata }
    }

    const start = sidecar?.indexedBytes ?? 0
    if (sidecar && start > 0 && !(await verifyUsageIndexTail(path, start, sidecar.tailDigest))) {
      throw new UsageIndexCorruptionError(path, 0, 'invalid-schema', 'sidecar tail digest does not match index')
    }
    const parsed = await readRows(path, start)
    if (parsed.incompleteTrailingRecord) {
      throw new UsageIndexCorruptionError(path, parsed.line + 1, 'invalid-json', 'unterminated record')
    }
    const metadata = sidecar && start > 0
      ? metadataAfterAppend(sidecar, parsed.rows, parsed.serialized)
      : metadataFromRows(parsed.rows)
    const state = sidecar && start > 0 ? stateFromRows(parsed.rows, sidecar.state) : stateFromRows(parsed.rows)
    const hashes = sidecar && start > 0
      ? await appendUsageIndexHashes(path, { segments: sidecar.segments, tailDigest: sidecar.tailDigest }, start, fileBytes)
      : await hashUsageIndexFile(path, fileBytes)
    const completeMetadata = {
      ...metadata,
      indexedBytes: fileBytes,
      statSignature: usageIndexStatSignature(info),
      segments: hashes.segments,
      tailDigest: hashes.tailDigest
    }
    await writeSidecar(this.statePath(threadId), { ...completeMetadata, state, version: USAGE_INDEX_STATE_VERSION })
    return { state, metadata: completeMetadata }
  }

  private async streamRows(
    threadId: string,
    start: number,
    onRow: (row: UsageIndexRow) => void | 'stop'
  ): Promise<void> {
    const path = this.indexPath(threadId)
    let remainder = ''
    try {
      const stream = createReadStream(path, { encoding: 'utf-8', start, highWaterMark: 64 * 1024 })
      for await (const chunk of stream) {
        remainder += typeof chunk === 'string' ? chunk : chunk.toString('utf-8')
        let newline = remainder.indexOf('\n')
        while (newline >= 0) {
          const record = remainder.slice(0, newline)
          remainder = remainder.slice(newline + 1)
          const result = onRow(parseUsageIndexRow(record, { path, line: 0 }))
          if (result === 'stop') {
            stream.destroy()
            return
          }
          newline = remainder.indexOf('\n')
        }
        if (Buffer.byteLength(remainder, 'utf-8') > DEFAULT_INDEX_MAX_RECORD_BYTES) {
          throw new UsageIndexCorruptionError(path, 0, 'record-too-large', 'record exceeds limit')
        }
      }
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return
      throw error
    }
  }
}

export function parseUsageIndexRow(
  line: string,
  context: { path?: string; line?: number } = {}
): UsageIndexRow {
  const path = context.path ?? 'usage-index.jsonl'
  const lineNumber = context.line ?? 0
  if (Buffer.byteLength(line, 'utf-8') > DEFAULT_INDEX_MAX_RECORD_BYTES) {
    throw new UsageIndexCorruptionError(path, lineNumber, 'record-too-large', 'record exceeds limit')
  }
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    throw new UsageIndexCorruptionError(path, lineNumber, 'invalid-json', 'cannot parse JSON')
  }
  const parsed = UsageIndexRowSchema.safeParse(value)
  if (!parsed.success) {
    throw new UsageIndexCorruptionError(path, lineNumber, 'invalid-schema', 'does not match usage index schema')
  }
  return parsed.data
}

function appendRowsForEvent(
  event: UsageEvent,
  state: UsageIndexState
): { rows: UsageIndexRow[]; state: UsageIndexState } {
  if (event.seq <= state.lastSeq) return { rows: [], state }
  const day = utcDayOf(event.timestamp)
  const rows: UsageIndexRow[] = []
  if (state.lastSeq > 0 && day && day !== state.lastDay) {
    rows.push({
      type: 'checkpoint',
      date: state.lastDay,
      seq: state.lastSeq,
      timestamp: state.lastDay,
      cumulative: state.cumulative
    })
  }
  rows.push({
    type: 'delta',
    seq: event.seq,
    timestamp: event.timestamp,
    ...(event.turnId ? { turnId: event.turnId } : {}),
    ...(event.model ? { model: event.model } : {}),
    ...(event.providerId ? { providerId: event.providerId } : {}),
    usage: diffUsage(event.usage, state.cumulative),
    cumulative: event.usage
  })
  return {
    rows,
    state: {
      lastSeq: event.seq,
      cumulative: event.usage,
      lastDay: day || state.lastDay
    }
  }
}

function stateFromRows(rows: UsageIndexRow[], initial: UsageIndexState = emptyUsageIndexState()): UsageIndexState {
  let state = initial
  for (const row of rows) {
    if (row.type === 'delta' && row.seq > state.lastSeq) {
      state = {
        lastSeq: row.seq,
        cumulative: row.cumulative,
        lastDay: utcDayOf(row.timestamp) || state.lastDay
      }
    } else if (row.type === 'checkpoint' && row.seq > state.lastSeq) {
      state = { lastSeq: row.seq, cumulative: row.cumulative, lastDay: row.date || state.lastDay }
    }
  }
  return state
}

function emptyMetadata(): UsageIndexMetadata {
  return { indexedBytes: 0, days: {}, monotonicTimestamps: true, lastTimestamp: '', statSignature: '', segments: [], tailDigest: '' }
}

function metadataFromRows(rows: UsageIndexRow[]): UsageIndexMetadata {
  let metadata = emptyMetadata()
  let offset = 0
  for (const row of rows) {
    const serialized = `${JSON.stringify(row)}\n`
    metadata = metadataAfterAppend(metadata, [row], serialized, offset)
    offset += Buffer.byteLength(serialized, 'utf-8')
  }
  return metadata
}

function metadataAfterAppend(
  metadata: UsageIndexMetadata,
  rows: UsageIndexRow[],
  serialized: string,
  startOffset = metadata.indexedBytes
): UsageIndexMetadata {
  const days = { ...metadata.days }
  let monotonicTimestamps = metadata.monotonicTimestamps
  let lastTimestamp = metadata.lastTimestamp
  let offset = startOffset
  for (const row of rows) {
    const line = `${JSON.stringify(row)}\n`
    if (row.type === 'delta') {
      const day = utcDayOf(row.timestamp)
      if (day && days[day] === undefined) days[day] = offset
      const currentMs = Date.parse(row.timestamp)
      const previousMs = Date.parse(lastTimestamp)
      if (!Number.isFinite(currentMs) || (lastTimestamp && (!Number.isFinite(previousMs) || currentMs < previousMs))) {
        monotonicTimestamps = false
      }
      lastTimestamp = row.timestamp
    }
    offset += Buffer.byteLength(line, 'utf-8')
  }
  return {
    indexedBytes: startOffset + Buffer.byteLength(serialized, 'utf-8'),
    days,
    monotonicTimestamps,
    lastTimestamp,
    statSignature: metadata.statSignature,
    segments: metadata.segments,
    tailDigest: metadata.tailDigest
  }
}

function sameUsageSnapshot(left: UsageSnapshot, right: UsageSnapshot): boolean {
  return isDeepStrictEqual(JSON.parse(JSON.stringify(left)), JSON.parse(JSON.stringify(right)))
}

function serializeRows(rows: UsageIndexRow[]): string {
  return rows.map((row) => JSON.stringify(row)).join('\n')
}

function utcDayOf(timestamp: string): string {
  const ms = Date.parse(timestamp)
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : ''
}

function utcDayFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function canUseSparseStart(metadata: UsageIndexMetadata, fromMs: number | undefined): boolean {
  return fromMs !== undefined && metadata.monotonicTimestamps && Object.keys(metadata.days).length > 0
}

function offsetForDay(days: Record<string, number>, day: string): number {
  let best = 0
  for (const [candidate, offset] of Object.entries(days)) {
    if (candidate <= day && offset >= best) best = offset
  }
  return best
}

async function readRows(path: string, start: number): Promise<{
  rows: UsageIndexRow[]
  serialized: string
  incompleteTrailingRecord: boolean
  line: number
}> {
  const rows: UsageIndexRow[] = []
  let serialized = ''
  let remainder = ''
  let line = 0
  const stream = createReadStream(path, { encoding: 'utf-8', start, highWaterMark: 64 * 1024 })
  for await (const chunk of stream) {
    remainder += typeof chunk === 'string' ? chunk : chunk.toString('utf-8')
    let newline = remainder.indexOf('\n')
    while (newline >= 0) {
      const record = remainder.slice(0, newline)
      remainder = remainder.slice(newline + 1)
      const full = `${record}\n`
      rows.push(parseUsageIndexRow(record, { path, line: line + 1 }))
      serialized += full
      line += 1
      newline = remainder.indexOf('\n')
    }
    if (Buffer.byteLength(remainder, 'utf-8') > DEFAULT_INDEX_MAX_RECORD_BYTES) {
      throw new UsageIndexCorruptionError(path, line + 1, 'record-too-large', 'record exceeds limit')
    }
  }
  return { rows, serialized, incompleteTrailingRecord: remainder.length > 0, line }
}

async function readSidecar(path: string): Promise<UsageIndexSidecar | null> {
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return null
    throw error
  }
  try {
    const value = JSON.parse(raw) as { version?: number; sha256?: string; [key: string]: unknown }
    if (value.version === 2 && isValidV2Sidecar(value)) return value as UsageIndexSidecar
    if (value.version === 1 && isValidLegacySidecar(value as Partial<LegacyUsageIndexSidecar>)) return null
    return null
  } catch {
    return null
  }
}

function isValidV2Sidecar(value: { [key: string]: unknown; version?: number; indexedBytes?: unknown; state?: UsageIndexState; days?: unknown; statSignature?: unknown; segments?: unknown; tailDigest?: unknown }): boolean {
  return Number.isSafeInteger(value.indexedBytes) && (value.indexedBytes as number) >= 0 &&
    !!value.state && Number.isSafeInteger(value.state.lastSeq) &&
    UsageSnapshotSchema.safeParse(value.state.cumulative).success && typeof value.state.lastDay === 'string' &&
    typeof value.days === 'object' && value.days !== null &&
    Object.values(value.days).every((offset) => Number.isSafeInteger(offset) && offset >= 0) &&
    typeof value.statSignature === 'string' &&
    Array.isArray(value.segments) && value.segments.every((hash) => typeof hash === 'string') &&
    typeof value.tailDigest === 'string'
}

function isValidLegacySidecar(value: Partial<LegacyUsageIndexSidecar>): value is LegacyUsageIndexSidecar {
  const state = value.state as UsageIndexState | undefined
  return Number.isSafeInteger(value.indexedBytes) && (value.indexedBytes as number) >= 0 &&
    typeof value.sha256 === 'string' && !!state && Number.isSafeInteger(state.lastSeq) &&
    UsageSnapshotSchema.safeParse(state.cumulative).success && typeof state.lastDay === 'string'
}

async function writeSidecar(path: string, state: UsageIndexSidecar): Promise<void> {
  await atomicWriteFile(path, `${JSON.stringify(state)}\n`, { allowDirectWriteFallback: false })
}

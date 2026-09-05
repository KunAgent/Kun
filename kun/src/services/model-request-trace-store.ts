import { createReadStream } from 'node:fs'
import { appendFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { applyPosixMode } from '../security/posix-permissions.js'
import {
  MODEL_REQUEST_TRACE_SCHEMA_VERSION,
  ModelRequestTraceRecordSchema,
  type ModelRequestTraceRecord
} from '../contracts/model-request-trace.js'
import {
  ModelRequestTraceRetention,
  type ModelRequestTraceRetentionOptions
} from './model-request-trace-retention.js'

export const DEFAULT_MODEL_REQUEST_TRACE_PAGE_SIZE = 50
export const MAX_MODEL_REQUEST_TRACE_PAGE_SIZE = 200

export type ModelRequestTraceStorePage = {
  records: ModelRequestTraceRecord[]
  nextCursor?: string
  warnings: string[]
}

export type ModelRequestTraceStoreOptions = ModelRequestTraceRetentionOptions & {
  maxCachedThreads?: number
}

const DEFAULT_MAX_CACHED_TRACE_THREADS = 64

/** Private, append-only, per-thread JSONL storage for completed model transports. */
export class ModelRequestTraceStore {
  private readonly root: string
  private readonly legacyRoot: string
  private readonly writes = new Map<string, Promise<void>>()
  private readonly recent = new Map<string, { records: ModelRequestTraceRecord[]; hasMore: boolean }>()
  private readonly recentLoads = new Map<string, Promise<void>>()
  private readonly pendingRecent = new Map<string, ModelRequestTraceRecord[]>()
  private readonly cacheLru = new Map<string, true>()
  private readonly warningSet = new Set<string>()
  private readonly retention?: ModelRequestTraceRetention
  private readonly maxCachedThreads: number
  private writeTail: Promise<void> = Promise.resolve()
  private ready: Promise<void> | undefined

  constructor(dataDir: string, options: ModelRequestTraceStoreOptions = {}) {
    this.root = join(dataDir, 'observability', 'trajectory', 'records')
    this.legacyRoot = join(dataDir, 'observability', 'model-http')
    if (hasExplicitRetention(options)) {
      this.retention = new ModelRequestTraceRetention(this.root, options)
    }
    this.maxCachedThreads = normalizeCachedThreadLimit(options.maxCachedThreads)
  }

  append(record: ModelRequestTraceRecord): Promise<void> {
    const threadId = record.threadId
    const previous = this.writeTail
    const queued = previous
      .catch(() => undefined)
      .then(async () => {
        try {
          await this.ensureReady()
          const path = this.pathForThread(threadId)
          await appendFile(path, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 })
          await applyPosixMode(path, 0o600)
          this.rememberRecent(threadId, record)
          if (await this.retention?.afterAppend(path)) this.invalidateRecentCaches()
        } catch (error) {
          this.rememberWarning(classifyTracePersistenceError(error))
        }
      })
    this.writeTail = queued
    this.writes.set(threadId, queued)
    void queued.finally(() => {
      if (this.writes.get(threadId) === queued) this.writes.delete(threadId)
    })
    return queued
  }

  async list(
    threadId: string,
    options: { limit?: number; cursor?: string } = {}
  ): Promise<ModelRequestTraceStorePage> {
    await this.flushThread(threadId)
    const limit = normalizePageSize(options.limit)
    if (!options.cursor) {
      await this.ensureRecent(threadId)
      const recent = this.recent.get(threadId) ?? { records: [], hasMore: false }
      const records = recent.records.slice(0, limit)
      const hasMore = recent.hasMore || recent.records.length > limit
      return {
        records,
        ...(hasMore && records.length
          ? { nextCursor: encodeCursor(traceKey(records.at(-1)!)) }
          : {}),
        warnings: this.warnings()
      }
    }
    return this.scan(threadId, { limit, cursor: options.cursor })
  }

  private async scan(
    threadId: string,
    options: { limit: number; cursor?: string }
  ): Promise<ModelRequestTraceStorePage> {
    const before = decodeCursor(options.cursor)
    const retainedById = new Map<string, ModelRequestTraceRecord>()
    for (const path of this.pathsForThread(threadId)) try {
      const input = createReadStream(path, { encoding: 'utf8' })
      const lines = createInterface({ input, crlfDelay: Infinity })
      for await (const line of lines) {
        if (!line.trim()) continue
        let value: unknown
        try {
          value = JSON.parse(line)
        } catch {
          this.rememberWarning('one malformed trace record was ignored')
          continue
        }
        const parsed = ModelRequestTraceRecordSchema.safeParse(value)
        if (!parsed.success || parsed.data.threadId !== threadId) {
          this.rememberWarning('one invalid trace record was ignored')
          continue
        }
        if (before && compareTraceKey(traceKey(parsed.data), before) >= 0) continue
        retainedById.set(parsed.data.id, parsed.data)
      }
    } catch (error) {
      if (!isMissingFileError(error)) this.rememberWarning(`trace read failed: ${safeError(error)}`)
    }
    const retained = [...retainedById.values()]
      .sort((left, right) => compareTraceKey(traceKey(right), traceKey(left)))
      .slice(0, options.limit + 1)
    const hasMore = retained.length > options.limit
    const records = retained.slice(0, options.limit)
    return {
      records,
      ...(hasMore && records.length ? { nextCursor: encodeCursor(traceKey(records.at(-1)!)) } : {}),
      warnings: this.warnings()
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.flushThread(threadId)
    this.recent.delete(threadId)
    this.recentLoads.delete(threadId)
    this.pendingRecent.delete(threadId)
    this.cacheLru.delete(threadId)
    try {
      await Promise.all(this.pathsForThread(threadId).map((path) => rm(path, { force: true })))
    } catch (error) {
      this.rememberWarning(`trace deletion failed: ${safeError(error)}`)
    }
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.writes.values()].map((write) => write.catch(() => undefined)))
  }

  warnings(): string[] {
    return [...this.warningSet]
  }

  private async ensureReady(): Promise<void> {
    this.ready ??= mkdir(this.root, { recursive: true, mode: 0o700 })
      .then(async () => { await applyPosixMode(this.root, 0o700) })
    await this.ready
  }

  private async flushThread(threadId: string): Promise<void> {
    await this.writeTail.catch(() => undefined)
  }

  private async ensureRecent(threadId: string): Promise<void> {
    this.touchCacheThread(threadId)
    if (this.recent.has(threadId)) return
    let load = this.recentLoads.get(threadId)
    if (!load) {
      load = this.scan(threadId, { limit: MAX_MODEL_REQUEST_TRACE_PAGE_SIZE })
        .then((page) => {
          const pending = this.pendingRecent.get(threadId) ?? []
          const byId = new Map(page.records.map((record) => [record.id, record]))
          for (const record of pending) byId.set(record.id, record)
          const records = [...byId.values()]
            .sort((left, right) => compareTraceKey(traceKey(right), traceKey(left)))
            .slice(0, MAX_MODEL_REQUEST_TRACE_PAGE_SIZE)
          this.touchCacheThread(threadId)
          this.recent.set(threadId, {
            records,
            hasMore: Boolean(page.nextCursor) ||
              byId.size > MAX_MODEL_REQUEST_TRACE_PAGE_SIZE
          })
          this.pendingRecent.delete(threadId)
        })
        .finally(() => {
          if (this.recentLoads.get(threadId) === load) this.recentLoads.delete(threadId)
        })
      this.recentLoads.set(threadId, load)
    }
    await load
  }

  private rememberRecent(threadId: string, record: ModelRequestTraceRecord): void {
    this.touchCacheThread(threadId)
    const recent = this.recent.get(threadId)
    if (!recent) {
      const pending = this.pendingRecent.get(threadId) ?? []
      pending.push(record)
      if (pending.length > MAX_MODEL_REQUEST_TRACE_PAGE_SIZE + 1) pending.shift()
      this.pendingRecent.set(threadId, pending)
      return
    }
    const records = [record, ...recent.records.filter((candidate) => candidate.id !== record.id)]
      .sort((left, right) => compareTraceKey(traceKey(right), traceKey(left)))
    const overflow = records.length > MAX_MODEL_REQUEST_TRACE_PAGE_SIZE
    this.recent.set(threadId, {
      records: records.slice(0, MAX_MODEL_REQUEST_TRACE_PAGE_SIZE),
      hasMore: recent.hasMore || overflow
    })
  }

  private pathForThread(threadId: string): string {
    return this.pathInRoot(this.root, threadId)
  }

  private pathsForThread(threadId: string): string[] {
    return [this.pathInRoot(this.legacyRoot, threadId), this.pathInRoot(this.root, threadId)]
  }

  private pathInRoot(root: string, threadId: string): string {
    const name = Buffer.from(threadId, 'utf8').toString('base64url') || 'empty'
    return join(root, `${name}.jsonl`)
  }

  private touchCacheThread(threadId: string): void {
    this.cacheLru.delete(threadId)
    this.cacheLru.set(threadId, true)
    while (this.cacheLru.size > this.maxCachedThreads) {
      const oldest = this.cacheLru.keys().next().value as string | undefined
      if (!oldest) break
      this.cacheLru.delete(oldest)
      this.recent.delete(oldest)
      this.pendingRecent.delete(oldest)
    }
  }

  private invalidateRecentCaches(): void {
    this.recent.clear()
    this.pendingRecent.clear()
    this.cacheLru.clear()
  }

  private rememberWarning(value: string): void {
    if (this.warningSet.size >= 8 && !this.warningSet.has(value)) return
    this.warningSet.add(value.slice(0, 512))
  }
}

type TraceKey = { startedAt: string; sequence: number; id: string }

function traceKey(record: ModelRequestTraceRecord): TraceKey {
  return { startedAt: record.startedAt, sequence: record.sequence, id: record.id }
}

function compareTraceKey(left: TraceKey, right: TraceKey): number {
  const timestamp = left.startedAt.localeCompare(right.startedAt)
  if (timestamp !== 0) return timestamp
  const sequence = left.sequence - right.sequence
  return sequence === 0 ? left.id.localeCompare(right.id) : sequence
}

function encodeCursor(key: TraceKey): string {
  return Buffer.from(JSON.stringify({ v: MODEL_REQUEST_TRACE_SCHEMA_VERSION, ...key }), 'utf8').toString('base64url')
}

function decodeCursor(value: string | undefined): TraceKey | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
    if (
      parsed.v !== MODEL_REQUEST_TRACE_SCHEMA_VERSION ||
      typeof parsed.startedAt !== 'string' ||
      typeof parsed.sequence !== 'number' ||
      typeof parsed.id !== 'string'
    ) return undefined
    return { startedAt: parsed.startedAt, sequence: parsed.sequence, id: parsed.id }
  } catch {
    return undefined
  }
}

function normalizePageSize(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) return DEFAULT_MODEL_REQUEST_TRACE_PAGE_SIZE
  return Math.min(MAX_MODEL_REQUEST_TRACE_PAGE_SIZE, Math.max(1, Math.floor(value)))
}

function normalizeCachedThreadLimit(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) {
    return DEFAULT_MAX_CACHED_TRACE_THREADS
  }
  return Math.max(1, Math.floor(value))
}

function hasExplicitRetention(options: ModelRequestTraceStoreOptions): boolean {
  return options.maxBytesPerThread !== undefined ||
    options.maxTotalBytes !== undefined ||
    options.maxAgeMs !== undefined ||
    options.maintenanceIntervalMs !== undefined ||
    options.now !== undefined
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Classifies a trace-persistence failure so operators can distinguish disk
 * exhaustion from other write errors without parsing generic "fetch failed"
 * / "Internal server error" responses. Keeps the code path free of retry loops:
 * a failed append is reported once through the bounded warning set and the
 * in-memory active record remains servable.
 */
export function classifyTracePersistenceError(error: unknown): string {
  const code = String((error as { code?: unknown })?.code ?? '')
  const message = safeError(error)
  if (code === 'ENOSPC') {
    return `storage exhausted (ENOSPC); trace persistence degraded, in-memory records retained: ${message}`
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return `trace persistence permission denied (${code}): ${message}`
  }
  return `trace persistence failed: ${message}`
}

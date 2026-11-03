import { open, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import { applyPosixMode } from '../security/posix-permissions.js'

export type ModelRequestTraceRetentionOptions = {
  maxBytesPerThread?: number
  maxTotalBytes?: number
  maxAgeMs?: number
  maintenanceIntervalMs?: number
  now?: () => number
}

type NormalizedRetentionOptions = {
  maxBytesPerThread: number
  maxTotalBytes: number
  maxAgeMs: number
  maintenanceIntervalMs: number
  now: () => number
}

type TraceFile = { name: string; path: string; size: number; mtimeMs: number }

const DEFAULT_MAX_BYTES_PER_THREAD = 16 * 1024 * 1024
const DEFAULT_MAX_TOTAL_BYTES = 256 * 1024 * 1024
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000

/** Applies bounded, best-effort retention while the runtime remains alive. */
export class ModelRequestTraceRetention {
  private readonly options: NormalizedRetentionOptions
  private nextSweepAt = 0

  constructor(
    private readonly root: string,
    options: ModelRequestTraceRetentionOptions = {},
    /** Older trace directories that readers still consult and share the budget. */
    private readonly extraRoots: readonly string[] = []
  ) {
    this.options = normalizeOptions(options)
  }

  /** One full maintenance pass, e.g. shortly after startup before any append. */
  sweepNow(): Promise<boolean> {
    return this.sweep(this.options.now())
  }

  private async listAllTraceFiles(): Promise<TraceFile[]> {
    const lists = await Promise.all([this.root, ...this.extraRoots].map((root) => listTraceFiles(root)))
    return lists.flat()
  }

  async afterAppend(path: string): Promise<boolean> {
    const now = this.options.now()
    let changed = false
    const current = await stat(path)
    if (current.size > this.options.maxBytesPerThread) {
      changed = await trimTraceFile(
        path,
        this.options.maxBytesPerThread,
        now - this.options.maxAgeMs
      ) || changed
    }
    if (this.nextSweepAt === 0 && this.options.maintenanceIntervalMs > 0) {
      this.nextSweepAt = now + this.options.maintenanceIntervalMs
      return changed
    }
    if (now < this.nextSweepAt) return changed
    this.nextSweepAt = now + this.options.maintenanceIntervalMs
    return await this.sweep(now) || changed
  }

  private async sweep(now: number): Promise<boolean> {
    let changed = false
    const cutoff = now - this.options.maxAgeMs
    let files = await this.listAllTraceFiles()
    for (const file of files) {
      changed = await trimTraceFile(
        file.path,
        this.options.maxBytesPerThread,
        cutoff
      ) || changed
    }

    files = await this.listAllTraceFiles()
    const total = files.reduce((sum, file) => sum + file.size, 0)
    if (total <= this.options.maxTotalBytes || files.length === 0) return changed

    // Share the global budget across owners so one noisy thread cannot evict
    // every recent trace belonging to quieter threads.
    const fairBudget = Math.max(1, Math.floor(this.options.maxTotalBytes / files.length))
    for (const file of files) {
      changed = await trimTraceFile(
        file.path,
        Math.min(this.options.maxBytesPerThread, fairBudget),
        cutoff
      ) || changed
    }

    files = await this.listAllTraceFiles()
    let remaining = files.reduce((sum, file) => sum + file.size, 0)
    for (const file of files.sort((left, right) => left.mtimeMs - right.mtimeMs)) {
      if (remaining <= this.options.maxTotalBytes) break
      await rm(file.path, { force: true })
      remaining -= file.size
      changed = true
    }
    return changed
  }
}

async function listTraceFiles(root: string): Promise<TraceFile[]> {
  let names: string[]
  try {
    names = await readdir(root)
  } catch (error) {
    if (isMissingFileError(error)) return []
    throw error
  }
  const files = await Promise.all(names
    .filter((name) => name.endsWith('.jsonl'))
    .map(async (name): Promise<TraceFile | undefined> => {
      const path = join(root, name)
      try {
        const metadata = await stat(path)
        return metadata.isFile()
          ? { name, path, size: metadata.size, mtimeMs: metadata.mtimeMs }
          : undefined
      } catch (error) {
        if (isMissingFileError(error)) return undefined
        throw error
      }
    }))
  return files.filter((file): file is TraceFile => Boolean(file))
}

/**
 * Bounds one trace file without loading it whole. Traces from long-lived
 * threads reached hundreds of MB; trimming reads only the newest `maxBytes`
 * tail, and a file whose last write predates the age cutoff is removed
 * without being read at all.
 */
async function trimTraceFile(path: string, maxBytes: number, cutoffMs: number): Promise<boolean> {
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(path)
  } catch (error) {
    if (isMissingFileError(error)) return false
    throw error
  }
  if (info.mtimeMs < cutoffMs) {
    await rm(path, { force: true })
    return true
  }
  if (info.size <= maxBytes) return false
  const tail = await readTail(path, info.size, maxBytes)
  const lines = tail.split('\n').filter((line) => line.trim().length > 0)
  const retained: string[] = []
  let retainedBytes = 0
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (!isRecentTraceLine(line, cutoffMs)) continue
    const lineBytes = Buffer.byteLength(`${line}\n`, 'utf8')
    if (retainedBytes + lineBytes > maxBytes) break
    retained.unshift(line)
    retainedBytes += lineBytes
  }
  if (!retained.length) {
    await rm(path, { force: true })
    return true
  }
  await atomicWriteFile(path, `${retained.join('\n')}\n`)
  await applyPosixMode(path, 0o600)
  return true
}

/** Newest `maxBytes` of the file, starting at a line boundary. */
async function readTail(path: string, size: number, maxBytes: number): Promise<string> {
  const start = Math.max(0, size - maxBytes)
  const handle = await open(path, 'r')
  try {
    // One extra byte tells whether the tail begins on a line boundary.
    const lead = start > 0 ? 1 : 0
    const buffer = Buffer.alloc(size - start + lead)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start - lead)
    const text = buffer.subarray(0, bytesRead).toString('utf8')
    if (!lead) return text
    if (text.startsWith('\n')) return text.slice(1)
    const firstBreak = text.indexOf('\n')
    return firstBreak < 0 ? '' : text.slice(firstBreak + 1)
  } finally {
    await handle.close()
  }
}

function isRecentTraceLine(line: string, cutoffMs: number): boolean {
  try {
    const value = JSON.parse(line) as { startedAt?: unknown }
    if (typeof value.startedAt !== 'string') return false
    const timestamp = Date.parse(value.startedAt)
    return Number.isFinite(timestamp) && timestamp >= cutoffMs
  } catch {
    return false
  }
}

function normalizeOptions(options: ModelRequestTraceRetentionOptions): NormalizedRetentionOptions {
  const maxBytesPerThread = positiveInteger(
    options.maxBytesPerThread,
    DEFAULT_MAX_BYTES_PER_THREAD
  )
  return {
    maxBytesPerThread,
    maxTotalBytes: positiveInteger(options.maxTotalBytes, DEFAULT_MAX_TOTAL_BYTES),
    maxAgeMs: positiveInteger(options.maxAgeMs, DEFAULT_MAX_AGE_MS),
    maintenanceIntervalMs: nonNegativeInteger(
      options.maintenanceIntervalMs,
      DEFAULT_MAINTENANCE_INTERVAL_MS
    ),
    now: options.now ?? Date.now
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value > 0
    ? Math.max(1, Math.floor(value))
    : fallback
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value >= 0
    ? Math.floor(value)
    : fallback
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

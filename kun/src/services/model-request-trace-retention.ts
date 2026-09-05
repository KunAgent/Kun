import { readdir, readFile, rm, stat } from 'node:fs/promises'
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
    options: ModelRequestTraceRetentionOptions = {}
  ) {
    this.options = normalizeOptions(options)
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
    let files = await listTraceFiles(this.root)
    for (const file of files) {
      changed = await trimTraceFile(
        file.path,
        this.options.maxBytesPerThread,
        cutoff
      ) || changed
    }

    files = await listTraceFiles(this.root)
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

    files = await listTraceFiles(this.root)
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

async function trimTraceFile(path: string, maxBytes: number, cutoffMs: number): Promise<boolean> {
  let contents: string
  try {
    contents = await readFile(path, 'utf8')
  } catch (error) {
    if (isMissingFileError(error)) return false
    throw error
  }
  const lines = contents.split('\n').filter((line) => line.trim().length > 0)
  const retained: string[] = []
  let retainedBytes = 0
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (!isRecentTraceLine(line, cutoffMs)) continue
    const lineBytes = Buffer.byteLength(`${line}\n`, 'utf8')
    if (retainedBytes + lineBytes > maxBytes) continue
    retained.unshift(line)
    retainedBytes += lineBytes
  }
  const next = retained.length ? `${retained.join('\n')}\n` : ''
  if (next === contents) return false
  if (!next) {
    await rm(path, { force: true })
    return true
  }
  await atomicWriteFile(path, next)
  await applyPosixMode(path, 0o600)
  return true
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

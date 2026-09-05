import { readdir, readFile, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export type BackgroundShellOutputRetentionOptions = {
  maxBytesPerThread?: number
  maxFilesPerThread?: number
  maxTotalBytes?: number
  maxTotalFiles?: number
  maxAgeMs?: number
  staleMarkerMs?: number
  now?: () => number
}

type OutputEntry = {
  path: string
  threadId: string
  size: number
  mtimeMs: number
}

type NormalizedOptions = Required<Omit<BackgroundShellOutputRetentionOptions, 'now'>> & {
  now: () => number
}

const DEFAULT_MAX_BYTES_PER_THREAD = 64 * 1024 * 1024
const DEFAULT_MAX_FILES_PER_THREAD = 128
const DEFAULT_MAX_TOTAL_BYTES = 512 * 1024 * 1024
const DEFAULT_MAX_TOTAL_FILES = 2_048
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_STALE_MARKER_MS = 48 * 60 * 60 * 1000
const retentionQueues = new Map<string, Promise<void>>()

export function backgroundShellActiveMarkerPath(outputFilePath: string): string {
  return `${outputFilePath}.active.json`
}

/** Enforces settled-output budgets across every thread sharing one data dir. */
export function enforceBackgroundShellOutputRetention(
  dataDir: string,
  justSettledPath?: string,
  rawOptions: BackgroundShellOutputRetentionOptions = {}
): Promise<void> {
  const root = resolve(dataDir)
  const previous = retentionQueues.get(root) ?? Promise.resolve()
  const queued = previous.catch(() => undefined).then(() => enforceNow(
    root,
    justSettledPath ? resolve(justSettledPath) : undefined,
    normalizeOptions(rawOptions)
  ))
  retentionQueues.set(root, queued)
  void queued.finally(() => {
    if (retentionQueues.get(root) === queued) retentionQueues.delete(root)
  })
  return queued
}

async function enforceNow(
  dataDir: string,
  justSettledPath: string | undefined,
  options: NormalizedOptions
): Promise<void> {
  let entries = await scanSettledOutputs(dataDir, options)
  const cutoff = options.now() - options.maxAgeMs
  for (const entry of entries.filter((candidate) => candidate.mtimeMs < cutoff)) {
    await rm(entry.path, { force: true })
  }
  entries = entries.filter((entry) => entry.mtimeMs >= cutoff)

  const byThread = new Map<string, OutputEntry[]>()
  for (const entry of entries) {
    const group = byThread.get(entry.threadId) ?? []
    group.push(entry)
    byThread.set(entry.threadId, group)
  }
  for (const group of byThread.values()) {
    await pruneOldest(group, {
      maxBytes: options.maxBytesPerThread,
      maxFiles: options.maxFilesPerThread,
      justSettledPath
    })
  }

  entries = await scanSettledOutputs(dataDir, options)
  await pruneOldest(entries, {
    maxBytes: options.maxTotalBytes,
    maxFiles: options.maxTotalFiles,
    justSettledPath
  })
}

async function scanSettledOutputs(
  dataDir: string,
  options: NormalizedOptions
): Promise<OutputEntry[]> {
  const threadsRoot = join(dataDir, 'threads')
  let threads
  try {
    threads = await readdir(threadsRoot, { withFileTypes: true })
  } catch (error) {
    if (isMissingFileError(error)) return []
    throw error
  }
  const entries: OutputEntry[] = []
  for (const thread of threads) {
    if (!thread.isDirectory()) continue
    const outputDir = join(threadsRoot, thread.name, 'background-shells')
    let names
    try {
      names = await readdir(outputDir, { withFileTypes: true })
    } catch (error) {
      if (isMissingFileError(error)) continue
      throw error
    }
    for (const name of names) {
      if (!name.isFile() || !name.name.endsWith('.output')) continue
      const path = join(outputDir, name.name)
      if (await outputIsActive(path, options)) continue
      try {
        const metadata = await stat(path)
        entries.push({ path, threadId: thread.name, size: metadata.size, mtimeMs: metadata.mtimeMs })
      } catch (error) {
        if (!isMissingFileError(error)) throw error
      }
    }
  }
  return entries
}

async function outputIsActive(path: string, options: NormalizedOptions): Promise<boolean> {
  const marker = backgroundShellActiveMarkerPath(path)
  try {
    const [raw, metadata] = await Promise.all([readFile(marker, 'utf8'), stat(marker)])
    const value = JSON.parse(raw) as { pid?: unknown }
    if (typeof value.pid === 'number' && processAlive(value.pid)) return true
    if (metadata.mtimeMs >= options.now() - options.staleMarkerMs && typeof value.pid !== 'number') {
      return true
    }
    await rm(marker, { force: true })
    return false
  } catch (error) {
    if (isMissingFileError(error)) return false
    // A fresh marker that cannot be parsed/read is safer to preserve until its
    // stale-marker grace elapses on a later scan.
    const markerInfo = await stat(marker).catch(() => null)
    if (markerInfo?.mtimeMs !== undefined &&
        markerInfo.mtimeMs >= options.now() - options.staleMarkerMs) return true
    await rm(marker, { force: true }).catch(() => undefined)
    return false
  }
}

async function pruneOldest(
  entries: OutputEntry[],
  limits: { maxBytes: number; maxFiles: number; justSettledPath?: string }
): Promise<void> {
  let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0)
  let totalFiles = entries.length
  const oldestFirst = [...entries].sort((left, right) => {
    const leftSettled = left.path === limits.justSettledPath ? 1 : 0
    const rightSettled = right.path === limits.justSettledPath ? 1 : 0
    return leftSettled - rightSettled || left.mtimeMs - right.mtimeMs || left.path.localeCompare(right.path)
  })
  for (const entry of oldestFirst) {
    if (totalBytes <= limits.maxBytes && totalFiles <= limits.maxFiles) break
    await rm(entry.path, { force: true })
    totalBytes -= entry.size
    totalFiles -= 1
  }
}

function normalizeOptions(options: BackgroundShellOutputRetentionOptions): NormalizedOptions {
  return {
    maxBytesPerThread: positiveInteger(options.maxBytesPerThread, DEFAULT_MAX_BYTES_PER_THREAD),
    maxFilesPerThread: positiveInteger(options.maxFilesPerThread, DEFAULT_MAX_FILES_PER_THREAD),
    maxTotalBytes: positiveInteger(options.maxTotalBytes, DEFAULT_MAX_TOTAL_BYTES),
    maxTotalFiles: positiveInteger(options.maxTotalFiles, DEFAULT_MAX_TOTAL_FILES),
    maxAgeMs: positiveInteger(options.maxAgeMs, DEFAULT_MAX_AGE_MS),
    staleMarkerMs: positiveInteger(options.staleMarkerMs, DEFAULT_STALE_MARKER_MS),
    now: options.now ?? Date.now
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return String((error as { code?: unknown })?.code ?? '') === 'EPERM'
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value > 0
    ? Math.max(1, Math.floor(value))
    : fallback
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'

export type LiveProcessLogOptions = {
  maxFileBytes?: number
  maxArchives?: number
  maxAgeMs?: number
  maintenanceIntervalMs?: number
  now?: () => number
}

export type LiveProcessLogHandle = { close: () => void }

type NormalizedOptions = {
  maxFileBytes: number
  maxArchives: number
  maxAgeMs: number
  maintenanceIntervalMs: number
  now: () => number
}

type WritableLike = { write: NodeJS.WriteStream['write'] }

const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024
const DEFAULT_MAX_ARCHIVES = 3
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_MAINTENANCE_INTERVAL_MS = 60_000
const OVERSIZED_CHUNK_MARKER = '[kun log chunk truncated]\n'

/**
 * Keeps an inherited append-only stdout/stderr file descriptor on the same
 * inode while rotating its path during a live process.
 */
export function installLiveProcessLog(input: {
  logPath: string
  stdout?: WritableLike
  stderr?: WritableLike
  options?: LiveProcessLogOptions
}): LiveProcessLogHandle {
  const options = normalizeOptions(input.options)
  const stdout = input.stdout ?? process.stdout
  const stderr = input.stderr ?? process.stderr
  const restoreStdout = wrapWrite(stdout, input.logPath, options)
  const restoreStderr = stderr === stdout
    ? () => undefined
    : wrapWrite(stderr, input.logPath, options)
  maintainLiveProcessLog(input.logPath, options)
  const timer = options.maintenanceIntervalMs > 0
    ? setInterval(() => maintainLiveProcessLog(input.logPath, options), options.maintenanceIntervalMs)
    : undefined
  timer?.unref?.()
  let closed = false
  return {
    close: () => {
      if (closed) return
      closed = true
      if (timer) clearInterval(timer)
      restoreStdout()
      restoreStderr()
    }
  }
}

/** Performs startup/periodic cleanup without replacing the active inode. */
export function maintainLiveProcessLog(
  logPath: string,
  rawOptions: LiveProcessLogOptions = {}
): void {
  const options = normalizeOptions(rawOptions)
  try {
    if (fileSize(logPath) > options.maxFileBytes) rotateActiveLog(logPath, options)
    cleanupArchives(logPath, options)
  } catch {
    // Logging maintenance must never terminate the runtime it is diagnosing.
  }
}

function wrapWrite(
  stream: WritableLike,
  logPath: string,
  options: NormalizedOptions
): () => void {
  const original = stream.write.bind(stream)
  const wrapped = function (
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void
  ): boolean {
    const encoding = typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined
    let output: string | Uint8Array = boundChunk(chunk, encoding, options.maxFileBytes)
    try {
      const outputBytes = chunkBytes(output, encoding)
      const currentBytes = fileSize(logPath)
      if (currentBytes > 0 && currentBytes + outputBytes > options.maxFileBytes) {
        rotateActiveLog(logPath, options)
      }
    } catch {
      output = chunk
    }
    if (typeof encodingOrCallback === 'function') return original(output, encodingOrCallback)
    return original(output, encodingOrCallback, callback)
  } as NodeJS.WriteStream['write']
  stream.write = wrapped
  return () => {
    if (stream.write === wrapped) stream.write = original
  }
}

function boundChunk(
  chunk: string | Uint8Array,
  encoding: BufferEncoding | undefined,
  maxBytes: number
): string | Uint8Array {
  if (chunkBytes(chunk, encoding) <= maxBytes) return chunk
  const source = typeof chunk === 'string' ? Buffer.from(chunk, encoding) : Buffer.from(chunk)
  const marker = Buffer.from(OVERSIZED_CHUNK_MARKER, 'utf8')
  if (marker.byteLength >= maxBytes) return marker.subarray(0, maxBytes)
  return Buffer.concat([marker, source.subarray(source.byteLength - (maxBytes - marker.byteLength))])
}

function rotateActiveLog(logPath: string, options: NormalizedOptions): void {
  if (!existsSync(logPath) || fileSize(logPath) === 0) return
  if (options.maxArchives === 0) {
    truncateSync(logPath, 0)
    return
  }
  for (let index = options.maxArchives; index >= 1; index -= 1) {
    const source = `${logPath}.${index}`
    if (!existsSync(source)) continue
    if (index === options.maxArchives) rmSync(source, { force: true })
    else renameSync(source, `${logPath}.${index + 1}`)
  }
  const temporary = `${logPath}.rotate-${process.pid}-${Date.now()}`
  copyBoundedTail(logPath, temporary, options.maxFileBytes)
  renameSync(temporary, `${logPath}.1`)
  truncateSync(logPath, 0)
  cleanupArchives(logPath, options)
}

function copyBoundedTail(source: string, destination: string, maxBytes: number): void {
  const size = fileSize(source)
  const length = Math.min(size, maxBytes)
  const buffer = Buffer.allocUnsafe(length)
  const handle = openSync(source, 'r')
  try {
    let offset = 0
    while (offset < length) {
      const read = readSync(handle, buffer, offset, length - offset, size - length + offset)
      if (read === 0) break
      offset += read
    }
    writeFileSync(destination, buffer.subarray(0, offset), { mode: 0o600 })
  } finally {
    closeSync(handle)
  }
}

function cleanupArchives(logPath: string, options: NormalizedOptions): void {
  const directory = dirname(logPath)
  const prefix = `${basename(logPath)}.`
  const cutoff = options.now() - options.maxAgeMs
  let archives = readdirSync(directory)
    .filter((name) => name.startsWith(prefix) && /^\d+$/.test(name.slice(prefix.length)))
    .map((name) => {
      const path = join(directory, name)
      return { path, index: Number(name.slice(prefix.length)), metadata: statSync(path) }
    })
    .sort((left, right) => left.index - right.index)
  for (const archive of archives) {
    if (archive.index > options.maxArchives || archive.metadata.mtimeMs < cutoff) {
      rmSync(archive.path, { force: true })
    }
  }
  archives = archives.filter((archive) =>
    archive.index <= options.maxArchives && archive.metadata.mtimeMs >= cutoff)
  const maxArchiveBytes = options.maxFileBytes * options.maxArchives
  let total = archives.reduce((sum, archive) => sum + archive.metadata.size, 0)
  for (const archive of [...archives].sort((left, right) => right.index - left.index)) {
    if (total <= maxArchiveBytes) break
    rmSync(archive.path, { force: true })
    total -= archive.metadata.size
  }
}

function normalizeOptions(options: LiveProcessLogOptions = {}): NormalizedOptions {
  return {
    maxFileBytes: positiveInteger(options.maxFileBytes, DEFAULT_MAX_FILE_BYTES),
    maxArchives: nonNegativeInteger(options.maxArchives, DEFAULT_MAX_ARCHIVES),
    maxAgeMs: positiveInteger(options.maxAgeMs, DEFAULT_MAX_AGE_MS),
    maintenanceIntervalMs: nonNegativeInteger(
      options.maintenanceIntervalMs,
      DEFAULT_MAINTENANCE_INTERVAL_MS
    ),
    now: options.now ?? Date.now
  }
}

function chunkBytes(chunk: string | Uint8Array, encoding?: BufferEncoding): number {
  return typeof chunk === 'string' ? Buffer.byteLength(chunk, encoding) : chunk.byteLength
}

function fileSize(path: string): number {
  try {
    return statSync(path).size
  } catch (error) {
    if (isMissingFileError(error)) return 0
    throw error
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

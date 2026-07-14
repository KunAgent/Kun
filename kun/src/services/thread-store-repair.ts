import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'

const DEFAULT_MAX_BYTES = 16 * 1024 * 1024
const RENAME_ATTEMPTS = 6

export type JsonlTailInspection = {
  status: 'missing' | 'ok' | 'repaired' | 'truncated' | 'invalid' | 'too_large' | 'changed'
  path: string
  bytes: number
  validPrefixBytes?: number
  removedBytes?: number
  contentSha256?: string
  reason?: string
}

export type JsonlTailBackup = {
  path: string
  contents: string
  bytes: number
  sha256: string
}

export type JsonlTailRepairOptions = {
  maxBytes?: number
  backup: (snapshot: JsonlTailBackup) => Promise<void>
}

/** Inspect a JSONL file without exposing its contents or changing the file. */
export async function inspectJsonlTail(
  path: string,
  options: { maxBytes?: number } = {}
): Promise<JsonlTailInspection> {
  const resolvedPath = path
  const maxBytes = normalizeMaxBytes(options.maxBytes)
  let before: Awaited<ReturnType<typeof stat>>
  try {
    before = await stat(resolvedPath)
  } catch (error) {
    if (isMissing(error)) return { status: 'missing', path: resolvedPath, bytes: 0 }
    throw error
  }
  if (!before.isFile()) {
    return { status: 'invalid', path: resolvedPath, bytes: before.size, reason: 'not_a_file' }
  }
  if (before.size > maxBytes) {
    return { status: 'too_large', path: resolvedPath, bytes: before.size, reason: 'max_bytes' }
  }

  const bytes = await readFile(resolvedPath)
  const after = await stat(resolvedPath)
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
    return { status: 'changed', path: resolvedPath, bytes: after.size, reason: 'changed_during_read' }
  }
  if (!Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes)) {
    return { status: 'invalid', path: resolvedPath, bytes: bytes.length, reason: 'invalid_utf8' }
  }

  const text = bytes.toString('utf8')
  const lines = text.split('\n')
  let characterOffset = 0
  let validRecords = 0
  let malformedInterior = false
  let malformedFinalStart = -1
  let lastNonEmpty = -1

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const trimmed = line.trim()
    if (trimmed) lastNonEmpty = index
    characterOffset += line.length + (index < lines.length - 1 ? 1 : 0)
  }

  characterOffset = 0
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const trimmed = line.trim()
    if (trimmed) {
      try {
        JSON.parse(line)
        validRecords += 1
      } catch {
        if (index === lastNonEmpty) {
          malformedFinalStart = characterOffset
        } else {
          malformedInterior = true
        }
      }
    }
    characterOffset += line.length + (index < lines.length - 1 ? 1 : 0)
  }

  const contentSha256 = sha256(bytes)
  if (malformedInterior || (malformedFinalStart >= 0 && validRecords === 0)) {
    return { status: 'invalid', path: resolvedPath, bytes: bytes.length, contentSha256, reason: 'malformed_record' }
  }
  if (malformedFinalStart >= 0) {
    const validPrefixBytes = Buffer.byteLength(text.slice(0, malformedFinalStart), 'utf8')
    return {
      status: 'truncated',
      path: resolvedPath,
      bytes: bytes.length,
      validPrefixBytes,
      removedBytes: bytes.length - validPrefixBytes,
      contentSha256
    }
  }
  return { status: 'ok', path: resolvedPath, bytes: bytes.length, contentSha256 }
}

/**
 * Repair only a malformed final JSONL record.
 *
 * The caller must provide a backup callback. The callback receives a stable,
 * bounded snapshot and must durably preserve it before this function writes.
 * Interior corruption, races, missing backups, and oversized files fail closed.
 */
export async function repairJsonlTail(
  path: string,
  options: JsonlTailRepairOptions
): Promise<JsonlTailInspection> {
  if (typeof options.backup !== 'function') throw new Error('backup_required')
  const inspection = await inspectJsonlTail(path, options)
  if (inspection.status !== 'truncated' || inspection.validPrefixBytes === undefined) {
    return inspection
  }

  const before = await stat(path)
  const bytes = await readFile(path)
  const after = await stat(path)
  if (
    before.size !== after.size
    || before.mtimeMs !== after.mtimeMs
    || bytes.length !== inspection.bytes
    || (inspection.contentSha256 && sha256(bytes) !== inspection.contentSha256)
  ) {
    return { status: 'changed', path, bytes: after.size, reason: 'changed_before_repair' }
  }
  const contents = bytes.toString('utf8')
  const snapshot: JsonlTailBackup = {
    path,
    contents,
    bytes: bytes.length,
    sha256: sha256(bytes)
  }
  await options.backup(snapshot)

  // The backup callback can take an arbitrary amount of time. Revalidate the
  // exact bytes after it returns so a concurrent writer cannot be overwritten
  // by the stale repair snapshot.
  const latestBeforeWrite = await readFile(path)
  const latestStat = await stat(path)
  if (
    latestStat.size !== before.size
    || latestStat.mtimeMs !== before.mtimeMs
    || !latestBeforeWrite.equals(bytes)
  ) {
    return { status: 'changed', path, bytes: latestStat.size, reason: 'changed_before_write' }
  }

  const repairedBytes = bytes.subarray(0, inspection.validPrefixBytes)
  await writeAtomic(path, repairedBytes)
  const verify = await readFile(path)
  if (!verify.equals(repairedBytes)) throw new Error('repair_verification_failed')
  return {
    status: 'repaired',
    path,
    bytes: verify.length,
    validPrefixBytes: verify.length,
    removedBytes: bytes.length - verify.length
  }
}

async function writeAtomic(path: string, bytes: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tempPath = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.repair.tmp`
  try {
    const handle = await open(tempPath, 'w')
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    for (let attempt = 1; attempt <= RENAME_ATTEMPTS; attempt += 1) {
      try {
        await rename(tempPath, path)
        return
      } catch (error) {
        if (!isRetryableRename(error) || attempt === RENAME_ATTEMPTS) throw error
        await new Promise((resolve) => setTimeout(resolve, attempt * 25))
      }
    }
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined)
  }
}

function normalizeMaxBytes(value: number | undefined): number {
  const maxBytes = value ?? DEFAULT_MAX_BYTES
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('maxBytes must be positive')
  return maxBytes
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function isRetryableRename(error: unknown): boolean {
  const code = String((error as { code?: unknown })?.code ?? '')
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
}

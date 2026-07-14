import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, opendir, open, rm } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { atomicWriteFile } from '../../../kun/src/adapters/file/atomic-write'

export type BackupPayload = {
  contents: string
  sensitivity: 'non-sensitive'
}

export type AtomicBackupOptions = {
  directory: string
  id: string
  maxBackups?: number
  maxTotalBytes?: number
  maxBytesPerBackup?: number
  now?: () => Date
}

export type AtomicBackupRecord = {
  schemaVersion: 1
  id: string
  path: string
  bytes: number
  sha256: string
  createdAt: string
}

export type RestoreBackupOptions = {
  directory: string
  maxBytes?: number
}

const DEFAULT_MAX_BACKUPS = 5
const DEFAULT_MAX_TOTAL_BYTES = 50 * 1024 * 1024
const DEFAULT_MAX_BYTES_PER_BACKUP = 10 * 1024 * 1024
const MAX_ID_LENGTH = 64
const MAX_ROTATION_SCAN_ENTRIES = 4096

/** Create a bounded text backup using the existing atomic file writer. */
export async function createAtomicBackup(
  payload: BackupPayload,
  options: AtomicBackupOptions
): Promise<AtomicBackupRecord> {
  validatePayload(payload)
  const limits = normalizeLimits(options)
  const contentsBytes = Buffer.byteLength(payload.contents, 'utf8')
  if (contentsBytes > limits.maxBytesPerBackup || contentsBytes > limits.maxTotalBytes) {
    throw new Error('backup contents exceed configured size limit')
  }
  const createdAt = options.now?.() ?? new Date()
  if (!Number.isFinite(createdAt.getTime())) throw new Error('backup timestamp is invalid')

  const id = sanitizeId(options.id)
  const directory = resolve(options.directory)
  await mkdir(directory, { recursive: true })
  const path = join(directory, `${id}-${formatTimestamp(createdAt)}-${randomUUID()}.backup`)
  const record: AtomicBackupRecord = {
    schemaVersion: 1,
    id,
    path,
    bytes: contentsBytes,
    sha256: sha256(payload.contents),
    createdAt: createdAt.toISOString()
  }
  await atomicWriteFile(path, payload.contents)
  await rotateBackups(directory, id, path, limits)
  return record
}

/** Read and checksum-validate a backup within its configured directory. */
export async function restoreAtomicBackup(
  record: AtomicBackupRecord,
  options: RestoreBackupOptions
): Promise<string> {
  validateRecord(record)
  const directory = resolve(options.directory)
  const path = resolve(record.path)
  if (!isWithin(directory, path) || basename(path) !== basename(record.path)) {
    throw new Error('backup path is outside the configured directory')
  }
  const maxBytes = normalizeLimit(options.maxBytes ?? DEFAULT_MAX_BYTES_PER_BACKUP, 'maxBytes')
  const before = await lstat(path)
  if (!before.isFile()) throw new Error('backup path is not a regular file')
  if (before.size > maxBytes || before.size !== record.bytes) throw new Error('backup size is invalid')
  const contents = await readBoundedText(path, maxBytes)
  if (Buffer.byteLength(contents, 'utf8') !== record.bytes || sha256(contents) !== record.sha256) {
    throw new Error('backup checksum validation failed')
  }
  const after = await lstat(path)
  if (!after.isFile()) throw new Error('backup path changed to a non-file')
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
    throw new Error('backup changed during restore')
  }
  return contents
}

function validatePayload(payload: BackupPayload): void {
  if (!payload || Object.keys(payload).some((key) => key !== 'contents' && key !== 'sensitivity')) {
    throw new Error('backup payload contains unknown fields')
  }
  if (typeof payload.contents !== 'string') throw new Error('backup contents must be text')
  if (payload.sensitivity !== 'non-sensitive') throw new Error('sensitive backup contents are not allowed')
}

function validateRecord(record: AtomicBackupRecord): void {
  if (!record || record.schemaVersion !== 1 || typeof record.id !== 'string' || !record.id ||
      typeof record.path !== 'string' || !isAbsolute(record.path) ||
      !Number.isSafeInteger(record.bytes) || record.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(record.sha256) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.createdAt)) {
    throw new Error('backup record is invalid')
  }
}

function normalizeLimits(options: AtomicBackupOptions): {
  maxBackups: number
  maxTotalBytes: number
  maxBytesPerBackup: number
} {
  return {
    maxBackups: normalizeLimit(options.maxBackups ?? DEFAULT_MAX_BACKUPS, 'maxBackups'),
    maxTotalBytes: normalizeLimit(options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES, 'maxTotalBytes'),
    maxBytesPerBackup: normalizeLimit(options.maxBytesPerBackup ?? DEFAULT_MAX_BYTES_PER_BACKUP, 'maxBytesPerBackup')
  }
}

function normalizeLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer`)
  return value
}

function sanitizeId(raw: string): string {
  if (typeof raw !== 'string') throw new Error('backup id must be text')
  const value = raw.trim().replace(/[^A-Za-z0-9._-]+/g, '-')
  if (!value || value === '.' || value === '..') throw new Error('backup id is invalid')
  return value.slice(0, MAX_ID_LENGTH)
}

async function rotateBackups(
  directory: string,
  id: string,
  keepPath: string,
  limits: { maxBackups: number; maxTotalBytes: number }
): Promise<void> {
  const prefix = `${id}-`
  const backups: Array<{ path: string; bytes: number; mtimeMs: number }> = []
  const directoryHandle = await opendir(directory)
  try {
    for await (const entry of directoryHandle) {
      if (backups.length >= MAX_ROTATION_SCAN_ENTRIES) {
        throw new Error('backup directory contains too many entries')
      }
      if (!entry.isFile() || !entry.name.startsWith(prefix) || !entry.name.endsWith('.backup')) continue
      const path = join(directory, entry.name)
      const metadata = await lstat(path)
      if (!metadata.isFile()) continue
      backups.push({ path, bytes: metadata.size, mtimeMs: metadata.mtimeMs })
    }
  } finally {
    await directoryHandle.close().catch(() => undefined)
  }
  backups.sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path))
  let total = backups.reduce((sum, backup) => sum + backup.bytes, 0)
  while (backups.length > limits.maxBackups || total > limits.maxTotalBytes) {
    const index = backups.findIndex((backup) => backup.path !== keepPath)
    if (index < 0) break
    const [oldest] = backups.splice(index, 1)
    await rm(oldest.path, { force: true })
    total -= oldest.bytes
  }
}

async function readBoundedText(path: string, maxBytes: number): Promise<string> {
  const handle = await open(path, 'r')
  const chunks: Buffer[] = []
  let total = 0
  try {
    while (total <= maxBytes) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, maxBytes + 1 - total))
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, total)
      if (bytesRead === 0) break
      chunks.push(chunk.subarray(0, bytesRead))
      total += bytesRead
      if (total > maxBytes) throw new Error('backup exceeds restore size limit')
    }
    return Buffer.concat(chunks).toString('utf8')
  } finally {
    await handle.close().catch(() => undefined)
  }
}

function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function formatTimestamp(value: Date): string {
  return value.toISOString().replace(/[:.]/g, '-')
}

function sha256(contents: string): string {
  return createHash('sha256').update(contents, 'utf8').digest('hex')
}

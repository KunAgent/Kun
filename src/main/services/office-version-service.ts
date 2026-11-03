import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  MAX_OFFICE_VERSION_BYTES,
  MAX_OFFICE_VERSION_LABEL_CHARS,
  MAX_OFFICE_VERSIONS_PER_FILE,
  type OfficeVersionEntry,
  type OfficeVersionFailure,
  type OfficeVersionListResult,
  type OfficeVersionReadResult,
  type OfficeVersionReason,
  type OfficeVersionRecordResult,
  type OfficeVersionRestoreResult
} from '../../shared/office-version'
import { atomicWriteFile } from '../atomic-json-file'

/**
 * Snapshot store for Office files edited from the artifact chat panel. Each
 * file (by resolved absolute path) gets a folder of `<id>.bin` blobs plus an
 * `index.json`, newest first, capped per file. Restores verify the expected
 * current content first and keep that content as a new snapshot, so an undo
 * can itself be undone.
 */

type IndexFile = { version: 1; path: string; entries: OfficeVersionEntry[] }

const queues = new Map<string, Promise<unknown>>()

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function failure(code: OfficeVersionFailure['code'], message: string): OfficeVersionFailure {
  return { ok: false, code, message }
}

function fileKey(absolutePath: string): string {
  const normalized = process.platform === 'win32' ? absolutePath.toLowerCase() : absolutePath
  return sha256(Buffer.from(normalized, 'utf8')).slice(0, 32)
}

/** One operation per file at a time: index edits and restores never interleave. */
function serialized<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(task)
  const tail = next.catch(() => undefined)
  queues.set(key, tail)
  void tail.then(() => { if (queues.get(key) === tail) queues.delete(key) })
  return next
}

async function readIndex(folder: string, absolutePath: string): Promise<IndexFile> {
  try {
    const parsed = JSON.parse(await readFile(join(folder, 'index.json'), 'utf8')) as Partial<IndexFile>
    if (parsed.version === 1 && Array.isArray(parsed.entries)) {
      return { version: 1, path: absolutePath, entries: parsed.entries.filter(validEntry) }
    }
  } catch {
    // Missing or unreadable index: start a fresh history for this file.
  }
  return { version: 1, path: absolutePath, entries: [] }
}

function validEntry(value: unknown): value is OfficeVersionEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return typeof entry.id === 'string' && /^[a-z0-9-]{1,64}$/.test(entry.id) &&
    typeof entry.sha256 === 'string' && typeof entry.createdAt === 'string' &&
    typeof entry.size === 'number' && typeof entry.label === 'string'
}

async function writeIndex(folder: string, index: IndexFile): Promise<void> {
  await atomicWriteFile(join(folder, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)
}

async function addEntry(input: {
  folder: string
  absolutePath: string
  bytes: Uint8Array
  replacedBySha256?: string
  label: string
  reason: OfficeVersionReason
  threadId?: string
  now: Date
}): Promise<OfficeVersionEntry> {
  const index = await readIndex(input.folder, input.absolutePath)
  const contentSha = sha256(input.bytes)
  const latest = index.entries[0]
  if (latest && latest.sha256 === contentSha && latest.replacedBySha256 === input.replacedBySha256) return latest
  const entry: OfficeVersionEntry = {
    id: `${input.now.getTime().toString(36)}-${contentSha.slice(0, 12)}`,
    createdAt: input.now.toISOString(),
    sha256: contentSha,
    ...(input.replacedBySha256 ? { replacedBySha256: input.replacedBySha256 } : {}),
    size: input.bytes.byteLength,
    label: Array.from(input.label.trim()).slice(0, MAX_OFFICE_VERSION_LABEL_CHARS).join(''),
    reason: input.reason,
    ...(input.threadId ? { threadId: input.threadId } : {})
  }
  await writeBinaryAtomic(join(input.folder, `${entry.id}.bin`), input.bytes)
  const entries = [entry, ...index.entries.filter((candidate) => candidate.id !== entry.id)]
  const kept = entries.slice(0, MAX_OFFICE_VERSIONS_PER_FILE)
  await writeIndex(input.folder, { ...index, entries: kept })
  await Promise.all(entries.slice(MAX_OFFICE_VERSIONS_PER_FILE).map((dropped) =>
    rm(join(input.folder, `${dropped.id}.bin`), { force: true }).catch(() => undefined)))
  return entry
}

/** Temp file beside the target, then rename; the target keeps its permissions. */
async function writeBinaryAtomic(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const mode = await stat(path).then((info) => info.mode & 0o777).catch(() => 0o600)
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    const handle = await open(temporaryPath, 'wx', mode)
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporaryPath, path)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

async function readEntryBytes(folder: string, entry: OfficeVersionEntry): Promise<Uint8Array | null> {
  const bytes = await readFile(join(folder, `${entry.id}.bin`)).catch(() => null)
  return bytes && sha256(bytes) === entry.sha256 ? bytes : null
}

export type OfficeVersionStore = {
  record: (input: {
    absolutePath: string
    data: Uint8Array
    sha256: string
    replacedBySha256?: string
    label: string
    threadId?: string
  }) => Promise<OfficeVersionRecordResult>
  list: (absolutePath: string) => Promise<OfficeVersionListResult>
  read: (absolutePath: string, id: string) => Promise<OfficeVersionReadResult>
  restore: (absolutePath: string, id: string, expectedSha256: string) => Promise<OfficeVersionRestoreResult>
}

export function createOfficeVersionStore(rootDir: string, clock: () => Date = () => new Date()): OfficeVersionStore {
  const folderFor = (absolutePath: string): string => join(rootDir, fileKey(absolutePath))
  const guard = async <T>(task: () => Promise<T>): Promise<T | OfficeVersionFailure> => {
    try {
      return await task()
    } catch (error) {
      return failure('io', error instanceof Error ? error.message : String(error))
    }
  }
  return {
    record: (input) => serialized(fileKey(input.absolutePath), () => guard(async () => {
      if (input.data.byteLength === 0 || input.data.byteLength > MAX_OFFICE_VERSION_BYTES) {
        return failure('invalid', 'The snapshot is empty or larger than the version store accepts.')
      }
      if (sha256(input.data) !== input.sha256.toLowerCase()) {
        return failure('invalid', 'The snapshot does not match its SHA-256.')
      }
      const entry = await addEntry({
        folder: folderFor(input.absolutePath),
        absolutePath: input.absolutePath,
        bytes: input.data,
        ...(input.replacedBySha256 ? { replacedBySha256: input.replacedBySha256.toLowerCase() } : {}),
        label: input.label,
        reason: 'agent-edit',
        ...(input.threadId ? { threadId: input.threadId } : {}),
        now: clock()
      })
      return { ok: true as const, entry }
    })),
    list: (absolutePath) => serialized(fileKey(absolutePath), () => guard(async () => {
      const index = await readIndex(folderFor(absolutePath), absolutePath)
      return { ok: true as const, entries: index.entries }
    })),
    read: (absolutePath, id) => serialized(fileKey(absolutePath), () => guard(async () => {
      const folder = folderFor(absolutePath)
      const entry = (await readIndex(folder, absolutePath)).entries.find((candidate) => candidate.id === id)
      if (!entry) return failure('missing', 'That version is no longer kept.')
      const bytes = await readEntryBytes(folder, entry)
      if (!bytes) return failure('missing', 'That version could not be read.')
      return { ok: true as const, entry, dataBase64: Buffer.from(bytes).toString('base64') }
    })),
    restore: (absolutePath, id, expectedSha256) => serialized(fileKey(absolutePath), () => guard(async () => {
      const folder = folderFor(absolutePath)
      const entry = (await readIndex(folder, absolutePath)).entries.find((candidate) => candidate.id === id)
      if (!entry) return failure('missing', 'That version is no longer kept.')
      const target = await readEntryBytes(folder, entry)
      if (!target) return failure('missing', 'That version could not be read.')
      const current = await readFile(absolutePath)
      if (sha256(current) !== expectedSha256.toLowerCase()) {
        return failure('changed', 'The file changed after this view was loaded; reload it before restoring.')
      }
      const backup = await addEntry({
        folder,
        absolutePath,
        bytes: current,
        replacedBySha256: entry.sha256,
        label: entry.label,
        reason: 'restore',
        now: clock()
      })
      await writeBinaryAtomic(absolutePath, target)
      return { ok: true as const, sha256: entry.sha256, backup }
    }))
  }
}

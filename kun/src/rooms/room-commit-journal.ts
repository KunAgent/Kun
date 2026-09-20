import { createHash } from 'node:crypto'
import { mkdir, open, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { RoomIdSchema } from '../contracts/rooms.js'

const MAX_COMMIT_BYTES = 1024 * 1024
const CommitSchema = z.object({
  schemaVersion: z.literal(1),
  sequence: z.number().int().positive(),
  commandId: RoomIdSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  payload: z.unknown(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/)
}).strict()
export type RoomJournalCommit = z.infer<typeof CommitSchema>

export class RoomJournalConflictError extends Error {
  readonly code = 'room_revision_conflict'
}
export class RoomJournalCorruptionError extends Error {
  readonly code = 'room_journal_corrupt'
}

/**
 * Manager-owned journal primitive. Each immutable, synced commit is the atomic
 * business unit, including its outbox intent. Callers must provide Manager
 * ownership/fencing; this class does not arbitrate independent processes.
 */
export class RoomCommitJournal {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly root: string, private readonly assertOwner: () => Promise<void>) {}

  append(input: {
    roomId: string
    commandId: string
    fingerprint: string
    expectedSequence: number
    payload: unknown
  }): Promise<RoomJournalCommit> {
    return this.serialize(async () => {
      const roomId = RoomIdSchema.parse(input.roomId)
      RoomIdSchema.parse(input.commandId)
      await this.assertOwner()
      const entries = await this.readAll(roomId)
      const existing = entries.find((entry) => entry.commandId === input.commandId)
      if (existing) {
        if (existing.fingerprint !== input.fingerprint) {
          throw new RoomJournalConflictError('command id is bound to different content')
        }
        return existing
      }
      if (entries.length !== input.expectedSequence) throw new RoomJournalConflictError('stale journal revision')
      const unsigned = {
        schemaVersion: 1 as const,
        sequence: entries.length + 1,
        commandId: input.commandId,
        fingerprint: input.fingerprint,
        payload: input.payload
      }
      const commit = CommitSchema.parse({ ...unsigned, checksum: digest(JSON.stringify(unsigned)) })
      const serialized = `${JSON.stringify(commit)}\n`
      if (Buffer.byteLength(serialized) > MAX_COMMIT_BYTES) throw new Error('room commit exceeds size limit')
      const directory = join(this.root, roomId)
      await createDurableDirectory(directory)
      await this.assertOwner()
      // Exclusive creation prevents replacing a committed revision even when a
      // stale caller reaches the filesystem. A partial file fails closed on read.
      const handle = await open(join(directory, fileName(commit.sequence)), 'wx', 0o600)
      try {
        await handle.writeFile(serialized, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      if (process.platform !== 'win32') {
        const directoryHandle = await open(directory, 'r')
        try { await directoryHandle.sync() } finally { await directoryHandle.close() }
      }
      return commit
    })
  }

  async readAll(roomIdInput: string): Promise<RoomJournalCommit[]> {
    const roomId = RoomIdSchema.parse(roomIdInput)
    const directory = join(this.root, roomId)
    let names: string[]
    try { names = await readdir(directory) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const files = names.filter((name) => /^\d{12}\.json$/.test(name)).sort()
    const entries: RoomJournalCommit[] = []
    for (const name of files) {
      const path = join(directory, name)
      if ((await stat(path)).size > MAX_COMMIT_BYTES) throw new RoomJournalCorruptionError('oversized journal commit')
      let entry: RoomJournalCommit
      try {
        entry = CommitSchema.parse(JSON.parse(await readFile(path, 'utf8')))
      } catch (cause) {
        throw new RoomJournalCorruptionError(`invalid room commit ${name}`, { cause })
      }
      const { checksum, ...unsigned } = entry
      if (checksum !== digest(JSON.stringify(unsigned)) || entry.sequence !== entries.length + 1 ||
        name !== fileName(entry.sequence)) throw new RoomJournalCorruptionError(`invalid room sequence/checksum ${name}`)
      entries.push(entry)
    }
    return entries
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }
}

export function roomRequestFingerprint(request: unknown): string {
  return digest(JSON.stringify(canonical(request)))
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonical(entry)]))
  }
  return value
}
async function createDurableDirectory(path: string): Promise<void> {
  const absolute = resolve(path)
  const parent = dirname(absolute)
  if (parent !== absolute) await createDurableDirectory(parent)
  try { await mkdir(absolute, { mode: 0o700 }) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  // Also sync existing parents: a prior failed attempt may have created the
  // directory but failed before making its parent entry durable.
  if (process.platform !== 'win32') {
    const handle = await open(parent, 'r')
    try { await handle.sync() } finally { await handle.close() }
  }
}

function digest(value: string): string { return createHash('sha256').update(value).digest('hex') }
function fileName(sequence: number): string { return `${String(sequence).padStart(12, '0')}.json` }

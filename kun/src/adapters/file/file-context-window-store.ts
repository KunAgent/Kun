import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { assertSafeThreadId } from '../../contracts/thread-id.js'
import type { NotesWriteFileResult } from '../../contracts/context-windows.js'
import {
  CONTEXT_WINDOW_NOTE_VERSION_RETENTION,
  type ContextWindowStore,
  type ContextWindowStoreLimits,
  type NoteAppendOutcome,
  type NoteContent,
  type NoteFileSummary,
  type NoteVersionRecord
} from '../../ports/context-window-store.js'

const STATE_SCHEMA_VERSION = 2

type NoteFileRecord = {
  revision: number
  byteSize: number
  updatedAt: string
  content: string
  /**
   * Immutable committed snapshots, oldest first. Absent on files written by
   * schema v1; the first v2 commit backfills the pre-existing content as a
   * snapshot so old state files join the version chain.
   */
  versions?: NoteVersionRecord[]
}

type NoteAppendJournalEntry = {
  path: string
  revision: number
  /** Missing on journal entries written by schema v1 (treated as pre-fork). */
  atItemSeq?: number
}

type NoteState = {
  schemaVersion: typeof STATE_SCHEMA_VERSION
  /** Per-thread monotonic commit seq for version snapshots. */
  nextCommitSeq: number
  files: Record<string, NoteFileRecord>
  /** operationId -> committed append result, for idempotent replay. */
  appends: Record<string, NoteAppendJournalEntry>
}

function emptyState(): NoteState {
  return { schemaVersion: STATE_SCHEMA_VERSION, nextCommitSeq: 1, files: {}, appends: {} }
}

function byteSize(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function isValidVersion(value: unknown): value is NoteVersionRecord {
  const version = value as NoteVersionRecord | null
  return Boolean(
    version &&
    Number.isSafeInteger(version.seq) && version.seq >= 1 &&
    Number.isSafeInteger(version.atItemSeq) && version.atItemSeq >= 0 &&
    typeof version.at === 'string' &&
    typeof version.content === 'string'
  )
}

function parseState(raw: string): NoteState {
  const parsed = JSON.parse(raw) as {
    schemaVersion?: unknown
    nextCommitSeq?: unknown
    files?: Record<string, NoteFileRecord> | null
    appends?: Record<string, NoteAppendJournalEntry> | null
  } | null
  if (
    (parsed?.schemaVersion !== 1 && parsed?.schemaVersion !== STATE_SCHEMA_VERSION) ||
    typeof parsed.files !== 'object' || !parsed.files
  ) {
    return emptyState()
  }
  const files: Record<string, NoteFileRecord> = {}
  for (const [path, record] of Object.entries(parsed.files)) {
    if (!record || typeof record.revision !== 'number' || typeof record.content !== 'string') {
      continue
    }
    files[path] = {
      revision: record.revision,
      byteSize: typeof record.byteSize === 'number' ? record.byteSize : byteSize(record.content),
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
      content: record.content,
      ...(Array.isArray(record.versions)
        ? { versions: record.versions.filter(isValidVersion) }
        : {})
    }
  }
  const appends: Record<string, NoteAppendJournalEntry> = {}
  if (typeof parsed.appends === 'object' && parsed.appends) {
    for (const [operationId, entry] of Object.entries(parsed.appends)) {
      if (entry && typeof entry.path === 'string' && typeof entry.revision === 'number') {
        appends[operationId] = {
          path: entry.path,
          revision: entry.revision,
          ...(Number.isSafeInteger(entry.atItemSeq) ? { atItemSeq: entry.atItemSeq } : {})
        }
      }
    }
  }
  const nextCommitSeq = Number.isSafeInteger(parsed.nextCommitSeq) && (parsed.nextCommitSeq as number) >= 1
    ? parsed.nextCommitSeq as number
    : 1
  return { schemaVersion: STATE_SCHEMA_VERSION, nextCommitSeq, files, appends }
}

export class QuotaExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QuotaExceededError'
  }
}

/**
 * File-backed context-window store. The whole notes dataset of a thread is
 * capped by quota (2 MiB current content plus bounded version retention), so
 * the per-thread state file is small enough to rewrite atomically on every
 * mutation; a crash mid-write leaves the previous state file intact and a
 * retry is safe.
 *
 * Version-retention policy (separate from the current-content quotas):
 * every committed write/append appends an immutable full-content snapshot
 * with a per-thread monotonic commit seq and the caller-reported public
 * history position. At most `maxVersionsPerFile` snapshots are kept per file
 * and at most `maxVersionBytesPerThread` snapshot bytes per thread; eviction
 * drops the oldest snapshots first and never drops the newest snapshot of a
 * file or touches current content. Snapshots are full content, so evicting
 * an old snapshot never corrupts the replay of a newer one.
 */
export class FileContextWindowStore implements ContextWindowStore {
  private readonly dataDir: string
  private readonly limits: ContextWindowStoreLimits
  private readonly states = new Map<string, NoteState>()
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(options: { dataDir: string; limits: ContextWindowStoreLimits }) {
    this.dataDir = resolve(options.dataDir, 'threads')
    this.limits = options.limits
  }

  listNoteFiles(threadId: string): Promise<NoteFileSummary[]> {
    assertSafeThreadId(threadId)
    return this.withThreadQueue(threadId, async () =>
      Object.entries((await this.state(threadId)).files)
        .map(([path, record]) => ({
          path,
          revision: record.revision,
          byteSize: record.byteSize,
          updatedAt: record.updatedAt
        }))
        .sort((left, right) => left.path.localeCompare(right.path))
    )
  }

  readNote(threadId: string, path: string): Promise<NoteContent | null> {
    assertSafeThreadId(threadId)
    return this.withThreadQueue(threadId, async () => {
      const record = (await this.state(threadId)).files[path]
      return record ? { content: record.content, revision: record.revision } : null
    })
  }

  async writeNote(
    threadId: string,
    path: string,
    expectedRevision: number,
    content: string,
    nowIso: string,
    atItemSeq: number
  ): Promise<NotesWriteFileResult> {
    assertSafeThreadId(threadId)
    return this.withThreadQueue(threadId, async () => {
      const state = await this.state(threadId)
      const record = state.files[path]
      const actualRevision = record?.revision ?? 0
      if (actualRevision !== expectedRevision) {
        return { status: 'conflict', path, expectedRevision, actualRevision }
      }
      const nextSize = byteSize(content)
      this.assertQuota(state, path, nextSize)
      const next = this.commitRecord(state, record, content, nowIso, atItemSeq)
      state.files[path] = next
      this.evictVersions(state)
      await this.persist(threadId, state)
      return { status: 'ok', path, revision: next.revision }
    })
  }

  async appendNote(
    threadId: string,
    path: string,
    operationId: string,
    text: string,
    nowIso: string,
    atItemSeq: number
  ): Promise<NoteAppendOutcome> {
    assertSafeThreadId(threadId)
    return this.withThreadQueue(threadId, async () => {
      const state = await this.state(threadId)
      const replayed = state.appends[operationId]
      if (replayed) return { status: 'replayed', revision: replayed.revision }
      const record = state.files[path]
      const content = `${record?.content ?? ''}${text}`
      const nextSize = byteSize(content)
      this.assertQuota(state, path, nextSize)
      const next = this.commitRecord(state, record, content, nowIso, atItemSeq)
      state.files[path] = next
      state.appends[operationId] = { path, revision: next.revision, atItemSeq }
      this.evictVersions(state)
      await this.persist(threadId, state)
      return { status: 'applied', revision: next.revision }
    })
  }

  async copyThreadData(
    sourceThreadId: string,
    targetThreadId: string,
    cutoffItemSeq?: number
  ): Promise<void> {
    assertSafeThreadId(sourceThreadId)
    assertSafeThreadId(targetThreadId)
    const source = await this.readStateFile(sourceThreadId)
    if (!source) return
    await this.withThreadQueue(targetThreadId, async () => {
      const target = cutoffItemSeq === undefined
        ? structuredClone(source)
        : deriveForkState(source, cutoffItemSeq)
      this.states.set(targetThreadId, target)
      await this.persist(targetThreadId, target)
    })
  }

  async deleteThreadData(threadId: string): Promise<void> {
    assertSafeThreadId(threadId)
    this.states.delete(threadId)
    this.queues.delete(threadId)
    await rm(this.statePath(threadId), { force: true })
  }

  /**
   * Commit one mutation: backfill a legacy snapshot when the file predates
   * version tracking, then append the immutable snapshot and bump the
   * revision. Quota is checked by the caller before this runs.
   */
  private commitRecord(
    state: NoteState,
    record: NoteFileRecord | undefined,
    content: string,
    nowIso: string,
    atItemSeq: number
  ): NoteFileRecord {
    const versions = record && Array.isArray(record.versions) ? [...record.versions] : []
    if (record && !Array.isArray(record.versions)) {
      // Forward-compatible read: content written before version tracking
      // cannot be positioned retroactively, so it is stamped as pre-fork
      // content (position 0) and always copied by cutoff forks — matching
      // the pre-upgrade copy-everything behavior for legacy files.
      versions.push({
        seq: state.nextCommitSeq++,
        atItemSeq: 0,
        at: record.updatedAt,
        content: record.content
      })
    }
    versions.push({ seq: state.nextCommitSeq++, atItemSeq, at: nowIso, content })
    return {
      revision: (record?.revision ?? 0) + 1,
      byteSize: byteSize(content),
      updatedAt: nowIso,
      content,
      versions
    }
  }

  private maxVersionsPerFile(): number {
    return Math.max(
      1,
      Math.floor(this.limits.maxVersionsPerFile ?? CONTEXT_WINDOW_NOTE_VERSION_RETENTION.maxVersionsPerFile)
    )
  }

  private evictVersions(state: NoteState): void {
    const maxPerFile = this.maxVersionsPerFile()
    for (const record of Object.values(state.files)) {
      if (record.versions && record.versions.length > maxPerFile) {
        record.versions = record.versions.slice(record.versions.length - maxPerFile)
      }
    }
    const maxBytes = Math.max(
      0,
      Math.floor(this.limits.maxVersionBytesPerThread ?? CONTEXT_WINDOW_NOTE_VERSION_RETENTION.maxVersionBytesPerThread)
    )
    let total = totalVersionBytes(state)
    while (total > maxBytes) {
      const evictable = oldestEvictableVersion(state)
      if (!evictable) break
      const [path, index] = evictable
      const versions = state.files[path]!.versions!
      total -= byteSize(versions[index]!.content)
      versions.splice(index, 1)
    }
  }

  private assertQuota(state: NoteState, path: string, nextSize: number): void {
    if (nextSize > this.limits.maxFileBytes) {
      throw new QuotaExceededError(
        `note file ${JSON.stringify(path)} exceeds ${this.limits.maxFileBytes} bytes`
      )
    }
    const fileNames = Object.keys(state.files)
    const isNewFile = !(path in state.files)
    if (isNewFile && fileNames.length >= this.limits.maxFilesPerThread) {
      throw new QuotaExceededError(
        `thread exceeds ${this.limits.maxFilesPerThread} note files`
      )
    }
    const currentTotal = fileNames.reduce((total, name) => total + state.files[name]!.byteSize, 0)
    const currentSize = state.files[path]?.byteSize ?? 0
    if (currentTotal - currentSize + nextSize > this.limits.maxTotalBytes) {
      throw new QuotaExceededError(
        `thread note total exceeds ${this.limits.maxTotalBytes} bytes`
      )
    }
  }

  private async state(threadId: string): Promise<NoteState> {
    const cached = this.states.get(threadId)
    if (cached) return cached
    const loaded = (await this.readStateFile(threadId)) ?? emptyState()
    this.states.set(threadId, loaded)
    return loaded
  }

  private async readStateFile(threadId: string): Promise<NoteState | null> {
    let raw: string
    try {
      raw = await readFile(this.statePath(threadId), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    try {
      return parseState(raw)
    } catch {
      // A torn or hand-edited state file must not crash reads; the next
      // mutation starts from an empty state instead of corrupt data.
      return emptyState()
    }
  }

  private async persist(threadId: string, state: NoteState): Promise<void> {
    const path = this.statePath(threadId)
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`
    await rm(tmp, { force: true })
    await writeFileSyncFirst(tmp, JSON.stringify(state))
    await rename(tmp, path)
  }

  private statePath(threadId: string): string {
    return join(this.dataDir, threadId, 'context-notes.json')
  }

  private withThreadQueue<T>(threadId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(threadId) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(operation)
    this.queues.set(threadId, next)
    return next
  }
}

/**
 * Derive the child thread state at a fork: copy only note versions committed
 * at or before `cutoffItemSeq` and replay them (each snapshot is full
 * content, so the child's current content is the newest included snapshot).
 * Versionless legacy files predate version tracking and are treated as
 * pre-fork content; files with no included version are dropped entirely.
 */
function deriveForkState(source: NoteState, cutoffItemSeq: number): NoteState {
  const target = emptyState()
  let maxSeq = 0
  for (const [path, record] of Object.entries(source.files)) {
    if (!Array.isArray(record.versions)) {
      target.files[path] = structuredClone(record)
      continue
    }
    const versions = record.versions.filter((version) => version.atItemSeq <= cutoffItemSeq)
    if (versions.length === 0) continue
    const newest = versions[versions.length - 1]!
    maxSeq = Math.max(maxSeq, newest.seq)
    target.files[path] = {
      revision: versions.length,
      byteSize: byteSize(newest.content),
      updatedAt: newest.at,
      content: newest.content,
      versions: structuredClone(versions)
    }
  }
  for (const [operationId, entry] of Object.entries(source.appends)) {
    if ((entry.atItemSeq ?? 0) <= cutoffItemSeq) {
      target.appends[operationId] = structuredClone(entry)
    }
  }
  target.nextCommitSeq = maxSeq + 1
  return target
}

function totalVersionBytes(state: NoteState): number {
  let total = 0
  for (const record of Object.values(state.files)) {
    for (const version of record.versions ?? []) total += byteSize(version.content)
  }
  return total
}

/** Oldest snapshot (by commit seq) across files, keeping >= 1 per file. */
function oldestEvictableVersion(state: NoteState): [string, number] | null {
  let best: [string, number] | null = null
  let bestSeq = Number.MAX_SAFE_INTEGER
  for (const [path, record] of Object.entries(state.files)) {
    const versions = record.versions
    if (!versions || versions.length <= 1) continue
    if (versions[0]!.seq < bestSeq) {
      bestSeq = versions[0]!.seq
      best = [path, 0]
    }
  }
  return best
}

async function writeFileSyncFirst(path: string, contents: string): Promise<void> {
  const handle = await open(path, 'w', 0o600)
  try {
    await handle.writeFile(contents, { encoding: 'utf8' })
    await handle.sync()
  } finally {
    await handle.close()
  }
}

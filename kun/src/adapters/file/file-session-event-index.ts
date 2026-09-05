import { AsyncLocalStorage } from 'node:async_hooks'
import { appendFile, mkdir, open, readFile, rm, stat, truncate, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { atomicWriteFile } from './atomic-write.js'

export const EVENT_INDEX_RECORD_BYTES = 16
export const EVENT_INDEX_SEQ_STEP = 256
export const EVENT_INDEX_BYTE_STEP = 1024 * 1024

/** Bound for the single-line read used to cross-check an indexed seek target. */
const DEFAULT_MAX_LINE_BYTES = 4 * 1024 * 1024

const EventIndexStateSchema = z.object({
  version: z.literal(2),
  generation: z.number().int().nonnegative(),
  dev: z.number().int().nonnegative(),
  ino: z.number().int().nonnegative(),
  indexedBytes: z.number().int().nonnegative(),
  entryCount: z.number().int().nonnegative(),
  lastIndexedSeq: z.number().int().nonnegative(),
  lastIndexedOffset: z.number().int().nonnegative()
}).strict()

export type EventIndexState = z.infer<typeof EventIndexStateSchema>

type IndexEntry = { seq: number; offset: number }

export type EventIndexStats = {
  seeks: number
  fallbacks: number
  appendedEntries: number
  lastStartOffset: number
  repairs: number
}

type MutationScope = Map<string, { active: boolean }>

export class FileSessionEventIndex {
  private readonly stateCache = new Map<string, EventIndexState>()
  private readonly mutationTail = new Map<string, Promise<void>>()
  private readonly mutationScopes = new AsyncLocalStorage<MutationScope>()
  private readonly onFallback?: (threadId: string) => void
  private seeks = 0
  private fallbacks = 0
  private appendedEntries = 0
  private lastStartOffset = 0
  private repairs = 0

  constructor(options: { onFallback?: (threadId: string) => void } = {}) {
    this.onFallback = options.onFallback
  }

  /**
   * Serialize index mutations per canonical source path so a background
   * rebuild publish and a live append can never interleave the bin/state
   * pair. Calls for the same source are reentrant (a nested mutation from
   * inside an outer mutation bypasses the queue) mirroring the JSONL read
   * scope, so existing single-call `recordAppend` users stay correct.
   */
  async withIndexMutation<T>(sourcePath: string, operation: () => Promise<T>): Promise<T> {
    const key = resolve(sourcePath)
    const inherited = this.mutationScopes.getStore()
    if (inherited?.get(key)?.active) return operation()
    const prior = this.mutationTail.get(key) ?? Promise.resolve()
    const token = { active: true }
    const scope = new Map(inherited)
    scope.set(key, token)
    const run = prior.then(() => this.mutationScopes.run(scope, operation))
    const tail = run.then(() => undefined, () => undefined)
    this.mutationTail.set(key, tail)
    try {
      return await run
    } finally {
      if (this.mutationTail.get(key) === tail) this.mutationTail.delete(key)
    }
  }

  async recordAppend(input: {
    threadId: string
    sourcePath: string
    seq: number
    recordOffset: number
    sourceSize: number
    dev: number
    ino: number
  }): Promise<void> {
    await this.withIndexMutation(input.sourcePath, () => this.recordAppendUnlocked(input))
  }

  private async recordAppendUnlocked(input: {
    threadId: string
    sourcePath: string
    seq: number
    recordOffset: number
    sourceSize: number
    dev: number
    ino: number
  }): Promise<void> {
    let state = this.stateCache.get(input.threadId)
    if (!state) state = await this.readState(input.threadId, input.sourcePath)
    let validState = state && state.dev === input.dev && state.ino === input.ino &&
      state.indexedBytes <= input.recordOffset && state.lastIndexedOffset <= input.recordOffset &&
      state.lastIndexedSeq <= input.seq ? state : undefined
    const due = !validState || validState.entryCount === 0 ||
      input.seq - validState.lastIndexedSeq >= EVENT_INDEX_SEQ_STEP ||
      input.recordOffset - validState.lastIndexedOffset >= EVENT_INDEX_BYTE_STEP
    if (!due) return

    const indexPath = eventIndexPath(input.sourcePath)
    const entry = encodeEventIndexEntry(input.seq, input.recordOffset)
    await mkdir(dirname(indexPath), { recursive: true, mode: 0o700 })

    // Align the binary file to the committed length before appending. A crash
    // can leave a full or partial tail past `entryCount * EVENT_INDEX_RECORD_BYTES`
    // while the state file still points at the old count. Truncate that residual
    // away; if the binary is missing or shorter than committed, the state is no
    // longer trustworthy and we rebuild from scratch.
    if (validState) {
      const expectedBytes = validState.entryCount * EVENT_INDEX_RECORD_BYTES
      const info = await stat(indexPath).catch(() => null)
      if (info && info.size > expectedBytes) {
        await truncate(indexPath, expectedBytes)
      } else if (!info || info.size < expectedBytes) {
        validState = undefined
      }
    }

    if (validState) await appendFile(indexPath, entry, { mode: 0o600 })
    else await writeFile(indexPath, entry, { mode: 0o600 })

    const next: EventIndexState = {
      version: 2,
      generation: validState ? validState.generation : (state?.generation ?? 0) + 1,
      dev: input.dev,
      ino: input.ino,
      indexedBytes: input.sourceSize,
      entryCount: validState ? validState.entryCount + 1 : 1,
      lastIndexedSeq: input.seq,
      lastIndexedOffset: input.recordOffset
    }
    await atomicWriteFile(eventIndexStatePath(input.sourcePath), JSON.stringify(next))
    this.stateCache.set(input.threadId, next)
    this.appendedEntries += 1
  }

  async startOffset(
    threadId: string,
    sourcePath: string,
    sinceSeq: number,
    maxLineBytes = DEFAULT_MAX_LINE_BYTES
  ): Promise<number> {
    if (sinceSeq <= 0) return 0
    return this.withIndexMutation(sourcePath, () =>
      this.startOffsetLocked(threadId, sourcePath, sinceSeq, maxLineBytes)
    )
  }

  private async startOffsetLocked(
    threadId: string,
    sourcePath: string,
    sinceSeq: number,
    maxLineBytes: number
  ): Promise<number> {
    try {
      const [source, state, bytes] = await Promise.all([
        stat(sourcePath),
        this.readState(threadId, sourcePath),
        readFile(eventIndexPath(sourcePath))
      ])
      if (!state || state.dev !== source.dev || state.ino !== source.ino ||
        state.indexedBytes > source.size ||
        bytes.length !== state.entryCount * EVENT_INDEX_RECORD_BYTES) {
        return this.failRebuild(threadId, sourcePath)
      }
      // A fully-scanned zero-entry index is a valid performance degradation,
      // not corruption: replay from the top and keep the sidecars so the next
      // append can seed the sparse index without an extra rebuild.
      if (state.entryCount === 0) {
        if (state.lastIndexedSeq !== 0 || state.lastIndexedOffset !== 0) {
          return this.failRebuild(threadId, sourcePath)
        }
        this.seeks += 1
        this.lastStartOffset = 0
        return 0
      }
      if (!validEntries(bytes, state.entryCount)) {
        return this.failRebuild(threadId, sourcePath)
      }
      if (!tailMatchesState(bytes, state)) {
        return this.failRebuild(threadId, sourcePath)
      }
      const candidate = seekCandidate(bytes, state.entryCount, sinceSeq, source.size)
      if (candidate === null) {
        return this.failRebuild(threadId, sourcePath)
      }
      // No indexed entry at or below `sinceSeq`: replay from the top is safe.
      if (candidate.offset === 0) {
        this.seeks += 1
        this.lastStartOffset = 0
        return 0
      }
      if (!(await this.lineMatches(sourcePath, candidate, source.size, maxLineBytes))) {
        return this.failRebuild(threadId, sourcePath)
      }
      this.seeks += 1
      this.lastStartOffset = candidate.offset
      return candidate.offset
    } catch {
      this.fallbacks += 1
      this.onFallback?.(threadId)
      return 0
    }
  }

  async invalidate(threadId: string, sourcePath: string): Promise<void> {
    await this.withIndexMutation(sourcePath, () => this.invalidateUnlocked(threadId, sourcePath))
  }

  private async invalidateUnlocked(threadId: string, sourcePath: string): Promise<void> {
    this.stateCache.delete(threadId)
    const paths = eventIndexPaths(sourcePath)
    await Promise.all([
      rm(paths.bin, { force: true }),
      rm(paths.state, { force: true }),
      rm(paths.rebuildBin, { force: true }),
      rm(paths.rebuildState, { force: true })
    ])
  }

  clearMemory(threadId?: string): void {
    if (threadId) this.stateCache.delete(threadId)
    else this.stateCache.clear()
  }

  stats(): EventIndexStats {
    return {
      seeks: this.seeks,
      fallbacks: this.fallbacks,
      appendedEntries: this.appendedEntries,
      lastStartOffset: this.lastStartOffset,
      repairs: this.repairs
    }
  }

  private async failRebuild(threadId: string, sourcePath: string): Promise<number> {
    this.fallbacks += 1
    this.repairs += 1
    this.onFallback?.(threadId)
    await this.invalidate(threadId, sourcePath).catch(() => undefined)
    return 0
  }

  private async lineMatches(
    sourcePath: string,
    candidate: IndexEntry,
    sourceSize: number,
    maxLineBytes: number
  ): Promise<boolean> {
    if (candidate.offset < 0 || candidate.offset >= sourceSize) return false
    if (candidate.offset > 0) {
      const previous = await readBytesAt(sourcePath, candidate.offset - 1, 1)
      if (previous.length !== 1 || previous[0] !== 0x0a) return false
    }
    const length = Math.min(Math.max(1, Math.floor(maxLineBytes)) + 1, sourceSize - candidate.offset)
    const chunk = await readBytesAt(sourcePath, candidate.offset, length)
    const newline = chunk.indexOf(0x0a)
    if (newline < 0) return false
    let seq: unknown
    try {
      const parsed = JSON.parse(chunk.subarray(0, newline).toString('utf8')) as unknown
      seq = (parsed as { seq?: unknown }).seq
    } catch {
      return false
    }
    return typeof seq === 'number' && Number.isSafeInteger(seq) && seq === candidate.seq
  }

  private async readState(threadId: string, sourcePath: string): Promise<EventIndexState | undefined> {
    const cached = this.stateCache.get(threadId)
    if (cached) return cached
    const state = await readEventIndexState(sourcePath)
    if (state) this.stateCache.set(threadId, state)
    return state
  }
}

function eventIndexPath(sourcePath: string): string {
  return join(dirname(sourcePath), 'events-index.bin')
}

function eventIndexStatePath(sourcePath: string): string {
  return join(dirname(sourcePath), 'events-index.state.json')
}

export function eventIndexPaths(sourcePath: string): {
  bin: string
  state: string
  rebuildBin: string
  rebuildState: string
  diagnostic: string
} {
  return {
    bin: eventIndexPath(sourcePath),
    state: eventIndexStatePath(sourcePath),
    rebuildBin: join(dirname(sourcePath), 'events-index.rebuild.bin'),
    rebuildState: join(dirname(sourcePath), 'events-index.rebuild.state.json'),
    diagnostic: join(dirname(sourcePath), 'events-index.rebuild-diagnostic.json')
  }
}

export async function readEventIndexState(sourcePath: string): Promise<EventIndexState | undefined> {
  try {
    const parsed = EventIndexStateSchema.safeParse(
      JSON.parse(await readFile(eventIndexStatePath(sourcePath), 'utf8'))
    )
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

/**
 * Cheap validity gate used by the background rebuild sweep to decide whether a
 * thread already has a usable index and can be skipped. Foreground seeks use a
 * stricter per-lookup validation (entry monotonicity, tail and line cross-check)
 * and self-heal via `failRebuild`, so a false-positive skip here is still caught
 * and repaired on the next foreground read.
 */
export function eventIndexIsValid(
  state: EventIndexState | undefined,
  source: { dev: number; ino: number; size: number },
  binBytes: number
): state is EventIndexState {
  if (!state || state.dev !== source.dev || state.ino !== source.ino) return false
  if (state.indexedBytes > source.size) return false
  // A fully-scanned source with no indexable events publishes a zero-length
  // bin. This is a valid performance degradation (replay from byte zero), not
  // corruption, so the rebuild sweep must not keep retrying it.
  if (state.entryCount === 0) {
    return binBytes === 0 &&
      state.indexedBytes === source.size &&
      state.lastIndexedSeq === 0 &&
      state.lastIndexedOffset === 0
  }
  return binBytes === state.entryCount * EVENT_INDEX_RECORD_BYTES
}

/**
 * Snapshot of the source file and the formal index generation captured when a
 * rebuild scan finished. Publish compares this against a fresh stat/state read
 * inside the index mutation critical section; any drift means a concurrent
 * append or external rewrite advanced the source and the stale rebuild must be
 * discarded instead of overwriting newer index entries.
 */
export type EventIndexPublishSnapshot = {
  dev: number
  ino: number
  size: number
  mtimeMs: number
  generation: number | undefined
}

export function eventIndexPublishConflict(
  snapshot: EventIndexPublishSnapshot,
  source: { dev: number; ino: number; size: number; mtimeMs: number },
  generation: number | undefined
): boolean {
  return snapshot.dev !== source.dev ||
    snapshot.ino !== source.ino ||
    snapshot.size !== source.size ||
    snapshot.mtimeMs !== source.mtimeMs ||
    snapshot.generation !== generation
}

export function encodeEventIndexEntry(seq: number, offset: number): Buffer {
  const entry = Buffer.allocUnsafe(EVENT_INDEX_RECORD_BYTES)
  entry.writeBigUInt64LE(BigInt(seq), 0)
  entry.writeBigUInt64LE(BigInt(offset), 8)
  return entry
}

function decodeEntry(bytes: Buffer, index: number): IndexEntry | null {
  const seq = Number(bytes.readBigUInt64LE(index * EVENT_INDEX_RECORD_BYTES))
  const offset = Number(bytes.readBigUInt64LE(index * EVENT_INDEX_RECORD_BYTES + 8))
  if (!Number.isSafeInteger(seq) || !Number.isSafeInteger(offset)) return null
  return { seq, offset }
}

function validEntries(bytes: Buffer, entryCount: number): boolean {
  let previousSeq = -1
  let previousOffset = -1
  for (let index = 0; index < entryCount; index += 1) {
    const entry = decodeEntry(bytes, index)
    if (!entry || entry.seq < previousSeq || entry.offset < previousOffset) return false
    previousSeq = entry.seq
    previousOffset = entry.offset
  }
  return true
}

function tailMatchesState(bytes: Buffer, state: EventIndexState): boolean {
  const tail = decodeEntry(bytes, state.entryCount - 1)
  return tail !== null && tail.seq === state.lastIndexedSeq && tail.offset === state.lastIndexedOffset
}

function seekCandidate(
  bytes: Buffer,
  entryCount: number,
  sinceSeq: number,
  sourceSize: number
): IndexEntry | null {
  let low = 0
  let high = entryCount - 1
  let match = -1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const entry = decodeEntry(bytes, middle)
    if (!entry) return null
    if (entry.seq <= sinceSeq) {
      match = middle
      low = middle + 1
    } else high = middle - 1
  }
  if (match < 0) return { seq: 0, offset: 0 }
  const entry = decodeEntry(bytes, match)
  if (!entry) return null
  return entry.offset >= 0 && entry.offset < sourceSize ? entry : null
}

async function readBytesAt(path: string, start: number, length: number): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.allocUnsafe(Math.max(0, length))
    let position = 0
    while (position < length) {
      const { bytesRead } = await handle.read(buffer, position, length - position, start + position)
      if (bytesRead === 0) break
      position += bytesRead
    }
    return buffer.subarray(0, position)
  } finally {
    await handle.close()
  }
}

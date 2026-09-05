import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { appendFile, mkdir, open, readFile, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isSafeThreadId } from '../../contracts/thread-id.js'
import {
  EVENT_INDEX_BYTE_STEP,
  EVENT_INDEX_RECORD_BYTES,
  EVENT_INDEX_SEQ_STEP,
  encodeEventIndexEntry,
  eventIndexIsValid,
  eventIndexPaths,
  eventIndexPublishConflict,
  readEventIndexState,
  type EventIndexPublishSnapshot,
  type FileSessionEventIndex
} from './file-session-event-index.js'
import { atomicWriteFile, renameFileWithRetry } from './atomic-write.js'
import {
  EVENT_INDEX_REBUILD_FAILURE_LIMIT,
  EVENT_INDEX_REBUILD_TORN_TAIL_STABLE_MS,
  eventIndexSourceFingerprint,
  writeEventIndexRebuildDiagnostic
} from './file-session-event-index-diagnostic.js'
import {
  binBytes,
  classifyLine,
  freshSweep,
  nextAfter,
  parseSweep,
  readRebuildState,
  type GrindResult,
  type ProcessOutcome,
  type RebuildState,
  type SweepState
} from './file-session-event-index-rebuild-support.js'
import { listThreadDirs } from './file-session-usage-read.js'
import type { JsonlFileAccessCoordinator } from './jsonl-file-access.js'

/**
 * Byte/event budget per slice. The byte budget bounds disk I/O while the
 * event budget bounds parse cost; the shared maintenance lane also enforces
 * a 50ms wall-clock ceiling that matches `MAINTENANCE_SLICE_MAX_MS`.
 */
export const EVENT_INDEX_REBUILD_SLICE_MAX_BYTES = 2 * 1024 * 1024
export const EVENT_INDEX_REBUILD_SLICE_MAX_EVENTS = 4096
const DEFAULT_REBUILD_SLICE_MAX_MS = 50
const SCAN_CHUNK_BYTES = 64 * 1024

export type EventIndexRebuildStats = {
  slices: number
  published: number
  skippedValid: number
  abandoned: number
  eventsScanned: number
  bytesScanned: number
  corruptRecords: number
  blocked: number
  lastError?: string
}

/**
 * Low-priority, resumable rebuild of `events-index.bin` for threads that
 * predate the sparse index or whose index was invalidated. It is driven one
 * bounded slice at a time from the shared maintenance lane; foreground reads
 * never wait for it and keep falling back to a byte-zero full scan.
 */
export class FileSessionEventIndexRebuild {
  private readonly priority = new Set<string>()
  private wake: (() => void) | undefined
  private sweepPromise: Promise<SweepState> | undefined
  private slices = 0
  private published = 0
  private skippedValid = 0
  private abandoned = 0
  private eventsScanned = 0
  private bytesScanned = 0
  private corruptRecords = 0
  private blocked = 0
  private lastError: string | undefined

  constructor(private readonly options: {
    threadsDir: string
    eventsPathFor: (threadId: string) => string
    fileAccess: JsonlFileAccessCoordinator
    index: FileSessionEventIndex
    maxRecordBytes: number
    limits?: { maxBytes?: number; maxEvents?: number; maxMs?: number }
    now?: () => number
  }) {}

  /** Hint that a thread should be rebuilt first; fires the idle wake when set. */
  request(threadId: string): void {
    if (!isSafeThreadId(threadId)) return
    this.priority.add(threadId)
    this.wake?.()
  }

  setWake(wake: () => void): void {
    this.wake = wake
  }

  /**
   * Process at most one bounded unit of work. Returns `false` while any
   * thread remains partially rebuilt (retry soon) and `true` once the current
   * sweep generation has visited every thread directory.
   */
  async runSlice(): Promise<boolean> {
    this.slices += 1
    const startedAt = this.now()
    const sweep = await this.readSweep()
    const threads = await listThreadDirs(this.options.threadsDir)
    if (sweep.blocked) {
      for (const id of Object.keys(sweep.blocked)) {
        if (!threads.includes(id)) delete sweep.blocked[id]
      }
    }

    for (;;) {
      if (this.now() - startedAt >= this.maxMs()) {
        await this.saveSweep(sweep)
        return false
      }

      let target: string | undefined
      let source: 'priority' | 'sequential'
      if (sweep.inProgress) {
        target = sweep.inProgress.threadId
        source = sweep.inProgressSource ?? 'priority'
      } else {
        target = this.takePriority(threads)
        if (target) {
          source = 'priority'
        } else {
          target = nextAfter(threads, sweep.cursor)
          source = 'sequential'
        }
      }

      if (!target) {
        sweep.generation += 1
        sweep.cursor = undefined
        sweep.inProgress = undefined
        sweep.inProgressSource = undefined
        await this.saveSweep(sweep)
        return true
      }

      // Skip a quarantined source with an unchanged fingerprint.
      const blocked = sweep.blocked?.[target]
      if (blocked && source === 'sequential') {
        const info = await stat(this.options.eventsPathFor(target)).catch(() => null)
        const fingerprint = info ? eventIndexSourceFingerprint(info) : null
        if (fingerprint === null || fingerprint === blocked.sourceFingerprint) {
          if (!sweep.cursor || target > sweep.cursor) sweep.cursor = target
          await this.saveSweep(sweep)
          continue
        }
        if (sweep.blocked) delete sweep.blocked[target]
      }

      let outcome: ProcessOutcome
      try {
        outcome = await this.processThread(target, startedAt)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const info = await stat(this.options.eventsPathFor(target)).catch(() => null)
        const fingerprint = info ? eventIndexSourceFingerprint(info) : `missing:${target}`
        const prev = sweep.inProgress?.threadId === target ? sweep.inProgress : undefined
        const sameSource = prev?.sourceFingerprint === fingerprint
        const failureCount = (sameSource ? prev.failureCount : 0) + 1
        if (failureCount < EVENT_INDEX_REBUILD_FAILURE_LIMIT) {
          sweep.inProgress = { threadId: target, failureCount, blockedReason: message, sourceFingerprint: fingerprint }
          sweep.inProgressSource = source
          await this.saveSweep(sweep)
          return false
        }
        // Limit reached: quarantine this unchanged source and keep sweeping.
        await this.writeBlockedDiagnostic(target, fingerprint, failureCount)
        sweep.blocked = sweep.blocked ?? {}
        sweep.blocked[target] = { sourceFingerprint: fingerprint, blockedReason: message, blockedAt: new Date().toISOString() }
        sweep.inProgress = undefined
        sweep.inProgressSource = undefined
        if (source === 'sequential' && (!sweep.cursor || target > sweep.cursor)) sweep.cursor = target
        this.blocked += 1
        await this.saveSweep(sweep)
        continue
      }

      sweep.inProgress = undefined
      sweep.inProgressSource = undefined

      if (outcome.status === 'pending') {
        sweep.inProgress = { threadId: target, failureCount: 0, sourceFingerprint: outcome.fingerprint }
        sweep.inProgressSource = source
        await this.saveSweep(sweep)
        return false
      }

      if (sweep.blocked?.[target]) {
        if (sweep.blocked) delete sweep.blocked[target]
      }
      if (source === 'sequential' && (!sweep.cursor || target > sweep.cursor)) {
        sweep.cursor = target
      }
      await this.saveSweep(sweep)
    }
  }

  stats(): EventIndexRebuildStats {
    return {
      slices: this.slices,
      published: this.published,
      skippedValid: this.skippedValid,
      abandoned: this.abandoned,
      eventsScanned: this.eventsScanned,
      bytesScanned: this.bytesScanned,
      corruptRecords: this.corruptRecords,
      blocked: this.blocked,
      ...(this.lastError ? { lastError: this.lastError } : {})
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  private maxMs(): number {
    return Math.max(1, Math.floor(this.options.limits?.maxMs ?? DEFAULT_REBUILD_SLICE_MAX_MS))
  }

  private maxBytes(): number {
    return Math.max(1, Math.floor(
      this.options.limits?.maxBytes ?? EVENT_INDEX_REBUILD_SLICE_MAX_BYTES
    ))
  }

  private maxEvents(): number {
    return Math.max(1, Math.floor(
      this.options.limits?.maxEvents ?? EVENT_INDEX_REBUILD_SLICE_MAX_EVENTS
    ))
  }

  private budgetExceeded(startedAt: number, events: number, bytes: number): boolean {
    return bytes >= this.maxBytes() ||
      events >= this.maxEvents() ||
      (this.now() - startedAt >= this.maxMs() && events > 0)
  }

  private takePriority(threads: string[]): string | undefined {
    if (this.priority.size === 0) return undefined
    for (const id of [...this.priority]) {
      if (!threads.includes(id)) {
        this.priority.delete(id)
        continue
      }
      this.priority.delete(id)
      return id
    }
    return undefined
  }

  private async processThread(
    threadId: string,
    startedAt: number
  ): Promise<ProcessOutcome> {
    const eventsPath = this.options.eventsPathFor(threadId)
    const release = await this.options.fileAccess.acquireRead(eventsPath)
    try {
      const info = await stat(eventsPath).catch((error) =>
        (error as { code?: string }).code === 'ENOENT' ? null : Promise.reject(error)
      )
      if (!info || info.size === 0) {
        await this.discardStaging(eventsPath)
        if (info) this.abandoned += 1
        return { status: 'done', fingerprint: info ? eventIndexSourceFingerprint(info) : `missing:${threadId}` }
      }

      const existingBinBytes = await binBytes(eventsPath)
      const existingState = await readEventIndexState(eventsPath)
      const existingGeneration = existingState?.generation
      if (eventIndexIsValid(existingState, info, existingBinBytes)) {
        await this.discardStaging(eventsPath)
        this.skippedValid += 1
        return { status: 'skipped', fingerprint: eventIndexSourceFingerprint(info) }
      }

      // Pre-scan snapshot: any append/rewrite during the scan changes size,
      // mtime or generation, so the publish CAS will discard a stale result.
      const snapshot: EventIndexPublishSnapshot = {
        dev: info.dev,
        ino: info.ino,
        size: info.size,
        mtimeMs: info.mtimeMs,
        generation: existingGeneration
      }

      const staging = await this.loadOrResetStaging(eventsPath, info)
      const result = await this.grind(eventsPath, staging, startedAt)

      if (result.tail) {
        const current = await stat(eventsPath).catch(() => null)
        if (!current || current.size !== result.tail.offset + result.tail.length) {
          // Source changed while scanning: reset the stability clock and wait.
          result.staging.tail = { ...result.tail, firstSeenMs: this.now() }
          await this.persistStaging(eventsPath, result.staging)
          return { status: 'pending', fingerprint: eventIndexSourceFingerprint(info) }
        }
        const tailDecision = this.reconcileTail(result.staging, result.tail)
        if (tailDecision === 'pending') {
          await this.persistStaging(eventsPath, result.staging)
          return { status: 'pending', fingerprint: eventIndexSourceFingerprint(info) }
        }
        // Quarantine the stable torn tail from the index projection only.
        result.staging.byteCursor = result.tail.offset + result.tail.length
        result.staging.tail = undefined
      }

      if (!result.streamEnded) {
        await this.persistStaging(eventsPath, result.staging)
        return { status: 'pending', fingerprint: eventIndexSourceFingerprint(info) }
      }

      const outcome = await this.publish(threadId, eventsPath, result.staging, snapshot)
      if (outcome === 'conflict') {
        await this.discardStaging(eventsPath)
        return { status: 'done', fingerprint: eventIndexSourceFingerprint(info) }
      }

      this.corruptRecords += result.staging.invalidRecords + result.staging.oversizedRecords
      await this.finalizeDiagnostic(threadId, eventsPath, result.staging, info, result.tail)
      return { status: 'done', fingerprint: eventIndexSourceFingerprint(info) }
    } finally {
      release()
    }
  }

  private async grind(
    eventsPath: string,
    staging: RebuildState,
    startedAt: number
  ): Promise<GrindResult> {
    const entries: Buffer[] = []
    let remainder = Buffer.alloc(0)
    let nextOffset = staging.byteCursor
    let scannedEvents = 0
    let scannedBytes = 0
    let streamEnded = false

    let skipping = false
    let skipStart = 0
    let skippedBytes = 0
    if (staging.skip) {
      skipping = true
      skipStart = staging.skip.offset
      skippedBytes = staging.skip.bytesSkipped
      nextOffset = skipStart + skippedBytes
    }

    let invalidRecords = staging.invalidRecords
    let oversizedRecords = staging.oversizedRecords
    let firstCorruptOffset = staging.firstCorruptOffset

    const stream = createReadStream(eventsPath, {
      start: nextOffset,
      highWaterMark: SCAN_CHUNK_BYTES
    })
    for await (const chunk of stream) {
      if (skipping) {
        const newline = chunk.indexOf(0x0a)
        if (newline < 0) {
          skippedBytes += chunk.length
          if (this.budgetExceeded(startedAt, scannedEvents, scannedBytes + skippedBytes)) {
            staging.byteCursor = skipStart + skippedBytes
            staging.invalidRecords = invalidRecords
            staging.oversizedRecords = oversizedRecords
            staging.firstCorruptOffset = firstCorruptOffset
            staging.skip = { offset: skipStart, bytesSkipped: skippedBytes }
            await this.appendEntries(eventsPath, entries)
            this.eventsScanned += scannedEvents
            this.bytesScanned += scannedBytes + skippedBytes
            return { staging, streamEnded: false }
          }
          continue
        }
        skippedBytes += newline
        nextOffset = skipStart + skippedBytes + 1
        scannedBytes += skippedBytes + 1
        skipping = false
        staging.skip = undefined
        remainder = chunk.subarray(newline + 1)
        if (this.budgetExceeded(startedAt, scannedEvents, scannedBytes)) {
          staging.byteCursor = nextOffset
          staging.invalidRecords = invalidRecords
          staging.oversizedRecords = oversizedRecords
          staging.firstCorruptOffset = firstCorruptOffset
          await this.appendEntries(eventsPath, entries)
          this.eventsScanned += scannedEvents
          this.bytesScanned += scannedBytes
          return { staging, streamEnded: false }
        }
      } else {
        remainder = remainder.length === 0 ? chunk : Buffer.concat([remainder, chunk])
      }

      for (;;) {
        const newline = remainder.indexOf(0x0a)
        if (newline < 0) break
        const line = remainder.subarray(0, newline)
        const recordOffset = nextOffset
        nextOffset += newline + 1
        remainder = remainder.subarray(newline + 1)
        scannedBytes += newline + 1
        scannedEvents += 1

        const classified = classifyLine(line, this.options.maxRecordBytes)
        if (classified.reason === 'oversized') {
          oversizedRecords += 1
          if (firstCorruptOffset === undefined) firstCorruptOffset = recordOffset
        } else if (classified.seq === null) {
          invalidRecords += 1
          if (firstCorruptOffset === undefined) firstCorruptOffset = recordOffset
        } else if (classified.seq >= staging.lastSeq) {
          const due = staging.entryCount === 0 ||
            classified.seq - staging.lastSeq >= EVENT_INDEX_SEQ_STEP ||
            recordOffset - staging.lastOffset >= EVENT_INDEX_BYTE_STEP
          if (due) {
            entries.push(encodeEventIndexEntry(classified.seq, recordOffset))
            staging.lastSeq = classified.seq
            staging.lastOffset = recordOffset
            staging.entryCount += 1
          }
        }

        if (this.budgetExceeded(startedAt, scannedEvents, scannedBytes)) {
          staging.byteCursor = nextOffset
          staging.invalidRecords = invalidRecords
          staging.oversizedRecords = oversizedRecords
          staging.firstCorruptOffset = firstCorruptOffset
          await this.appendEntries(eventsPath, entries)
          this.eventsScanned += scannedEvents
          this.bytesScanned += scannedBytes
          return { staging, streamEnded: false }
        }
      }

      if (remainder.length > this.options.maxRecordBytes) {
        oversizedRecords += 1
        if (firstCorruptOffset === undefined) firstCorruptOffset = nextOffset
        skipping = true
        skipStart = nextOffset
        skippedBytes = remainder.length
        remainder = Buffer.alloc(0)
      }
    }

    streamEnded = true
    staging.invalidRecords = invalidRecords
    staging.oversizedRecords = oversizedRecords
    staging.firstCorruptOffset = firstCorruptOffset

    let tail: GrindResult['tail']
    if (skipping) {
      // Unterminated oversized record: cursor is already past it (EOF).
      staging.skip = undefined
      staging.byteCursor = skipStart + skippedBytes
    } else if (remainder.length > 0) {
      tail = {
        offset: nextOffset,
        length: remainder.length,
        sampleSha256: createHash('sha256').update(remainder).digest('hex')
      }
      staging.byteCursor = nextOffset
    } else {
      staging.byteCursor = nextOffset
    }

    await this.appendEntries(eventsPath, entries)
    this.eventsScanned += scannedEvents
    this.bytesScanned += scannedBytes
    return { staging, streamEnded, tail }
  }

  private reconcileTail(
    staging: RebuildState,
    tail: { offset: number; length: number; sampleSha256: string }
  ): 'pending' | 'quarantine' {
    const existing = staging.tail
    const now = this.now()
    if (existing && existing.offset === tail.offset && existing.length === tail.length &&
        existing.sampleSha256 === tail.sampleSha256) {
      staging.tail = { ...tail, firstSeenMs: existing.firstSeenMs }
      return now - existing.firstSeenMs >= EVENT_INDEX_REBUILD_TORN_TAIL_STABLE_MS
        ? 'quarantine'
        : 'pending'
    }
    staging.tail = { ...tail, firstSeenMs: now }
    return 'pending'
  }

  private async appendEntries(eventsPath: string, entries: Buffer[]): Promise<void> {
    if (entries.length === 0) return
    const bin = eventIndexPaths(eventsPath).rebuildBin
    await mkdir(dirname(bin), { recursive: true, mode: 0o700 })
    await appendFile(bin, Buffer.concat(entries), { mode: 0o600 })
  }

  private async loadOrResetStaging(
    eventsPath: string,
    info: { dev: number; ino: number; size: number }
  ): Promise<RebuildState> {
    const paths = eventIndexPaths(eventsPath)
    const state = await readRebuildState(paths.rebuildState)
    const stagingBinBytes = await binBytes(eventsPath, paths.rebuildBin)
    const valid = state && state.dev === info.dev && state.ino === info.ino &&
      stagingBinBytes === state.entryCount * EVENT_INDEX_RECORD_BYTES
    if (valid) return state
    await this.discardStaging(eventsPath)
    return {
      version: 2,
      dev: info.dev,
      ino: info.ino,
      byteCursor: 0,
      entryCount: 0,
      lastSeq: 0,
      lastOffset: 0,
      invalidRecords: 0,
      oversizedRecords: 0
    }
  }

  private async persistStaging(eventsPath: string, staging: RebuildState): Promise<void> {
    const paths = eventIndexPaths(eventsPath)
    await mkdir(dirname(paths.rebuildState), { recursive: true, mode: 0o700 })
    await atomicWriteFile(paths.rebuildState, JSON.stringify(staging))
  }

  private async discardStaging(eventsPath: string): Promise<void> {
    const paths = eventIndexPaths(eventsPath)
    await Promise.all([
      rm(paths.rebuildBin, { force: true }),
      rm(paths.rebuildState, { force: true })
    ])
  }

  private async publish(
    threadId: string,
    eventsPath: string,
    staging: RebuildState,
    snapshot: EventIndexPublishSnapshot
  ): Promise<'published' | 'conflict'> {
    const paths = eventIndexPaths(eventsPath)
    await mkdir(dirname(paths.bin), { recursive: true, mode: 0o700 })
    await mkdir(dirname(paths.rebuildBin), { recursive: true, mode: 0o700 })
    // Ensure the rebuild bin exists even for a zero-entry result.
    await (await open(paths.rebuildBin, 'a', 0o600)).close()

    return this.options.index.withIndexMutation(eventsPath, async () => {
      const source = await stat(eventsPath).catch(() => null)
      const current = await readEventIndexState(eventsPath)
      if (!source || eventIndexPublishConflict(snapshot, source, current?.generation)) {
        return 'conflict'
      }
      await renameFileWithRetry(paths.rebuildBin, paths.bin)
      await atomicWriteFile(paths.state, JSON.stringify({
        version: 2,
        generation: (current?.generation ?? 0) + 1,
        dev: staging.dev,
        ino: staging.ino,
        indexedBytes: staging.byteCursor,
        entryCount: staging.entryCount,
        lastIndexedSeq: staging.lastSeq,
        lastIndexedOffset: staging.lastOffset
      }))
      await rm(paths.rebuildState, { force: true }).catch(() => undefined)
      this.options.index.clearMemory(threadId)
      this.published += 1
      return 'published'
    })
  }

  private async finalizeDiagnostic(
    threadId: string,
    eventsPath: string,
    staging: RebuildState,
    info: { dev: number; ino: number; size: number; mtimeMs: number },
    tail: { offset: number; length: number; sampleSha256: string } | undefined
  ): Promise<void> {
    const paths = eventIndexPaths(eventsPath)
    const fingerprint = eventIndexSourceFingerprint(info)
    if (tail) {
      await writeEventIndexRebuildDiagnostic(paths.diagnostic, {
        version: 1,
        recordedAt: new Date().toISOString(),
        threadId,
        sourceFingerprint: fingerprint,
        reason: 'torn_tail',
        byteOffset: tail.offset,
        length: tail.length,
        sampleSha256: tail.sampleSha256
      }).catch(() => undefined)
      return
    }
    const corrupt = staging.invalidRecords + staging.oversizedRecords
    if (corrupt > 0) {
      await writeEventIndexRebuildDiagnostic(paths.diagnostic, {
        version: 1,
        recordedAt: new Date().toISOString(),
        threadId,
        sourceFingerprint: fingerprint,
        reason: staging.oversizedRecords > 0 ? 'oversized_record' : 'invalid_record',
        byteOffset: staging.firstCorruptOffset,
        count: corrupt
      }).catch(() => undefined)
      return
    }
    await rm(paths.diagnostic, { force: true }).catch(() => undefined)
  }

  private async writeBlockedDiagnostic(
    threadId: string,
    fingerprint: string,
    failureCount: number
  ): Promise<void> {
    await writeEventIndexRebuildDiagnostic(
      eventIndexPaths(this.options.eventsPathFor(threadId)).diagnostic,
      {
        version: 1,
        recordedAt: new Date().toISOString(),
        threadId,
        sourceFingerprint: fingerprint,
        reason: 'rebuild_failure',
        failureCount
      }
    ).catch(() => undefined)
  }

  private async readSweep(): Promise<SweepState> {
    if (!this.sweepPromise) {
      this.sweepPromise = readFile(this.sweepPath(), 'utf8')
        .then((text) => parseSweep(text))
        .catch(() => freshSweep())
    }
    return this.sweepPromise
  }

  private saveSweep(sweep: SweepState): Promise<void> {
    const saved = atomicWriteFile(this.sweepPath(), JSON.stringify(sweep)).then(() => undefined)
    this.sweepPromise = saved.then(() => sweep)
    return saved
  }

  private sweepPath(): string {
    return join(this.options.threadsDir, 'event-index-rebuild.sweep.json')
  }
}

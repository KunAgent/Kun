import { createHash } from 'node:crypto'
import { mkdir, open, readFile, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import { sanitizeMemoryDegradedReason } from '../adapters/hybrid/hybrid-memory-degraded-state.js'
import {
  MEMORY_FEEDBACK_SCHEMA_VERSION,
  MemoryFeedbackAggregate,
  MemoryFeedbackCheckpoint,
  MemoryFeedbackDiagnostics,
  MemoryFeedbackEvent,
  MemoryFeedbackProjection,
  type MemoryFeedbackAggregate as MemoryFeedbackAggregateValue,
  type MemoryFeedbackCheckpoint as MemoryFeedbackCheckpointValue,
  type MemoryFeedbackConfig,
  type MemoryFeedbackDiagnostics as MemoryFeedbackDiagnosticsValue,
  type MemoryFeedbackEvent as MemoryFeedbackEventValue
} from '../contracts/memory-feedback.js'
import { withMemoryMutation } from './memory-mutation-queue.js'

export type MemoryFeedbackAppendResult = 'appended' | 'replayed'

type FeedbackState = {
  identityHashes: Map<string, string>
  explicitEvents: Map<string, MemoryFeedbackEventValue>
  aggregates: Map<string, MemoryFeedbackAggregateValue>
  segmentPaths: Map<number, string>
  activeSegment: number
  coveredSegment: number
  checkpointAt?: string
  storageBytes: number
  duplicateCount: number
  malformedCount: number
  degradedReason?: string
}

export class FileMemoryFeedbackStore {
  private state: FeedbackState | undefined
  private lastFailure: string | undefined

  constructor(private readonly options: {
    dataDir: string
    config: MemoryFeedbackConfig | (() => MemoryFeedbackConfig)
    nowIso?: () => string
    appendLine?: (path: string, line: string) => Promise<void>
    writeProjection?: (path: string, contents: string) => Promise<void>
    writeCheckpoint?: (path: string, contents: string) => Promise<void>
    afterCheckpointWrite?: () => Promise<void>
  }) {}

  async ready(): Promise<void> {
    await this.withMutation(async () => {
      try {
        const state = await this.load()
        await this.persistProjection(state)
        await this.removeCoveredSegments(state)
        this.lastFailure = undefined
      } catch (error) {
        this.lastFailure = feedbackFailure('feedback rebuild failed', error)
        throw error
      }
    })
  }

  async append(raw: MemoryFeedbackEventValue): Promise<MemoryFeedbackAppendResult> {
    const event = MemoryFeedbackEvent.parse(raw)
    return this.withMutation(async () => {
      try {
        const state = await this.load()
        if (state.malformedCount > 0) throw new Error('memory feedback ledger must be repaired before appending')
        const payloadHash = eventHash(event)
        const existingHash = state.identityHashes.get(event.id)
        if (existingHash) {
          if (existingHash !== payloadHash) throw new Error(`memory feedback event id conflict: ${event.id}`)
          await this.persistProjection(state)
          this.lastFailure = undefined
          return 'replayed'
        }

        const line = `${JSON.stringify(event)}\n`
        await this.ensureCapacity(state, Buffer.byteLength(line))
        await this.appendEvent(state, line)
        applyEvent(state, event, payloadHash)
        if (await this.activeSegmentBytes(state) >= this.config().maxSegmentBytes) {
          await this.compact(state)
        }
        await this.persistProjection(state)
        this.lastFailure = undefined
        return 'appended'
      } catch (error) {
        this.lastFailure = feedbackFailure('feedback append failed', error)
        throw error
      }
    })
  }

  async aggregate(memoryId: string): Promise<MemoryFeedbackAggregateValue | undefined> {
    return this.withMutation(async () => {
      const aggregate = (await this.load()).aggregates.get(memoryId)
      return aggregate ? MemoryFeedbackAggregate.parse(aggregate) : undefined
    })
  }

  async event(eventId: string): Promise<MemoryFeedbackEventValue | undefined> {
    return this.withMutation(async () => {
      const event = (await this.load()).explicitEvents.get(eventId)
      return event ? MemoryFeedbackEvent.parse(event) : undefined
    })
  }

  async listAggregates(): Promise<MemoryFeedbackAggregateValue[]> {
    return this.withMutation(async () => sortedAggregates((await this.load()).aggregates))
  }

  async diagnostics(): Promise<MemoryFeedbackDiagnosticsValue> {
    return this.withMutation(async () => {
      try {
        const state = await this.load()
        const reason = this.lastFailure ?? state.degradedReason
        return MemoryFeedbackDiagnostics.parse({
          enabled: this.config().enabled,
          state: reason ? 'degraded' : this.config().enabled ? 'ready' : 'disabled',
          projection: reason ? 'degraded' : 'ready',
          eventCount: state.identityHashes.size,
          aggregateCount: state.aggregates.size,
          duplicateCount: state.duplicateCount,
          malformedCount: state.malformedCount,
          ...(state.checkpointAt ? { lastCheckpointAt: state.checkpointAt } : {}),
          ...(reason ? { degradedReason: reason } : {})
        })
      } catch (error) {
        const reason = this.lastFailure ?? feedbackFailure('feedback rebuild failed', error)
        this.lastFailure = reason
        return MemoryFeedbackDiagnostics.parse({
          enabled: this.config().enabled,
          state: 'degraded',
          projection: 'degraded',
          eventCount: 0,
          aggregateCount: 0,
          duplicateCount: 0,
          malformedCount: 1,
          degradedReason: reason
        })
      }
    })
  }

  private async load(): Promise<FeedbackState> {
    if (this.state) return this.state
    const state = emptyState()
    const checkpoint = await this.readCheckpoint()
    if (checkpoint) applyCheckpoint(state, checkpoint)

    await mkdir(this.rootPath(), { recursive: true, mode: 0o700 })
    const entries = await readdir(this.rootPath())
    const newestSegment = Math.max(0, ...segmentNumbers(entries))
    for (const entry of entries.sort((left, right) => left.localeCompare(right))) {
      const segment = segmentNumber(entry)
      if (segment === undefined) continue
      const path = join(this.rootPath(), entry)
      state.segmentPaths.set(segment, path)
      state.storageBytes += await fileBytes(path)
      if (segment <= state.coveredSegment) continue
      parseSegment(await readFile(path, 'utf8'), state, segment === newestSegment)
      state.activeSegment = Math.max(state.activeSegment, segment)
    }
    state.storageBytes += await fileBytes(this.checkpointPath())
    state.activeSegment = Math.max(state.activeSegment, state.coveredSegment + 1)
    this.state = state
    return state
  }

  private async readCheckpoint(): Promise<MemoryFeedbackCheckpointValue | undefined> {
    try {
      return MemoryFeedbackCheckpoint.parse(JSON.parse(await readFile(this.checkpointPath(), 'utf8')) as unknown)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw new Error('memory feedback checkpoint is invalid', { cause: error })
    }
  }

  private async ensureCapacity(state: FeedbackState, lineBytes: number): Promise<void> {
    if (state.storageBytes + lineBytes <= this.config().maxTotalBytes) return
    await this.compact(state)
    if (state.storageBytes + lineBytes > this.config().maxTotalBytes) {
      throw new Error('memory feedback storage capacity reached')
    }
  }

  private async appendEvent(state: FeedbackState, line: string): Promise<void> {
    const path = this.segmentPath(state.activeSegment)
    await mkdir(this.rootPath(), { recursive: true, mode: 0o700 })
    if (this.options.appendLine) {
      await this.options.appendLine(path, line)
    } else {
      const handle = await open(path, 'a', 0o600)
      try {
        await handle.writeFile(line, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
    }
    state.segmentPaths.set(state.activeSegment, path)
    state.storageBytes += Buffer.byteLength(line)
  }

  private async compact(state: FeedbackState): Promise<void> {
    if (state.identityHashes.size === 0) return
    const coveredSegment = state.activeSegment
    const createdAt = this.now()
    const checkpoint = MemoryFeedbackCheckpoint.parse({
      schemaVersion: MEMORY_FEEDBACK_SCHEMA_VERSION,
      createdAt,
      coveredSegment,
      eventReceipts: [...state.identityHashes.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([id, payloadHash]) => ({ id, payloadHash })),
      explicitEvents: [...state.explicitEvents.values()]
        .sort((left, right) => left.id.localeCompare(right.id)),
      aggregates: sortedAggregates(state.aggregates)
    })
    const contents = `${JSON.stringify(checkpoint, null, 2)}\n`
    const checkpointBytes = Buffer.byteLength(contents)
    if (checkpointBytes > this.config().maxTotalBytes) {
      throw new Error('memory feedback checkpoint exceeds storage capacity')
    }
    if (this.options.writeCheckpoint) {
      await this.options.writeCheckpoint(this.checkpointPath(), contents)
    } else {
      await atomicWriteFile(this.checkpointPath(), contents, {
        durable: true,
        allowDirectWriteFallback: false
      })
    }
    await this.options.afterCheckpointWrite?.()
    state.coveredSegment = coveredSegment
    state.checkpointAt = createdAt
    state.activeSegment = coveredSegment + 1
    await this.removeCoveredSegments(state)
    state.storageBytes = checkpointBytes + await this.uncoveredSegmentBytes(state)
  }

  private async removeCoveredSegments(state: FeedbackState): Promise<void> {
    for (const [segment, path] of [...state.segmentPaths.entries()]) {
      if (segment > state.coveredSegment) continue
      await rm(path, { force: true })
      state.segmentPaths.delete(segment)
    }
  }

  private async uncoveredSegmentBytes(state: FeedbackState): Promise<number> {
    let bytes = 0
    for (const [segment, path] of state.segmentPaths) {
      if (segment > state.coveredSegment) bytes += await fileBytes(path)
    }
    return bytes
  }

  private async activeSegmentBytes(state: FeedbackState): Promise<number> {
    return fileBytes(this.segmentPath(state.activeSegment))
  }

  private async persistProjection(state: FeedbackState): Promise<void> {
    const projection = MemoryFeedbackProjection.parse({
      schemaVersion: MEMORY_FEEDBACK_SCHEMA_VERSION,
      eventCount: state.identityHashes.size,
      aggregates: sortedAggregates(state.aggregates)
    })
    const contents = `${JSON.stringify(projection, null, 2)}\n`
    if (this.options.writeProjection) return this.options.writeProjection(this.projectionPath(), contents)
    await atomicWriteFile(this.projectionPath(), contents, {
      durable: true,
      allowDirectWriteFallback: false
    })
  }

  private rootPath(): string { return join(this.options.dataDir, 'memory-feedback') }
  private checkpointPath(): string { return join(this.rootPath(), 'checkpoint.json') }
  private projectionPath(): string { return join(this.rootPath(), 'aggregates.json') }
  private segmentPath(segment: number): string {
    return join(this.rootPath(), `events-${String(segment).padStart(6, '0')}.jsonl`)
  }
  private config(): MemoryFeedbackConfig {
    return typeof this.options.config === 'function' ? this.options.config() : this.options.config
  }
  private now(): string { return this.options.nowIso?.() ?? new Date().toISOString() }
  private withMutation<T>(operation: () => Promise<T>): Promise<T> {
    return withMemoryMutation(this.rootPath(), async () => {
      this.state = undefined
      return operation()
    })
  }
}

function applyCheckpoint(state: FeedbackState, checkpoint: MemoryFeedbackCheckpointValue): void {
  state.coveredSegment = checkpoint.coveredSegment
  state.checkpointAt = checkpoint.createdAt
  state.activeSegment = checkpoint.coveredSegment + 1
  for (const receipt of checkpoint.eventReceipts) state.identityHashes.set(receipt.id, receipt.payloadHash)
  for (const event of checkpoint.explicitEvents) state.explicitEvents.set(event.id, event)
  for (const aggregate of checkpoint.aggregates) state.aggregates.set(aggregate.memoryId, aggregate)
}

function parseSegment(text: string, state: FeedbackState, tolerateMalformedTail: boolean): void {
  const lines = text.split(/\r?\n/u)
  if (lines.at(-1) === '') lines.pop()
  for (let index = 0; index < lines.length; index += 1) {
    let event: MemoryFeedbackEventValue
    try {
      event = MemoryFeedbackEvent.parse(JSON.parse(lines[index]!) as unknown)
    } catch (error) {
      if (tolerateMalformedTail && index === lines.length - 1) {
        state.malformedCount += 1
        state.degradedReason = 'feedback ledger has a malformed final event'
        break
      }
      throw new Error('memory feedback ledger contains malformed interior data', { cause: error })
    }
    const hash = eventHash(event)
    const existingHash = state.identityHashes.get(event.id)
    if (existingHash) {
      if (existingHash !== hash) throw new Error(`memory feedback ledger contains conflicting event id: ${event.id}`)
      state.duplicateCount += 1
      continue
    }
    applyEvent(state, event, hash)
  }
}

function applyEvent(state: FeedbackState, event: MemoryFeedbackEventValue, payloadHash: string): void {
  state.identityHashes.set(event.id, payloadHash)
  if (event.kind !== 'retrieved') state.explicitEvents.set(event.id, event)
  const current = state.aggregates.get(event.memoryId) ?? MemoryFeedbackAggregate.parse({
    schemaVersion: MEMORY_FEEDBACK_SCHEMA_VERSION,
    memoryId: event.memoryId,
    retrievalCount: 0,
    confirmationCount: 0,
    correctionCount: 0
  })
  state.aggregates.set(event.memoryId, MemoryFeedbackAggregate.parse({
    ...current,
    ...(event.kind === 'retrieved' ? {
      retrievalCount: current.retrievalCount + 1,
      lastRetrievedAt: laterTimestamp(current.lastRetrievedAt, event.occurredAt)
    } : {}),
    ...(event.kind === 'confirmed' ? {
      confirmationCount: current.confirmationCount + 1,
      lastConfirmedAt: laterTimestamp(current.lastConfirmedAt, event.occurredAt)
    } : {}),
    ...(event.kind === 'corrected' ? {
      correctionCount: current.correctionCount + 1,
      lastCorrectedAt: laterTimestamp(current.lastCorrectedAt, event.occurredAt)
    } : {})
  }))
}

function emptyState(): FeedbackState {
  return {
    identityHashes: new Map(), explicitEvents: new Map(), aggregates: new Map(), segmentPaths: new Map(),
    activeSegment: 1, coveredSegment: 0, storageBytes: 0, duplicateCount: 0, malformedCount: 0
  }
}

function sortedAggregates(aggregates: ReadonlyMap<string, MemoryFeedbackAggregateValue>): MemoryFeedbackAggregateValue[] {
  return [...aggregates.values()]
    .sort((left, right) => left.memoryId.localeCompare(right.memoryId))
    .map((aggregate) => MemoryFeedbackAggregate.parse(aggregate))
}

function segmentNumbers(entries: readonly string[]): number[] {
  return entries.flatMap((entry) => {
    const value = segmentNumber(entry)
    return value === undefined ? [] : [value]
  })
}

function segmentNumber(entry: string): number | undefined {
  const match = /^events-([0-9]{6})\.jsonl$/u.exec(entry)
  return match ? Number(match[1]) : undefined
}

async function fileBytes(path: string): Promise<number> {
  try { return (await stat(path)).size } catch { return 0 }
}

function eventHash(event: MemoryFeedbackEventValue): string {
  return createHash('sha256').update(JSON.stringify(event)).digest('hex')
}

function laterTimestamp(current: string | undefined, next: string): string {
  return !current || next > current ? next : current
}

function feedbackFailure(action: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return sanitizeMemoryDegradedReason(`${action}: ${message}`)
}

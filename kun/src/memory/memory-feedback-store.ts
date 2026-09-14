import { mkdir, open, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import { sanitizeMemoryDegradedReason } from '../adapters/hybrid/hybrid-memory-degraded-state.js'
import {
  MEMORY_FEEDBACK_SCHEMA_VERSION,
  MemoryFeedbackAggregate,
  MemoryFeedbackDiagnostics,
  MemoryFeedbackEvent,
  MemoryFeedbackProjection,
  classifyMemoryFeedbackReplay,
  type MemoryFeedbackAggregate as MemoryFeedbackAggregateValue,
  type MemoryFeedbackConfig,
  type MemoryFeedbackDiagnostics as MemoryFeedbackDiagnosticsValue,
  type MemoryFeedbackEvent as MemoryFeedbackEventValue
} from '../contracts/memory-feedback.js'
import { withMemoryMutation } from './memory-mutation-queue.js'

export type MemoryFeedbackAppendResult = 'appended' | 'replayed'

type FeedbackState = {
  events: MemoryFeedbackEventValue[]
  byId: Map<string, MemoryFeedbackEventValue>
  aggregates: Map<string, MemoryFeedbackAggregateValue>
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
    appendLine?: (path: string, line: string) => Promise<void>
    writeProjection?: (path: string, contents: string) => Promise<void>
  }) {}

  async ready(): Promise<void> {
    await this.withMutation(async () => {
      try {
        const state = await this.load()
        await this.persistProjection(state)
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
        if (state.malformedCount > 0) {
          throw new Error('memory feedback ledger must be repaired before appending')
        }
        const existing = state.byId.get(event.id)
        if (existing) {
          if (classifyMemoryFeedbackReplay(existing, event) === 'conflict') {
            throw new Error(`memory feedback event id conflict: ${event.id}`)
          }
          await this.persistProjection(state)
          this.lastFailure = undefined
          return 'replayed'
        }

        await this.appendEvent(event)
        applyEvent(state, event)
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
          eventCount: state.events.length,
          aggregateCount: state.aggregates.size,
          duplicateCount: state.duplicateCount,
          malformedCount: state.malformedCount,
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
    let text: string
    try {
      text = await readFile(this.eventsPath(), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.state = emptyState()
      return this.state
    }
    this.state = parseLedger(text)
    return this.state
  }

  private async appendEvent(event: MemoryFeedbackEventValue): Promise<void> {
    const path = this.eventsPath()
    const line = `${JSON.stringify(event)}\n`
    await mkdir(this.rootPath(), { recursive: true, mode: 0o700 })
    if (this.options.appendLine) return this.options.appendLine(path, line)
    const handle = await open(path, 'a', 0o600)
    try {
      await handle.writeFile(line, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  private async persistProjection(state: FeedbackState): Promise<void> {
    const projection = MemoryFeedbackProjection.parse({
      schemaVersion: MEMORY_FEEDBACK_SCHEMA_VERSION,
      eventCount: state.events.length,
      aggregates: sortedAggregates(state.aggregates)
    })
    const contents = `${JSON.stringify(projection, null, 2)}\n`
    if (this.options.writeProjection) return this.options.writeProjection(this.projectionPath(), contents)
    await atomicWriteFile(this.projectionPath(), contents, {
      durable: true,
      allowDirectWriteFallback: false
    })
  }

  private rootPath(): string {
    return join(this.options.dataDir, 'memory-feedback')
  }

  private eventsPath(): string {
    return join(this.rootPath(), 'events.jsonl')
  }

  private projectionPath(): string {
    return join(this.rootPath(), 'aggregates.json')
  }

  private config(): MemoryFeedbackConfig {
    return typeof this.options.config === 'function' ? this.options.config() : this.options.config
  }

  private withMutation<T>(operation: () => Promise<T>): Promise<T> {
    return withMemoryMutation(this.rootPath(), async () => {
      this.state = undefined
      return operation()
    })
  }
}

function parseLedger(text: string): FeedbackState {
  const state = emptyState()
  const lines = text.split(/\r?\n/u)
  if (lines.at(-1) === '') lines.pop()
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    let event: MemoryFeedbackEventValue
    try {
      event = MemoryFeedbackEvent.parse(JSON.parse(line) as unknown)
    } catch (error) {
      if (index !== lines.length - 1) throw new Error('memory feedback ledger contains malformed interior data', { cause: error })
      state.malformedCount += 1
      state.degradedReason = 'feedback ledger has a malformed final event'
      break
    }
    const existing = state.byId.get(event.id)
    if (existing) {
      if (classifyMemoryFeedbackReplay(existing, event) === 'conflict') {
        throw new Error(`memory feedback ledger contains conflicting event id: ${event.id}`)
      }
      state.duplicateCount += 1
      continue
    }
    applyEvent(state, event)
  }
  return state
}

function applyEvent(state: FeedbackState, event: MemoryFeedbackEventValue): void {
  state.events.push(event)
  state.byId.set(event.id, event)
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
  return { events: [], byId: new Map(), aggregates: new Map(), duplicateCount: 0, malformedCount: 0 }
}

function sortedAggregates(aggregates: ReadonlyMap<string, MemoryFeedbackAggregateValue>): MemoryFeedbackAggregateValue[] {
  return [...aggregates.values()]
    .sort((left, right) => left.memoryId.localeCompare(right.memoryId))
    .map((aggregate) => MemoryFeedbackAggregate.parse(aggregate))
}

function laterTimestamp(current: string | undefined, next: string): string {
  return !current || next > current ? next : current
}

function feedbackFailure(action: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return sanitizeMemoryDegradedReason(`${action}: ${message}`)
}

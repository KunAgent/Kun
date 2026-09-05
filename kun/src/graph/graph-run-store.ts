import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { GraphRuntimeConfig } from '../config/kun-config.js'
import {
  GRAPH_CONTRACT_VERSION,
  GRAPH_EVENT_VERSION,
  GraphCommandResultV1Schema,
  GraphDomainEventV1Schema,
  GraphEventEnvelopeV1Schema,
  GraphRunIdSchema,
  GraphRunV1Schema,
  type GraphCommandResultV1,
  type GraphDomainEventV1,
  type GraphEventEnvelopeV1,
  type GraphPlanV1,
  type GraphRunStatus,
  type GraphRunV1
} from '../contracts/graph.js'
import type { ArtifactStore } from '../artifacts/artifact-store.js'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { applyGraphEvent } from './graph-reducer.js'
import { assertValidGraphPlan } from './graph-validator.js'
import { FileGraphRunIndex } from './graph-run-index.js'
import {
  GraphRunJournal,
  type GraphJournalRecord,
  type GraphSnapshotRecord
} from './graph-run-journal.js'
import {
  checksumJson,
  diagnosticForStoreError,
  isTerminalRunStatus
} from './graph-run-store-support.js'

const GraphOutboxSchema = z.array(GraphEventEnvelopeV1Schema).max(10_000)

export type CreateGraphRunInput = {
  runId: string
  threadId: string
  projectId: string
  sourceTurnId: string
  plan: GraphPlanV1
  commandId: string
  idempotencyKey: string
}

export type AppendGraphEventInput = {
  expectedSeq: number
  graphRevision: number
  eventId?: string
  commandId?: string
  idempotencyKey?: string
  timestamp?: string
  event: GraphDomainEventV1
}

export type AppendGraphEventResult = {
  state: GraphRunV1
  envelope: GraphEventEnvelopeV1
  duplicate: boolean
}

export type GraphRunListFilter = {
  threadId?: string
  projectId?: string
  statuses?: GraphRunStatus[]
}

export type GraphEventReplay = {
  events: GraphEventEnvelopeV1[]
  replayFloorSeq: number
  currentSeq: number
  snapshotSeq: number
  truncated: boolean
}

export type GraphStoreDiagnostic = {
  runId: string
  code: 'corrupt_journal' | 'missing_artifact' | 'invalid_state'
  message: string
  retryable: boolean
}

export interface GraphRunStore {
  create(input: CreateGraphRunInput): Promise<GraphCommandResultV1>
  append(runId: string, input: AppendGraphEventInput): Promise<AppendGraphEventResult>
  get(runId: string): Promise<GraphRunV1 | null>
  list(filter?: GraphRunListFilter): Promise<GraphRunV1[]>
  events(runId: string, sinceSeq?: number): Promise<GraphEventEnvelopeV1[]>
  eventReplay?(runId: string, sinceSeq?: number): Promise<GraphEventReplay>
  snapshot(runId: string): Promise<GraphRunV1>
  remove(runId: string): Promise<void>
  diagnostics?(): Promise<GraphStoreDiagnostic[]>
}

export class GraphRunNotFoundError extends Error {
  constructor(readonly runId: string) {
    super(`GraphRun not found: ${runId}`)
    this.name = 'GraphRunNotFoundError'
  }
}

export class GraphRunConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GraphRunConflictError'
  }
}

export class GraphStoreCorruptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GraphStoreCorruptionError'
  }
}

type LoadedGraphRun = {
  state: GraphRunV1
  records: GraphJournalRecord[]
  snapshot?: GraphSnapshotRecord
}

export type FileGraphRunStoreOptions = {
  rootDir: string
  config: () => GraphRuntimeConfig
  artifactStore?: ArtifactStore
  runtimeEvents?: Pick<RuntimeEventRecorder, 'record'>
  nowIso?: () => string
  nextId?: (prefix: string) => string
}

export class FileGraphRunStore implements GraphRunStore {
  private readonly queues = new Map<string, Promise<unknown>>()
  private ready?: Promise<void>
  private readonly index: FileGraphRunIndex
  private readonly journal: GraphRunJournal
  private readonly nowIso: () => string
  private readonly nextId: (prefix: string) => string
  private readonly issues = new Map<string, GraphStoreDiagnostic>()

  constructor(private readonly options: FileGraphRunStoreOptions) {
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.nextId = options.nextId ?? ((prefix) => `${prefix}_${randomUUID().replaceAll('-', '')}`)
    this.index = new FileGraphRunIndex(options.rootDir)
    this.journal = new GraphRunJournal({ rootDir: options.rootDir, config: options.config })
  }

  async create(input: CreateGraphRunInput): Promise<GraphCommandResultV1> {
    const runId = GraphRunIdSchema.parse(input.runId)
    return this.enqueue(runId, async () => {
      await this.ensureRoot()
      const existing = await this.loadRunHistory(runId).catch((error) => {
        if (error instanceof GraphRunNotFoundError) return null
        throw error
      })
      if (existing) {
        const duplicate = this.findDuplicate(existing, input.commandId, input.idempotencyKey)
        if (!duplicate) throw new GraphRunConflictError(`GraphRun already exists: ${runId}`)
        await this.maintainJournal(existing)
        await this.index.update(existing.state)
        await this.flushRuntimeEventsBestEffort(runId)
        return GraphCommandResultV1Schema.parse({
          version: GRAPH_CONTRACT_VERSION,
          commandId: input.commandId,
          applied: true,
          duplicate: true,
          run: existing.state
        })
      }

      const plan = assertValidGraphPlan(input.plan, this.options.config())
      try {
        await mkdir(this.runDir(runId), { recursive: false, mode: 0o700 })
      } catch (error) {
        if (String((error as { code?: unknown })?.code ?? '') === 'EEXIST') {
          throw new GraphRunConflictError(`GraphRun already exists: ${runId}`)
        }
        throw error
      }
      const envelope = GraphEventEnvelopeV1Schema.parse({
        version: GRAPH_EVENT_VERSION,
        eventId: this.nextId('graph_event'),
        runId,
        threadId: input.threadId,
        graphSeq: 1,
        graphRevision: plan.revision,
        timestamp: this.nowIso(),
        commandId: input.commandId,
        idempotencyKey: input.idempotencyKey,
        event: {
          type: 'run_created',
          payload: {
            plan,
            projectId: input.projectId,
            sourceTurnId: input.sourceTurnId
          }
        }
      })
      const state = applyGraphEvent(undefined, envelope)
      const persisted = await this.persistEnvelope(envelope)
      await this.journal.writeSnapshot(state, [journalRecord(persisted)])
      await this.index.update(state)
      await this.flushRuntimeEventsBestEffort(runId)
      return GraphCommandResultV1Schema.parse({
        version: GRAPH_CONTRACT_VERSION,
        commandId: input.commandId,
        applied: true,
        duplicate: false,
        run: state
      })
    })
  }

  async append(runIdInput: string, input: AppendGraphEventInput): Promise<AppendGraphEventResult> {
    const runId = GraphRunIdSchema.parse(runIdInput)
    return this.enqueue(runId, async () => {
      const loaded = await this.loadRunHistory(runId)
      const state = loaded.state
      const duplicate = this.findDuplicate(loaded, input.commandId, input.idempotencyKey)
      if (duplicate) {
        await this.maintainJournal(loaded)
        await this.index.update(state)
        await this.flushRuntimeEventsBestEffort(runId)
        return { state, envelope: duplicate, duplicate: true }
      }
      if (state.lastEventSeq !== input.expectedSeq) {
        throw new GraphRunConflictError(
          `GraphRun ${runId} expected sequence ${input.expectedSeq}; current is ${state.lastEventSeq}`
        )
      }
      const envelope = GraphEventEnvelopeV1Schema.parse({
        version: GRAPH_EVENT_VERSION,
        eventId: input.eventId ?? this.nextId('graph_event'),
        runId,
        threadId: state.threadId,
        graphSeq: state.lastEventSeq + 1,
        graphRevision: input.graphRevision,
        timestamp: input.timestamp ?? this.nowIso(),
        ...(input.commandId ? { commandId: input.commandId } : {}),
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        event: input.event
      })
      const next = applyGraphEvent(state, envelope)
      const persisted = await this.persistEnvelope(envelope)
      await this.maintainJournal({
        state: next,
        records: [...loaded.records, journalRecord(persisted)],
        snapshot: loaded.snapshot
      })
      await this.index.update(next)
      await this.flushRuntimeEventsBestEffort(runId)
      return { state: next, envelope: persisted, duplicate: false }
    })
  }

  async get(runIdInput: string): Promise<GraphRunV1 | null> {
    const runId = GraphRunIdSchema.parse(runIdInput)
    return this.enqueue(runId, async () => {
      try {
        return await this.loadRun(runId)
      } catch (error) {
        if (error instanceof GraphRunNotFoundError) return null
        throw error
      }
    })
  }

  async list(filter: GraphRunListFilter = {}): Promise<GraphRunV1[]> {
    await this.ensureRoot()
    const runs: GraphRunV1[] = []
    const candidates = await this.index.candidates(filter)
    for (const entry of candidates) {
      const run = await this.get(entry.runId).catch((error) => {
        const diagnostic = diagnosticForStoreError(entry.runId, error)
        this.issues.set(entry.runId, diagnostic)
        return null
      })
      if (!run) continue
      this.issues.delete(entry.runId)
      runs.push(run)
    }
    return runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
  }

  async events(runIdInput: string, sinceSeq = 0): Promise<GraphEventEnvelopeV1[]> {
    return (await this.eventReplay(runIdInput, sinceSeq)).events
  }

  async eventReplay(runIdInput: string, sinceSeq = 0): Promise<GraphEventReplay> {
    const runId = GraphRunIdSchema.parse(runIdInput)
    return this.enqueue(runId, async () => {
      const loaded = await this.loadRunHistory(runId)
      const { state, records, snapshot } = loaded
      const replayFloorSeq = records.at(0)?.envelope.graphSeq ?? state.lastEventSeq + 1
      return {
        events: records
        .map((record) => record.envelope)
        .filter((envelope) => envelope.graphSeq > sinceSeq),
        replayFloorSeq,
        currentSeq: state.lastEventSeq,
        snapshotSeq: snapshot?.state.lastEventSeq ?? 0,
        truncated: sinceSeq + 1 < replayFloorSeq
      }
    })
  }

  async snapshot(runIdInput: string): Promise<GraphRunV1> {
    const runId = GraphRunIdSchema.parse(runIdInput)
    return this.enqueue(runId, async () => {
      const state = await this.loadRun(runId)
      const records = await this.journal.read(runId)
      await this.journal.writeSnapshot(state, records)
      return state
    })
  }

  async remove(runIdInput: string): Promise<void> {
    const runId = GraphRunIdSchema.parse(runIdInput)
    await this.enqueue(runId, async () => {
      const state = await this.loadRun(runId)
      if (!isTerminalRunStatus(state.status)) {
        throw new GraphRunConflictError(`cannot remove nonterminal GraphRun ${runId}`)
      }
      await rm(this.runDir(runId), { recursive: true, force: true })
      await this.index.remove(runId)
    })
  }

  async diagnostics(): Promise<GraphStoreDiagnostic[]> {
    await this.list().catch(() => undefined)
    return [...this.issues.values()].sort((a, b) => a.runId.localeCompare(b.runId))
  }

  private async loadRun(runId: string): Promise<GraphRunV1> {
    return (await this.loadRunHistory(runId)).state
  }

  private async loadRunHistory(runId: string): Promise<LoadedGraphRun> {
    await this.ensureRoot()
    try {
      const info = await stat(this.runDir(runId))
      if (!info.isDirectory()) throw new GraphRunNotFoundError(runId)
    } catch (error) {
      if (error instanceof GraphRunNotFoundError) throw error
      if (String((error as { code?: unknown })?.code ?? '') === 'ENOENT') {
        throw new GraphRunNotFoundError(runId)
      }
      throw error
    }

    const records = await this.journal.read(runId).catch((error) => {
      if (error instanceof Error && error.name === 'GraphStoreCorruptionError') {
        throw new GraphStoreCorruptionError(error.message)
      }
      throw error
    })
    const journalHighWater = records.at(-1)?.envelope.graphSeq ?? Number.MAX_SAFE_INTEGER
    const snapshot = await this.journal.readSnapshot(runId, journalHighWater)
    let state = snapshot?.state
    if (!state && records.length === 0) {
      throw new GraphStoreCorruptionError(`GraphRun ${runId} has no journal events or valid snapshot`)
    }
    if (!state && records[0]!.envelope.graphSeq !== 1) {
      throw new GraphStoreCorruptionError(
        `GraphRun ${runId} compacted journal requires a valid snapshot`
      )
    }
    const replayFrom = state?.lastEventSeq ?? 0
    for (const record of records) {
      if (record.envelope.graphSeq <= replayFrom) continue
      const hydrated = await this.hydrateEnvelope(record.envelope)
      state = applyGraphEvent(state, hydrated, { replayCompatibility: true })
    }
    if (!state) throw new GraphStoreCorruptionError(`GraphRun ${runId} could not be reconstructed`)
    return { state, records, ...(snapshot ? { snapshot } : {}) }
  }

  private findDuplicate(
    loaded: LoadedGraphRun,
    commandId?: string,
    idempotencyKey?: string
  ): GraphEventEnvelopeV1 | undefined {
    if (!commandId && !idempotencyKey) return undefined
    const journalMatch = loaded.records.find(({ envelope }) =>
      (idempotencyKey && envelope.idempotencyKey === idempotencyKey) ||
      (commandId && envelope.commandId === commandId))?.envelope
    if (journalMatch) return journalMatch
    return loaded.snapshot?.recentCommands.find(({ envelope }) =>
      (idempotencyKey && envelope.idempotencyKey === idempotencyKey) ||
      (commandId && envelope.commandId === commandId))?.envelope
  }

  private async persistEnvelope(envelope: GraphEventEnvelopeV1): Promise<GraphEventEnvelopeV1> {
    const publicEnvelope = await this.externalizeIfNeeded(envelope)
    await this.journal.append(publicEnvelope)
    await this.queueRuntimeEvent(publicEnvelope)
    return publicEnvelope
  }

  private async externalizeIfNeeded(
    envelope: GraphEventEnvelopeV1
  ): Promise<GraphEventEnvelopeV1> {
    const serializedEvent = JSON.stringify(envelope.event)
    if (Buffer.byteLength(serializedEvent, 'utf8') <= this.options.config().context.maxInlineEventBytes) {
      return envelope
    }
    if (!this.options.artifactStore) {
      throw new GraphRunConflictError('oversized Graph event requires an ArtifactStore')
    }
    const stored = await this.options.artifactStore.put({
      content: serializedEvent,
      mimeType: 'application/vnd.kun.graph-event+json',
      source: 'other',
      origin: `graph:${envelope.runId}`,
      maxInlineChars: Math.min(2_048, this.options.config().context.maxInlineEventBytes)
    })
    const contentHash = createHash('sha256').update(serializedEvent).digest('hex')
    return GraphEventEnvelopeV1Schema.parse({
      ...envelope,
      event: {
        type: 'payload_externalized',
        payload: {
          originalType: envelope.event.type,
          summary: stored.summary.inline.slice(0, 4_096),
          artifact: {
            version: GRAPH_CONTRACT_VERSION,
            artifactId: stored.meta.id,
            contentHash,
            mimeType: stored.meta.mimeType ?? 'application/vnd.kun.graph-event+json',
            byteLength: stored.meta.byteSize,
            summary: stored.summary.inline.slice(0, 4_096),
            visibility: 'run',
            retention: 'thread',
            createdAt: stored.meta.createdAt
          }
        }
      }
    })
  }

  private async hydrateEnvelope(envelope: GraphEventEnvelopeV1): Promise<GraphEventEnvelopeV1> {
    if (envelope.event.type !== 'payload_externalized') return envelope
    if (!this.options.artifactStore) {
      throw new GraphStoreCorruptionError('cannot hydrate Graph event without ArtifactStore')
    }
    const content = await this.options.artifactStore.get(envelope.event.payload.artifact.artifactId)
    if (content === null) {
      throw new GraphStoreCorruptionError(
        `missing Graph event artifact ${envelope.event.payload.artifact.artifactId}`
      )
    }
    if (createHash('sha256').update(content).digest('hex') !== envelope.event.payload.artifact.contentHash) {
      throw new GraphStoreCorruptionError('Graph event artifact checksum mismatch')
    }
    let raw: unknown
    try {
      raw = JSON.parse(content)
    } catch {
      throw new GraphStoreCorruptionError('Graph event artifact is not valid JSON')
    }
    return GraphEventEnvelopeV1Schema.parse({
      ...envelope,
      event: GraphDomainEventV1Schema.parse(raw)
    })
  }

  private async maintainJournal(loaded: LoadedGraphRun): Promise<void> {
    const retention = this.options.config().retention
    const shouldSnapshot =
      loaded.state.lastEventSeq % retention.snapshotEveryEvents === 0 ||
      isTerminalRunStatus(loaded.state.status)
    if (!shouldSnapshot) return
    await this.journal.writeSnapshot(loaded.state, loaded.records)
    if (loaded.state.lastEventSeq >= retention.compactAfterEvents) {
      await this.journal.compact(loaded.state, loaded.records)
    }
  }

  private async queueRuntimeEvent(envelope: GraphEventEnvelopeV1): Promise<void> {
    if (!this.options.runtimeEvents) return
    const pending = await this.readOutbox(envelope.runId)
    if (pending.some((entry) => entry.eventId === envelope.eventId)) return
    await atomicWriteFile(
      this.outboxPath(envelope.runId),
      `${JSON.stringify(GraphOutboxSchema.parse([...pending, envelope]))}\n`
    )
  }

  private async flushRuntimeEvents(runId: string): Promise<void> {
    if (!this.options.runtimeEvents) return
    const pending = await this.readOutbox(runId)
    for (let index = 0; index < pending.length; index += 1) {
      const envelope = pending[index]!
      await this.options.runtimeEvents.record({
        kind: 'graph_event',
        threadId: envelope.threadId,
        graph: envelope
      })
      await atomicWriteFile(
        this.outboxPath(runId),
        `${JSON.stringify(pending.slice(index + 1))}\n`
      )
    }
  }

  private async flushRuntimeEventsBestEffort(runId: string): Promise<void> {
    try {
      await this.flushRuntimeEvents(runId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(
        `[kun] Graph runtime event outbox flush deferred for ${runId}: ${message.slice(0, 512)}`
      )
    }
  }

  private async readOutbox(runId: string): Promise<GraphEventEnvelopeV1[]> {
    try {
      return GraphOutboxSchema.parse(
        JSON.parse(await readFile(this.outboxPath(runId), 'utf8'))
      )
    } catch (error) {
      if (String((error as { code?: unknown })?.code ?? '') === 'ENOENT') return []
      throw error
    }
  }

  private async ensureRoot(): Promise<void> {
    if (!this.ready) {
      const attempt = (async () => {
        await mkdir(this.options.rootDir, { recursive: true, mode: 0o700 })
        await this.index.initialize()
      })()
      this.ready = attempt
      void attempt.catch(() => {
        // Initialization can observe a transiently unavailable/corrupt index
        // while the manager is taking ownership of an existing data directory.
        // Do not permanently poison this store instance: a later request must
        // be able to retry after the underlying condition has been repaired.
        if (this.ready === attempt) this.ready = undefined
      })
    }
    return this.ready
  }

  private runDir(runId: string): string {
    return join(this.options.rootDir, GraphRunIdSchema.parse(runId))
  }

  private outboxPath(runId: string): string {
    return join(this.runDir(runId), 'runtime-outbox.json')
  }

  private async enqueue<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(runId) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(operation)
    const guard = run.then(() => undefined, () => undefined)
    this.queues.set(runId, guard)
    try {
      return await run
    } finally {
      if (this.queues.get(runId) === guard) this.queues.delete(runId)
    }
  }
}

function journalRecord(envelope: GraphEventEnvelopeV1): GraphJournalRecord {
  return { checksum: checksumJson(envelope), envelope }
}

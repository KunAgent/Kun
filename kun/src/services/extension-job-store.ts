import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { JobEventSchema, JobSnapshotSchema } from '@kun/extension-api'
import { AtomicJsonFile } from '../extensions/atomic-json.js'
import { extensionWorkspaceKey } from '../extensions/paths.js'
import {
  EXTENSION_JOB_SCHEMA_VERSION,
  EXTENSION_JOB_STORE_SCHEMA_VERSION,
  extensionJobCursor,
  isExtensionJobTerminal,
  parseExtensionJobCursor,
  type ExtensionJobCheckpoint,
  type ExtensionJobEvent,
  type ExtensionJobEventType,
  type ExtensionJobIdempotency,
  type ExtensionJobOwner,
  type ExtensionJobSnapshot,
  type ExtensionJobStoreDocument,
  type StoredExtensionJob
} from './extension-job-types.js'

export const DEFAULT_EXTENSION_JOB_EVENTS_PER_JOB = 512
export const DEFAULT_EXTENSION_JOB_EVENT_BYTES_PER_JOB = 4 * 1024 * 1024
export const DEFAULT_EXTENSION_JOB_TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60_000
export const DEFAULT_EXTENSION_JOB_TERMINAL_RECORDS = 1_000

export type ExtensionJobStoreOptions = {
  path: string
  now?: () => Date
  maxEventsPerJob?: number
  maxEventBytesPerJob?: number
  terminalRetentionMs?: number
  maxTerminalRecords?: number
}

export type ExtensionJobStoreCreateInput = {
  snapshot: Omit<ExtensionJobSnapshot, 'latestCursor'> & { latestCursor?: string }
  workspaceRoot: string
  permissionsSnapshot: readonly string[]
  idempotency?: ExtensionJobIdempotency
  checkpoint?: ExtensionJobCheckpoint
}

export type ExtensionJobEventDraft = {
  type: ExtensionJobEventType
  progress?: ExtensionJobEvent['progress']
  result?: ExtensionJobEvent['result']
  error?: ExtensionJobEvent['error']
}

export type ExtensionJobStoreMutation = {
  snapshot?: ExtensionJobSnapshot
  event?: ExtensionJobEventDraft
  checkpoint?: ExtensionJobCheckpoint | null
  cancellationReason?: string | null
}

export type ExtensionJobStoreCommit = {
  snapshot: ExtensionJobSnapshot
  event?: ExtensionJobEvent
  changed: boolean
}

export type ExtensionJobStoreReplay = {
  snapshot: ExtensionJobSnapshot
  events: ExtensionJobEvent[]
  cursor: string
  gap: boolean
  complete: boolean
}

export type ExtensionJobStoreListener = (
  snapshot: ExtensionJobSnapshot,
  event: ExtensionJobEvent
) => void

/**
 * Atomic, single-file store for extension-owned jobs.
 *
 * Every mutation replaces the whole validated document through AtomicJsonFile,
 * so a snapshot transition and its event are committed by one rename. The
 * in-process serialization fence also makes idempotent creation and event
 * sequence allocation deterministic under concurrent callers.
 */
export class ExtensionJobStore {
  private readonly file: AtomicJsonFile<ExtensionJobStoreDocument>
  private readonly listeners = new Set<ExtensionJobStoreListener>()
  private readonly now: () => Date
  private readonly maxEventsPerJob: number
  private readonly maxEventBytesPerJob: number
  private readonly terminalRetentionMs: number
  private readonly maxTerminalRecords: number
  private document?: ExtensionJobStoreDocument
  private loading?: Promise<ExtensionJobStoreDocument>
  private operation: Promise<unknown> = Promise.resolve()

  constructor(options: ExtensionJobStoreOptions) {
    this.file = new AtomicJsonFile(options.path, validateJobStoreDocument)
    this.now = options.now ?? (() => new Date())
    this.maxEventsPerJob = positiveInteger(
      options.maxEventsPerJob,
      DEFAULT_EXTENSION_JOB_EVENTS_PER_JOB,
      'maxEventsPerJob'
    )
    this.maxEventBytesPerJob = positiveInteger(
      options.maxEventBytesPerJob,
      DEFAULT_EXTENSION_JOB_EVENT_BYTES_PER_JOB,
      'maxEventBytesPerJob'
    )
    this.terminalRetentionMs = nonNegativeInteger(
      options.terminalRetentionMs,
      DEFAULT_EXTENSION_JOB_TERMINAL_RETENTION_MS,
      'terminalRetentionMs'
    )
    this.maxTerminalRecords = nonNegativeInteger(
      options.maxTerminalRecords,
      DEFAULT_EXTENSION_JOB_TERMINAL_RECORDS,
      'maxTerminalRecords'
    )
  }

  async load(): Promise<ExtensionJobStoreDocument> {
    return this.serialize(async () => {
      const current = await this.loadUnlocked()
      const next = structuredClone(current)
      const before = Object.keys(next.jobs).length
      this.pruneDocument(next)
      if (Object.keys(next.jobs).length !== before) await this.persist(next)
      return structuredClone(next)
    })
  }

  async create(input: ExtensionJobStoreCreateInput): Promise<{
    snapshot: ExtensionJobSnapshot
    created: boolean
  }> {
    let emitted: { snapshot: ExtensionJobSnapshot; event: ExtensionJobEvent } | undefined
    const result = await this.serialize(async () => {
      const current = await this.loadUnlocked()
      const existingId = input.idempotency === undefined
        ? undefined
        : ownRecordValue(current.idempotency, idempotencyScope(input.snapshot, input.idempotency))
      if (existingId !== undefined) {
        const existing = ownRecordValue(current.jobs, existingId)
        if (existing !== undefined) {
          return { snapshot: structuredClone(existing.snapshot), created: false }
        }
      }
      if (ownRecordValue(current.jobs, input.snapshot.id) !== undefined) {
        throw new Error(`Extension job ID already exists: ${input.snapshot.id}`)
      }

      const now = this.now().toISOString()
      const snapshot: ExtensionJobSnapshot = {
        ...structuredClone(input.snapshot),
        schemaVersion: EXTENSION_JOB_SCHEMA_VERSION,
        state: 'queued',
        executionAttempt: 0,
        createdAt: input.snapshot.createdAt || now,
        updatedAt: input.snapshot.updatedAt || now,
        latestCursor: extensionJobCursor(input.snapshot.id, 1)
      }
      const event: ExtensionJobEvent = {
        schemaVersion: EXTENSION_JOB_SCHEMA_VERSION,
        jobId: snapshot.id,
        kind: snapshot.kind,
        type: 'created',
        state: snapshot.state,
        timestamp: snapshot.createdAt,
        executionAttempt: 0,
        sequence: 1,
        cursor: snapshot.latestCursor
      }
      const bytes = jsonBytes(event)
      const stored: StoredExtensionJob = {
        snapshot,
        workspaceRoot: input.workspaceRoot,
        permissionsSnapshot: uniqueSorted(input.permissionsSnapshot),
        ...(input.idempotency ? { idempotency: structuredClone(input.idempotency) } : {}),
        ...(input.checkpoint ? { checkpoint: structuredClone(input.checkpoint) } : {}),
        events: [event],
        oldestRetainedSequence: 1,
        retainedEventBytes: bytes
      }
      const next = structuredClone(current)
      setOwnRecordValue(next.jobs, snapshot.id, stored)
      if (input.idempotency !== undefined) {
        setOwnRecordValue(next.idempotency, idempotencyScope(snapshot, input.idempotency), snapshot.id)
      }
      this.pruneDocument(next)
      await this.persist(next)
      emitted = { snapshot: structuredClone(snapshot), event: structuredClone(event) }
      return { snapshot: structuredClone(snapshot), created: true }
    })
    if (emitted !== undefined) this.emit(emitted.snapshot, emitted.event)
    return result
  }

  async get(jobId: string): Promise<ExtensionJobSnapshot | undefined> {
    return this.serialize(async () => {
      const stored = ownRecordValue((await this.loadUnlocked()).jobs, jobId)
      return stored === undefined ? undefined : structuredClone(stored.snapshot)
    })
  }

  async getStored(jobId: string): Promise<StoredExtensionJob | undefined> {
    return this.serialize(async () => {
      const stored = ownRecordValue((await this.loadUnlocked()).jobs, jobId)
      return stored === undefined ? undefined : structuredClone(stored)
    })
  }

  async list(): Promise<ExtensionJobSnapshot[]> {
    return this.serialize(async () => orderedJobs(await this.loadUnlocked())
      .map((job) => structuredClone(job.snapshot)))
  }

  async listStored(): Promise<StoredExtensionJob[]> {
    return this.serialize(async () => orderedJobs(await this.loadUnlocked())
      .map((job) => structuredClone(job)))
  }

  async findIdempotent(
    owner: ExtensionJobOwner,
    idempotency: ExtensionJobIdempotency
  ): Promise<ExtensionJobSnapshot | undefined> {
    return this.serialize(async () => {
      const document = await this.loadUnlocked()
      const jobId = ownRecordValue(document.idempotency, idempotencyScope(owner, idempotency))
      const stored = jobId === undefined ? undefined : ownRecordValue(document.jobs, jobId)
      return stored === undefined ? undefined : structuredClone(stored.snapshot)
    })
  }

  async mutate(
    jobId: string,
    mutate: (current: StoredExtensionJob) => ExtensionJobStoreMutation | undefined
  ): Promise<ExtensionJobStoreCommit | undefined> {
    let emitted: { snapshot: ExtensionJobSnapshot; event: ExtensionJobEvent } | undefined
    const result = await this.serialize(async () => {
      const current = await this.loadUnlocked()
      const record = ownRecordValue(current.jobs, jobId)
      if (record === undefined) return undefined
      const mutation = mutate(structuredClone(record))
      if (mutation === undefined) {
        return { snapshot: structuredClone(record.snapshot), changed: false }
      }

      const next = structuredClone(current)
      const nextRecord = ownRecordValue(next.jobs, jobId)
      if (nextRecord === undefined) return undefined
      if (mutation.snapshot !== undefined) nextRecord.snapshot = structuredClone(mutation.snapshot)
      if (mutation.checkpoint === null) delete nextRecord.checkpoint
      else if (mutation.checkpoint !== undefined) {
        nextRecord.checkpoint = structuredClone(mutation.checkpoint)
      }
      if (mutation.cancellationReason === null) delete nextRecord.cancellationReason
      else if (mutation.cancellationReason !== undefined) {
        nextRecord.cancellationReason = mutation.cancellationReason
      }

      let event: ExtensionJobEvent | undefined
      if (mutation.event !== undefined) {
        const sequence = latestSequence(nextRecord) + 1
        const cursor = extensionJobCursor(jobId, sequence)
        nextRecord.snapshot.latestCursor = cursor
        event = {
          schemaVersion: EXTENSION_JOB_SCHEMA_VERSION,
          jobId,
          kind: nextRecord.snapshot.kind,
          type: mutation.event.type,
          state: nextRecord.snapshot.state,
          timestamp: nextRecord.snapshot.updatedAt,
          executionAttempt: nextRecord.snapshot.executionAttempt,
          sequence,
          cursor,
          ...(mutation.event.progress ? { progress: structuredClone(mutation.event.progress) } : {}),
          ...(mutation.event.result ? { result: structuredClone(mutation.event.result) } : {}),
          ...(mutation.event.error ? { error: structuredClone(mutation.event.error) } : {})
        }
        nextRecord.events.push(event)
        nextRecord.retainedEventBytes += jsonBytes(event)
        this.pruneEvents(nextRecord)
      }
      this.pruneDocument(next)
      await this.persist(next)
      if (event !== undefined) {
        emitted = {
          snapshot: structuredClone(nextRecord.snapshot),
          event: structuredClone(event)
        }
      }
      return {
        snapshot: structuredClone(nextRecord.snapshot),
        ...(event ? { event: structuredClone(event) } : {}),
        changed: true
      }
    })
    if (emitted !== undefined) this.emit(emitted.snapshot, emitted.event)
    return result
  }

  async replay(jobId: string, cursor?: string): Promise<ExtensionJobStoreReplay | undefined> {
    return this.serialize(async () => {
      const record = ownRecordValue((await this.loadUnlocked()).jobs, jobId)
      if (record === undefined) return undefined
      let sequence = 0
      let gap = false
      if (cursor !== undefined) {
        const parsed = parseExtensionJobCursor(cursor)
        if (parsed === undefined || parsed.jobId !== jobId) {
          gap = true
          sequence = latestSequence(record)
        } else {
          sequence = parsed.sequence
        }
      }
      const latest = latestSequence(record)
      if (sequence > latest || sequence < record.oldestRetainedSequence - 1) {
        gap = true
        sequence = latest
      }
      const events = gap
        ? []
        : record.events
          .filter((event) => event.sequence > sequence)
          .map((event) => structuredClone(event))
      return {
        snapshot: structuredClone(record.snapshot),
        events,
        cursor: gap
          ? record.snapshot.latestCursor
          : events.at(-1)?.cursor ?? extensionJobCursor(jobId, sequence),
        gap,
        complete: isExtensionJobTerminal(record.snapshot.state)
      }
    })
  }

  async prune(): Promise<number> {
    return this.serialize(async () => {
      const current = await this.loadUnlocked()
      const next = structuredClone(current)
      const before = Object.keys(next.jobs).length
      this.pruneDocument(next)
      const removed = before - Object.keys(next.jobs).length
      if (removed > 0) await this.persist(next)
      return removed
    })
  }

  subscribe(listener: ExtensionJobStoreListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async loadUnlocked(): Promise<ExtensionJobStoreDocument> {
    if (this.document !== undefined) return this.document
    this.loading ??= this.file.read(() => emptyDocument(this.now)).then((document) => {
      this.document = document
      return document
    })
    return this.loading
  }

  private async persist(document: ExtensionJobStoreDocument): Promise<void> {
    document.revision += 1
    document.updatedAt = this.now().toISOString()
    const validated = validateJobStoreDocument(document)
    await this.file.write(validated)
    this.document = validated
  }

  private pruneEvents(record: StoredExtensionJob): void {
    while (
      record.events.length > this.maxEventsPerJob ||
      record.retainedEventBytes > this.maxEventBytesPerJob
    ) {
      if (record.events.length <= 1) break
      const removed = record.events.shift()
      if (removed !== undefined) record.retainedEventBytes -= jsonBytes(removed)
    }
    record.retainedEventBytes = Math.max(0, record.retainedEventBytes)
    record.oldestRetainedSequence = record.events[0]?.sequence ?? latestSequence(record) + 1
  }

  private pruneDocument(document: ExtensionJobStoreDocument): void {
    const now = this.now().getTime()
    const terminal = Object.values(document.jobs)
      .filter((job) => isExtensionJobTerminal(job.snapshot.state))
      .sort(compareOldestTerminal)
    const expired = terminal.filter((job) => {
      const terminalAt = Date.parse(job.snapshot.terminalAt ?? job.snapshot.updatedAt)
      return Number.isFinite(terminalAt) && now - terminalAt > this.terminalRetentionMs
    })
    const overLimit = terminal.slice(0, Math.max(0, terminal.length - this.maxTerminalRecords))
    for (const job of new Set([...expired, ...overLimit])) {
      deleteOwnRecordValue(document.jobs, job.snapshot.id)
    }
    for (const [scope, jobId] of Object.entries(document.idempotency)) {
      if (ownRecordValue(document.jobs, jobId) === undefined) {
        deleteOwnRecordValue(document.idempotency, scope)
      }
    }
  }

  private emit(snapshot: ExtensionJobSnapshot, event: ExtensionJobEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(structuredClone(snapshot), structuredClone(event))
      } catch {
        // A consumer cannot roll back an already durable state transition.
      }
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operation.then(operation, operation)
    this.operation = result.then(() => undefined, () => undefined)
    return result
  }
}

function emptyDocument(now: () => Date): ExtensionJobStoreDocument {
  return {
    schemaVersion: EXTENSION_JOB_STORE_SCHEMA_VERSION,
    revision: 0,
    updatedAt: now().toISOString(),
    jobs: {},
    idempotency: {}
  }
}

/**
 * Job IDs are extension-controlled opaque strings, so they can legally be
 * names such as `__proto__`. Persisted maps are ordinary JSON objects; always
 * access their own data properties so an inherited Object.prototype member
 * cannot be mistaken for a job record or mutated by a subsequent update.
 */
function ownRecordValue<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

function setOwnRecordValue<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true
  })
}

function deleteOwnRecordValue<T>(record: Record<string, T>, key: string): void {
  if (Object.hasOwn(record, key)) delete record[key]
}

function latestSequence(record: StoredExtensionJob): number {
  const parsed = parseExtensionJobCursor(record.snapshot.latestCursor)
  return parsed?.jobId === record.snapshot.id ? parsed.sequence : 0
}

function idempotencyScope(
  owner: ExtensionJobOwner | Pick<ExtensionJobSnapshot, 'ownerExtensionId' | 'workspaceId'>,
  idempotency: ExtensionJobIdempotency
): string {
  const extensionId = 'extensionId' in owner ? owner.extensionId : owner.ownerExtensionId
  return createHash('sha256').update(JSON.stringify([
    extensionId,
    owner.workspaceId,
    idempotency.operation,
    idempotency.key
  ])).digest('base64url')
}

function orderedJobs(document: ExtensionJobStoreDocument): StoredExtensionJob[] {
  return Object.values(document.jobs).sort((left, right) =>
    right.snapshot.createdAt.localeCompare(left.snapshot.createdAt) ||
    right.snapshot.id.localeCompare(left.snapshot.id))
}

function compareOldestTerminal(left: StoredExtensionJob, right: StoredExtensionJob): number {
  return (left.snapshot.terminalAt ?? left.snapshot.updatedAt)
    .localeCompare(right.snapshot.terminalAt ?? right.snapshot.updatedAt) ||
    left.snapshot.id.localeCompare(right.snapshot.id)
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const normalized = value ?? fallback
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return normalized
}

function nonNegativeInteger(value: number | undefined, fallback: number, name: string): number {
  const normalized = value ?? fallback
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error(`${name} must be a non-negative integer`)
  }
  return normalized
}

function validateJobStoreDocument(value: unknown): ExtensionJobStoreDocument {
  if (!isRecord(value) || value.schemaVersion !== EXTENSION_JOB_STORE_SCHEMA_VERSION) {
    throw new Error('Invalid extension job store schema')
  }
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0) {
    throw new Error('Invalid extension job store revision')
  }
  assertTimestamp(value.updatedAt, 'updatedAt')
  if (!isRecord(value.jobs) || !isRecord(value.idempotency)) {
    throw new Error('Invalid extension job store maps')
  }
  const document = structuredClone(value) as ExtensionJobStoreDocument
  for (const [jobId, job] of Object.entries(document.jobs)) validateStoredJob(jobId, job)
  for (const [scope, jobId] of Object.entries(document.idempotency)) {
    if (scope.length === 0 || typeof jobId !== 'string' || ownRecordValue(document.jobs, jobId) === undefined) {
      throw new Error('Invalid extension job idempotency index')
    }
  }
  return document
}

function validateStoredJob(jobId: string, value: unknown): asserts value is StoredExtensionJob {
  if (!isRecord(value) || !isRecord(value.snapshot)) throw new Error('Invalid extension job record')
  const snapshot = value.snapshot
  JobSnapshotSchema.parse(snapshot)
  if (
    snapshot.schemaVersion !== EXTENSION_JOB_SCHEMA_VERSION ||
    snapshot.id !== jobId ||
    !isNonEmptyString(snapshot.kind) ||
    !Number.isSafeInteger(snapshot.kindSchemaVersion) ||
    Number(snapshot.kindSchemaVersion) <= 0 ||
    !isNonEmptyString(snapshot.ownerExtensionId) ||
    !isNonEmptyString(snapshot.ownerExtensionVersion) ||
    !isNonEmptyString(snapshot.workspaceId) ||
    !isNonEmptyString(snapshot.initiatingOperation) ||
    !isJobState(snapshot.state) ||
    !Number.isSafeInteger(snapshot.executionAttempt) ||
    Number(snapshot.executionAttempt) < 0 ||
    !isNonEmptyString(snapshot.latestCursor)
  ) throw new Error('Invalid extension job snapshot')
  assertTimestamp(snapshot.createdAt, 'createdAt')
  assertTimestamp(snapshot.updatedAt, 'updatedAt')
  if (snapshot.startedAt !== undefined) assertTimestamp(snapshot.startedAt, 'startedAt')
  if (snapshot.terminalAt !== undefined) assertTimestamp(snapshot.terminalAt, 'terminalAt')
  if (snapshot.cancelRequestedAt !== undefined) {
    assertTimestamp(snapshot.cancelRequestedAt, 'cancelRequestedAt')
  }
  if (!Array.isArray(value.permissionsSnapshot) || !value.permissionsSnapshot.every(isNonEmptyString)) {
    throw new Error('Invalid extension job permission snapshot')
  }
  if (
    !isNonEmptyString(value.workspaceRoot) ||
    value.workspaceRoot.length > 4_096 ||
    !isAbsolute(value.workspaceRoot) ||
    containsAsciiControl(value.workspaceRoot) ||
    extensionWorkspaceKey(value.workspaceRoot) !== snapshot.workspaceId
  ) {
    throw new Error('Invalid extension job workspace root')
  }
  if (!Array.isArray(value.events)) throw new Error('Invalid extension job events')
  let previousSequence = 0
  let eventBytes = 0
  for (const event of value.events) {
    JobEventSchema.parse(event)
    if (!isRecord(event) || event.jobId !== jobId || !Number.isSafeInteger(event.sequence)) {
      throw new Error('Invalid extension job event')
    }
    const sequence = Number(event.sequence)
    if (sequence <= previousSequence) throw new Error('Non-monotonic extension job events')
    previousSequence = sequence
    eventBytes += jsonBytes(event)
  }
  if (
    !Number.isSafeInteger(value.oldestRetainedSequence) ||
    Number(value.oldestRetainedSequence) < 1 ||
    !Number.isSafeInteger(value.retainedEventBytes) ||
    Number(value.retainedEventBytes) !== eventBytes
  ) throw new Error('Invalid extension job event retention metadata')
  const cursor = parseExtensionJobCursor(snapshot.latestCursor)
  if (cursor === undefined || cursor.jobId !== jobId || cursor.sequence < previousSequence) {
    throw new Error('Invalid extension job cursor')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function containsAsciiControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
}

function isJobState(value: unknown): boolean {
  return value === 'queued' || value === 'running' || value === 'completed' ||
    value === 'failed' || value === 'cancelled' || value === 'interrupted'
}

function assertTimestamp(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Invalid extension job ${field}`)
  }
}

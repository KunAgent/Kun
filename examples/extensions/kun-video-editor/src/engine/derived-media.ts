import { createHash } from 'node:crypto'
import { engineError } from './errors.js'
import { assertSourceFingerprint, type SourceFingerprint } from './transcript-adapters.js'

export type DerivedMediaKind =
  | 'waveform'
  | 'thumbnail'
  | 'filmstrip'
  | 'transcript'
  | 'analysis'
  | 'embedding'
  | 'proxy'
  | 'proof'
  | 'preview'

export type DerivedMediaStatus =
  | 'queued'
  | 'running'
  | 'partial'
  | 'ready'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'invalid'

export type DerivedMediaPriority = 'background' | 'user' | 'interactive' | 'export'

export type DerivedMediaOwner = {
  extensionId: string
  extensionVersion: string
  workspaceId: string
  projectId?: string
  assetId?: string
}

export type DerivedMediaRecord = {
  schemaVersion: 1
  id: string
  /** Monotonic across every record mutation in this workspace store. */
  generation: number
  /** Generation of the most recent status transition for event consumers. */
  statusGeneration: number
  dedupeKey: string
  kind: DerivedMediaKind
  owner: DerivedMediaOwner
  sourceFingerprint: SourceFingerprint
  normalizedParameters: Readonly<Record<string, unknown>>
  producer: { id: string; version: string }
  dependencies: string[]
  status: DerivedMediaStatus
  priority: DerivedMediaPriority
  bytes: number
  pinned: boolean
  attempt: number
  jobId?: string
  artifactHandleIds: string[]
  partialArtifactHandleIds: string[]
  progress?: { completed: number; total: number; unit: string; message?: string }
  error?: { code: string; message: string; retryable: boolean }
  retryAfter?: string
  createdAt: string
  updatedAt: string
  lastAccessedAt: string
}

export type DerivedMediaSnapshot = {
  schemaVersion: 1
  generation: number
  records: DerivedMediaRecord[]
}

export interface DerivedMediaPersistence {
  load(): Promise<unknown | undefined>
  save(snapshot: DerivedMediaSnapshot): Promise<void>
}

export type DerivedMediaStoreOptions = {
  quotaBytes?: number
  maxRecords?: number
  now?: () => Date
  onEvict?: (record: DerivedMediaRecord) => Promise<void>
}

export type DerivedRequest = {
  kind: DerivedMediaKind
  owner: DerivedMediaOwner
  sourceFingerprint: SourceFingerprint
  normalizedParameters?: Readonly<Record<string, unknown>>
  producer: { id: string; version: string }
  dependencies?: readonly string[]
  priority?: DerivedMediaPriority
  pinned?: boolean
}

export type DerivedRequestResult = {
  record: DerivedMediaRecord
  deduplicated: boolean
  backoffActive: boolean
}

export type DerivedStorageUsage = {
  quotaBytes: number
  usedBytes: number
  readyBytes: number
  recordCount: number
  pinnedCount: number
  evictableCount: number
}

const DEFAULT_QUOTA_BYTES = 2 * 1024 * 1024 * 1024
const DEFAULT_MAX_RECORDS = 2_000
const MAX_PARAMETER_BYTES = 64 * 1024
const MAX_ARTIFACTS = 16
const PRIORITY_ORDER: Readonly<Record<DerivedMediaPriority, number>> = Object.freeze({
  background: 100,
  user: 200,
  interactive: 300,
  export: 400
})

export class MemoryDerivedMediaPersistence implements DerivedMediaPersistence {
  snapshot?: DerivedMediaSnapshot

  async load(): Promise<unknown | undefined> {
    return this.snapshot === undefined ? undefined : structuredClone(this.snapshot)
  }

  async save(snapshot: DerivedMediaSnapshot): Promise<void> {
    this.snapshot = structuredClone(snapshot)
  }
}

export class DerivedMediaStore {
  readonly recoveryDiagnostics: string[]
  private records: DerivedMediaRecord[]
  private generation: number
  private queue: Promise<unknown> = Promise.resolve()

  private constructor(
    private readonly persistence: DerivedMediaPersistence,
    private readonly options: Required<Pick<DerivedMediaStoreOptions, 'quotaBytes' | 'maxRecords' | 'now'>> &
      Pick<DerivedMediaStoreOptions, 'onEvict'>,
    records: DerivedMediaRecord[],
    generation: number,
    diagnostics: string[]
  ) {
    this.records = records
    this.generation = generation
    this.recoveryDiagnostics = diagnostics
  }

  static async open(
    persistence: DerivedMediaPersistence,
    options: DerivedMediaStoreOptions = {}
  ): Promise<DerivedMediaStore> {
    const normalizedOptions = {
      quotaBytes: boundedPositive(options.quotaBytes ?? DEFAULT_QUOTA_BYTES, 'quotaBytes'),
      maxRecords: Math.min(DEFAULT_MAX_RECORDS, boundedPositive(options.maxRecords ?? DEFAULT_MAX_RECORDS, 'maxRecords')),
      now: options.now ?? (() => new Date()),
      ...(options.onEvict === undefined ? {} : { onEvict: options.onEvict })
    }
    const diagnostics: string[] = []
    let records: DerivedMediaRecord[] = []
    let generation = 0
    const loaded = await persistence.load()
    if (loaded !== undefined) {
      try {
        const snapshot = validateSnapshot(loaded, normalizedOptions.maxRecords)
        records = snapshot.records
        generation = snapshot.generation
      } catch (error) {
        diagnostics.push(`Derived metadata could not be decoded and was left untouched: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return new DerivedMediaStore(persistence, normalizedOptions, records, generation, diagnostics)
  }

  async list(filter: { owner?: Partial<DerivedMediaOwner>; kinds?: readonly DerivedMediaKind[] } = {}): Promise<DerivedMediaRecord[]> {
    return await this.serialized(async () => {
      const kindSet = filter.kinds ? new Set(filter.kinds) : undefined
      const matches = this.records.filter((record) =>
        (!kindSet || kindSet.has(record.kind)) && ownerMatches(record.owner, filter.owner)
      ).sort((left, right) =>
        PRIORITY_ORDER[right.priority] - PRIORITY_ORDER[left.priority] ||
        right.updatedAt.localeCompare(left.updatedAt) ||
        left.id.localeCompare(right.id)
      )
      return structuredClone(matches)
    })
  }

  async get(id: string, touch = true): Promise<DerivedMediaRecord | undefined> {
    return await this.serialized(async () => {
      const record = this.records.find((candidate) => candidate.id === id)
      if (!record) return undefined
      if (touch) {
        record.lastAccessedAt = this.timestamp()
        this.bump(record)
        await this.persist()
      }
      return structuredClone(record)
    })
  }

  async request(request: DerivedRequest): Promise<DerivedRequestResult> {
    return await this.serialized(async () => {
      validateRequest(request)
      const dedupeKey = derivedDedupeKey(request)
      const existing = this.records.find((record) => record.dedupeKey === dedupeKey)
      const timestamp = this.timestamp()
      if (existing) {
        existing.lastAccessedAt = timestamp
        const retryAfter = existing.retryAfter ? Date.parse(existing.retryAfter) : 0
        const backoffActive = existing.status === 'failed' && retryAfter > this.options.now().getTime()
        if (
          backoffActive ||
          ['queued', 'running', 'partial', 'ready'].includes(existing.status)
        ) {
          this.bump(existing)
          await this.persist()
          return { record: structuredClone(existing), deduplicated: true, backoffActive }
        }
        existing.status = 'queued'
        existing.priority = request.priority ?? existing.priority
        existing.pinned = request.pinned ?? existing.pinned
        existing.attempt += 1
        existing.jobId = undefined
        existing.artifactHandleIds = []
        existing.partialArtifactHandleIds = []
        existing.progress = undefined
        existing.error = undefined
        existing.retryAfter = undefined
        existing.updatedAt = timestamp
        this.bump(existing, true)
        await this.persist()
        return { record: structuredClone(existing), deduplicated: false, backoffActive: false }
      }
      if (this.records.length >= this.options.maxRecords) await this.evictRecordsForCount(1)
      const record: DerivedMediaRecord = {
        schemaVersion: 1,
        id: `derived-${dedupeKey.slice(0, 32)}`,
        generation: this.generation + 1,
        statusGeneration: this.generation + 1,
        dedupeKey,
        kind: request.kind,
        owner: structuredClone(request.owner),
        sourceFingerprint: { ...request.sourceFingerprint },
        normalizedParameters: structuredClone(request.normalizedParameters ?? {}),
        producer: { ...request.producer },
        dependencies: [...new Set(request.dependencies ?? [])].sort(),
        status: 'queued',
        priority: request.priority ?? defaultPriority(request.kind),
        bytes: 0,
        pinned: request.pinned ?? false,
        attempt: 1,
        artifactHandleIds: [],
        partialArtifactHandleIds: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        lastAccessedAt: timestamp
      }
      this.generation += 1
      assertDependencies(this.records, record)
      this.records.push(record)
      await this.persist()
      return { record: structuredClone(record), deduplicated: false, backoffActive: false }
    })
  }

  async markRunning(id: string, jobId: string): Promise<DerivedMediaRecord> {
    return await this.transition(id, ['queued', 'interrupted', 'partial'], (record) => {
      if (record.status !== 'partial') record.status = 'running'
      record.jobId = boundedString(jobId, 8, 512, 'jobId')
      record.error = undefined
      record.retryAfter = undefined
    })
  }

  async queueNextStage(id: string): Promise<DerivedMediaRecord> {
    return await this.transition(id, ['partial'], (record) => {
      record.jobId = undefined
    })
  }

  async reportProgress(
    id: string,
    progress: { completed: number; total: number; unit: string; message?: string; partialArtifactHandleIds?: readonly string[] }
  ): Promise<DerivedMediaRecord> {
    return await this.transition(id, ['running', 'partial'], (record) => {
      if (!Number.isFinite(progress.completed) || !Number.isFinite(progress.total) || progress.total <= 0 || progress.completed < 0 || progress.completed > progress.total) {
        throw engineError('invalid_operation', 'Derived progress must be monotonic and bounded')
      }
      if (record.progress && progress.completed < record.progress.completed) {
        throw engineError('invalid_operation', 'Derived progress cannot move backwards')
      }
      record.progress = {
        completed: progress.completed,
        total: progress.total,
        unit: boundedString(progress.unit, 1, 32, 'progress.unit'),
        ...(progress.message === undefined ? {} : { message: boundedString(progress.message, 1, 512, 'progress.message') })
      }
      if (progress.partialArtifactHandleIds?.length) {
        record.partialArtifactHandleIds = boundedHandles(progress.partialArtifactHandleIds)
        record.status = 'partial'
      }
    })
  }

  async complete(id: string, input: { bytes: number; artifactHandleIds: readonly string[] }): Promise<DerivedMediaRecord> {
    return await this.serialized(async () => {
      const record = requiredRecord(this.records, id)
      if (!['running', 'partial'].includes(record.status)) invalidTransition(record, 'ready')
      if (!Number.isSafeInteger(input.bytes) || input.bytes < 0) {
        throw engineError('invalid_operation', 'Derived byte size must be a non-negative integer')
      }
      for (const dependency of record.dependencies) {
        if (requiredRecord(this.records, dependency).status !== 'ready') {
          throw engineError('invalid_operation', `Derived dependency ${dependency} is not ready`)
        }
      }
      await this.ensureCapacity(Math.max(0, input.bytes - record.bytes), new Set([record.id]))
      record.status = 'ready'
      record.bytes = input.bytes
      record.artifactHandleIds = boundedHandles(input.artifactHandleIds)
      record.partialArtifactHandleIds = []
      record.progress = { completed: 1, total: 1, unit: 'result', message: 'Ready' }
      record.error = undefined
      record.retryAfter = undefined
      record.updatedAt = this.timestamp()
      record.lastAccessedAt = record.updatedAt
      this.bump(record, true)
      await this.persist()
      return structuredClone(record)
    })
  }

  async fail(id: string, error: { code: string; message: string; retryable: boolean }): Promise<DerivedMediaRecord> {
    return await this.transition(id, ['queued', 'running', 'partial'], (record) => {
      record.status = 'failed'
      record.error = {
        code: boundedString(error.code, 1, 128, 'error.code'),
        message: boundedString(error.message, 1, 1024, 'error.message'),
        retryable: error.retryable
      }
      record.retryAfter = error.retryable
        ? new Date(this.options.now().getTime() + retryDelayMs(record.attempt)).toISOString()
        : undefined
      record.partialArtifactHandleIds = []
    })
  }

  async interrupt(id: string, message = 'Derived work was interrupted before its result could be reconciled.'): Promise<DerivedMediaRecord> {
    return await this.transition(id, ['queued', 'running', 'partial'], (record) => {
      record.status = 'interrupted'
      record.partialArtifactHandleIds = []
      record.error = {
        code: 'interrupted',
        message: boundedString(message, 1, 1024, 'interrupt.message'),
        retryable: true
      }
      record.retryAfter = undefined
    })
  }

  async retry(id: string, priority?: DerivedMediaPriority): Promise<DerivedMediaRecord> {
    return await this.transition(id, ['failed', 'cancelled', 'interrupted', 'invalid'], (record) => {
      record.status = 'queued'
      record.priority = priority ?? record.priority
      record.attempt += 1
      record.bytes = 0
      record.jobId = undefined
      record.artifactHandleIds = []
      record.partialArtifactHandleIds = []
      record.progress = undefined
      record.error = undefined
      record.retryAfter = undefined
    })
  }

  async cancel(id: string): Promise<DerivedMediaRecord> {
    return await this.transition(id, ['queued', 'running', 'partial'], (record) => {
      record.status = 'cancelled'
      record.partialArtifactHandleIds = []
      record.error = { code: 'cancelled', message: 'Derived work was cancelled.', retryable: true }
    })
  }

  async setPinned(id: string, pinned: boolean): Promise<DerivedMediaRecord> {
    return await this.transition(id, ALL_STATUSES, (record) => { record.pinned = pinned })
  }

  /**
   * Records a successful consumer access without turning ordinary metadata
   * reads into cache hits. Callers may pass the runtime-owned handle access
   * timestamp so opening a protected View lease participates in LRU ordering.
   */
  async touch(id: string, accessedAt?: string): Promise<DerivedMediaRecord> {
    return await this.serialized(async () => {
      const record = requiredRecord(this.records, id)
      const timestamp = accessedAt ?? this.timestamp()
      if (Number.isNaN(Date.parse(timestamp))) {
        throw engineError('invalid_operation', 'Derived access timestamp is invalid')
      }
      if (timestamp <= record.lastAccessedAt) return structuredClone(record)
      record.lastAccessedAt = timestamp
      this.bump(record)
      await this.persist()
      return structuredClone(record)
    })
  }

  async invalidateSource(sourceFingerprint: SourceFingerprint): Promise<DerivedMediaRecord[]> {
    assertSourceFingerprint(sourceFingerprint)
    return await this.invalidateMatching(
      (record) => record.sourceFingerprint.value === sourceFingerprint.value,
      'source_changed',
      'Source identity changed; recompute this derived result.'
    )
  }

  /**
   * Invalidates only records owned by the relinked asset whose immutable source
   * identity no longer matches. Other projects may still validly reference the
   * old source, while dependency descendants remain invalidated transitively.
   */
  async invalidateOwnerSourceChange(
    owner: Partial<DerivedMediaOwner>,
    currentSourceFingerprint: SourceFingerprint
  ): Promise<DerivedMediaRecord[]> {
    assertSourceFingerprint(currentSourceFingerprint)
    return await this.invalidateMatching(
      (record) => ownerMatches(record.owner, owner) &&
        record.sourceFingerprint.value !== currentSourceFingerprint.value,
      'source_changed',
      'Source identity changed; recompute this derived result.'
    )
  }

  /** Invalidate an unavailable/revoked asset and every dependent graph node. */
  async invalidateOwner(
    owner: Partial<DerivedMediaOwner>,
    error: { code: string; message: string } = {
      code: 'source_unavailable',
      message: 'Source media is unavailable; reauthorize it before recomputing this result.'
    }
  ): Promise<DerivedMediaRecord[]> {
    const code = boundedString(error.code, 1, 128, 'error.code')
    const message = boundedString(error.message, 1, 1024, 'error.message')
    return await this.invalidateMatching(
      (record) => ownerMatches(record.owner, owner),
      code,
      message
    )
  }

  /**
   * Clears released artifacts while retaining the invalid record and its
   * provenance. This makes restart recovery and byte accounting honest.
   */
  async discardArtifacts(id: string): Promise<DerivedMediaRecord> {
    return await this.serialized(async () => {
      const record = requiredRecord(this.records, id)
      if (
        record.bytes === 0 && record.jobId === undefined &&
        record.artifactHandleIds.length === 0 && record.partialArtifactHandleIds.length === 0
      ) return structuredClone(record)
      record.bytes = 0
      record.jobId = undefined
      record.artifactHandleIds = []
      record.partialArtifactHandleIds = []
      record.progress = undefined
      record.updatedAt = this.timestamp()
      this.bump(record)
      await this.persist()
      return structuredClone(record)
    })
  }

  async recoverInterrupted(): Promise<DerivedMediaRecord[]> {
    return await this.serialized(async () => {
      const recovered = this.records.filter(({ status }) => ['queued', 'running', 'partial'].includes(status))
      const timestamp = this.timestamp()
      for (const record of recovered) {
        record.status = 'interrupted'
        record.updatedAt = timestamp
        record.partialArtifactHandleIds = []
        record.error = {
          code: 'interrupted',
          message: 'Derived work was interrupted before an atomic result became ready.',
          retryable: true
        }
        this.bump(record, true)
      }
      if (recovered.length > 0) await this.persist()
      return structuredClone(recovered)
    })
  }

  async cleanup(input: {
    includeFailed?: boolean
    includeInvalid?: boolean
    includeCancelled?: boolean
    includeReady?: boolean
    owner?: Partial<DerivedMediaOwner>
  } = {}): Promise<DerivedMediaRecord[]> {
    return await this.serialized(async () => {
      const removable = new Set<DerivedMediaStatus>([
        ...(input.includeFailed === false ? [] : ['failed' as const, 'interrupted' as const]),
        ...(input.includeInvalid === false ? [] : ['invalid' as const]),
        ...(input.includeCancelled === false ? [] : ['cancelled' as const]),
        ...(input.includeReady === true ? ['ready' as const] : [])
      ])
      const removed: DerivedMediaRecord[] = []
      for (const record of [...this.records]) {
        if (
          record.pinned ||
          !removable.has(record.status) ||
          !ownerMatches(record.owner, input.owner) ||
          hasDependent(this.records, record.id)
        ) continue
        await this.evict(record)
        removed.push(record)
      }
      if (removed.length > 0) await this.persist()
      return structuredClone(removed)
    })
  }

  async usage(): Promise<DerivedStorageUsage> {
    return await this.serialized(async () => ({
      quotaBytes: this.options.quotaBytes,
      usedBytes: this.records.reduce((total, { bytes }) => total + bytes, 0),
      readyBytes: this.records.filter(({ status }) => status === 'ready').reduce((total, { bytes }) => total + bytes, 0),
      recordCount: this.records.length,
      pinnedCount: this.records.filter(({ pinned }) => pinned).length,
      evictableCount: this.records.filter((record) => isEvictable(this.records, record)).length
    }))
  }

  private async transition(
    id: string,
    allowed: readonly DerivedMediaStatus[],
    mutate: (record: DerivedMediaRecord) => void
  ): Promise<DerivedMediaRecord> {
    return await this.serialized(async () => {
      const record = requiredRecord(this.records, id)
      if (!allowed.includes(record.status)) invalidTransition(record, 'updated')
      const previousStatus = record.status
      mutate(record)
      record.updatedAt = this.timestamp()
      record.lastAccessedAt = record.updatedAt
      this.bump(record, record.status !== previousStatus)
      await this.persist()
      return structuredClone(record)
    })
  }

  private async invalidateMatching(
    matches: (record: DerivedMediaRecord) => boolean,
    code: string,
    message: string
  ): Promise<DerivedMediaRecord[]> {
    return await this.serialized(async () => {
      const invalid = new Set(this.records.filter(matches).map(({ id }) => id))
      let changed = true
      while (changed) {
        changed = false
        for (const record of this.records) {
          if (!invalid.has(record.id) && record.dependencies.some((dependency) => invalid.has(dependency))) {
            invalid.add(record.id)
            changed = true
          }
        }
      }
      const timestamp = this.timestamp()
      let mutated = false
      const actionable = new Set<string>()
      for (const record of this.records) {
        if (!invalid.has(record.id)) continue
        if (record.status === 'invalid' && record.error?.code === code) {
          if (
            record.bytes > 0 || record.jobId !== undefined ||
            record.artifactHandleIds.length > 0 || record.partialArtifactHandleIds.length > 0
          ) actionable.add(record.id)
          continue
        }
        record.status = 'invalid'
        record.updatedAt = timestamp
        record.error = { code, message, retryable: true }
        record.retryAfter = undefined
        this.bump(record, true)
        actionable.add(record.id)
        mutated = true
      }
      if (mutated) await this.persist()
      return structuredClone(this.records.filter(({ id }) => actionable.has(id)))
    })
  }

  private async ensureCapacity(additionalBytes: number, excluded = new Set<string>()): Promise<void> {
    while (this.records.reduce((total, { bytes }) => total + bytes, 0) + additionalBytes > this.options.quotaBytes) {
      const candidate = this.records
        .filter((record) => !excluded.has(record.id) && isEvictable(this.records, record))
        .sort((left, right) => left.lastAccessedAt.localeCompare(right.lastAccessedAt) || left.id.localeCompare(right.id))[0]
      if (!candidate) {
        throw engineError('invalid_operation', 'Derived media quota is full and no unpinned result can be evicted', {
          quotaBytes: this.options.quotaBytes,
          additionalBytes
        })
      }
      await this.evict(candidate)
    }
  }

  private async evictRecordsForCount(required: number): Promise<void> {
    while (this.records.length + required > this.options.maxRecords) {
      const candidate = this.records
        .filter((record) => isEvictable(this.records, record))
        .sort((left, right) => left.lastAccessedAt.localeCompare(right.lastAccessedAt) || left.id.localeCompare(right.id))[0]
      if (!candidate) throw engineError('invalid_operation', 'Derived record limit is full and no record can be evicted')
      await this.evict(candidate)
    }
  }

  private async evict(record: DerivedMediaRecord): Promise<void> {
    await this.options.onEvict?.(structuredClone(record))
    this.bump(record)
    this.records = this.records.filter(({ id }) => id !== record.id)
  }

  private async persist(): Promise<void> {
    await this.persistence.save({
      schemaVersion: 1,
      generation: this.generation,
      records: structuredClone(this.records)
    })
  }

  private bump(record: DerivedMediaRecord, statusChanged = false): void {
    this.generation += 1
    record.generation = this.generation
    if (statusChanged) record.statusGeneration = this.generation
  }

  private timestamp(): string {
    return this.options.now().toISOString()
  }

  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation)
    this.queue = next.then(() => undefined, () => undefined)
    return await next
  }
}

export function derivedDedupeKey(request: DerivedRequest): string {
  validateRequest(request)
  return createHash('sha256').update(canonicalJson({
    kind: request.kind,
    owner: request.owner,
    sourceFingerprint: request.sourceFingerprint,
    normalizedParameters: request.normalizedParameters ?? {},
    producer: request.producer,
    dependencies: [...new Set(request.dependencies ?? [])].sort()
  })).digest('hex')
}

function validateRequest(request: DerivedRequest): void {
  if (!DERIVED_KINDS.has(request.kind)) throw engineError('invalid_operation', 'Unsupported derived media kind')
  validateOwner(request.owner)
  assertSourceFingerprint(request.sourceFingerprint)
  boundedString(request.producer.id, 1, 128, 'producer.id')
  boundedString(request.producer.version, 1, 64, 'producer.version')
  const parameterBytes = new TextEncoder().encode(canonicalJson(request.normalizedParameters ?? {})).byteLength
  if (parameterBytes > MAX_PARAMETER_BYTES) throw engineError('invalid_operation', 'Derived parameters exceed 64 KiB')
  if ((request.dependencies?.length ?? 0) > 64) throw engineError('invalid_operation', 'Derived request has too many dependencies')
}

function validateSnapshot(value: unknown, maxRecords: number): DerivedMediaSnapshot {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.records) || value.records.length > maxRecords) {
    throw engineError('invalid_project', 'Derived metadata snapshot is invalid')
  }
  const records = value.records.map((record, index) => validateRecord(record, index + 1))
  const ids = new Set<string>()
  const keys = new Set<string>()
  for (const record of records) {
    if (ids.has(record.id) || keys.has(record.dedupeKey)) throw engineError('invalid_project', 'Derived metadata identities must be unique')
    ids.add(record.id)
    keys.add(record.dedupeKey)
  }
  for (const record of records) assertDependencies(records, record)
  const maximumRecordGeneration = records.reduce(
    (maximum, record) => Math.max(maximum, record.generation, record.statusGeneration),
    0
  )
  const generation = Number.isSafeInteger(value.generation) && Number(value.generation) >= 0
    ? Math.max(Number(value.generation), maximumRecordGeneration)
    : maximumRecordGeneration
  return { schemaVersion: 1, generation, records }
}

function validateRecord(value: unknown, legacyGeneration: number): DerivedMediaRecord {
  if (!isRecord(value) || value.schemaVersion !== 1) throw engineError('invalid_project', 'Derived record is invalid')
  const record = structuredClone(value) as unknown as DerivedMediaRecord
  record.generation = positiveGeneration(value.generation, legacyGeneration, 'derived.generation')
  record.statusGeneration = positiveGeneration(
    value.statusGeneration,
    record.generation,
    'derived.statusGeneration'
  )
  if (record.statusGeneration > record.generation) {
    throw engineError('invalid_project', 'Derived status generation cannot exceed its record generation')
  }
  boundedString(record.id, 1, 128, 'derived.id')
  if (!/^[a-f0-9]{64}$/u.test(record.dedupeKey)) throw engineError('invalid_project', 'Derived dedupe key is invalid')
  if (!DERIVED_KINDS.has(record.kind) || !ALL_STATUSES.includes(record.status)) throw engineError('invalid_project', 'Derived kind or status is invalid')
  validateOwner(record.owner)
  assertSourceFingerprint(record.sourceFingerprint)
  validateRequest({
    kind: record.kind,
    owner: record.owner,
    sourceFingerprint: record.sourceFingerprint,
    normalizedParameters: record.normalizedParameters,
    producer: record.producer,
    dependencies: record.dependencies,
    priority: record.priority,
    pinned: record.pinned
  })
  if (!Object.hasOwn(PRIORITY_ORDER, record.priority) || !Number.isSafeInteger(record.bytes) || record.bytes < 0 || !Number.isSafeInteger(record.attempt) || record.attempt < 1) {
    throw engineError('invalid_project', 'Derived accounting is invalid')
  }
  record.artifactHandleIds = boundedHandles(record.artifactHandleIds)
  record.partialArtifactHandleIds = boundedHandles(record.partialArtifactHandleIds)
  for (const timestamp of [record.createdAt, record.updatedAt, record.lastAccessedAt, record.retryAfter].filter(Boolean)) {
    if (Number.isNaN(Date.parse(timestamp!))) throw engineError('invalid_project', 'Derived timestamp is invalid')
  }
  return record
}

function positiveGeneration(value: unknown, fallback: number, path: string): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw engineError('invalid_project', `${path} must be a positive safe integer`)
  }
  return Number(value)
}

function assertDependencies(records: readonly DerivedMediaRecord[], record: DerivedMediaRecord): void {
  if (record.dependencies.includes(record.id)) throw engineError('invalid_operation', 'Derived record cannot depend on itself')
  const known = new Set(records.map(({ id }) => id))
  for (const dependency of record.dependencies) {
    if (!known.has(dependency)) throw engineError('invalid_operation', `Missing derived dependency ${dependency}`)
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const byId = new Map(records.map((candidate) => [candidate.id, candidate]))
  const visit = (id: string): void => {
    if (visiting.has(id)) throw engineError('invalid_operation', 'Derived dependency graph contains a cycle')
    if (visited.has(id)) return
    visiting.add(id)
    for (const dependency of byId.get(id)?.dependencies ?? []) visit(dependency)
    visiting.delete(id)
    visited.add(id)
  }
  for (const candidate of records) visit(candidate.id)
}

function defaultPriority(kind: DerivedMediaKind): DerivedMediaPriority {
  if (kind === 'proof' || kind === 'preview') return 'interactive'
  if (kind === 'proxy') return 'user'
  return 'background'
}

function retryDelayMs(attempt: number): number {
  return Math.min(60 * 60_000, 1_000 * 2 ** Math.min(12, Math.max(0, attempt - 1)))
}

function isEvictable(records: readonly DerivedMediaRecord[], record: DerivedMediaRecord): boolean {
  return !record.pinned && !['queued', 'running', 'partial'].includes(record.status) && !hasDependent(records, record.id)
}

function hasDependent(records: readonly DerivedMediaRecord[], id: string): boolean {
  return records.some((record) => record.dependencies.includes(id) && record.status !== 'invalid')
}

function requiredRecord(records: readonly DerivedMediaRecord[], id: string): DerivedMediaRecord {
  const record = records.find((candidate) => candidate.id === id)
  if (!record) throw engineError('invalid_operation', `Derived record does not exist: ${id}`)
  return record
}

function invalidTransition(record: DerivedMediaRecord, target: string): never {
  throw engineError('invalid_operation', `Derived record ${record.id} cannot move from ${record.status} to ${target}`)
}

function ownerMatches(owner: DerivedMediaOwner, filter?: Partial<DerivedMediaOwner>): boolean {
  if (!filter) return true
  return Object.entries(filter).every(([key, value]) => owner[key as keyof DerivedMediaOwner] === value)
}

function validateOwner(owner: DerivedMediaOwner): void {
  boundedString(owner.extensionId, 1, 256, 'owner.extensionId')
  boundedString(owner.extensionVersion, 1, 64, 'owner.extensionVersion')
  boundedString(owner.workspaceId, 1, 256, 'owner.workspaceId')
  if (owner.projectId !== undefined) boundedString(owner.projectId, 1, 128, 'owner.projectId')
  if (owner.assetId !== undefined) boundedString(owner.assetId, 1, 128, 'owner.assetId')
}

function boundedHandles(values: readonly string[]): string[] {
  if (!Array.isArray(values) || values.length > MAX_ARTIFACTS) throw engineError('invalid_operation', 'Derived artifacts exceed the bounded limit')
  return [...new Set(values.map((value) => boundedString(value, 8, 512, 'artifactHandleId')))]
}

function boundedString(value: string, minimum: number, maximum: number, path: string): string {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) {
    throw engineError('invalid_operation', `${path} must contain ${minimum} through ${maximum} characters`)
  }
  return value
}

function boundedPositive(value: number, path: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw engineError('invalid_operation', `${path} must be a positive integer`)
  return value
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const DERIVED_KINDS = new Set<DerivedMediaKind>([
  'waveform', 'thumbnail', 'filmstrip', 'transcript', 'analysis', 'embedding', 'proxy', 'proof', 'preview'
])
const ALL_STATUSES: readonly DerivedMediaStatus[] = [
  'queued', 'running', 'partial', 'ready', 'failed', 'cancelled', 'interrupted', 'invalid'
]

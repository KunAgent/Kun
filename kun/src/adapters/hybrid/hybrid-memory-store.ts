import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import type { MemoryCapabilityConfig } from '../../contracts/capabilities.js'
import {
  MemoryDiagnostics,
  type MemoryCreateRequest,
  type MemoryRecord,
  type MemoryRetrievalTrace,
  type MemoryUpdateRequest
} from '../../contracts/memory.js'
import {
  assertSafeMemoryIndexPath,
  readCanonicalMemoryDirectory,
  readCanonicalMemoryRecordHashes
} from '../../memory/memory-canonical-files.js'
import { canonicalMemoryHash } from '../../memory/memory-record-normalizer.js'
import {
  FileMemoryStore,
  type MemoryAccess,
  type MemoryListFilter,
  type MemoryStore
} from '../../memory/memory-store.js'
import { memoryLifecycleState } from '../../memory/memory-ranking.js'
import { retrieveMemoryRecords, type MemoryRetrieveRequest } from '../../memory/memory-retrieval.js'
import { MEMORY_MAX_QUERY_SEARCH_TOKENS, memorySearchTokens } from '../../memory/memory-search-tokens.js'
import { yieldToEventLoop } from './hybrid-thread-support.js'
import {
  HybridMemoryBackfillCoordinator,
  type HybridMemoryBackfillState
} from './hybrid-memory-backfill.js'
import { HybridMemoryDegradedState } from './hybrid-memory-degraded-state.js'
import { HybridMemoryIndex } from './hybrid-memory-index.js'
import {
  MEMORY_INDEX_SCHEMA_VERSION,
  memoryIndexSchemaVersion,
  migrateMemoryIndex
} from './hybrid-memory-migrations.js'

type DatabaseFactory = (path: string) => BetterSqliteDatabase

export class HybridMemoryStore implements MemoryStore {
  private readonly dataDir: string
  private readonly rootDir: string
  private readonly sqlitePath: string
  private readonly canonical: FileMemoryStore
  private readonly readyPromise: Promise<void>
  private readonly degraded = new HybridMemoryDegradedState()
  private db: BetterSqliteDatabase | null = null
  private index: HybridMemoryIndex | null = null
  private backfill: HybridMemoryBackfillCoordinator | null = null
  private backfillState: HybridMemoryBackfillState = { running: false, scanned: 0, remaining: 0 }
  private indexStale = false
  private lastRetrieval: MemoryRetrievalTrace | undefined
  private lastInjectedIds: string[] = []
  private mutationQueue: Promise<unknown> = Promise.resolve()
  private mutationGeneration = 0

  constructor(private readonly options: {
    dataDir: string
    rootDir?: string
    sqlitePath?: string
    config: MemoryCapabilityConfig | (() => MemoryCapabilityConfig)
    nowIso?: () => string
    idGenerator?: () => string
    minConfidence?: number
    databaseFactory?: DatabaseFactory
    beforeMigrate?: () => void
    beforeProject?: (record: MemoryRecord) => void
    beforeIndexQuery?: (operation: 'list' | 'retrieve') => void
    beforeIndexRemove?: (id: string) => void
    backfillBatchSize?: number
    backfillYield?: () => Promise<void>
    beforeBackfillBatch?: () => Promise<void> | void
  }) {
    this.dataDir = resolve(options.dataDir)
    this.rootDir = resolve(options.rootDir ?? join(this.dataDir, 'memory'))
    this.sqlitePath = assertSafeMemoryIndexPath(
      this.dataDir,
      options.sqlitePath ?? join(this.dataDir, 'memory-index.sqlite3')
    )
    this.canonical = new FileMemoryStore({
      rootDir: this.rootDir,
      config: () => this.config(),
      nowIso: options.nowIso,
      idGenerator: options.idGenerator,
      minConfidence: options.minConfidence
    })
    this.readyPromise = this.initialize()
  }

  async ready(): Promise<void> { await this.readyPromise }
  async waitForBackfill(): Promise<void> { await this.ready(); await this.backfill?.wait() }

  async shutdown(): Promise<void> {
    await this.ready()
    this.backfill?.stop()
    await this.backfill?.wait()
    try { this.db?.close() } finally { this.db = null; this.index = null }
  }

  async create(input: MemoryCreateRequest): Promise<MemoryRecord> {
    return this.enqueueMutation(async () => {
      this.mutationGeneration += 1
      await this.ready()
      const record = await this.canonical.create(input)
      await this.projectCanonicalIds([record.id, ...(input.supersedes ? [input.supersedes] : [])])
      return record
    })
  }

  async createWithId(id: string, input: MemoryCreateRequest): Promise<MemoryRecord> {
    return this.enqueueMutation(async () => {
      this.mutationGeneration += 1
      await this.ready()
      const record = await this.canonical.createWithId(id, input)
      await this.projectCanonicalIds([record.id, ...(input.supersedes ? [input.supersedes] : [])])
      return record
    })
  }

  async update(id: string, patch: MemoryUpdateRequest, access?: MemoryAccess): Promise<MemoryRecord> {
    return this.enqueueMutation(async () => {
      this.mutationGeneration += 1
      await this.ready()
      const record = await this.canonical.update(id, patch, access)
      await this.projectRecord(record)
      return record
    })
  }

  async delete(id: string, access?: MemoryAccess): Promise<MemoryRecord> {
    return this.enqueueMutation(async () => {
      this.mutationGeneration += 1
      await this.ready()
      const record = await this.canonical.delete(id, access)
      await this.projectRecord(record)
      return record
    })
  }

  async purge(id: string): Promise<void> {
    return this.enqueueMutation(async () => {
      this.mutationGeneration += 1
      await this.ready()
      await this.canonical.purge(id)
      if (!this.index) return
      try {
        this.options.beforeIndexRemove?.(id)
        this.index.remove(id)
      } catch (error) {
        this.indexStale = true
        this.degraded.fail('purge projection', error)
      }
    })
  }

  async list(filter: MemoryListFilter = {}): Promise<MemoryRecord[]> {
    await this.ready()
    if (this.indexReady()) {
      try {
        this.options.beforeIndexQuery?.('list')
        const records = this.index!.list(filter)
        this.degraded.recover()
        return records
      } catch (error) {
        this.degraded.fail('list query', error)
      }
    }
    const records = await this.canonical.list(filter)
    this.reconcileStaleIndex()
    return records
  }

  async retrieve(request: MemoryRetrieveRequest): Promise<MemoryRecord[]> {
    await this.ready()
    const policy = request.policy ?? this.config()
    if (this.indexReady()) {
      try {
        this.options.beforeIndexQuery?.('retrieve')
        const queryTokens = memorySearchTokens(request.query, MEMORY_MAX_QUERY_SEARCH_TOKENS)
        const nowIso = this.now()
        const candidates = this.index!.candidates(request, policy, queryTokens, nowIso)
        const result = retrieveMemoryRecords({
          records: candidates.records,
          request,
          policy,
          mode: 'sqlite-fts5',
          nowIso,
          minConfidence: this.options.minConfidence,
          queryTokens,
          lexicalScores: candidates.lexicalScores,
          channels: candidates.channels,
          preFiltered: candidates.filtered
        })
        this.lastRetrieval = result.trace
        this.lastInjectedIds = [...result.trace.selectedIds]
        this.degraded.recover()
        return result.records
      } catch (error) {
        this.degraded.fail('retrieval query', error)
      }
    }
    const records = await this.canonical.retrieve({ ...request, policy })
    const diagnostics = await this.canonical.diagnostics(policy)
    this.lastRetrieval = diagnostics.lastRetrieval
    this.lastInjectedIds = [...(diagnostics.lastInjectedIds ?? [])]
    this.reconcileStaleIndex()
    return records
  }

  async diagnostics(policy = this.config()): Promise<MemoryDiagnostics> {
    await this.ready()
    const canonical = await readCanonicalMemoryDirectory(this.rootDir)
    const nowMs = Date.parse(this.now())
    let indexedCount = 0
    let staleCount = 0
    let schemaVersion = 0
    if (this.index && this.db) {
      try {
        const rows = this.index.indexedRows()
        indexedCount = rows.length
        schemaVersion = memoryIndexSchemaVersion(this.db)
        const canonicalHashes = new Map(canonical.records.map((record) => [record.id, canonicalMemoryHash(record)]))
        const indexedIds = new Set(rows.map((row) => row.id))
        staleCount = rows.filter((row) => canonicalHashes.get(row.id) !== row.canonicalHash).length +
          canonical.records.filter((record) => !indexedIds.has(record.id)).length
        if (staleCount > 0 && !this.indexStale) {
          this.indexStale = true
          if (!this.degraded.degradedReason()) {
            this.degraded.fail('stale projection', new Error(`${staleCount} canonical memory row(s) need reconciliation`))
          }
        }
      } catch (error) {
        this.degraded.fail('diagnostics query', error)
      }
    }
    const reason = this.degraded.degradedReason()
    const indexState = !policy.enabled
      ? 'disabled'
      : reason || !this.index || this.indexStale
        ? 'degraded'
        : this.backfillState.running
          ? 'backfilling'
          : 'ready'
    return MemoryDiagnostics.parse({
      enabled: policy.enabled,
      rootDir: this.rootDir,
      activeCount: canonical.records.filter((record) =>
        memoryLifecycleState(record, nowMs) === 'active' && record.confidence >= (this.options.minConfidence ?? 0)
      ).length,
      tombstoneCount: canonical.records.filter((record) => Boolean(record.deletedAt)).length,
      lastInjectedIds: this.lastInjectedIds,
      canonicalCount: canonical.records.length,
      malformedCount: canonical.malformedIds.length,
      indexState,
      indexSchemaVersion: schemaVersion,
      indexedCount,
      staleCount,
      backfill: this.backfillState,
      degradedReason: reason,
      lastRetrieval: this.lastRetrieval
    })
  }

  setLastInjected(ids: string[]): void {
    this.lastInjectedIds = [...ids]
    this.canonical.setLastInjected(ids)
    if (this.lastRetrieval) {
      const selected = new Set(ids)
      this.lastRetrieval = {
        ...this.lastRetrieval,
        selectedIds: [...ids],
        rankings: this.lastRetrieval.rankings.map((ranking) => ({
          ...ranking,
          selected: selected.has(ranking.memoryId)
        }))
      }
    }
  }

  private async initialize(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 })
    try {
      const factory = this.options.databaseFactory ?? await defaultDatabaseFactory()
      this.db = factory(this.sqlitePath)
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('busy_timeout = 5000')
      this.db.pragma('foreign_keys = ON')
      this.options.beforeMigrate?.()
      migrateMemoryIndex(this.db)
      if (memoryIndexSchemaVersion(this.db) !== MEMORY_INDEX_SCHEMA_VERSION) {
        throw new Error('unsupported memory index schema version')
      }
      this.index = new HybridMemoryIndex(this.db)
      this.index.integrityCheck()
      this.backfill = new HybridMemoryBackfillCoordinator({
        readCanonical: () => readCanonicalMemoryDirectory(this.rootDir),
        readCanonicalRecordHashes: (ids) => readCanonicalMemoryRecordHashes(this.rootDir, ids),
        indexedRows: () => this.index!.indexedRows(),
        upsert: (record, hash) => this.index!.upsert(record, hash),
        remove: (id) => this.index!.remove(id),
        enqueueIndexWrite: (write) => this.enqueueMutation(async () => { write() }),
        noteState: (state) => { this.backfillState = state; this.index!.noteBackfillState(state) },
        generation: () => this.mutationGeneration,
        beforeBatch: this.options.beforeBackfillBatch,
        complete: (clean) => {
          if (!clean) return
          this.indexStale = false
          this.degraded.recover()
        },
        yieldToEventLoop: this.options.backfillYield ?? yieldToEventLoop,
        warn: (action, error) => this.degraded.fail(action, error),
        batchSize: this.options.backfillBatchSize
      })
      this.backfill.start()
    } catch (error) {
      this.degraded.fail('initialize', error)
      try { this.db?.close() } catch { /* best-effort degraded cleanup */ }
      this.db = null
      this.index = null
      this.backfill = null
    }
  }

  private async projectCanonicalIds(ids: readonly string[]): Promise<void> {
    for (const id of new Set(ids)) {
      const record = await this.canonical.get(id)
      if (record) await this.projectRecord(record)
    }
  }

  private async projectRecord(record: MemoryRecord): Promise<void> {
    if (!this.index) return
    try {
      this.options.beforeProject?.(record)
      this.index.upsert(record, canonicalMemoryHash(record))
    } catch (error) {
      this.indexStale = true
      this.degraded.fail(`project ${record.id}`, error)
    }
  }

  private indexReady(): boolean {
    return Boolean(this.index && !this.backfillState.running && !this.indexStale)
  }

  private reconcileStaleIndex(): void {
    if (this.indexStale) this.backfill?.start()
  }

  private config(): MemoryCapabilityConfig {
    return typeof this.options.config === 'function' ? this.options.config() : this.options.config
  }

  private now(): string { return this.options.nowIso?.() ?? new Date().toISOString() }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.catch(() => undefined).then(operation)
    this.mutationQueue = run.then(() => undefined, () => undefined)
    return run
  }
}

async function defaultDatabaseFactory(): Promise<DatabaseFactory> {
  const sqlite = await import('better-sqlite3')
  return (path) => new sqlite.default(path)
}

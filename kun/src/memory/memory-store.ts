import { readFile } from 'node:fs/promises'
import type { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import {
  MemoryDiagnostics,
  MemoryRecord,
  type MemoryCreateRequest,
  type MemoryRetrievalTrace,
  type MemoryUpdateRequest
} from '../contracts/memory.js'
import {
  MEMORY_MAX_FALLBACK_FILES,
  memoryRecordPath,
  purgeCanonicalMemoryRecord,
  readCanonicalMemoryDirectory,
  writeCanonicalMemoryRecord
} from './memory-canonical-files.js'
import {
  defaultLegacyProvenance,
  defaultMemoryConfidence,
  defaultProvenance,
  normalizeCreateSources,
  normalizeMemoryRecord,
  normalizeUpdateSources
} from './memory-record-normalizer.js'
import {
  memoryInScope,
  memoryLifecycleState,
  normalizeMemoryScopePath
} from './memory-ranking.js'
import {
  retrieveMemoryRecords,
  type MemoryRetrieveRequest
} from './memory-retrieval.js'

export interface MemoryStore {
  create(input: MemoryCreateRequest): Promise<MemoryRecord>
  createWithId?(id: string, input: MemoryCreateRequest): Promise<MemoryRecord>
  update(id: string, patch: MemoryUpdateRequest, access?: MemoryAccess): Promise<MemoryRecord>
  delete(id: string, access?: MemoryAccess): Promise<MemoryRecord>
  purge?(id: string): Promise<void>
  list(filter?: MemoryListFilter): Promise<MemoryRecord[]>
  retrieve(input: MemoryRetrieveRequest): Promise<MemoryRecord[]>
  diagnostics(policy?: MemoryCapabilityConfig): Promise<MemoryDiagnostics>
  setLastInjected(ids: string[]): void
  ready?(): Promise<void>
  shutdown?(): Promise<void>
}

export type MemoryAccess = { workspace?: string; project?: string }
export type MemoryListFilter = MemoryAccess & { includeDeleted?: boolean; all?: boolean }

export class FileMemoryStore implements MemoryStore {
  private lastInjectedIds: string[] = []
  private lastRetrieval: MemoryRetrievalTrace | undefined

  constructor(
    private readonly options: {
      rootDir: string
      config: MemoryCapabilityConfig | (() => MemoryCapabilityConfig)
      nowIso?: () => string
      idGenerator?: () => string
      minConfidence?: number
    }
  ) {}

  async create(input: MemoryCreateRequest): Promise<MemoryRecord> {
    return this.createRecord(
      this.options.idGenerator?.() ?? `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      input
    )
  }

  async createWithId(id: string, input: MemoryCreateRequest): Promise<MemoryRecord> {
    const existing = await this.get(id)
    if (existing) {
      if (input.supersedes && existing.supersedes === input.supersedes) {
        const older = await this.mustGet(input.supersedes, {
          workspace: existing.workspace,
          project: existing.project
        })
        if (!older.supersededAt) {
          const now = this.now()
          await this.write(MemoryRecord.parse({ ...older, supersededAt: now, updatedAt: now }))
        }
      }
      return existing
    }
    return this.createRecord(id, input)
  }

  async get(id: string): Promise<MemoryRecord | undefined> {
    // memoryRecordPath rejects invalid IDs with 'invalid memory id', preserving
    // createWithId('../escape') rejection semantics while reading by ID in O(1).
    const path = memoryRecordPath(this.options.rootDir, id)
    let value: unknown
    try {
      value = JSON.parse(await readFile(path, 'utf8'))
    } catch {
      return undefined // missing file or malformed JSON — matches full-list malformed exclusion
    }
    const result = normalizeMemoryRecord(value, id)
    return result.ok ? result.record : undefined
  }

  private async createRecord(id: string, input: MemoryCreateRequest): Promise<MemoryRecord> {
    const now = this.now()
    const scope = input.scope ?? 'workspace'
    const workspace = normalizeMemoryScopePath(input.workspace)
    const project = normalizeMemoryScopePath(input.project ?? (scope === 'project' ? input.workspace : undefined))
    const provenance = input.provenance ?? defaultProvenance(input)
    const parsed = MemoryRecord.parse({
      id,
      content: input.content,
      scope,
      ...(scope !== 'user' && workspace ? { workspace } : {}),
      ...(scope === 'project' && project ? { project } : {}),
      sourceThreadId: input.sourceThreadId,
      sourceTurnId: input.sourceTurnId,
      provenance,
      tags: input.tags ?? [],
      confidence: input.confidence ?? defaultMemoryConfidence(provenance.kind),
      createdAt: now,
      updatedAt: now,
      type: input.type,
      importance: input.importance,
      observedAt: input.observedAt ?? now,
      validFrom: input.validFrom,
      validTo: input.validTo,
      sources: normalizeCreateSources(input),
      ...(input.expiresAt
        ? { expiresAt: input.expiresAt }
        : input.ttlMs
          ? { expiresAt: new Date(Date.parse(now) + input.ttlMs).toISOString() }
          : {}),
      ...(input.disabled ? { disabledAt: now } : {}),
      ...(input.supersedes ? { supersedes: input.supersedes } : {})
    })
    assertValidInterval(parsed)
    const older = input.supersedes
      ? await this.mustGet(input.supersedes, { workspace, project })
      : undefined
    if (older) {
      if (older.scope !== parsed.scope) {
        throw new Error('a memory can only supersede another memory in the same scope')
      }
    }
    await this.write(parsed)
    if (older) {
      await this.write(MemoryRecord.parse({ ...older, supersededAt: now, updatedAt: now }))
    }
    return parsed
  }

  async update(id: string, patch: MemoryUpdateRequest, access?: MemoryAccess): Promise<MemoryRecord> {
    const current = await this.mustGet(id, access)
    const now = this.now()
    const corrected = patch.content !== undefined && patch.content !== current.content
    const next = MemoryRecord.parse({
      ...current,
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      ...(patch.confidence !== undefined ? { confidence: patch.confidence } : corrected ? { confidence: 1 } : {}),
      ...(patch.importance !== undefined ? { importance: patch.importance } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.observedAt !== undefined ? { observedAt: patch.observedAt } : {}),
      ...(patch.sources !== undefined ? { sources: normalizeUpdateSources(patch.sources) } : {}),
      ...(corrected ? {
        correctedFrom: current.correctedFrom ?? current.content,
        provenance: { ...(current.provenance ?? defaultLegacyProvenance(current)), kind: 'user' }
      } : {}),
      ...(patch.validFrom !== undefined ? { validFrom: patch.validFrom ?? undefined } : {}),
      ...(patch.validTo !== undefined ? { validTo: patch.validTo ?? undefined } : {}),
      ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt ?? undefined } : {}),
      ...(patch.disabled === true ? { disabledAt: current.disabledAt ?? now } : {}),
      ...(patch.disabled === false ? { disabledAt: undefined } : {}),
      updatedAt: now
    })
    assertValidInterval(next)
    await this.write(next)
    return next
  }

  async delete(id: string, access?: MemoryAccess): Promise<MemoryRecord> {
    const current = await this.mustGet(id, access)
    const now = this.now()
    const next = MemoryRecord.parse({
      ...current,
      deletedAt: current.deletedAt ?? now,
      updatedAt: now
    })
    await this.write(next)
    return next
  }

  async purge(id: string): Promise<void> {
    await purgeCanonicalMemoryRecord(this.options.rootDir, id)
  }

  async list(filter: MemoryListFilter = {}): Promise<MemoryRecord[]> {
    const records = (await readCanonicalMemoryDirectory(this.options.rootDir)).records
    return records
      .filter((record) => filter.includeDeleted || !record.deletedAt)
      .filter((record) => filter.all || memoryInScope(record, filter))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
  }

  async retrieve(input: MemoryRetrieveRequest): Promise<MemoryRecord[]> {
    const canonical = await readCanonicalMemoryDirectory(this.options.rootDir, {
      maxFiles: MEMORY_MAX_FALLBACK_FILES
    })
    const result = retrieveMemoryRecords({
      records: canonical.records,
      request: input,
      policy: input.policy ?? this.config(),
      mode: 'filesystem-fallback',
      nowIso: this.now(),
      minConfidence: this.options.minConfidence
    })
    this.lastRetrieval = result.trace
    this.lastInjectedIds = [...result.trace.selectedIds]
    return result.records
  }

  async diagnostics(policy = this.config()): Promise<MemoryDiagnostics> {
    const canonical = await readCanonicalMemoryDirectory(this.options.rootDir)
    const nowMs = Date.parse(this.now())
    return MemoryDiagnostics.parse({
      enabled: policy.enabled,
      rootDir: this.options.rootDir,
      activeCount: canonical.records.filter((record) =>
        memoryLifecycleState(record, nowMs) === 'active' && record.confidence >= (this.options.minConfidence ?? 0)
      ).length,
      tombstoneCount: canonical.records.filter((record) => Boolean(record.deletedAt)).length,
      lastInjectedIds: this.lastInjectedIds,
      canonicalCount: canonical.records.length,
      malformedCount: canonical.malformedIds.length,
      indexState: policy.enabled ? 'filesystem' : 'disabled',
      indexSchemaVersion: 0,
      indexedCount: 0,
      staleCount: 0,
      backfill: { running: false, scanned: canonical.records.length, remaining: 0 },
      lastRetrieval: this.lastRetrieval
    })
  }

  setLastInjected(ids: string[]): void {
    this.lastInjectedIds = [...ids]
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

  private async mustGet(id: string, access?: MemoryAccess): Promise<MemoryRecord> {
    const record = await this.get(id)
    if (!record || (access && !memoryInScope(record, access))) throw new Error(`memory not found: ${id}`)
    return record
  }

  private write(record: MemoryRecord): Promise<void> {
    return writeCanonicalMemoryRecord(this.options.rootDir, record)
  }

  private config(): MemoryCapabilityConfig {
    return typeof this.options.config === 'function' ? this.options.config() : this.options.config
  }

  private now(): string {
    return this.options.nowIso?.() ?? new Date().toISOString()
  }
}

export function isMemoryActive(record: MemoryRecord, nowMs: number, minConfidence = 0): boolean {
  return memoryLifecycleState(record, nowMs) === 'active' && record.confidence >= minConfidence
}

/** @deprecated Confidence no longer decays with age; use memoryFreshness separately. */
export function effectiveMemoryConfidence(record: MemoryRecord, _nowMs?: number, _halfLifeMs?: number): number {
  return record.confidence
}

function assertValidInterval(record: MemoryRecord): void {
  if (record.validFrom && record.validTo && Date.parse(record.validFrom) > Date.parse(record.validTo)) {
    throw new Error('memory validFrom must not be after validTo')
  }
}

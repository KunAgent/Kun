import { agentMemoryVisible, type AgentMemoryAccess } from './agent-memory-scope.js'
import type { PendingMemoryCandidate } from '../contracts/memory-distillation-runtime.js'
import { commitMemoryDistillationCandidate } from './memory-distillation-apply.js'
import { withMemoryMutation } from './memory-mutation-queue.js'
import { readFile } from 'node:fs/promises'
import type { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import {
  MEMORY_DIRECTIVE_MAX_CONTENT_CHARS,
  MemoryDiagnostics,
  MemoryRecord,
  type MemoryAuthority,
  type MemoryCreateRequest,
  type MemoryRetrievalTrace,
  type MemoryType,
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
  canonicalMemoryHash,
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
  selectMemoryDirectives,
  type MemoryDirectiveResult
} from './memory-directives.js'
import {
  retrieveMemoryRecords,
  type MemoryRetrieveRequest
} from './memory-retrieval.js'

export interface MemoryStore {
  getById?(id: string, access?: MemoryAccess): Promise<MemoryRecord>
  create(input: MemoryCreateRequest): Promise<MemoryRecord>
  commitDistillation?(candidate: PendingMemoryCandidate): Promise<MemoryRecord>
  createWithId?(id: string, input: MemoryCreateRequest): Promise<MemoryRecord>
  update(id: string, patch: MemoryUpdateRequest, access?: MemoryAccess): Promise<MemoryRecord>
  delete(id: string, access?: MemoryAccess): Promise<MemoryRecord>
  purge?(id: string, access?: MemoryAccess): Promise<void>
  list(filter?: MemoryListFilter): Promise<MemoryRecord[]>
  listDirectives?(access?: MemoryAccess): Promise<MemoryDirectiveResult>
  retrieve(input: MemoryRetrieveRequest): Promise<MemoryRecord[]>
  diagnostics(policy?: MemoryCapabilityConfig): Promise<MemoryDiagnostics>
  setLastInjected(ids: string[]): void
  ready?(): Promise<void>
  shutdown?(): Promise<void>
}

export type MemoryAccess = { workspace?: string; project?: string; agent?: AgentMemoryAccess }
export type MemoryListFilter = MemoryAccess & {
  includeDeleted?: boolean
  all?: boolean
  limit?: number
  before?: { updatedAt: string; id: string }
  authority?: MemoryAuthority
  type?: MemoryType
}
export type { MemoryDirectiveResult }

export class FileMemoryStore implements MemoryStore {
  private lastInjectedIds: string[] = []
  private lastRetrieval: MemoryRetrievalTrace | undefined
  private lastDirectiveInjection: MemoryDirectiveResult | undefined

  constructor(
    private readonly options: {
      rootDir: string
      config: MemoryCapabilityConfig | (() => MemoryCapabilityConfig)
      nowIso?: () => string
      idGenerator?: () => string
      minConfidence?: number
    }
  ) {}

  async getById(id: string, access?: MemoryAccess): Promise<MemoryRecord> { return this.mustGet(id, access) }

  async create(input: MemoryCreateRequest): Promise<MemoryRecord> {
    return withMemoryMutation(this.options.rootDir, () => this.createRecord(
      this.options.idGenerator?.() ?? `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      input
    ))
  }

  async createWithId(id: string, input: MemoryCreateRequest): Promise<MemoryRecord> {
    return withMemoryMutation(this.options.rootDir, () => this.createWithIdNow(id, input))
  }

  private async createWithIdNow(id: string, input: MemoryCreateRequest): Promise<MemoryRecord> {
    const existing = await this.get(id)
    if (existing) {
      if (existing.agentContext?.agentId !== input.agentContext?.agentId || existing.agentContext?.sourceConversationId !== input.agentContext?.sourceConversationId || existing.agentContext?.originFingerprint !== input.agentContext?.originFingerprint || existing.agentContext?.sourceTaskId !== input.agentContext?.sourceTaskId || existing.agentContext?.sourceHandoffId !== input.agentContext?.sourceHandoffId) throw new Error('memory identity belongs to another scope')
      if (input.supersedes && existing.supersedes === input.supersedes) {
        const older = await this.mustGet(input.supersedes, {
          workspace: existing.workspace,
          project: existing.project, ...(existing.agentContext ? { agent: { agentId: existing.agentContext.agentId, manage: true } } : {})
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
      agentContext: input.agentContext,
      sourceThreadId: input.sourceThreadId,
      sourceTurnId: input.sourceTurnId,
      provenance,
      tags: input.tags ?? [],
      confidence: input.confidence ?? defaultMemoryConfidence(provenance.kind),
      createdAt: now,
      updatedAt: now,
      type: input.type,
      authority: input.authority,
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
    assertDirectiveConstraints(parsed)
    const older = input.supersedes
      ? await this.mustGet(input.supersedes, { workspace, project, ...(input.agentContext ? { agent: { agentId: input.agentContext.agentId, manage: true } } : {}) })
      : undefined
    if (older) {
      if (older.agentContext?.sourceConversationId !== parsed.agentContext?.sourceConversationId ||
        older.agentContext?.sourceTaskId !== parsed.agentContext?.sourceTaskId || older.agentContext?.sourceHandoffId !== parsed.agentContext?.sourceHandoffId) throw new Error('memory supersession cannot change visibility scope')
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
    return withMemoryMutation(this.options.rootDir, () => this.updateNow(id, patch, access))
  }

  private async updateNow(id: string, patch: MemoryUpdateRequest, access?: MemoryAccess): Promise<MemoryRecord> {
    const current = await this.mustGet(id, access)
    if (patch.agentContext && (!current.agentContext || patch.agentContext.agentId !== current.agentContext.agentId || patch.agentContext.sourceConversationId !== current.agentContext.sourceConversationId || !access?.agent?.manage)) throw new Error('memory ownership cannot change')
    const now = this.now()
    const corrected = patch.content !== undefined && patch.content !== current.content
    const next = MemoryRecord.parse({
      ...current,
      ...(patch.agentContext ? { agentContext: patch.agentContext } : {}),
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      ...(patch.confidence !== undefined ? { confidence: patch.confidence } : corrected ? { confidence: 1 } : {}),
      ...(patch.importance !== undefined ? { importance: patch.importance } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.authority !== undefined ? { authority: patch.authority } : {}),
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
    assertDirectiveConstraints(next)
    await this.write(next)
    return next
  }

  async delete(id: string, access?: MemoryAccess): Promise<MemoryRecord> {
    return withMemoryMutation(this.options.rootDir, () => this.deleteNow(id, access))
  }

  private async deleteNow(id: string, access?: MemoryAccess): Promise<MemoryRecord> {
    const current = await this.mustGet(id, access)
    const now = this.now()
    const next = MemoryRecord.parse({
      ...current,
      ...(current.agentContext && access?.agent?.manage && access.agent.operationId ? {
        agentContext: { ...current.agentContext, lastOperationId: access.agent.operationId }
      } : {}),
      deletedAt: current.deletedAt ?? now,
      updatedAt: now
    })
    await this.write(next)
    return next
  }

  async purge(id: string, access?: MemoryAccess): Promise<void> {
    await withMemoryMutation(this.options.rootDir, async () => {
      const record = await this.get(id)
      if (record && !agentMemoryVisible(record, access ?? {})) throw new Error('memory not found')
      await purgeCanonicalMemoryRecord(this.options.rootDir, id)
    })
  }

  async commitDistillation(candidate: PendingMemoryCandidate): Promise<MemoryRecord> {
    return withMemoryMutation(this.options.rootDir, () => commitMemoryDistillationCandidate({
      list: (filter) => this.list(filter),
      update: (id, patch, access) => this.updateNow(id, patch, access),
      createWithId: (id, input) => this.createWithIdNow(id, input)
    }, candidate, Date.parse(this.now())))
  }

  async list(filter: MemoryListFilter = {}): Promise<MemoryRecord[]> {
    const records = (await readCanonicalMemoryDirectory(this.options.rootDir)).records
    return records
      .filter((record) => filter.includeDeleted || !record.deletedAt)
      .filter((record) => !filter.authority || record.authority === filter.authority)
      .filter((record) => !filter.type || record.type === filter.type)
      .filter((record) => agentMemoryVisible(record, filter) && (filter.all || memoryInScope(record, filter)))
      .filter((record) => !filter.before || record.updatedAt < filter.before.updatedAt || record.updatedAt === filter.before.updatedAt && record.id > filter.before.id)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
      .slice(0, filter.limit ?? Infinity)
  }

  async listDirectives(access: MemoryAccess = {}): Promise<MemoryDirectiveResult> {
    const canonical = await readCanonicalMemoryDirectory(this.options.rootDir, {
      maxFiles: MEMORY_MAX_FALLBACK_FILES
    })
    const result = selectMemoryDirectives({
      records: canonical.records,
      access,
      policy: this.config(),
      nowMs: Date.parse(this.now())
    })
    this.lastDirectiveInjection = result
    return result
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
    if (input.purpose !== 'tool') {
      this.lastRetrieval = result.trace
      this.lastInjectedIds = [...result.trace.selectedIds]
    }
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
      lastRetrieval: this.lastRetrieval,
      directiveCount: canonical.records.filter((record) =>
        record.authority === 'directive' && memoryLifecycleState(record, nowMs) === 'active'
      ).length,
      ...(this.lastDirectiveInjection ? {
        lastDirectiveInjection: {
          ids: this.lastDirectiveInjection.records.map((record) => record.id),
          excludedByBudget: this.lastDirectiveInjection.excludedByBudget,
          truncatedIds: this.lastDirectiveInjection.truncatedIds,
          characters: this.lastDirectiveInjection.characters
        }
      } : {})
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
    if (!record || !agentMemoryVisible(record, access ?? {}) || (access && !memoryInScope(record, access))) throw new Error(`memory not found: ${id}`)
    if (access?.agent?.expectedFingerprint && canonicalMemoryHash(record) !== access.agent.expectedFingerprint) throw new Error('memory changed; reload before editing')
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

/** Re-validates the merged record so a patch cannot smuggle in a bad directive. */
function assertDirectiveConstraints(record: MemoryRecord): void {
  if (record.authority !== 'directive') return
  if (record.agentContext) throw new Error('agent-scoped memories cannot become directives')
  if (record.scope === 'project') throw new Error('project-scoped memories cannot become directives')
  if (record.content.length > MEMORY_DIRECTIVE_MAX_CONTENT_CHARS) {
    throw new Error(`directive content must be at most ${MEMORY_DIRECTIVE_MAX_CONTENT_CHARS} characters`)
  }
}

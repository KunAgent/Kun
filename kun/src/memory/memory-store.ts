import { memoryErasureOperationId, readMemoryErasureOperation, prepareMemoryErasureOperation, authorizeMemoryErasureRetry } from './memory-erasure-operations.js'
import { MemoryNotFoundError } from './memory-not-found-error.js'
import { MemoryLifecycleRequest, type MemoryLifecycleResult, type MemoryHistoryResult } from '../contracts/memory-lifecycle.js'
import { assertMemoryRevision, reviseMemory, rollbackMemory, MemoryRevisionConflictError } from './memory-revisions.js'
import { applyMemoryForgetting, assertMemoryNotForgotten, readMemoryForgetting, recordMemoryForgetting, memoryDescendants, memoryBlockedByForgetting } from './memory-forgetting.js'
import { projectIdentityForNewMemory, resolveMemoryProjectAccess } from './memory-project-identity.js'
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
  erasureReceipt?(operationId: string): Promise<string[]>
  isForgotten?(input: MemoryCreateRequest, id?: string): Promise<boolean>
  history?(id: string, access?: MemoryAccess): Promise<MemoryHistoryResult>
  lifecycle?(id: string, request: MemoryLifecycleRequest, access?: MemoryAccess): Promise<MemoryLifecycleResult>
  getById?(id: string, access?: MemoryAccess): Promise<MemoryRecord>
  create(input: MemoryCreateRequest): Promise<MemoryRecord>
  commitDistillation?(candidate: PendingMemoryCandidate): Promise<MemoryRecord>
  createWithId?(id: string, input: MemoryCreateRequest): Promise<MemoryRecord>
  update(id: string, patch: MemoryUpdateRequest, access?: MemoryAccess): Promise<MemoryRecord>
  delete(id: string, access?: MemoryAccess): Promise<MemoryRecord>
  purge?(id: string, access?: MemoryAccess): Promise<void>
  list(filter?: MemoryListFilter): Promise<MemoryRecord[]>
  /** `policy` overrides the store's own config so shared repositories honor live settings. */
  listDirectives?(access?: MemoryAccess, policy?: MemoryCapabilityConfig): Promise<MemoryDirectiveResult>
  retrieve(input: MemoryRetrieveRequest): Promise<MemoryRecord[]>
  diagnostics(policy?: MemoryCapabilityConfig): Promise<MemoryDiagnostics>
  setLastInjected(ids: string[]): void
  ready?(): Promise<void>
  shutdown?(): Promise<void>
}

export type MemoryAccess = { mutationOrigin?: 'inference'; workspace?: string; project?: string; projectIdentity?: string; agent?: AgentMemoryAccess }
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

  async erasureReceipt(operationId: string): Promise<string[]> {
    const ledger = await readMemoryForgetting(this.options.rootDir)
    const ids = ledger.barriers.filter((entry) => entry.erased && entry.operationId === operationId).map((entry) => entry.memoryId)
    for (const id of ids) await purgeCanonicalMemoryRecord(this.options.rootDir, id)
    return ids
  }

  async isForgotten(input: MemoryCreateRequest, id?: string): Promise<boolean> {
    return memoryBlockedByForgetting(await readMemoryForgetting(this.options.rootDir), input, id)
  }

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
      await assertMemoryNotForgotten(this.options.rootDir, existing, id)
      if (existing.agentContext?.agentId !== input.agentContext?.agentId || existing.agentContext?.sourceConversationId !== input.agentContext?.sourceConversationId || existing.agentContext?.originFingerprint !== input.agentContext?.originFingerprint || existing.agentContext?.sourceTaskId !== input.agentContext?.sourceTaskId || existing.agentContext?.sourceHandoffId !== input.agentContext?.sourceHandoffId) throw new Error('memory identity belongs to another scope')
      if (input.supersedes && existing.supersedes === input.supersedes) {
        const older = await this.mustGet(input.supersedes, {
          workspace: existing.workspace,
          project: existing.project, ...(existing.agentContext ? { agent: { agentId: existing.agentContext.agentId, manage: true } } : {})
        })
        if (!older.supersededAt) {
          const now = this.now()
          await this.write(reviseMemory(older, MemoryRecord.parse({ ...older, supersededAt: now, updatedAt: now }), 'supersede'))
        }
      }
      return existing
    }
    return this.createRecord(id, input)
  }

  async get(id: string, includeErased = false): Promise<MemoryRecord | undefined> {
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
    return result.ok ? includeErased ? result.record : applyMemoryForgetting(await readMemoryForgetting(this.options.rootDir), result.record) : undefined
  }

  private async createRecord(id: string, input: MemoryCreateRequest): Promise<MemoryRecord> {
    await assertMemoryNotForgotten(this.options.rootDir, input, id)
    const now = this.now()
    const scope = input.scope ?? 'workspace'
    const workspace = normalizeMemoryScopePath(input.workspace)
    const project = normalizeMemoryScopePath(input.project ?? (scope === 'project' ? input.workspace : undefined))
    const provenance = input.provenance ?? defaultProvenance(input)
    const older = input.supersedes
      ? await this.mustGet(input.supersedes, { workspace, project, ...(input.agentContext ? { agent: { agentId: input.agentContext.agentId, manage: true } } : {}) })
      : undefined
    const projectIdentity = await projectIdentityForNewMemory(input, older)
    const parsed = MemoryRecord.parse({
      id,
      ...(projectIdentity ? { projectIdentity } : {}),
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
      consolidation: input.consolidation,
      ...(input.expiresAt
        ? { expiresAt: input.expiresAt }
        : input.ttlMs
          ? { expiresAt: new Date(Date.parse(now) + input.ttlMs).toISOString() }
          : {}),
      ...(input.disabled ? { disabledAt: now } : {}),
      ...(input.supersedes ? { supersedes: input.supersedes } : {})
    })
    await assertMemoryNotForgotten(this.options.rootDir, parsed, id)
    assertValidInterval(parsed)
    assertDirectiveConstraints(parsed)
    if (older) {
      assertMemoryRevision(older, input.supersedesExpectedRevision)
      if (older.agentContext?.sourceConversationId !== parsed.agentContext?.sourceConversationId ||
        older.agentContext?.sourceTaskId !== parsed.agentContext?.sourceTaskId || older.agentContext?.sourceHandoffId !== parsed.agentContext?.sourceHandoffId) throw new Error('memory supersession cannot change visibility scope')
      if (older.scope !== parsed.scope) {
        throw new Error('a memory can only supersede another memory in the same scope')
      }
    }
    await this.write(parsed)
    if (older) {
      await this.write(reviseMemory(older, MemoryRecord.parse({ ...older, supersededAt: now, updatedAt: now }), 'supersede'))
    }
    return parsed
  }

  async update(id: string, patch: MemoryUpdateRequest, access?: MemoryAccess): Promise<MemoryRecord> {
    return withMemoryMutation(this.options.rootDir, () => this.updateNow(id, patch, access))
  }

  private async updateNow(id: string, patch: MemoryUpdateRequest, access?: MemoryAccess): Promise<MemoryRecord> {
    const current = await this.mustGet(id, access)
    assertMemoryRevision(current, patch.expectedRevision)
    if (current.deletedAt) throw new MemoryRevisionConflictError('forgotten memories cannot be edited')
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
      ...(patch.consolidation !== undefined ? { consolidation: patch.consolidation } : {}),
      ...(corrected ? {
        correctedFrom: current.correctedFrom ?? current.content,
        provenance: access?.mutationOrigin === 'inference' ? current.provenance : { ...(current.provenance ?? defaultLegacyProvenance(current)), kind: 'user' }
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
    await assertMemoryNotForgotten(this.options.rootDir, next, id)
    const revised = reviseMemory(current, next, patch.disabled === true ? 'disable' : patch.disabled === false ? 'restore' : 'update')
    await this.write(revised)
    return revised
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
    const affected = memoryDescendants((await readCanonicalMemoryDirectory(this.options.rootDir)).records, id)
    await recordMemoryForgetting(this.options.rootDir, affected, false, now)
    const revised = reviseMemory(current, next, 'forget')
    for (const record of affected) {
      await this.write(record.id === id ? revised : reviseMemory(record,
        MemoryRecord.parse({ ...record, deletedAt: now, updatedAt: now }), 'forget'))
    }
    this.setLastInjected([])
    this.lastDirectiveInjection = undefined
    return revised
  }

  async history(id: string, access?: MemoryAccess): Promise<MemoryHistoryResult> {
    const memory = await this.mustGet(id, access)
    return { memoryId: id, revision: memory.revision, history: memory.history }
  }

  async lifecycle(id: string, raw: MemoryLifecycleRequest, access?: MemoryAccess): Promise<MemoryLifecycleResult> {
    const request = MemoryLifecycleRequest.parse(raw)
    return withMemoryMutation(this.options.rootDir, async () => {
      if (access) access = await resolveMemoryProjectAccess(access)
      const operationId = memoryErasureOperationId(id, request.expectedRevision, access)
      let current: MemoryRecord
      try { current = await this.mustGet(id, access, request.action === 'erase') }
      catch (error) {
        if (request.action !== 'erase') throw error
        const receipt = await readMemoryErasureOperation(this.options.rootDir, operationId)
        if (!receipt) throw error
        authorizeMemoryErasureRetry(receipt, id, request, access)
        const ledger = await readMemoryForgetting(this.options.rootDir)
        const approved = new Set(ledger.barriers.filter((entry) => entry.erased && entry.operationId === operationId).map((entry) => entry.memoryId))
        if (!approved.has(id) || receipt.affectedIds.some((affectedId) => !approved.has(affectedId))) throw error
        for (const affectedId of receipt.affectedIds) await purgeCanonicalMemoryRecord(this.options.rootDir, affectedId)
        return { erased: true, affectedIds: receipt.affectedIds }
      }
      assertMemoryRevision(current, request.expectedRevision)
      if (request.action === 'disable' || request.action === 'restore') {
        return { memory: await this.updateNow(id, { disabled: request.action === 'disable',
          expectedRevision: request.expectedRevision }, access), erased: false, affectedIds: [id] }
      }
      if (request.action === 'rollback') {
        const rolledBack = rollbackMemory(current, request.targetRevision!, this.now())
        const memory = MemoryRecord.parse({ ...rolledBack, ...(rolledBack.agentContext && access?.agent?.operationId ? {
          agentContext: { ...rolledBack.agentContext, lastOperationId: access.agent.operationId }
        } : {}) })
        await assertMemoryNotForgotten(this.options.rootDir, memory, id)
        assertDirectiveConstraints(memory)
        await this.write(memory)
        return { memory, erased: false, affectedIds: [id] }
      }
      const visible = (await readCanonicalMemoryDirectory(this.options.rootDir)).records
      const affected = memoryDescendants([...visible.filter((record) => record.id !== id), current], id)
      if (request.action === 'forget') {
        return { memory: await this.deleteNow(id, access), erased: false, affectedIds: affected.map((record) => record.id) }
      }
      if (request.confirmation?.memoryId !== id || !request.confirmation.irreversible) {
        throw new MemoryRevisionConflictError('confirm the exact memory before irreversible erasure')
      }
      await prepareMemoryErasureOperation(this.options.rootDir, operationId, current, affected.map((record) => record.id), this.now())
      await recordMemoryForgetting(this.options.rootDir, affected, true, this.now(), operationId)
      for (const record of affected) await purgeCanonicalMemoryRecord(this.options.rootDir, record.id)
      this.setLastInjected([])
      this.lastRetrieval = undefined
      this.lastDirectiveInjection = undefined
      return { erased: true, affectedIds: affected.map((record) => record.id) }
    })
  }

  async purge(id: string, access?: MemoryAccess): Promise<void> {
    await withMemoryMutation(this.options.rootDir, async () => {
      const record = await this.get(id)
      if (record && !agentMemoryVisible(record, access ?? {})) throw new MemoryNotFoundError()
      await purgeCanonicalMemoryRecord(this.options.rootDir, id)
    })
  }

  async commitDistillation(candidate: PendingMemoryCandidate): Promise<MemoryRecord> {
    return withMemoryMutation(this.options.rootDir, () => commitMemoryDistillationCandidate({
      list: (filter) => this.list(filter),
      update: (id, patch, access) => this.updateNow(id, patch, { ...access, mutationOrigin: 'inference' }),
      createWithId: (id, input) => this.createWithIdNow(id, input)
    }, candidate, Date.parse(this.now())))
  }

  async list(filter: MemoryListFilter = {}): Promise<MemoryRecord[]> {
    filter = await resolveMemoryProjectAccess(filter)
    const records = (await readCanonicalMemoryDirectory(this.options.rootDir)).records
    return records
      .filter((record) => filter.includeDeleted || !record.deletedAt)
      .filter((record) => !filter.authority || record.authority === filter.authority)
      .filter((record) => !filter.type || record.type === filter.type)
      .filter((record) => agentMemoryVisible(record, filter) && (filter.all || memoryInScope(record, filter)))
      .filter((record) => !filter.before || record.updatedAt < filter.before.updatedAt || record.updatedAt === filter.before.updatedAt && record.id > filter.before.id)
      // Match SQLite BINARY ordering and the keyset predicate even for mixed-case IDs.
      .sort((left, right) => left.updatedAt === right.updatedAt
        ? left.id < right.id ? -1 : left.id > right.id ? 1 : 0
        : left.updatedAt > right.updatedAt ? -1 : 1)
      .slice(0, filter.limit ?? Infinity)
  }

  async listDirectives(
    access: MemoryAccess = {},
    policy: MemoryCapabilityConfig = this.config()
  ): Promise<MemoryDirectiveResult> {
    access = await resolveMemoryProjectAccess(access)
    const canonical = await readCanonicalMemoryDirectory(this.options.rootDir, {
      maxFiles: MEMORY_MAX_FALLBACK_FILES
    })
    const result = selectMemoryDirectives({
      records: canonical.records,
      access,
      policy,
      nowMs: Date.parse(this.now())
    })
    this.lastDirectiveInjection = result
    return result
  }

  async retrieve(input: MemoryRetrieveRequest): Promise<MemoryRecord[]> {
    input = await resolveMemoryProjectAccess(input)
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

  private async mustGet(id: string, access?: MemoryAccess, includeErased = false): Promise<MemoryRecord> {
    if (access) access = await resolveMemoryProjectAccess(access)
    const record = await this.get(id, includeErased)
    if (!record || !agentMemoryVisible(record, access ?? {}) || (access && !memoryInScope(record, access))) throw new MemoryNotFoundError()
    if (access?.agent?.expectedFingerprint && canonicalMemoryHash(record) !== access.agent.expectedFingerprint) throw new MemoryRevisionConflictError()
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

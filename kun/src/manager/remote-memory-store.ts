import { MemoryRelationResult, type MemoryRelationCommand } from '../contracts/memory-relations.js'
import { MemoryRelationContextResult, emptyMemoryRelationContext, type MemoryRelationContextRequest } from '../contracts/memory-working-context.js'
import { MemoryErasureIncompleteError } from '../memory/memory-erasure-error.js'
import { MemoryLifecycleResult, MemoryHistoryResult, type MemoryLifecycleRequest } from '../contracts/memory-lifecycle.js'
import { MemoryRevisionConflictError } from '../memory/memory-revisions.js'
import type { PendingMemoryCandidate } from '../contracts/memory-distillation-runtime.js'
import { MemoryDistillationCommitResult } from '../contracts/memory-distillation-storage.js'
import { MemoryDistillationConflictError } from '../memory/memory-distillation-apply.js'
import { z } from 'zod'
import type { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import {
  MemoryDiagnostics,
  MemoryRecord,
  type MemoryCreateRequest,
  type MemoryUpdateRequest
} from '../contracts/memory.js'
import type { MemoryAccess, MemoryListFilter, MemoryStore } from '../memory/memory-store.js'
import type { MemoryRetrieveRequest } from '../memory/memory-retrieval.js'
import type { ServiceManagerConnection } from './manager-client.js'
import { callManagerStore } from './remote-data-store-request.js'

const MemoryDirectiveResultSchema = z.object({
  records: z.array(MemoryRecord),
  excludedByBudget: z.array(z.string()),
  truncatedIds: z.array(z.string()),
  characters: z.number().int().nonnegative()
}).strict()

export class ManagerRemoteMemoryStore implements MemoryStore {
  private lastInjectedIds: string[] = []

  async relationContext(request: MemoryRelationContextRequest): Promise<MemoryRelationContextResult> {
    if (!this.config.enabled || (request.purpose === 'injection' && !this.config.relationContextEnabled)) {
      return emptyMemoryRelationContext()
    }
    return MemoryRelationContextResult.parse(await this.call('relationContext', request))
  }

  async relations(command: MemoryRelationCommand): Promise<MemoryRelationResult> {
    return MemoryRelationResult.parse(await this.call('relations', command))
  }

  constructor(
    private readonly manager: ServiceManagerConnection,
    private readonly config: MemoryCapabilityConfig
  ) {}

  async commitDistillation(candidate: PendingMemoryCandidate): Promise<MemoryRecord> {
    const result = MemoryDistillationCommitResult.parse(await this.call('commitDistillation', candidate))
    if (!result.ok) throw new MemoryDistillationConflictError(result.conflict)
    return result.record
  }

  async erasureReceipt(operationId: string): Promise<string[]> {
    return z.array(z.string()).parse(await this.call('erasureReceipt', { operationId }))
  }

  async isForgotten(input: MemoryCreateRequest, id?: string): Promise<boolean> {
    return z.boolean().parse(await this.call('isForgotten', { input: {
      content: input.content, scope: input.scope, workspace: input.workspace, project: input.project,
      agentContext: input.agentContext, sources: input.sources, consolidation: input.consolidation, supersedes: input.supersedes
    }, id }))
  }

  async history(id: string, access?: MemoryAccess) {
    return MemoryHistoryResult.parse(await this.call('history', { id, access }))
  }

  async lifecycle(id: string, request: MemoryLifecycleRequest, access?: MemoryAccess) {
    const result = z.discriminatedUnion('ok', [
      z.object({ ok: z.literal(true), result: MemoryLifecycleResult }),
      z.object({ ok: z.literal(false), conflict: z.string(), incomplete: z.boolean().optional() })
    ]).parse(await this.call('lifecycle', { id, request, access }))
    if (!result.ok) {
      if (result.incomplete) throw new MemoryErasureIncompleteError()
      throw new MemoryRevisionConflictError(result.conflict)
    }
    return result.result
  }

  async getById(id: string, access?: MemoryAccess): Promise<MemoryRecord> {
    return MemoryRecord.parse(await this.call('getById', { id, access }))
  }

  async create(input: MemoryCreateRequest) {
    return MemoryRecord.parse(await this.call('create', input))
  }

  async createWithId(id: string, input: MemoryCreateRequest) {
    return MemoryRecord.parse(await this.call('createWithId', { id, input }))
  }

  async update(id: string, patch: MemoryUpdateRequest, access?: MemoryAccess) {
    return MemoryRecord.parse(await this.call('update', { id, patch, access }))
  }

  async delete(id: string, access?: MemoryAccess) {
    return MemoryRecord.parse(await this.call('delete', { id, access }))
  }

  async purge(id: string, access?: MemoryAccess): Promise<void> {
    await this.call('purge', { id, access })
  }

  async list(filter: MemoryListFilter = {}) {
    return MemoryRecord.array().parse(await this.call('list', filter))
  }

  async listDirectives(access: MemoryAccess = {}) {
    return MemoryDirectiveResultSchema.parse(await this.call('listDirectives', access))
  }

  async retrieve(input: MemoryRetrieveRequest) {
    return MemoryRecord.array().parse(await this.call('retrieve', input))
  }

  async diagnostics() {
    const diagnostics = MemoryDiagnostics.parse(await this.call('diagnostics', {}))
    return diagnostics.lastInjectedIds.length > 0 || this.lastInjectedIds.length === 0
      ? diagnostics
      : { ...diagnostics, lastInjectedIds: [...this.lastInjectedIds] }
  }

  setLastInjected(ids: string[]): void {
    this.lastInjectedIds = [...ids]
  }

  private call(operation: string, value?: unknown): Promise<unknown> {
    return callManagerStore(this.manager, 'memory', operation, {
      config: this.config,
      value: value ?? {}
    })
  }
}

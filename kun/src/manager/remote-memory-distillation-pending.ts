import { z } from 'zod'
import type { ServiceManagerConnection } from './manager-client.js'
import { PendingMemoryCandidate } from '../contracts/memory-distillation-runtime.js'
import type { MemoryDistillationPendingStorePort } from '../memory/memory-distillation-pending-store.js'
import { callManagerStore } from './remote-data-store-request.js'

export class ManagerRemoteMemoryDistillationPendingStore implements MemoryDistillationPendingStorePort {
  constructor(private readonly manager: ServiceManagerConnection) {}

  async ready(): Promise<void> { await this.call({ operation: 'ready' }) }
  async beginRun(threadId: string, turnId: string): Promise<boolean> {
    return z.boolean().parse(await this.call({ operation: 'beginRun', threadId, turnId }))
  }
  async completeRun(...[threadId, turnId, inserts]: Parameters<MemoryDistillationPendingStorePort['completeRun']>) {
    return PendingMemoryCandidate.array().parse(await this.call({ operation: 'completeRun', threadId, turnId, inserts }))
  }
  async failRun(threadId: string, turnId: string, diagnostic: string): Promise<void> {
    await this.call({ operation: 'failRun', threadId, turnId, diagnostic })
  }
  async list(input: Parameters<MemoryDistillationPendingStorePort['list']>[0] = {}) {
    return PendingMemoryCandidate.array().parse(await this.call({ operation: 'list', ...input }))
  }
  async get(id: string) {
    return PendingMemoryCandidate.nullable().parse(await this.call({ operation: 'get', id }))
  }
  async transition(...[id, from, to, options = {}]: Parameters<MemoryDistillationPendingStorePort['transition']>) {
    return PendingMemoryCandidate.parse(await this.call({ operation: 'transition', id, from, to, options }))
  }
  async expireDue(): Promise<number> {
    return z.number().int().nonnegative().parse(await this.call({ operation: 'expireDue' }))
  }
  private call(value: unknown): Promise<unknown> {
    return callManagerStore(this.manager, 'memory', 'distillationPending', { value })
  }
}

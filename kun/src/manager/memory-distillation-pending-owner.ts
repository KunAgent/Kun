import { MemoryDistillationPendingRequest } from '../contracts/memory-distillation-storage.js'
import { MemoryDistillationPendingStore } from '../memory/memory-distillation-pending-store.js'

/** One ledger and one startup recovery per Manager, shared by all runtime flavors. */
export class ManagerMemoryDistillationPendingOwner {
  private readonly pending: MemoryDistillationPendingStore
  private readyPromise: Promise<void> | undefined

  constructor(dataDir: string) {
    this.pending = new MemoryDistillationPendingStore({ dataDir })
  }

  async execute(value: unknown): Promise<unknown> {
    const request = MemoryDistillationPendingRequest.parse(value)
    // A runtime reconnect must not mark another live runtime's extraction failed.
    this.readyPromise ??= this.pending.ready().catch((error) => {
      this.readyPromise = undefined
      throw error
    })
    await this.readyPromise
    switch (request.operation) {
      case 'ready': return null
      case 'beginRun': return this.pending.beginRun(request.threadId, request.turnId)
      case 'completeRun': return this.pending.completeRun(request.threadId, request.turnId, request.inserts)
      case 'failRun':
        await this.pending.failRun(request.threadId, request.turnId, request.diagnostic)
        return null
      case 'list': return this.pending.list(request)
      case 'get': return this.pending.get(request.id)
      case 'transition': return this.pending.transition(request.id, request.from, request.to, request.options)
      case 'expireDue': return this.pending.expireDue()
    }
  }
}

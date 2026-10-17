import { z } from 'zod'
import { stripThreadItemBodies } from '../adapters/hybrid/hybrid-thread-projection.js'
import { restoreThreadBodies } from './thread-metadata-write.js'
import { ThreadSchema, ThreadSchemaReadable, ThreadSummarySchema, type ThreadRecord } from '../contracts/threads.js'
import { ThreadIndexStatusInfoSchema } from '../contracts/thread-index-status.js'
import type { ThreadStore, ThreadStoreListOptions, ThreadStoreListPage } from '../ports/thread-store.js'
import type { ServiceManagerConnection } from './manager-client.js'
import { callManagerStore } from './remote-data-store-request.js'

const ThreadStoreListPageSchema: z.ZodType<ThreadStoreListPage> = z.object({
  threads: z.array(ThreadSummarySchema),
  nextCursor: z.string().optional(),
  hasMore: z.boolean(),
  total: z.number().int().nonnegative().optional(),
  indexStatus: ThreadIndexStatusInfoSchema.optional()
}).strict()

export class ManagerRemoteThreadStore implements ThreadStore {
  constructor(private readonly manager: ServiceManagerConnection) {}

  async list(options: ThreadStoreListOptions = {}) {
    return ThreadSummarySchema.array().parse(await this.call('list', options))
  }

  async listPage(options: ThreadStoreListOptions = {}) {
    return ThreadStoreListPageSchema.parse(await this.call('listPage', options))
  }

  async hasHistoryReference(referenceId: string) {
    return z.boolean().parse(await this.call('hasHistoryReference', { referenceId }))
  }

  async get(threadId: string) {
    return ThreadSchemaReadable.nullable().parse(await this.call('get', { threadId }))
  }

  async getMetadata(threadId: string) {
    return ThreadSchemaReadable.nullable().parse(await this.call('getMetadata', { threadId }))
  }

  async touch(threadId: string, updatedAt: string) {
    return z.boolean().parse(await this.call('touch', { threadId, updatedAt }))
  }

  async upsert(thread: ThreadRecord) {
    const stored = ThreadSchema.parse(await this.call('upsert', {
      thread: stripThreadItemBodies(thread), metadataOnly: true
    }))
    return restoreThreadBodies(stored, thread)
  }

  async upsertIfRevision(thread: ThreadRecord, expectedRevision: number) {
    const result = z.object({
      applied: z.boolean(),
      thread: ThreadSchema.optional(),
      revision: z.number().int().nonnegative()
    }).strict().parse(await this.call('upsertIfRevision', {
      thread: stripThreadItemBodies(thread), expectedRevision, metadataOnly: true
    }))
    return result.thread ? { ...result, thread: restoreThreadBodies(result.thread, thread) } : result
  }

  async delete(threadId: string) {
    return z.boolean().parse(await this.call('delete', { threadId }))
  }

  async deleteByWorkspace(workspace: string) {
    return z.string().array().parse(await this.call('deleteByWorkspace', { workspace }))
  }

  private call(operation: string, value?: unknown): Promise<unknown> {
    return callManagerStore(this.manager, 'thread', operation, value)
  }
}

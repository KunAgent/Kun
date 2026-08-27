import type {
  ThreadStore,
  ThreadStoreConditionalWrite,
  ThreadStoreListOptions
} from '../ports/thread-store.js'
import {
  ThreadSchema,
  ThreadSchemaReadable,
  type ThreadRecord,
  type ThreadSummary
} from '../contracts/threads.js'
import { toThreadSummary } from '../domain/thread.js'

/**
 * In-memory thread store. Used by tests and the file-backed
 * implementation is layered on top in section 3.4.
 */
export class InMemoryThreadStore implements ThreadStore {
  private readonly threads = new Map<string, ThreadRecord>()

  async list(_options?: ThreadStoreListOptions): Promise<ThreadSummary[]> {
    return [...this.threads.values()]
      .map(toThreadSummary)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async get(threadId: string): Promise<ThreadRecord | null> {
    return this.threads.get(threadId) ?? null
  }

  async upsert(thread: ThreadRecord): Promise<ThreadRecord> {
    const current = this.threads.get(thread.id)
    const normalized = this.normalize({ ...thread, revision: (current?.revision ?? -1) + 1 })
    this.threads.set(normalized.id, normalized)
    return normalized
  }

  async upsertIfRevision(
    thread: ThreadRecord,
    expectedRevision: number
  ): Promise<ThreadStoreConditionalWrite> {
    const current = this.threads.get(thread.id)
    const revision = current?.revision ?? 0
    if (!current || revision !== expectedRevision) return { applied: false, revision }
    const normalized = this.normalize({ ...thread, revision: revision + 1 })
    this.threads.set(normalized.id, normalized)
    return { applied: true, thread: normalized, revision: normalized.revision ?? revision + 1 }
  }

  private normalize(thread: ThreadRecord): ThreadRecord {
    const strict = ThreadSchema.safeParse(thread)
    if (strict.success) return strict.data
    // Legacy half-bound plan-build records are tolerated for read/repair
    // paths exactly like the file and hybrid stores: a test (or a migration
    // import) may need to seed the pre-fix malformed shape to exercise the
    // CAS backfill flow. New writes still fail via the service-layer callers.
    const readable = ThreadSchemaReadable.safeParse(thread)
    if (readable.success) return readable.data
    throw strict.error
  }

  async delete(threadId: string): Promise<boolean> {
    return this.threads.delete(threadId)
  }

  async deleteByWorkspace(workspace: string): Promise<string[]> {
    const ids = [...this.threads.values()]
      .filter((thread) => thread.workspace === workspace)
      .map((thread) => thread.id)
    for (const id of ids) this.threads.delete(id)
    return ids
  }
}

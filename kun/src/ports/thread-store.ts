import type { ThreadRecord, ThreadSummary } from '../contracts/threads.js'
import type { ThreadIndexStatusInfo } from '../contracts/thread-index-status.js'

export type ThreadStoreConditionalWrite = {
  applied: boolean
  /** Durable record after a successful conditional write. */
  thread?: ThreadRecord
  /** Durable revision observed when the expected revision was stale. */
  revision: number
}

export type ThreadStoreListOptions = {
  limit?: number
  search?: string
  includeArchived?: boolean
  archivedOnly?: boolean
  includeSide?: boolean
  /** Opaque keyset cursor for stable pagination (base64 of `(updatedAt,id)`). */
  cursor?: string
  /** Filter by workspace root path. */
  workspace?: string
}

/**
 * Result of a paginated thread listing. `nextCursor` is present when more
 * matching threads exist after this page; `total` is only populated on the
 * first page (no cursor) for workspace counts.
 */
export type ThreadStoreListPage = {
  threads: ThreadSummary[]
  nextCursor?: string
  hasMore: boolean
  total?: number
  /** Rebuildable index progress, present when the store exposes it. */
  indexStatus?: ThreadIndexStatusInfo
}

/**
 * Port for persistent thread storage. Implementations use a JSONL
 * messages log plus a queryable index; the in-memory implementation is
 * used by tests.
 */
export interface ThreadStore {
  list(options?: ThreadStoreListOptions): Promise<ThreadSummary[]>
  /** Read a stable keyset page when the backing store supports pagination. */
  listPage?(options?: ThreadStoreListOptions): Promise<ThreadStoreListPage>
  /** Rebuildable index lifecycle/progress; `unavailable` when no index exists. */
  indexStatus?(): ThreadIndexStatusInfo
  get(threadId: string): Promise<ThreadRecord | null>
  /** Read the durable Thread/Turn projection without hydrating item history. */
  getMetadata?(threadId: string): Promise<ThreadRecord | null>
  /** Update only rebuildable Thread metadata, without hydrating item history. */
  touch?(threadId: string, updatedAt: string): Promise<boolean>
  upsert(thread: ThreadRecord): Promise<ThreadRecord>
  /** Atomically replace a record only when its durable revision still matches. */
  upsertIfRevision?(thread: ThreadRecord, expectedRevision: number): Promise<ThreadStoreConditionalWrite>
  delete(threadId: string): Promise<boolean>
  deleteByWorkspace?(workspace: string): Promise<string[]>
}

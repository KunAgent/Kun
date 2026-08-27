import type { RuntimeEvent } from '../contracts/events.js'
import type { TurnItem } from '../contracts/items.js'
import type { AgentSession } from '../domain/session.js'
import type {
  ItemHistoryCommit,
  ItemHistorySnapshot,
  SessionStore,
  SessionLatestUsageSnapshot,
  SessionUsageRecord
} from '../ports/session-store.js'
import type {
  ThreadStore,
  ThreadStoreConditionalWrite,
  ThreadStoreListOptions,
  ThreadStoreListPage
} from '../ports/thread-store.js'
import type { ThreadRecord, ThreadSummary } from '../contracts/threads.js'

/**
 * A per-thread generation fence for destructive lifecycle transitions.
 *
 * A writer captures a lease before it begins. Deletion closes the fence and
 * advances the generation, which makes every outstanding lease stale. The
 * deleter then waits for those leases to settle before removing the canonical
 * files. This prevents a delayed append/upsert from recreating a just-deleted
 * thread directory.
 */
export type ThreadLifecycleLease = {
  readonly threadId: string
  readonly generation: number
  isCurrent(): boolean
  release(): void
}

type ThreadLifecycleState = {
  generation: number
  closing: boolean
  deleted: boolean
  activeLeases: number
  drainWaiters: Array<() => void>
}

export class ThreadLifecycleFence {
  private readonly states = new Map<string, ThreadLifecycleState>()

  acquire(threadId: string): ThreadLifecycleLease | null {
    const state = this.stateFor(threadId)
    if (state.closing) return null

    const generation = state.generation
    state.activeLeases += 1
    let released = false
    return {
      threadId,
      generation,
      isCurrent: () => !released && this.isGenerationCurrent(threadId, generation),
      release: () => {
        if (released) return
        released = true
        this.release(threadId)
      }
    }
  }

  /** Refuse future writes and invalidate every previously-issued lease. */
  beginClose(threadId: string): void {
    const state = this.stateFor(threadId)
    if (state.closing) return
    state.closing = true
    state.generation += 1
  }

  isClosing(threadId: string): boolean {
    return this.states.get(threadId)?.closing ?? false
  }

  /** True only after the raw destructive delete has succeeded. */
  isDeleted(threadId: string): boolean {
    return this.states.get(threadId)?.deleted ?? false
  }

  /** Keep the fence closed after a raw delete, including callback failures. */
  markDeleted(threadId: string): void {
    const state = this.stateFor(threadId)
    state.closing = true
    state.deleted = true
  }

  /** Wait for writes that began before the current close to finish. */
  async drain(threadId: string): Promise<void> {
    const state = this.states.get(threadId)
    if (!state || state.activeLeases === 0) return
    await new Promise<void>((resolve) => state.drainWaiters.push(resolve))
  }

  /** Start a fresh generation after a successful explicit thread creation. */
  reopen(threadId: string): void {
    const state = this.stateFor(threadId)
    state.generation += 1
    state.closing = false
    state.deleted = false
  }

  private stateFor(threadId: string): ThreadLifecycleState {
    let state = this.states.get(threadId)
    if (!state) {
      state = {
        generation: 0,
        closing: false,
        deleted: false,
        activeLeases: 0,
        drainWaiters: []
      }
      this.states.set(threadId, state)
    }
    return state
  }

  private isGenerationCurrent(threadId: string, generation: number): boolean {
    const state = this.states.get(threadId)
    return Boolean(state && !state.closing && state.generation === generation)
  }

  private release(threadId: string): void {
    const state = this.states.get(threadId)
    if (!state) return
    state.activeLeases = Math.max(0, state.activeLeases - 1)
    if (state.activeLeases !== 0) return
    for (const resolve of state.drainWaiters.splice(0)) resolve()
  }
}

/**
 * Writes through this facade become harmless once a thread is closing. Reads
 * deliberately keep using the raw store so the delete service can still make
 * its decision from the durable state.
 */
export class LifecycleFencedThreadStore implements ThreadStore {
  readonly getMetadata?: (threadId: string) => Promise<ThreadRecord | null>
  readonly touch?: (threadId: string, updatedAt: string) => Promise<boolean>
  readonly deleteByWorkspace?: (workspace: string) => Promise<string[]>

  constructor(
    readonly raw: ThreadStore,
    private readonly fence: ThreadLifecycleFence
  ) {
    if (raw.getMetadata) {
      this.getMetadata = (threadId) => raw.getMetadata!(threadId)
    }
    if (raw.touch) {
      this.touch = (threadId, updatedAt) =>
        this.write(threadId, false, () => raw.touch!(threadId, updatedAt))
    }
    if (raw.deleteByWorkspace) {
      this.deleteByWorkspace = (workspace) => raw.deleteByWorkspace!(workspace)
    }
  }

  list(options?: ThreadStoreListOptions): Promise<ThreadSummary[]> {
    return this.raw.list(options)
  }

  async listPage(options?: ThreadStoreListOptions): Promise<ThreadStoreListPage> {
    const rawListPage = this.raw.listPage
    if (typeof rawListPage === 'function') return rawListPage.call(this.raw, options)
    const threads = await this.raw.list(options)
    const pageSize = typeof options?.limit === 'number' ? Math.max(1, Math.floor(options.limit)) : threads.length
    const page = threads.slice(0, pageSize)
    return {
      threads: page,
      hasMore: threads.length > pageSize,
      ...(options?.cursor ? {} : { total: threads.length })
    }
  }

  get(threadId: string): Promise<ThreadRecord | null> {
    return this.raw.get(threadId)
  }

  async upsert(thread: ThreadRecord): Promise<ThreadRecord> {
    const lease = this.fence.acquire(thread.id)
    if (!lease) return thread
    try {
      if (!lease.isCurrent()) return thread
      const stored = await this.raw.upsert(thread)
      // A close that raced an in-flight raw write is handled by drain() before
      // deletion removes the files. Return a harmless value to callers rather
      // than allowing that stale generation to drive another write.
      return lease.isCurrent() ? stored : thread
    } finally {
      lease.release()
    }
  }

  async upsertIfRevision(
    thread: ThreadRecord,
    expectedRevision: number
  ): Promise<ThreadStoreConditionalWrite> {
    return this.write(thread.id, { applied: false, revision: expectedRevision }, () =>
      this.raw.upsertIfRevision!(thread, expectedRevision))
  }

  /**
   * ThreadService must use `raw.delete()` after closing and draining the
   * fence. This passthrough exists only because ThreadStore has a delete
   * method and legacy test adapters expose the same shape.
   */
  delete(threadId: string): Promise<boolean> {
    return this.raw.delete(threadId)
  }

  private async write<T>(threadId: string, noOp: T, operation: () => Promise<T>): Promise<T> {
    const lease = this.fence.acquire(threadId)
    if (!lease) return noOp
    try {
      if (!lease.isCurrent()) return noOp
      const result = await operation()
      return lease.isCurrent() ? result : noOp
    } finally {
      lease.release()
    }
  }
}

/** Session writes use the same lifecycle lease as metadata writes. */
export class LifecycleFencedSessionStore implements SessionStore {
  readonly allocateEventSeq?: (threadId: string) => Promise<number>
  readonly iterateEventsSince?: (
    threadId: string,
    sinceSeq: number,
    options?: { maxRecordBytes?: number }
  ) => AsyncIterable<RuntimeEvent>
  readonly watchEventsSince?: (
    threadId: string,
    sinceSeq: number,
    signal: AbortSignal
  ) => AsyncIterable<RuntimeEvent>
  readonly loadUsageRecords?: (options?: { threadId?: string }) => Promise<SessionUsageRecord[]>
  readonly loadLatestUsageSnapshots?: (options?: { threadIds?: string[] }) => Promise<SessionLatestUsageSnapshot[]>
  readonly compactItems?: SessionStore['compactItems']
  readonly scheduleItemHistoryCompaction?: SessionStore['scheduleItemHistoryCompaction']
  readonly scheduleUsageEventCompaction?: SessionStore['scheduleUsageEventCompaction']
  readonly flushScheduledCompaction?: SessionStore['flushScheduledCompaction']
  readonly loadItemPage?: SessionStore['loadItemPage']
  readonly searchItemText?: SessionStore['searchItemText']
  readonly trimEventsFromSeq?: SessionStore['trimEventsFromSeq']

  constructor(
    readonly raw: SessionStore,
    private readonly fence: ThreadLifecycleFence
  ) {
    // Preserve the raw adapter's optional capability shape. In particular,
    // FileSessionStore has no indexed usage query, so exposing an empty stub
    // here would incorrectly disable its normal replay fallback.
    if (raw.iterateEventsSince) {
      this.iterateEventsSince = (threadId, sinceSeq, options) =>
        raw.iterateEventsSince!(threadId, sinceSeq, options)
    }
    if (raw.allocateEventSeq) {
      this.allocateEventSeq = (threadId) => raw.allocateEventSeq!(threadId)
    }
    if (raw.watchEventsSince) {
      this.watchEventsSince = (threadId, sinceSeq, signal) =>
        raw.watchEventsSince!(threadId, sinceSeq, signal)
    }
    if (raw.loadUsageRecords) {
      this.loadUsageRecords = (options) => raw.loadUsageRecords!(options)
    }
    if (raw.loadLatestUsageSnapshots) {
      this.loadLatestUsageSnapshots = (options) => raw.loadLatestUsageSnapshots!(options)
    }
    if (raw.searchItemText) {
      // Read-only and lock-free by contract, so it takes no lifecycle lease.
      this.searchItemText = (threadId, query, options) =>
        raw.searchItemText!(threadId, query, options)
    }
    if (raw.compactItems) {
      this.compactItems = (threadId, options) =>
        this.write(threadId, {
          compacted: false,
          beforeBytes: 0,
          afterBytes: 0,
          itemCount: 0
        }, () => raw.compactItems!(threadId, options))
    }
    if (raw.scheduleItemHistoryCompaction) {
      this.scheduleItemHistoryCompaction = (threadId) =>
        raw.scheduleItemHistoryCompaction!(threadId)
    }
    if (raw.scheduleUsageEventCompaction) {
      this.scheduleUsageEventCompaction = (threadId) =>
        raw.scheduleUsageEventCompaction!(threadId)
    }
    if (raw.flushScheduledCompaction) {
      this.flushScheduledCompaction = (threadId) =>
        raw.flushScheduledCompaction!(threadId)
    }
    if (raw.loadItemPage) {
      this.loadItemPage = (threadId, options) => raw.loadItemPage!(threadId, options)
    }
    if (raw.trimEventsFromSeq) {
      this.trimEventsFromSeq = (threadId, fromSeqInclusive) =>
        this.write(threadId, { afterBytes: 0 }, () => raw.trimEventsFromSeq!(threadId, fromSeqInclusive))
    }
  }

  appendEvent(threadId: string, event: RuntimeEvent): Promise<void> {
    return this.write(threadId, undefined, () => this.raw.appendEvent(threadId, event))
  }

  appendItem(threadId: string, item: TurnItem): Promise<void> {
    return this.write(threadId, undefined, () => this.raw.appendItem(threadId, item))
  }

  rewriteItems(threadId: string, items: TurnItem[]): Promise<void> {
    return this.write(threadId, undefined, () => this.raw.rewriteItems(threadId, items))
  }

  loadItemSnapshot(threadId: string): Promise<ItemHistorySnapshot> {
    return this.raw.loadItemSnapshot(threadId)
  }

  async rewriteItemsIfRevision(
    threadId: string,
    expectedRevision: number,
    items: TurnItem[]
  ): Promise<ItemHistoryCommit> {
    const lease = this.fence.acquire(threadId)
    if (!lease) return { applied: false, reason: 'closed' }
    try {
      if (!lease.isCurrent()) return { applied: false, reason: 'closed' }
      const result = await this.raw.rewriteItemsIfRevision(threadId, expectedRevision, items)
      return lease.isCurrent() ? result : { applied: false, reason: 'closed' }
    } finally {
      lease.release()
    }
  }

  updateItem(threadId: string, itemId: string, patch: Partial<TurnItem>): Promise<TurnItem | null> {
    return this.write(threadId, null, () => this.raw.updateItem(threadId, itemId, patch))
  }

  loadEventsSince(threadId: string, sinceSeq: number): Promise<RuntimeEvent[]> {
    return this.raw.loadEventsSince(threadId, sinceSeq)
  }

  loadItems(threadId: string): Promise<TurnItem[]> {
    return this.raw.loadItems(threadId)
  }

  loadSession(threadId: string): Promise<AgentSession | null> {
    return this.raw.loadSession(threadId)
  }

  upsertSession(session: AgentSession): Promise<void> {
    return this.write(session.threadId, undefined, () => this.raw.upsertSession(session))
  }

  highestSeq(threadId: string): Promise<number> {
    return this.raw.highestSeq(threadId)
  }

  resetMemory(): Promise<void> {
    return this.raw.resetMemory()
  }

  clearThreadMemory(threadId: string): void {
    this.raw.clearThreadMemory(threadId)
  }

  private async write<T>(threadId: string, noOp: T, operation: () => Promise<T>): Promise<T> {
    const lease = this.fence.acquire(threadId)
    if (!lease) return noOp
    try {
      if (!lease.isCurrent()) return noOp
      const result = await operation()
      return lease.isCurrent() ? result : noOp
    } finally {
      lease.release()
    }
  }
}

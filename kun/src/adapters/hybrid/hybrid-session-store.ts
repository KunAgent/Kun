import type { RuntimeEvent } from '../../contracts/events.js'
import type { TurnItem } from '../../contracts/items.js'
import type { AgentSession } from '../../domain/session.js'
import type {
  EventHistoryPage,
  EventHistoryPageOptions,
  ItemHistoryCompactionResult,
  ItemHistoryCommit,
  ItemHistoryPage,
  ItemHistoryPageOptions,
  ItemHistorySnapshot,
  ItemTextSearchOptions,
  SessionLatestUsageSnapshot,
  SessionStore,
  SessionUsageQueryOptions,
  SessionUsageRecord
} from '../../ports/session-store.js'
import type {
  SessionUsageAggregateQuery,
  SessionUsageAggregateResponse
} from '../../contracts/usage-query.js'
import { FileSessionStore } from '../file/file-session-store.js'
import type { HybridThreadStore } from './hybrid-thread-store.js'

/**
 * JSONL session store with a post-write SQLite index hook. The body
 * remains owned by FileSessionStore; the index is updated only after
 * the append/rewrite has succeeded.
 */
export class HybridSessionStore implements SessionStore {
  private readonly delegate: FileSessionStore
  private readonly index: HybridThreadStore

  constructor(options: {
    dataDir: string
    index: HybridThreadStore
    usageEventCompaction?: ConstructorParameters<typeof FileSessionStore>[0]['usageEventCompaction']
    fileAccess?: ConstructorParameters<typeof FileSessionStore>[0]['fileAccess']
  }) {
    this.delegate = new FileSessionStore({
      dataDir: options.dataDir,
      usageEventCompaction: options.usageEventCompaction,
      fileAccess: options.fileAccess
    })
    this.index = options.index
  }

  async appendEvent(threadId: string, event: RuntimeEvent): Promise<void> {
    await this.delegate.appendEvent(threadId, event)
    await this.index.noteEvent(event)
  }

  async appendItem(threadId: string, item: TurnItem): Promise<void> {
    await this.delegate.appendItem(threadId, item)
  }

  async checkpointLiveItem(threadId: string, item: TurnItem, representedSeq: number): Promise<void> {
    await this.delegate.checkpointLiveItem(threadId, item, representedSeq)
  }

  async finalizeLiveItem(threadId: string, item: TurnItem): Promise<void> {
    await this.delegate.finalizeLiveItem(threadId, item)
  }

  async rewriteItems(threadId: string, items: TurnItem[]): Promise<void> {
    await this.delegate.rewriteItems(threadId, items)
  }

  async loadItemSnapshot(threadId: string): Promise<ItemHistorySnapshot> {
    return this.delegate.loadItemSnapshot(threadId)
  }

  async rewriteItemsIfRevision(
    threadId: string,
    expectedRevision: number,
    items: TurnItem[]
  ): Promise<ItemHistoryCommit> {
    return this.delegate.rewriteItemsIfRevision(threadId, expectedRevision, items)
  }

  async updateItem(threadId: string, itemId: string, patch: Partial<TurnItem>): Promise<TurnItem | null> {
    return this.delegate.updateItem(threadId, itemId, patch)
  }

  async compactItems(
    threadId: string,
    options?: { force?: boolean }
  ): Promise<ItemHistoryCompactionResult> {
    return this.delegate.compactItems(threadId, options)
  }

  scheduleItemHistoryCompaction(threadId: string): void {
    this.delegate.scheduleItemHistoryCompaction(threadId)
  }

  scheduleUsageEventCompaction(threadId: string): void {
    this.delegate.scheduleUsageEventCompaction(threadId)
  }

  async flushScheduledCompaction(threadId?: string): Promise<void> {
    await this.delegate.flushScheduledCompaction(threadId)
  }

  async runEventIndexRebuildSlice(): Promise<boolean> {
    return this.delegate.runEventIndexRebuildSlice()
  }

  setEventIndexRebuildWake(wake: () => void): void {
    this.delegate.setEventIndexRebuildWake(wake)
  }

  async loadEventsSince(threadId: string, sinceSeq: number): Promise<RuntimeEvent[]> {
    return this.delegate.loadEventsSince(threadId, sinceSeq)
  }

  async loadEventPage(threadId: string, options: EventHistoryPageOptions): Promise<EventHistoryPage> {
    return this.delegate.loadEventPage(threadId, options)
  }

  async trimEventsFromSeq(threadId: string, fromSeqInclusive: number): Promise<{ afterBytes: number }> {
    return this.delegate.trimEventsFromSeq(threadId, fromSeqInclusive)
  }

  async eventReplayFloorSeq(threadId: string): Promise<number> {
    return this.delegate.eventReplayFloorSeq(threadId)
  }

  iterateEventsSince(
    threadId: string,
    sinceSeq: number,
    options?: { maxRecordBytes?: number }
  ): AsyncIterable<RuntimeEvent> {
    return this.delegate.iterateEventsSince(threadId, sinceSeq, options)
  }

  async loadItems(threadId: string): Promise<TurnItem[]> {
    return this.delegate.loadItems(threadId)
  }

  async loadItemPage(
    threadId: string,
    options: ItemHistoryPageOptions
  ): Promise<ItemHistoryPage> {
    return this.delegate.loadItemPage(threadId, options)
  }

  async searchItemText(
    threadId: string,
    query: string,
    options?: ItemTextSearchOptions
  ): Promise<string | null> {
    return this.delegate.searchItemText?.(threadId, query, options) ?? null
  }

  async loadSession(threadId: string): Promise<AgentSession | null> {
    return this.delegate.loadSession(threadId)
  }

  async upsertSession(session: AgentSession): Promise<void> {
    await this.delegate.upsertSession(session)
  }

  async highestSeq(threadId: string): Promise<number> {
    // JSONL is the canonical event log. An interruption after its append but
    // before the best-effort SQLite note leaves the index behind; trusting the
    // index alone would reuse that sequence and make SSE skip the durable
    // event. Keep the index as a fast hint, but never let it lower the file
    // high-water mark.
    const [indexed, durable] = await Promise.all([
      this.index.getEventSeqHighWater(threadId).catch(() => null),
      this.delegate.highestSeq(threadId)
    ])
    return Math.max(indexed ?? 0, durable)
  }

  async loadUsageRecords(options?: SessionUsageQueryOptions): Promise<SessionUsageRecord[]> {
    try {
      return await this.index.loadUsageRecords(options)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[kun] sqlite usage index unavailable; using file usage index: ${message}`)
      return this.delegate.loadUsageRecords(options)
    }
  }

  async aggregateUsage(
    query: SessionUsageAggregateQuery,
    liveRecords: SessionUsageRecord[] = []
  ): Promise<SessionUsageAggregateResponse> {
    return this.index.aggregateUsage(query, liveRecords)
  }

  async loadLatestUsageSnapshots(options?: { threadIds?: string[] }): Promise<SessionLatestUsageSnapshot[]> {
    try {
      return await this.index.loadLatestUsageSnapshots(options)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[kun] sqlite latest usage snapshots unavailable; using file usage index: ${message}`)
      return this.delegate.loadLatestUsageSnapshots(options)
    }
  }

  async resetMemory(): Promise<void> {
    await this.delegate.resetMemory()
  }

  clearThreadMemory(threadId: string): void {
    this.delegate.clearThreadMemory(threadId)
  }

  close(): Promise<void> { return this.delegate.close() }
}

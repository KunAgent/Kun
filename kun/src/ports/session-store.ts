import type { AgentSession } from '../domain/session.js'
import type { RuntimeEvent } from '../contracts/events.js'
import type { TurnItem } from '../contracts/items.js'
import type { UsageSnapshot } from '../contracts/usage.js'

export type SessionUsageQueryOptions = {
  threadId?: string
  /** Inclusive ISO-8601 UTC timestamp boundary. Requires `toExclusive`. */
  fromInclusive?: string
  /** Exclusive ISO-8601 UTC timestamp boundary. Requires `fromInclusive`. */
  toExclusive?: string
}

export type SessionUsageRecord = {
  threadId: string
  turnId?: string
  model?: string
  providerId?: string
  completedAt: string
  usage: UsageSnapshot
}

export type SessionLatestUsageSnapshot = {
  threadId: string
  seq: number
  usage: UsageSnapshot
}

/**
 * A point-in-time view of the canonical item history. `revision` is opaque to
 * callers and is valid for the lifetime of the active SessionStore instance.
 * It lets a read-compute-rewrite flow detect an item append or update that
 * landed after it loaded the history.
 */
export type ItemHistorySnapshot = {
  revision: number
  items: TurnItem[]
}

/** Result of a conditional full-history replacement. */
export type ItemHistoryCommit =
  | { applied: true; revision: number }
  | { applied: false; reason: 'conflict' | 'closed'; revision?: number }

export type ItemHistoryCompactionResult = {
  compacted: boolean
  beforeBytes: number
  afterBytes: number
  itemCount: number
}

export type SessionArchiveResult = {
  path: string
  cleanup: () => Promise<void>
}

export type SessionArchiveInput = {
  threadId: string
  cutoffTurnId: string
  createdAt: string
  items: TurnItem[]
  retainedItems: number
  replacedTokens: number
}

/**
 * A bounded chronological window from the durable item projection. `before`
 * is the stable id of the first item in the previously returned page and is
 * treated as an exclusive cursor.
 *
 * `anchorTurnId` is only honored on the newest page (no `before`): when the
 * turn's first real `user_message` falls outside the bounded window (a long
 * running turn produced more process items than the page budget), the page
 * keeps that user message pinned in front so the active request stays
 * visible. The cursor still points at the retained continuous window so
 * older pages cover the items between the anchor and the window without
 * gaps.
 */
export type ItemHistoryPageOptions = {
  before?: string
  anchorTurnId?: string
  maxItems: number
  maxBytes: number
}

export type ItemHistoryPage = {
  items: TurnItem[]
  nextCursor?: string
  hasMore: boolean
  itemBytes: number
}

export type ItemTextSearchOptions = {
  maxBytes?: number
  /** Epoch deadline after which the scan must stop and report no match. */
  deadlineAtMs?: number
}

/**
 * Port for persisted per-thread activity.
 *
 * The store keeps three streams: the ordered runtime event log
 * (used by SSE replay), the turn item history (used to rebuild chat
 * blocks), and the full session projection. Implementations append to
 * JSONL and keep a small in-memory window for fast access.
 */
export interface SessionStore {
  /**
   * Atomically reserve the next durable event sequence number.
   *
   * Manager-backed stores implement this so multiple runtime processes never
   * derive the same value from a shared high-water mark. Local stores may omit
   * it; RuntimeEventRecorder retains its process-local allocator fallback.
   */
  allocateEventSeq?(threadId: string): Promise<number>
  appendEvent(threadId: string, event: RuntimeEvent): Promise<void>
  appendItem(threadId: string, item: TurnItem): Promise<void>
  /**
   * Replace the canonical item stream for a thread. File-backed stores
   * should write atomically because this is used by load-time healing
   * and explicit discard flows.
   */
  rewriteItems(threadId: string, items: TurnItem[]): Promise<void>
  /** Stage an atomic, human-readable archive before a conditional history rewrite. */
  archiveItems?(input: SessionArchiveInput): Promise<SessionArchiveResult>
  /**
   * Replace the persisted event log, keeping only events at or after
   * `fromSeqInclusive`. Returns the new byte size; implementations must
   * rewrite atomically and keep `highestSeq()` monotonic.
   */
  trimEventsFromSeq?(threadId: string, fromSeqInclusive: number): Promise<{ afterBytes: number }>
  /**
   * The earliest event sequence still present in the durable log. Stores
   * that never trim return 0. SSE clients with cursors below this floor
   * must re-sync from a fresh state fetch instead of replaying.
   */
  eventReplayFloorSeq?(threadId: string): Promise<number>
  /** Load item history and its opaque revision as one consistent snapshot. */
  loadItemSnapshot(threadId: string): Promise<ItemHistorySnapshot>
  /**
   * Replace item history only if no item mutation has occurred since the
   * caller loaded `expectedRevision`.
   */
  rewriteItemsIfRevision(
    threadId: string,
    expectedRevision: number,
    items: TurnItem[]
  ): Promise<ItemHistoryCommit>
  updateItem(threadId: string, itemId: string, patch: Partial<TurnItem>): Promise<TurnItem | null>
  /** Atomically collapse append-only updates to the latest record per item id. */
  compactItems?(
    threadId: string,
    options?: { force?: boolean }
  ): Promise<ItemHistoryCompactionResult>
  /**
   * Queue a coalesced background item-history compaction. Live turns should
   * prefer this over awaiting `compactItems` so lease heartbeats stay responsive.
   */
  scheduleItemHistoryCompaction?(threadId: string): void
  /** Queue a coalesced background usage-event compaction for oversized logs. */
  scheduleUsageEventCompaction?(threadId: string): void
  /** Flush pending scheduled compaction for one thread or the whole store. */
  flushScheduledCompaction?(threadId?: string): Promise<void>
  loadEventsSince(threadId: string, sinceSeq: number): Promise<RuntimeEvent[]>
  /**
   * Optional cross-process live feed. The normal EventBus remains the fast
   * path for events produced by this runtime; shared stores use this feed to
   * relay events produced by the other flavor.
   */
  watchEventsSince?(
    threadId: string,
    sinceSeq: number,
    signal: AbortSignal
  ): AsyncIterable<RuntimeEvent>
  /**
   * Optional bounded, forward-only event replay. Serve uses this when present
   * so a long JSONL backlog is never materialized as one giant array.
   */
  iterateEventsSince?(
    threadId: string,
    sinceSeq: number,
    options?: { maxRecordBytes?: number }
  ): AsyncIterable<RuntimeEvent>
  loadItems(threadId: string): Promise<TurnItem[]>
  /** Optional bounded history read used by renderer timeline hydration. */
  loadItemPage?(threadId: string, options: ItemHistoryPageOptions): Promise<ItemHistoryPage>
  /**
   * Optional bounded, lock-free text scan over item history.
   *
   * Search is a read-only side path: unlike `loadItems` it must never take a
   * thread's write queue and must never trigger history compaction, so a
   * search keystroke cannot contend with an in-flight turn or rewrite a
   * multi-megabyte log. Implementations return the first matching item text,
   * or null when the thread has no match within `maxBytes`. Stores that
   * cannot honor those guarantees should leave this undefined; callers treat
   * an absent implementation as "no content-search capability" rather than
   * falling back to `loadItems`.
   */
  searchItemText?(
    threadId: string,
    query: string,
    options?: ItemTextSearchOptions
  ): Promise<string | null>
  loadSession(threadId: string): Promise<AgentSession | null>
  upsertSession(session: AgentSession): Promise<void>
  /** Highest known per-thread `seq`. Returns 0 when no events have been recorded. */
  highestSeq(threadId: string): Promise<number>
  /**
   * Optional indexed usage query. Implementations may return per-event
   * usage deltas without replaying the full event log.
   */
  loadUsageRecords?(options?: SessionUsageQueryOptions): Promise<SessionUsageRecord[]>
  /** Optional indexed latest cumulative usage snapshot query. */
  loadLatestUsageSnapshots?(options?: { threadIds?: string[] }): Promise<SessionLatestUsageSnapshot[]>
  /** Forget the per-thread in-memory state without touching disk. */
  resetMemory(): Promise<void>
  /** Forget cached state for a deleted thread without recreating its files. */
  clearThreadMemory(threadId: string): void
}

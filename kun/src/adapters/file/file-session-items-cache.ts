import type { TurnItem } from '../../contracts/items.js'
import { serializedArrayBytesUpTo, serializedBytes } from './file-session-jsonl.js'

export type ItemCacheWrite =
  /** A durable record: the item keeps its first-log position. */
  | 'durable'
  /** A persisted checkpoint: the item takes the live suffix's tail slot. */
  | 'live-tail'
  /** A throttled checkpoint: content only, the sidecar order did not move. */
  | 'live-content'

/**
 * Small bounded LRU cache for deduped item histories. The agent loop reloads
 * the full item history on every model step, so recently touched threads stay
 * in memory instead of re-reading and re-parsing messages.jsonl each time.
 *
 * The cached array mirrors cold-load order: entries below `canonicalCount` are
 * durable items in first-durable-occurrence order, and the suffix is live
 * checkpoints in checkpoint order (the order `live-items.json` keeps). A hit
 * therefore hashes to the same delegated-session history digest as a cold read.
 */
export class ItemsCache {
  private readonly items = new Map<string, TurnItem[]>()
  private readonly bytes = new Map<string, number>()
  private readonly versions = new Map<string, number>()
  private readonly canonicalCounts = new Map<string, number>()

  constructor(
    private readonly maxThreads: number,
    private readonly maxBytes: number
  ) {}

  get(threadId: string): TurnItem[] | undefined {
    return this.items.get(threadId)
  }

  versionOf(threadId: string): number {
    return this.versions.get(threadId) ?? 0
  }

  bumpVersion(threadId: string): void {
    this.versions.set(threadId, this.versionOf(threadId) + 1)
  }

  set(threadId: string, items: TurnItem[], canonicalCount?: number): void {
    // Touching a cached overlay must not promote its live suffix to durable.
    const count = canonicalCount ?? (this.items.get(threadId) === items
      ? this.canonicalCount(threadId) : items.length)
    this.remove(threadId)
    const bytes = serializedArrayBytesUpTo(items, this.maxBytes / 2)
    if (bytes > this.maxBytes / 2 || bytes > this.maxBytes) return
    this.items.set(threadId, items)
    this.bytes.set(threadId, bytes)
    this.canonicalCounts.set(threadId, Math.max(0, Math.min(count, items.length)))
    this.evictOverflow()
  }

  /** Invalidate before promotion, including an append that succeeds but cleanup fails. */
  beforeDurableWrite(threadId: string, itemId: string): void {
    const index = this.items.get(threadId)?.findIndex((item) => item.id === itemId) ?? -1
    if (index >= 0 && index >= this.canonicalCount(threadId)) this.remove(threadId)
  }

  /**
   * Apply a durably persisted item. Its canonical position is the first time
   * the log saw its id, so an already-canonical item is replaced in place. A
   * live-only item just gained that position at the log tail, which an in-place
   * update cannot express: drop the cache and let the next load rebuild order.
   */
  applyItem(threadId: string, item: TurnItem): void {
    const cached = this.items.get(threadId)
    if (!cached) return
    const index = cached.findIndex((existing) => existing.id === item.id)
    if (index >= 0 && index >= this.canonicalCount(threadId)) {
      this.remove(threadId)
      return
    }
    if (index < 0) {
      // Canonical items stay a prefix: insert before any live suffix.
      const at = this.canonicalCount(threadId)
      this.replaceOrAppend(threadId, cached, -1, item)
      if (this.items.get(threadId) !== cached) return
      cached.splice(cached.length - 1, 1)
      cached.splice(at, 0, item)
      this.canonicalCounts.set(threadId, at + 1)
      return
    }
    this.replaceOrAppend(threadId, cached, index, item)
  }

  /**
   * Apply a streaming checkpoint. Cold reads overlay the live suffix in
   * `live-items.json` order, replacing a canonical item in place unless it is
   * already terminal, so the warm cache must follow the same rule.
   */
  applyLiveItem(threadId: string, item: TurnItem, mode: ItemCacheWrite = 'live-tail'): void {
    const cached = this.items.get(threadId)
    if (!cached) return
    const index = cached.findIndex((existing) => existing.id === item.id)
    if (index < 0) {
      this.replaceOrAppend(threadId, cached, -1, item)
      return
    }
    if (index < this.canonicalCount(threadId)) {
      const status = cached[index]!.status
      if (status === 'completed' || status === 'failed' || status === 'aborted') return
      this.replaceOrAppend(threadId, cached, index, item)
      return
    }
    if (mode === 'live-content' || index === cached.length - 1) {
      this.replaceOrAppend(threadId, cached, index, item)
      return
    }
    // A persisted checkpoint rewrites the sidecar with filter-then-push.
    this.replaceOrAppend(threadId, cached, index, item)
    if (this.items.get(threadId) !== cached) return
    cached.splice(index, 1)
    cached.push(item)
  }

  remove(threadId: string): void {
    this.items.delete(threadId)
    this.bytes.delete(threadId)
    this.canonicalCounts.delete(threadId)
  }

  removeAll(threadId: string): void {
    this.remove(threadId)
    this.versions.delete(threadId)
  }

  clear(): void {
    this.items.clear()
    this.bytes.clear()
    this.versions.clear()
    this.canonicalCounts.clear()
  }

  stats(): { entries: number; bytes: number; maxBytes: number } {
    return { entries: this.items.size, bytes: this.totalBytes(), maxBytes: this.maxBytes }
  }

  private canonicalCount(threadId: string): number {
    return this.canonicalCounts.get(threadId) ?? 0
  }

  private replaceOrAppend(
    threadId: string,
    cached: TurnItem[],
    index: number,
    item: TurnItem
  ): void {
    const previousBytes = this.bytes.get(threadId) ?? 0
    const nextBytes = index >= 0
      ? previousBytes - serializedBytes(cached[index]) + serializedBytes(item)
      : previousBytes + serializedBytes(item) + (cached.length > 0 ? 1 : 0)
    if (nextBytes > this.maxBytes / 2 || nextBytes > this.maxBytes) {
      this.remove(threadId)
      return
    }
    if (index >= 0) cached[index] = item
    else cached.push(item)
    // Refresh LRU order without rebuilding the array.
    this.items.delete(threadId)
    this.items.set(threadId, cached)
    this.bytes.delete(threadId)
    this.bytes.set(threadId, nextBytes)
    this.evictOverflow()
  }

  private totalBytes(): number {
    let total = 0
    for (const bytes of this.bytes.values()) total += bytes
    return total
  }

  private evictOverflow(): void {
    while (this.items.size > this.maxThreads || this.totalBytes() > this.maxBytes) {
      const oldest = this.items.keys().next().value
      if (oldest === undefined) break
      this.remove(oldest)
    }
  }
}

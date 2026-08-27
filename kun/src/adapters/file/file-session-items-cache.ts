import type { TurnItem } from '../../contracts/items.js'
import { serializedBytes } from './file-session-jsonl.js'

/**
 * Small bounded LRU cache for deduped item histories. The agent loop reloads
 * the full item history on every model step, so recently touched threads stay
 * in memory instead of re-reading and re-parsing messages.jsonl each time.
 */
export class ItemsCache {
  private readonly items = new Map<string, TurnItem[]>()
  private readonly bytes = new Map<string, number>()
  private readonly versions = new Map<string, number>()

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

  set(threadId: string, items: TurnItem[]): void {
    this.remove(threadId)
    const bytes = serializedBytes(items)
    if (bytes > this.maxBytes / 2 || bytes > this.maxBytes) return
    this.items.set(threadId, items)
    this.bytes.set(threadId, bytes)
    this.evictOverflow()
  }

  applyItem(threadId: string, item: TurnItem): void {
    const cached = this.items.get(threadId)
    if (!cached) return
    const index = cached.findIndex((existing) => existing.id === item.id)
    const previousBytes = this.bytes.get(threadId) ?? 0
    const nextBytes = index >= 0
      ? previousBytes - serializedBytes(cached[index]) + serializedBytes(item)
      : previousBytes + serializedBytes(item)
    if (nextBytes > this.maxBytes / 2 || nextBytes > this.maxBytes) {
      this.remove(threadId)
      return
    }
    if (index >= 0) cached[index] = item
    else cached.push(item)
    this.items.delete(threadId)
    this.items.set(threadId, cached)
    this.bytes.delete(threadId)
    this.bytes.set(threadId, nextBytes)
    this.evictOverflow()
  }

  remove(threadId: string): void {
    this.items.delete(threadId)
    this.bytes.delete(threadId)
  }

  removeAll(threadId: string): void {
    this.remove(threadId)
    this.versions.delete(threadId)
  }

  clear(): void {
    this.items.clear()
    this.bytes.clear()
    this.versions.clear()
  }

  stats(): { entries: number; bytes: number; maxBytes: number } {
    return { entries: this.items.size, bytes: this.totalBytes(), maxBytes: this.maxBytes }
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

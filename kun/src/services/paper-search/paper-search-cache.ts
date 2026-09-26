import type { PaperSourceQuery } from './paper-search-types.js'

/**
 * Bounded TTL cache for per-source search results. Agent deep searches issue
 * the same query repeatedly across rounds; caching each (source, query,
 * limit, years) tuple keeps repeated lookups free and protects upstream APIs.
 * Entries are read through `structuredClone`-style copies so callers never
 * mutate the stored values.
 */
export class PaperSearchCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>()
  private readonly maxEntries: number
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(options: { maxEntries?: number; ttlMs?: number; now?: () => number } = {}) {
    this.maxEntries = options.maxEntries ?? 200
    this.ttlMs = options.ttlMs ?? 15 * 60_000
    this.now = options.now ?? Date.now
  }

  get size(): number {
    return this.entries.size
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key)
      return undefined
    }
    // Refresh LRU order.
    this.entries.delete(key)
    this.entries.set(key, entry)
    return JSON.parse(JSON.stringify(entry.value)) as V
  }

  set(key: string, value: V): void {
    if (this.entries.has(key)) this.entries.delete(key)
    this.entries.set(key, { value: JSON.parse(JSON.stringify(value)) as V, expiresAt: this.now() + this.ttlMs })
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.entries.delete(oldest.value)
    }
  }

  delete(key: string): void {
    this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
  }
}

export function paperSourceCacheKey(source: string, query: PaperSourceQuery): string {
  return [
    source,
    query.query.replace(/\s+/g, ' ').trim().toLowerCase(),
    query.limit,
    query.yearFrom ?? '',
    query.yearTo ?? ''
  ].join('|')
}

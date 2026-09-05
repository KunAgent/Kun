export const USAGE_SUMMARY_FRESH_MS = 30 * 60 * 1000
const USAGE_SUMMARY_CACHE_MAX = 12

type UsageSummaryCacheEntry<T> = {
  value: T
  updatedAt: string
  lastAccessedAt: number
}

export type UsageSummaryCacheResult<T> = {
  value: T
  updatedAt: string
  stale: boolean
}

const entries = new Map<string, UsageSummaryCacheEntry<unknown>>()

export function readUsageSummaryCache<T>(
  path: string,
  now = Date.now()
): UsageSummaryCacheResult<T> | null {
  const entry = entries.get(path) as UsageSummaryCacheEntry<T> | undefined
  if (!entry) return null
  entry.lastAccessedAt = now
  const updatedAtMs = Date.parse(entry.updatedAt)
  return {
    value: entry.value,
    updatedAt: entry.updatedAt,
    stale: !Number.isFinite(updatedAtMs) || now - updatedAtMs >= USAGE_SUMMARY_FRESH_MS
  }
}

export function writeUsageSummaryCache<T>(
  path: string,
  value: T,
  now = Date.now()
): UsageSummaryCacheResult<T> {
  const updatedAt = new Date(now).toISOString()
  entries.set(path, { value, updatedAt, lastAccessedAt: now })
  pruneUsageSummaryCache()
  return { value, updatedAt, stale: false }
}

function pruneUsageSummaryCache(): void {
  while (entries.size > USAGE_SUMMARY_CACHE_MAX) {
    let oldestKey: string | undefined
    let oldestAccess = Number.POSITIVE_INFINITY
    for (const [key, entry] of entries) {
      if (entry.lastAccessedAt < oldestAccess) {
        oldestKey = key
        oldestAccess = entry.lastAccessedAt
      }
    }
    if (oldestKey === undefined) break
    entries.delete(oldestKey)
  }
}

export function resetUsageSummaryCacheForTests(): void {
  entries.clear()
}

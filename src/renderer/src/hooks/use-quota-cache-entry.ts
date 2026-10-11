import { useSyncExternalStore } from 'react'
import type { QuotaCache, QuotaCacheEntry } from '../lib/quota-cache'

/** What the shared quota cache holds for `key` right now, kept current as other surfaces refresh it. */
export function useQuotaCacheEntry<T>(cache: QuotaCache<T>, key: string): QuotaCacheEntry<T> | undefined {
  return useSyncExternalStore(
    cache.subscribe,
    () => (key ? cache.peek(key) : undefined),
    () => undefined
  )
}

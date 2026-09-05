import { useEffect, useRef } from 'react'
import { USAGE_SUMMARY_FRESH_MS } from './usage-summary-cache'

export function useUsageAutoRefresh(
  enabled: boolean,
  manualRefreshKey: unknown,
  autoRefreshKey: number,
  refreshedAt: string | undefined,
  refresh: () => void
): void {
  const nextRefreshAt = useRef(Date.now() + USAGE_SUMMARY_FRESH_MS)
  const previousManualKey = useRef(manualRefreshKey)
  const previousRefreshedAt = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return
    const ownerDocument = document
    const now = Date.now()
    if (previousManualKey.current !== manualRefreshKey) {
      previousManualKey.current = manualRefreshKey
      nextRefreshAt.current = now + USAGE_SUMMARY_FRESH_MS
    }
    if (previousRefreshedAt.current !== refreshedAt) {
      previousRefreshedAt.current = refreshedAt
      const refreshedAtMs = refreshedAt ? Date.parse(refreshedAt) : Number.NaN
      nextRefreshAt.current = Number.isFinite(refreshedAtMs)
        ? refreshedAtMs + USAGE_SUMMARY_FRESH_MS
        : now + USAGE_SUMMARY_FRESH_MS
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = (): void => {
      if (timer) clearTimeout(timer)
      if (ownerDocument.visibilityState !== 'visible') return
      timer = setTimeout(() => {
        nextRefreshAt.current = Date.now() + USAGE_SUMMARY_FRESH_MS
        refresh()
      }, Math.max(0, nextRefreshAt.current - Date.now()))
    }
    schedule()
    ownerDocument.addEventListener('visibilitychange', schedule)
    return () => {
      if (timer) clearTimeout(timer)
      ownerDocument.removeEventListener('visibilitychange', schedule)
    }
  }, [autoRefreshKey, enabled, manualRefreshKey, refresh, refreshedAt])
}

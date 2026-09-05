type ActivityMetrics = {
  pushEvents: number
  coalescedEvents: number
  syncRequested: number
  syncExecuted: number
  legacyDiscoveryScans: number
  stateBatchRequests: number
  summaryRequests: number
  fullRefreshes: number
  durationTotalMs: number
  durationMaxMs: number
}

const EMPTY: ActivityMetrics = {
  pushEvents: 0, coalescedEvents: 0, syncRequested: 0, syncExecuted: 0,
  legacyDiscoveryScans: 0, stateBatchRequests: 0, summaryRequests: 0,
  fullRefreshes: 0, durationTotalMs: 0, durationMaxMs: 0
}

let metrics = { ...EMPTY }
let startedAt = Date.now()

export function recordSidebarActivityMetric(
  key: keyof ActivityMetrics,
  value = 1
): void {
  if (!import.meta.env.DEV) return
  metrics[key] += value
  flushSidebarActivityMetrics()
}

export function recordSidebarActivityDuration(durationMs: number): void {
  if (!import.meta.env.DEV) return
  metrics.durationTotalMs += durationMs
  metrics.durationMaxMs = Math.max(metrics.durationMaxMs, durationMs)
  flushSidebarActivityMetrics()
}

export function flushSidebarActivityMetrics(force = false): void {
  if (!import.meta.env.DEV) return
  const now = Date.now()
  if (!force && now - startedAt < 60_000) return
  console.info('[sidebar-activity-metrics]', {
    ...metrics,
    durationAvgMs: metrics.syncExecuted > 0
      ? Math.round(metrics.durationTotalMs / metrics.syncExecuted)
      : 0,
    visibility: typeof document === 'undefined' ? 'unknown' : document.visibilityState
  })
  metrics = { ...EMPTY }
  startedAt = now
}

import type { ProviderQuotaMetric } from '../../kun/src/contracts/provider-quota.js'

export type QuotaResetReminder = { metricId: string; label: string; unusedPercent: number; hoursLeft: number }

/**
 * Windows about to renew with much of them unused: allowance that is lost at
 * the reset unless it is spent first. Only metrics with a known usage share
 * and a future reset qualify.
 */
export function quotaResetReminders(metrics: readonly ProviderQuotaMetric[], now: number,
  options: { withinHours?: number; minUnusedPercent?: number } = {}): QuotaResetReminder[] {
  const withinMs = (options.withinHours ?? 6) * 3_600_000
  const minUnused = options.minUnusedPercent ?? 40
  return metrics.flatMap((metric) => {
    if (metric.usedPercent === undefined || !metric.resetsAt) return []
    const resetsAt = Date.parse(metric.resetsAt)
    if (!Number.isFinite(resetsAt) || resetsAt <= now || resetsAt - now > withinMs) return []
    const unusedPercent = Math.round(100 - metric.usedPercent)
    if (unusedPercent < minUnused) return []
    return [{ metricId: metric.id, label: metric.label, unusedPercent, hoursLeft: Math.max(1, Math.round((resetsAt - now) / 3_600_000)) }]
  })
}

import type { ProviderQuotaEntry, ProviderQuotaMetric } from '@shared/provider-quota'
import { quotaUsedPercent } from '../usage/quota-view-model'

export type ComposerQuotaWindow = { metric: ProviderQuotaMetric; remainingPercent: number }

export function composerQuotaWindowSeconds(metric: ProviderQuotaMetric): number | undefined {
  if (metric.windowSeconds !== undefined) return Number.isFinite(metric.windowSeconds) && metric.windowSeconds > 0 ? metric.windowSeconds : undefined
  const label = `${metric.id} ${metric.label}`.toLowerCase()
  if (/\bfive[-_\s]?hour\b/.test(label)) return 18_000
  if (/\bseven[-_\s]?day\b|\bweekly(?:_all)?\b/.test(label)) return 604_800
  const match = /(\d+(?:\.\d+)?)\s*-?\s*(hours?|hrs?|h|days?|d|weeks?|w|minutes?|mins?|m)\b/.exec(label)
  return match ? Number(match[1]) * (match[2].startsWith('h') ? 3_600 : match[2].startsWith('d') ? 86_400 : match[2].startsWith('w') ? 604_800 : 60) : undefined
}

/** Display exact periods, never round a provider's 30-minute or 7.5-hour window. */
export function composerQuotaWindowLabel(metric: ProviderQuotaMetric, t: (key: string, values?: Record<string, unknown>) => string): string {
  const seconds = composerQuotaWindowSeconds(metric)
  if (!seconds) return metric.label
  const knownScopes: Record<string, string> = { 'seven-day-sonnet': 'Sonnet', 'seven-day-opus': 'Opus', 'seven-day-oauth-apps': 'OAuth apps' }
  const scope = knownScopes[metric.id] ?? metric.label
    .replace(/\b(?:\d+(?:\.\d+)?\s*-?\s*(?:hours?|hrs?|h|days?|d|weeks?|w|minutes?|mins?|m)|five[-\s]?hour|seven[-\s]?day|weekly(?:_all)?|week)\b/gi, '')
    .replace(/\b(?:usage|quota|window|limit|primary|secondary|rate)\b/gi, '')
    .replace(/^[\s·:–—-]+|[\s·:–—-]+$/g, '').trim()
  const span = seconds === 604_800 ? t('subscriptionQuota.weekly')
    : seconds % 86_400 === 0 ? t('subscriptionQuota.windowDays', { count: seconds / 86_400 })
      : seconds >= 3_600 && Number.isInteger(seconds / 36) ? t('subscriptionQuota.windowHours', { count: seconds / 3_600 })
        : seconds % 60 === 0 ? t('subscriptionQuota.windowMinutes', { count: seconds / 60 }) : undefined
  return span ? [scope, span].filter(Boolean).join(' · ') : metric.label
}

/** Unknown percentages stay absent; an exhausted allowance (0% left) is still useful data. */
export function composerQuotaWindows(entry: ProviderQuotaEntry | null | undefined): ComposerQuotaWindow[] {
  if (entry?.status !== 'available') return []
  return entry.metrics.flatMap((metric): ComposerQuotaWindow[] => {
    if (metric.unit !== 'percent') return []
    // Claude may return the same global weekly window in both API formats.
    if (entry.presetId === 'claude-subscription' && metric.label === 'weekly_all' &&
      entry.metrics.some(other => other.id === 'seven-day' && other.usedPercent === metric.usedPercent && other.resetsAt === metric.resetsAt)) return []
    if (!Number.isFinite(metric.usedPercent) && !(
      Number.isFinite(metric.limit) && metric.limit! > 0 && (Number.isFinite(metric.used) || Number.isFinite(metric.remaining))
    )) return []
    const used = quotaUsedPercent(metric)
    return used !== undefined && Number.isFinite(used) ? [{ metric, remainingPercent: Math.max(0, Math.min(100, 100 - used)) }] : []
  }).sort((left, right) => {
    const span = (metric: ProviderQuotaMetric): number => composerQuotaWindowSeconds(metric) ?? Number.POSITIVE_INFINITY
    return span(left.metric) - span(right.metric)
  })
}

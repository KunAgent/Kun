import type { DailyUsageBucket, DailyUsageState } from '../../hooks/use-daily-usage'
import {
  formatCompactNumber,
  formatCost,
  formatPercent
} from '../../hooks/use-thread-usage'

export type CalendarCell = DailyUsageBucket | null
export type CalendarWeek = {
  key: string
  cells: CalendarCell[]
}
export type UsageTotalsBucket = DailyUsageBucket & { days: number; activeDays: number }
export type UsageViewMode = 'populated' | 'loading' | 'empty' | 'error'
export type UsageRangeKey = 'all' | '90d' | '30d' | '7d'
export type UsageTabKey = 'overview' | 'models'

export const USAGE_HEATMAP_PREVIEW_CELLS = 14 * 7
export const USAGE_HEATMAP_GRID_DAYS = 365
export const USAGE_RANGE_DAYS: Record<UsageRangeKey, number> = {
  all: 365,
  '90d': 90,
  '30d': 30,
  '7d': 7
}
export const USAGE_RANGE_KEYS: UsageRangeKey[] = ['all', '90d', '30d', '7d']
export const MODEL_USAGE_COLORS = ['#4f83df', '#6b99e5', '#8db3ed', '#b8cff6']
export const MODEL_USAGE_BREAKDOWN_COLORS = {
  cachedInput: '#9bd8ff',
  uncachedInput: '#62aaf8',
  output: '#245fd7'
} as const
export const EMPTY_DAILY_USAGE_BUCKETS: DailyUsageBucket[] = []

export const USAGE_HEATMAP_INTENSITY_CLASSES = [
  'border-ds-border-muted bg-ds-subtle',
  'border-emerald-400 bg-emerald-500 dark:border-emerald-400/35 dark:bg-emerald-700',
  'border-teal-400 bg-teal-500 dark:border-teal-300/40 dark:bg-teal-600',
  'border-cyan-600 bg-cyan-600 dark:border-cyan-300/50 dark:bg-cyan-400',
  'border-blue-700 bg-blue-700 dark:border-blue-300/60 dark:bg-blue-400'
]

export const USAGE_HEATMAP_CONTRAST_COLORS = [
  { level: 0, light: '#f5f7fb', dark: '#2a2a2a' },
  { level: 1, light: '#10b981', dark: '#047857' },
  { level: 2, light: '#14b8a6', dark: '#0d9488' },
  { level: 3, light: '#0891b2', dark: '#22d3ee' },
  { level: 4, light: '#1d4ed8', dark: '#60a5fa' }
] as const

export function buildUsageCalendarWeeks(buckets: DailyUsageBucket[]): CalendarWeek[] {
  if (buckets.length === 0) return []
  const sorted = [...buckets].sort((left, right) => left.date.localeCompare(right.date))
  const first = new Date(`${sorted[0].date}T00:00:00.000Z`)
  const aligned: CalendarCell[] = [
    ...Array.from({ length: Number.isNaN(first.getTime()) ? 0 : first.getUTCDay() }, () => null),
    ...sorted
  ]
  while (aligned.length % 7 !== 0) aligned.push(null)
  const weeks: CalendarWeek[] = []
  for (let index = 0; index < aligned.length; index += 7) {
    const weekCells = aligned.slice(index, index + 7)
    weeks.push({
      key: weekCells.find((cell) => cell)?.date ?? `week-${index / 7}`,
      cells: weekCells
    })
  }
  return weeks
}

export function usageHeatmapIntensityLevel(
  bucket: Pick<DailyUsageBucket, 'totalTokens' | 'turns'>,
  positiveMetrics: number[],
  useTurns = false
): number {
  const metric = useTurns ? bucket.turns : bucket.totalTokens
  if (metric <= 0 || positiveMetrics.length === 0) return 0
  const sorted = [...positiveMetrics].sort((left, right) => left - right)
  let rank = 0
  while (rank < sorted.length && sorted[rank] <= metric) rank += 1
  return Math.max(1, Math.min(4, Math.ceil((rank / sorted.length) * 4)))
}

export function usageHasBucketActivity(bucket: Pick<DailyUsageBucket, 'totalTokens' | 'turns'>): boolean {
  return bucket.totalTokens > 0 || bucket.turns > 0
}

export function usageStreaks(buckets: DailyUsageBucket[]): { current: number; longest: number } {
  let current = 0
  let longest = 0
  let running = 0
  for (const bucket of buckets) {
    if (usageHasBucketActivity(bucket)) {
      running += 1
      longest = Math.max(longest, running)
    } else {
      running = 0
    }
  }
  for (let index = buckets.length - 1; index >= 0; index -= 1) {
    if (!usageHasBucketActivity(buckets[index])) break
    current += 1
  }
  return { current, longest }
}

export function usageRangeBuckets(buckets: DailyUsageBucket[], rangeKey: UsageRangeKey): DailyUsageBucket[] {
  if (rangeKey === 'all') return buckets
  return buckets.slice(-USAGE_RANGE_DAYS[rangeKey])
}

export function usageTotalsFromBuckets(buckets: DailyUsageBucket[]): UsageTotalsBucket {
  let hasCny = false
  let hasEstimateCny = false
  const totals = buckets.reduce<UsageTotalsBucket>(
    (acc, bucket) => {
      acc.inputTokens += bucket.inputTokens
      acc.outputTokens += bucket.outputTokens
      acc.reasoningTokens += bucket.reasoningTokens
      acc.cachedTokens += bucket.cachedTokens
      acc.cacheMissTokens += bucket.cacheMissTokens
      acc.totalTokens += bucket.totalTokens
      acc.costUsd += bucket.costUsd
      acc.costCny = (acc.costCny ?? 0) + (bucket.costCny ?? 0)
      acc.valueEstimateUsd += bucket.valueEstimateUsd
      acc.valueEstimateCny = (acc.valueEstimateCny ?? 0) + (bucket.valueEstimateCny ?? 0)
      acc.valueEstimateUnpricedRequests += bucket.valueEstimateUnpricedRequests
      acc.tokenEconomySavingsTokens += bucket.tokenEconomySavingsTokens
      acc.turns += bucket.turns
      acc.threadCount += bucket.threadCount
      if (bucket.costCny != null) hasCny = true
      if (bucket.valueEstimateCny != null) hasEstimateCny = true
      if (usageHasBucketActivity(bucket)) acc.activeDays += 1
      return acc
    },
    {
      date: 'totals',
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedTokens: 0,
      cacheMissTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      costCny: 0,
      valueEstimateUsd: 0,
      valueEstimateCny: 0,
      valueEstimateCoverage: 'unavailable',
      valueEstimateUnpricedRequests: 0,
      tokenEconomySavingsTokens: 0,
      turns: 0,
      threadCount: 0,
      cacheHitRate: null,
      days: buckets.length,
      activeDays: 0
    }
  )
  const cacheTotal = totals.cachedTokens + totals.cacheMissTokens
  let hasEstimate = false
  let hasUnpriced = false
  for (const bucket of buckets) {
    if (bucket.valueEstimateUsd > 0 || (bucket.valueEstimateCny ?? 0) > 0) hasEstimate = true
    if (bucket.valueEstimateUnpricedRequests > 0) hasUnpriced = true
  }
  return {
    ...totals,
    costCny: hasCny ? totals.costCny : null,
    valueEstimateCny: hasEstimateCny ? totals.valueEstimateCny : null,
    // Slice-level coverage mirrors the backend rule: priced estimates plus any
    // unpriced subscription requests reads as `partial`.
    valueEstimateCoverage: hasEstimate ? (hasUnpriced ? 'partial' : 'complete') : 'unavailable',
    cacheHitRate: cacheTotal > 0 ? totals.cachedTokens / cacheTotal : null
  }
}

export function dailySummary(
  bucket: DailyUsageBucket,
  t: (key: string, values?: Record<string, unknown>) => string,
  locale: string
): string {
  return t('usageHeatmapDaySummary', {
    date: bucket.date,
    tokens: formatCompactNumber(bucket.totalTokens),
    cost: formatCost(bucket.costUsd, locale, bucket.costCny),
    saved: formatCompactNumber(bucket.cachedTokens),
    turns: bucket.turns,
    threads: bucket.threadCount,
    cache: formatPercent(bucket.cacheHitRate)
  })
}

export function usageHasActivity(state: DailyUsageState): boolean {
  const usage = state.usage
  if (!usage) return false
  return usage.totals.activeDays > 0 || usage.buckets.some((bucket) => bucket.totalTokens > 0 || bucket.turns > 0)
}

export function usageViewMode(state: DailyUsageState): UsageViewMode {
  if (usageHasActivity(state)) return 'populated'
  if (state.loading) return 'loading'
  if (state.error) return 'error'
  return 'empty'
}

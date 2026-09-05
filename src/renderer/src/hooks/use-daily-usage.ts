import { useEffect, useRef, useState } from 'react'
import { requestUsage } from './usage-request-cache'
import { parseUsageResponse, usageRequestError } from './usage-response'
import { readUsageSummaryCache, writeUsageSummaryCache } from './usage-summary-cache'

export const DEFAULT_USAGE_HEATMAP_DAYS = 90

export type DailyUsageBucket = {
  date: string
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cachedTokens: number
  cacheMissTokens: number
  totalTokens: number
  costUsd: number
  costCny: number | null
  valueEstimateUsd: number
  valueEstimateCny: number | null
  valueEstimateCoverage: 'complete' | 'partial' | 'unavailable'
  valueEstimateUnpricedRequests: number
  tokenEconomySavingsTokens: number
  turns: number
  threadCount: number
  cacheHitRate: number | null
}

export type DailyUsageTotals = Omit<DailyUsageBucket, 'date'> & {
  days: number
  activeDays: number
  valueEstimateCoverage: 'complete' | 'partial' | 'unavailable'
}

export type DailyUsageSummary = {
  groupBy: 'day'
  from: string
  to: string
  timezone: string
  buckets: DailyUsageBucket[]
  totals: DailyUsageTotals
}

export type DailyUsageState = {
  usage: DailyUsageSummary | null
  loading: boolean
  loaded: boolean
  error: string | null
  updatedAt?: string
  stale?: boolean
}

type RawDailyUsageBucket = {
  date?: unknown
  input_tokens?: unknown
  output_tokens?: unknown
  reasoning_tokens?: unknown
  cached_tokens?: unknown
  cache_miss_tokens?: unknown
  total_tokens?: unknown
  cost_usd?: unknown
  cost_cny?: unknown
  value_estimate_usd?: unknown
  value_estimate_cny?: unknown
  value_estimate_coverage?: unknown
  value_estimate_unpriced_requests?: unknown
  token_economy_savings_tokens?: unknown
  turns?: unknown
  thread_count?: unknown
  cache_hit_rate?: unknown
}

type RawDailyUsageResponse = {
  group_by?: unknown
  from?: unknown
  to?: unknown
  timezone?: unknown
  buckets?: unknown
  totals?: unknown
}

export type DailyUsageRange = {
  from: string
  to: string
  timezone: string
}

function usageNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function usageOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function usageRate(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null
}

function usageEstimateCoverage(value: unknown): 'complete' | 'partial' | 'unavailable' {
  return value === 'complete' || value === 'partial' ? value : 'unavailable'
}

function dateStringFromParts(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  if (!year || !month || !day) return date.toISOString().slice(0, 10)
  return `${year}-${month}-${day}`
}

function addDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function clientTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function defaultDailyUsageRange(now = new Date(), days = DEFAULT_USAGE_HEATMAP_DAYS): DailyUsageRange {
  const timezone = clientTimezone()
  const rangeDays = Math.max(7, Math.round(days))
  const to = dateStringFromParts(now, timezone)
  return {
    from: addDays(to, -(rangeDays - 1)),
    to,
    timezone
  }
}

export function buildDailyUsagePath(range: DailyUsageRange): string {
  const params = new URLSearchParams()
  params.set('group_by', 'day')
  params.set('from', range.from)
  params.set('to', range.to)
  params.set('timezone', range.timezone)
  return `/v1/usage?${params.toString()}`
}

function normalizeBucket(raw: RawDailyUsageBucket): DailyUsageBucket {
  const date = typeof raw.date === 'string' ? raw.date : ''
  const inputTokens = usageNumber(raw.input_tokens)
  const outputTokens = usageNumber(raw.output_tokens)
  const totalTokens = usageNumber(raw.total_tokens) || inputTokens + outputTokens
  return {
    date,
    inputTokens,
    outputTokens,
    reasoningTokens: usageNumber(raw.reasoning_tokens),
    cachedTokens: usageNumber(raw.cached_tokens),
    cacheMissTokens: usageNumber(raw.cache_miss_tokens),
    totalTokens,
    costUsd: usageNumber(raw.cost_usd),
    costCny: usageOptionalNumber(raw.cost_cny),
    valueEstimateUsd: usageNumber(raw.value_estimate_usd),
    valueEstimateCny: usageOptionalNumber(raw.value_estimate_cny),
    valueEstimateCoverage: usageEstimateCoverage(raw.value_estimate_coverage),
    valueEstimateUnpricedRequests: usageNumber(raw.value_estimate_unpriced_requests),
    tokenEconomySavingsTokens: usageNumber(raw.token_economy_savings_tokens),
    turns: usageNumber(raw.turns),
    threadCount: usageNumber(raw.thread_count),
    cacheHitRate: usageRate(raw.cache_hit_rate)
  }
}

function normalizeTotals(raw: RawDailyUsageBucket & { days?: unknown; active_days?: unknown }): DailyUsageTotals {
  const bucket = normalizeBucket({ ...raw, date: 'totals' })
  return {
    inputTokens: bucket.inputTokens,
    outputTokens: bucket.outputTokens,
    reasoningTokens: bucket.reasoningTokens,
    cachedTokens: bucket.cachedTokens,
    cacheMissTokens: bucket.cacheMissTokens,
    totalTokens: bucket.totalTokens,
    costUsd: bucket.costUsd,
    costCny: bucket.costCny,
    valueEstimateUsd: bucket.valueEstimateUsd,
    valueEstimateCny: bucket.valueEstimateCny,
    valueEstimateCoverage: bucket.valueEstimateCoverage,
    valueEstimateUnpricedRequests: bucket.valueEstimateUnpricedRequests,
    tokenEconomySavingsTokens: bucket.tokenEconomySavingsTokens,
    turns: bucket.turns,
    threadCount: bucket.threadCount,
    cacheHitRate: bucket.cacheHitRate,
    days: usageNumber(raw.days),
    activeDays: usageNumber(raw.active_days)
  }
}

export function normalizeDailyUsageResponse(raw: RawDailyUsageResponse): DailyUsageSummary {
  const buckets = Array.isArray(raw.buckets)
    ? raw.buckets
        .map((item) => normalizeBucket((item ?? {}) as RawDailyUsageBucket))
        .filter((bucket) => bucket.date)
    : []
  return {
    groupBy: 'day',
    from: typeof raw.from === 'string' ? raw.from : buckets[0]?.date ?? '',
    to: typeof raw.to === 'string' ? raw.to : buckets[buckets.length - 1]?.date ?? '',
    timezone: typeof raw.timezone === 'string' && raw.timezone.trim() ? raw.timezone : clientTimezone(),
    buckets,
    totals: normalizeTotals((raw.totals ?? {}) as RawDailyUsageBucket & { days?: unknown; active_days?: unknown })
  }
}

export async function loadDailyUsage(
  range: DailyUsageRange,
  generation?: string | number
): Promise<DailyUsageSummary | null> {
  if (typeof window.kunGui?.runtimeRequest !== 'function') return null
  const response = await requestUsage(buildDailyUsagePath(range), 'daily usage', generation)
  if (!response.ok || !response.body.trim()) {
    throw usageRequestError('daily usage', response.status, response.body)
  }
  const parsed = parseUsageResponse<RawDailyUsageResponse>(response.body, 'daily usage')
  if (parsed.group_by !== 'day') {
    throw new Error('daily usage response did not use day grouping')
  }
  return normalizeDailyUsageResponse(parsed)
}

export function useDailyUsageState(
  enabled: boolean,
  refreshKey: unknown,
  days = DEFAULT_USAGE_HEATMAP_DAYS
): DailyUsageState {
  const shouldLoad = enabled
  const [state, setState] = useState<DailyUsageState>({
    usage: null,
    loading: false,
    loaded: false,
    error: null,
    stale: false
  })
  const previousRefreshKey = useRef(refreshKey)

  useEffect(() => {
    let cancelled = false
    if (!shouldLoad) {
      setState((current) => ({ ...current, loading: false, error: null }))
      return
    }
    const explicitRefresh = previousRefreshKey.current !== refreshKey
    previousRefreshKey.current = refreshKey
    const range = defaultDailyUsageRange(new Date(), days)
    const path = buildDailyUsagePath(range)
    const cached = readUsageSummaryCache<DailyUsageSummary>(path)
    if (cached) {
      setState({
        usage: cached.value,
        loading: cached.stale || explicitRefresh,
        loaded: true,
        error: null,
        updatedAt: cached.updatedAt,
        stale: cached.stale
      })
      if (!cached.stale && !explicitRefresh) return
    } else {
      setState((current) => ({ ...current, loading: true, error: null }))
    }
    void loadDailyUsage(range, String(refreshKey))
      .then((usage) => {
        if (cancelled) return
        if (!usage) {
          setState({ usage: null, loading: false, loaded: true, error: null, stale: false })
          return
        }
        const stored = writeUsageSummaryCache(path, usage)
        setState({
          usage,
          loading: false,
          loaded: true,
          error: null,
          updatedAt: stored.updatedAt,
          stale: false
        })
      })
      .catch((error) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error)
          setState((current) => ({
            ...current,
            loading: false,
            loaded: current.loaded,
            error: message,
            stale: Boolean(current.usage)
          }))
        }
      })
    return () => {
      cancelled = true
    }
  }, [days, refreshKey, shouldLoad])

  return state
}

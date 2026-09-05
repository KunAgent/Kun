import { useEffect, useRef, useState } from 'react'
import { requestUsage } from './usage-request-cache'
import { parseUsageResponse } from './usage-response'
import type { ThreadUsageSnapshot } from '../agent/thread-runtime-types'

const THREAD_USAGE_RETRY_DELAYS_MS = [250, 750] as const

export type ThreadUsageSummary = {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cachedTokens: number
  cacheMissTokens: number
  /** Thread-cumulative cache hit rate (dragged down by the cold first turn). */
  cacheHitRate: number | null
  /**
   * Cache hit rate of the most recent turn. A valid zero means the provider
   * reported a miss; when telemetry is absent, the footer falls back to the
   * thread-cumulative rate instead of hiding persisted cache usage.
   */
  lastTurnCacheHitRate: number | null
  lastTurnCacheableHitRate?: number | null
  lastTurnTotalInputHitRate?: number | null
  cacheMissReasons?: string[]
  cacheSuggestions?: string[]
  totalTokens: number
  costUsd: number | null
  costCny: number | null
  valueEstimateUsd: number | null
  valueEstimateCny: number | null
  valueEstimateCoverage?: 'complete' | 'partial' | 'unavailable'
  valueEstimatePricedRequests?: number
  valueEstimateUnpricedRequests?: number
  tokenEconomySavingsTokens: number
  turns: number
  avgTtftMs: number | null
  avgTokensPerSecond: number | null
}

export type ThreadUsageState = {
  usage: ThreadUsageSummary | null
  loading: boolean
  loaded: boolean
}

export function retainPendingThreadUsage(
  previous: ThreadUsageSummary | null,
  next: ThreadUsageSummary | null
): ThreadUsageSummary | null {
  if (!next) return previous
  if (next.lastTurnCacheHitRate != null || previous?.lastTurnCacheHitRate == null) return next
  return {
    ...next,
    lastTurnCacheHitRate: previous.lastTurnCacheHitRate,
    lastTurnCacheableHitRate: previous.lastTurnCacheableHitRate,
    lastTurnTotalInputHitRate: previous.lastTurnTotalInputHitRate,
    cacheMissReasons: previous.cacheMissReasons,
    cacheSuggestions: previous.cacheSuggestions
  }
}

/**
 * Merge the live per-request `usage` SSE snapshot over the persisted REST
 * summary. The REST summary stays authoritative after settle/reload; the live
 * snapshot only overlays fields the runtime reports every model response, so
 * the footer and session header update between turns instead of freezing.
 * Fields the live snapshot never carries (reference price estimates and
 * coverage) are left to the REST value and refreshed on reconcile.
 */
export function mergeLiveThreadUsage(
  rest: ThreadUsageSummary | null,
  live: ThreadUsageSnapshot | null
): ThreadUsageSummary | null {
  if (!live) return rest
  if (!rest) {
    return {
      inputTokens: live.inputTokens,
      outputTokens: live.outputTokens,
      reasoningTokens: live.reasoningTokens,
      cachedTokens: live.cachedTokens,
      cacheMissTokens: live.cacheMissTokens,
      cacheHitRate: live.cacheHitRate,
      lastTurnCacheHitRate: live.lastRequestCacheHitRate ?? null,
      lastTurnCacheableHitRate: live.cacheableTokenHitRate ?? null,
      lastTurnTotalInputHitRate: live.totalInputTokenHitRate ?? null,
      cacheMissReasons: live.cacheMissReasons,
      cacheSuggestions: live.cacheSuggestions,
      totalTokens: live.totalTokens,
      costUsd: live.costUsd,
      costCny: live.costCny,
      valueEstimateUsd: null,
      valueEstimateCny: null,
      valueEstimateCoverage: 'unavailable',
      tokenEconomySavingsTokens: live.tokenEconomySavingsTokens,
      turns: live.turns,
      avgTtftMs: live.avgTtftMs,
      avgTokensPerSecond: live.avgTokensPerSecond
    }
  }
  return {
    ...rest,
    inputTokens: live.inputTokens,
    outputTokens: live.outputTokens,
    reasoningTokens: live.reasoningTokens,
    cachedTokens: live.cachedTokens,
    cacheMissTokens: live.cacheMissTokens,
    cacheHitRate: live.cacheHitRate,
    lastTurnCacheHitRate: live.lastRequestCacheHitRate ?? rest.lastTurnCacheHitRate,
    lastTurnCacheableHitRate: live.cacheableTokenHitRate ?? rest.lastTurnCacheableHitRate,
    lastTurnTotalInputHitRate: live.totalInputTokenHitRate ?? rest.lastTurnTotalInputHitRate,
    cacheMissReasons: live.cacheMissReasons ?? rest.cacheMissReasons,
    cacheSuggestions: live.cacheSuggestions ?? rest.cacheSuggestions,
    totalTokens: live.totalTokens,
    costUsd: live.costUsd,
    costCny: live.costCny,
    tokenEconomySavingsTokens: live.tokenEconomySavingsTokens,
    turns: live.turns,
    avgTtftMs: live.avgTtftMs,
    avgTokensPerSecond: live.avgTokensPerSecond
  }
}

function usageNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function hasFiniteNumber(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === 'number' && Number.isFinite(record[key])
}

function usageRate(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null
}

export function formatCompactNumber(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return new Intl.NumberFormat().format(value)
}

export const USD_TO_CNY_REFERENCE_RATE = 7.2

export function isChineseLocale(locale?: string): boolean {
  const normalized = (locale ?? '').trim().toLowerCase()
  return normalized === 'zh' || normalized.startsWith('zh-')
}

function formatMoneyValue(value: number, locale: string): string {
  const safeValue = Number.isFinite(value) ? value : 0
  if (safeValue > 0 && safeValue < 0.0001) return '<0.0001'
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: safeValue >= 1 ? 2 : 4,
    maximumFractionDigits: safeValue >= 1 ? 2 : 4
  }).format(safeValue)
}

export function formatCost(
  costUsd: number | null | undefined,
  locale: string,
  costCny?: number | null,
  includeZero = false
): string {
  const hasUsd = typeof costUsd === 'number' && Number.isFinite(costUsd) &&
    (includeZero ? costUsd >= 0 : costUsd > 0)
  const hasCny = typeof costCny === 'number' && Number.isFinite(costCny) &&
    (includeZero ? costCny >= 0 : costCny > 0)
  if (!hasUsd && !hasCny) return '-'
  if (isChineseLocale(locale)) {
    return `￥${formatMoneyValue(hasCny ? costCny as number : (costUsd as number) * USD_TO_CNY_REFERENCE_RATE, locale)}`
  }
  return `$${formatMoneyValue(hasUsd ? costUsd as number : (costCny as number) / USD_TO_CNY_REFERENCE_RATE, locale)}`
}

export type MoneySummaryItem = {
  kind: 'actual' | 'estimate'
  value: string
  coverage?: 'complete' | 'partial'
}

export function summarizeThreadMoney(input: {
  costUsd: number | null
  costCny: number | null
  valueEstimateUsd: number | null
  valueEstimateCny: number | null
  valueEstimateCoverage?: 'complete' | 'partial' | 'unavailable'
  locale: string
}): MoneySummaryItem[] {
  const actual = formatCost(input.costUsd, input.locale, input.costCny)
  const inferredEstimateAvailable = (
    (input.valueEstimateUsd ?? 0) > 0 || (input.valueEstimateCny ?? 0) > 0
  )
  const estimateCoverage = input.valueEstimateCoverage ?? (
    inferredEstimateAvailable ? 'complete' : 'unavailable'
  )
  const estimate = estimateCoverage === 'unavailable'
    ? '-'
    : formatCost(
        input.valueEstimateUsd,
        input.locale,
        input.valueEstimateCny,
        true
      )
  const displayedEstimateCoverage: 'complete' | 'partial' = estimateCoverage === 'partial'
    ? 'partial'
    : 'complete'
  return [
    ...(actual === '-' ? [] : [{ kind: 'actual' as const, value: actual }]),
    ...(estimate === '-' ? [] : [{
      kind: 'estimate' as const,
      value: estimate,
      coverage: displayedEstimateCoverage
    }])
  ]
}

export function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '-'
  const percent = Math.max(0, Math.min(100, value * 100))
  if (percent === 0 || percent >= 10) return `${Math.round(percent)}%`
  return `${percent.toFixed(1)}%`
}

export function primaryCacheHitRate(
  usage: Pick<ThreadUsageSummary, 'cacheHitRate' | 'lastTurnCacheHitRate'>
): number | null {
  const latestRate = usage.lastTurnCacheHitRate
  if (latestRate != null && Number.isFinite(latestRate)) return latestRate
  const cumulativeRate = usage.cacheHitRate
  return cumulativeRate != null && Number.isFinite(cumulativeRate) ? cumulativeRate : null
}

/**
 * Cumulative thread cache hit rate derived from token counts — the SAME formula
 * the overall usage panel uses (cachedTokens / (cachedTokens + cacheMissTokens)).
 * Aggregate usage surfaces use this value; active-conversation displays use the
 * latest request instead. Falls back to the backend-provided `cacheHitRate` when
 * no token telemetry is available.
 */
export function cumulativeCacheHitRate(
  usage: Pick<ThreadUsageSummary, 'cachedTokens' | 'cacheMissTokens' | 'cacheHitRate'>
): number | null {
  const total = usage.cachedTokens + usage.cacheMissTokens
  if (total > 0) return usage.cachedTokens / total
  return usage.cacheHitRate
}

export function formatCacheMissReason(reason: string): string {
  switch (reason) {
    case 'cold_request':
      return 'cold request'
    case 'model_changed':
      return 'model changed'
    case 'provider_changed':
      return 'provider changed'
    case 'endpoint_changed':
      return 'endpoint changed'
    case 'stable_prefix_changed':
      return 'stable prefix changed'
    case 'tool_catalog_changed':
      return 'tool catalog changed'
    case 'skills_changed':
      return 'skills changed'
    case 'cache_ttl_unknown':
      return 'cache TTL/provider reuse unknown'
    case 'provider_cache_miss':
      return 'provider reported cache miss'
    case 'provider_metrics_unavailable':
      return 'provider cache metrics unavailable'
    default:
      return reason.replace(/_/g, ' ')
  }
}

export async function loadThreadUsage(
  threadId: string,
  generation?: string | number
): Promise<ThreadUsageSummary | null> {
  if (typeof window.kunGui?.runtimeRequest !== 'function') return null
  const params = new URLSearchParams({
    group_by: 'thread',
    thread_id: threadId
  })
  const r = await requestUsage(`/v1/usage?${params.toString()}`, 'thread usage', generation)
  if (!r.ok || !r.body.trim()) return null
  const parsed = parseUsageResponse<{
    buckets?: Array<Record<string, unknown>>
  }>(r.body, 'thread usage')
  const bucket = parsed.buckets?.find((item) => {
    const candidates = [item.thread_id, item.key, item.id, item.label]
    return candidates.some((candidate) => candidate === threadId)
  })
  if (!bucket) return null
  const inputTokens = usageNumber(bucket.input_tokens)
  const outputTokens = usageNumber(bucket.output_tokens)
  const reasoningTokens = usageNumber(bucket.reasoning_tokens)
  const bucketCacheHitRate = usageRate(bucket.cache_hit_rate)
  const hasBucketCacheTelemetry = bucketCacheHitRate !== null
  const cachedTokens = hasBucketCacheTelemetry
      ? usageNumber(bucket.cached_tokens)
      : 0
  const cacheMissTokens = hasBucketCacheTelemetry
      ? usageNumber(bucket.cache_miss_tokens)
      : 0
  const cacheHitRate = bucketCacheHitRate
  const lastTurnCacheHitRate = usageRate(bucket.last_turn_cache_hit_rate)
  const lastTurnCacheableHitRate = usageRate(bucket.last_turn_cacheable_hit_rate)
  const lastTurnTotalInputHitRate = usageRate(bucket.last_turn_total_input_hit_rate)
  const cacheMissReasons = Array.isArray(bucket.last_cache_miss_reasons)
    ? bucket.last_cache_miss_reasons.filter((value): value is string => typeof value === 'string')
    : []
  const cacheSuggestions = Array.isArray(bucket.last_cache_suggestions)
    ? bucket.last_cache_suggestions.filter((value): value is string => typeof value === 'string')
    : []
  const totalTokens = inputTokens + outputTokens
  const rawCostUsd = hasFiniteNumber(bucket, 'cost_usd') ? usageNumber(bucket.cost_usd) : null
  const rawCostCny = hasFiniteNumber(bucket, 'cost_cny') ? usageNumber(bucket.cost_cny) : null
  const costUsd = rawCostUsd != null && rawCostUsd > 0 ? rawCostUsd : null
  const costCny = rawCostCny != null && rawCostCny > 0 ? rawCostCny : null
  const rawValueEstimateUsd = hasFiniteNumber(bucket, 'value_estimate_usd') ? usageNumber(bucket.value_estimate_usd) : null
  const rawValueEstimateCny = hasFiniteNumber(bucket, 'value_estimate_cny') ? usageNumber(bucket.value_estimate_cny) : null
  const valueEstimatePricedRequests = usageNumber(bucket.value_estimate_priced_requests)
  const valueEstimateUnpricedRequests = usageNumber(bucket.value_estimate_unpriced_requests)
  const explicitValueEstimateCoverage = referenceCoverage(bucket.value_estimate_coverage)
  const valueEstimateCoverage = explicitValueEstimateCoverage ?? (
    valueEstimatePricedRequests > 0
      ? valueEstimateUnpricedRequests > 0 ? 'partial' : 'complete'
      : (rawValueEstimateUsd ?? 0) > 0 || (rawValueEstimateCny ?? 0) > 0
        ? 'complete'
        : 'unavailable'
  )
  const valueEstimateUsd = rawValueEstimateUsd != null && (
    rawValueEstimateUsd > 0 || valueEstimateCoverage !== 'unavailable'
  ) ? rawValueEstimateUsd : null
  const valueEstimateCny = rawValueEstimateCny != null && (
    rawValueEstimateCny > 0 || valueEstimateCoverage !== 'unavailable'
  ) ? rawValueEstimateCny : null
  const tokenEconomySavingsTokens = usageNumber(bucket.token_economy_savings_tokens)
  const turns = usageNumber(bucket.turns)
  const avgTtftMs = hasFiniteNumber(bucket, 'avg_ttft_ms') ? usageNumber(bucket.avg_ttft_ms) : null
  const avgTokensPerSecond = hasFiniteNumber(bucket, 'avg_tokens_per_second')
    ? usageNumber(bucket.avg_tokens_per_second)
    : null
  if (
    totalTokens <= 0 &&
    cachedTokens <= 0 &&
    (costUsd ?? 0) <= 0 &&
    (costCny ?? 0) <= 0 &&
    (valueEstimateUsd ?? 0) <= 0 &&
    (valueEstimateCny ?? 0) <= 0 &&
    tokenEconomySavingsTokens <= 0 &&
    turns <= 0
  ) return null
  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    cachedTokens,
    cacheMissTokens,
    cacheHitRate,
    lastTurnCacheHitRate,
    lastTurnCacheableHitRate,
    lastTurnTotalInputHitRate,
    cacheMissReasons,
    cacheSuggestions,
    totalTokens,
    costUsd,
    costCny,
    valueEstimateUsd,
    valueEstimateCny,
    valueEstimateCoverage,
    valueEstimatePricedRequests,
    valueEstimateUnpricedRequests,
    tokenEconomySavingsTokens,
    turns,
    avgTtftMs,
    avgTokensPerSecond
  }
}

function referenceCoverage(
  value: unknown
): ThreadUsageSummary['valueEstimateCoverage'] | undefined {
  return value === 'complete' || value === 'partial' || value === 'unavailable'
    ? value
    : undefined
}

export function useThreadUsageState(
  threadId: string | null | undefined,
  enabled: boolean,
  refreshKey: unknown
): ThreadUsageState {
  const activeThreadRef = useRef<string | null>(null)
  const [state, setState] = useState<ThreadUsageState>({
    usage: null,
    loading: false,
    loaded: false
  })

  useEffect(() => {
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const nextThreadId = threadId ?? null
    const threadChanged = activeThreadRef.current !== nextThreadId
    activeThreadRef.current = nextThreadId
    if (!threadId || !enabled) {
      setState((current) => threadChanged
        ? { usage: null, loading: false, loaded: false }
        : { ...current, loading: false })
      return
    }
    setState((current) => threadChanged
      ? { usage: null, loading: true, loaded: false }
      : { ...current, loading: true, loaded: false })

    const load = (attempt: number): void => {
      void loadThreadUsage(threadId, `${String(refreshKey)}:${attempt}`)
        .then((usage) => {
          if (cancelled) return
          if (usage) {
            setState((current) => ({
              usage: retainPendingThreadUsage(current.usage, usage),
              loading: false,
              loaded: true
            }))
            return
          }
          retryOrFinish(attempt)
        })
        .catch(() => {
          if (!cancelled) retryOrFinish(attempt)
        })
    }

    const retryOrFinish = (attempt: number): void => {
      const delay = THREAD_USAGE_RETRY_DELAYS_MS[attempt]
      if (delay === undefined) {
        setState((current) => ({ ...current, loading: false, loaded: true }))
        return
      }
      retryTimer = setTimeout(() => load(attempt + 1), delay)
    }

    load(0)
    return () => {
      cancelled = true
      if (retryTimer !== undefined) clearTimeout(retryTimer)
    }
  }, [enabled, refreshKey, threadId])

  return state
}

export function useThreadUsage(
  threadId: string | null | undefined,
  enabled: boolean,
  refreshKey: unknown
): ThreadUsageSummary | null {
  return useThreadUsageState(threadId, enabled, refreshKey).usage
}

/** Format a TTFT millisecond value as a compact seconds label (`1.2s`). */
export function formatTtftSeconds(value: number | null): string | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null
  return `${(value / 1_000).toFixed(1)}s`
}

/** Format tokens-per-second with one decimal (`38.5`). */
export function formatTps(value: number | null): string | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null
  return value.toFixed(1)
}

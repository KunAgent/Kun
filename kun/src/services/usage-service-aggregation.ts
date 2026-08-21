import {
  estimateCodexSubscriptionValue,
  isLegacyCodexModel
} from '../adapters/model/codex-subscription-pricing.js'
import { UsageCounter } from '../telemetry/usage-counter.js'
import { CacheTelemetry } from '../telemetry/cache-telemetry.js'
import {
  diagnoseCacheUsage,
  type CacheRequestSignature
} from '../cache/cache-diagnostics.js'
import { analyzeCacheRegression, cacheRegressionSeverityRank } from '../cache/cache-regression.js'
import type {
  DailyUsageBucket,
  DailyUsageCounters,
  ModelUsageBucket,
  ThreadUsageBucket,
  UsageSnapshot
} from '../contracts/usage.js'
import { type DailyUsageAccumulator, type ModelUsageAccumulator, type ThreadUsageAccumulator, type UsageCountersTarget } from './usage-service-query.js'

export function emptyCounters(): DailyUsageCounters {
  return {
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    cached_tokens: 0,
    cache_write_tokens: 0,
    cache_miss_tokens: 0,
    total_tokens: 0,
    cost_usd: 0,
    cost_cny: 0,
    value_estimate_usd: 0,
    value_estimate_cny: 0,
    value_estimate_coverage: 'unavailable',
    value_estimate_priced_requests: 0,
    value_estimate_unpriced_requests: 0,
    cache_savings_usd: 0,
    cache_savings_cny: 0,
    token_economy_savings_tokens: 0,
    token_economy_savings_usd: 0,
    token_economy_savings_cny: 0,
    turns: 0,
    thread_count: 0,
    cache_hit_rate: null
  }
}

export function hasCacheTelemetry(usage: UsageSnapshot): boolean {
  return typeof usage.cacheHitTokens === 'number' || typeof usage.cacheMissTokens === 'number'
}

export function addUsageCounters(
  target: UsageCountersTarget,
  usage: UsageSnapshot,
  recordModel?: string,
  completedAt?: string
): { hasCacheTelemetry: boolean } {
  const cached = typeof usage.cacheHitTokens === 'number' ? usage.cacheHitTokens : 0
  const miss = typeof usage.cacheMissTokens === 'number' ? usage.cacheMissTokens : 0
  target.input_tokens += usage.promptTokens
  target.output_tokens += usage.completionTokens
  target.reasoning_tokens += usage.reasoningTokens ?? 0
  target.cached_tokens += cached
  target.cache_write_tokens += usage.cacheWriteTokens ?? 0
  target.cache_miss_tokens += miss
  target.total_tokens += usage.totalTokens
  const model = usage.actualModelId ?? usage.requestedModelId ?? recordModel ?? ''
  const legacyCodexRecord = usage.billingKind == null && isLegacyCodexModel(model)
  const referenceValue = usage.billingKind === 'subscription' || legacyCodexRecord
  if (!referenceValue) {
    target.cost_usd += usage.costUsd ?? 0
    target.cost_cny += usage.costCny ?? 0
  }
  const estimate = referenceValue
    ? estimateCodexSubscriptionValue({
        model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        reasoningTokens: usage.reasoningTokens,
        cacheHitTokens: usage.cacheHitTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        completedAt,
        serviceTier: usage.serviceTier
      })
    : null
  target.value_estimate_usd += estimate?.valueEstimateUsd ?? 0
  target.value_estimate_cny += estimate?.valueEstimateCny ?? 0
  if (referenceValue) {
    const requests = usage.turns > 0 ? usage.turns : hasRequestUsage(usage) ? 1 : 0
    if (estimate) target.value_estimate_priced_requests += requests
    else target.value_estimate_unpriced_requests += requests
    target.value_estimate_coverage = referenceCoverage(target)
  }
  target.cache_savings_usd += usage.cacheSavingsUsd ?? 0
  target.cache_savings_cny += usage.cacheSavingsCny ?? 0
  target.token_economy_savings_tokens += usage.tokenEconomySavingsTokens ?? 0
  target.token_economy_savings_usd += usage.tokenEconomySavingsUsd ?? 0
  target.token_economy_savings_cny += usage.tokenEconomySavingsCny ?? 0
  target.turns += usage.turns
  return { hasCacheTelemetry: hasCacheTelemetry(usage) }
}

export function finalizeCacheRate<T extends DailyUsageCounters>(
  counters: T,
  hasTelemetry: boolean
): T {
  const cacheTotal = counters.cached_tokens + counters.cache_miss_tokens
  return {
    ...counters,
    cache_hit_rate: hasTelemetry && cacheTotal > 0 ? counters.cached_tokens / cacheTotal : null,
    value_estimate_coverage: referenceCoverage(counters)
  }
}

export function emptyDailyBucket(date: string): DailyUsageAccumulator {
  return { date, ...emptyCounters(), threadIds: new Set<string>(), hasCacheTelemetry: false }
}

export function emptyThreadBucket(threadId: string): ThreadUsageAccumulator {
  return {
    thread_id: threadId,
    ...emptyCounters(),
    last_turn_cache_hit_rate: null,
    last_turn_cacheable_hit_rate: null,
    last_turn_total_input_hit_rate: null,
    last_cache_miss_reasons: [],
    last_cache_suggestions: [],
    avg_ttft_ms: null,
    avg_tokens_per_second: null,
    hasCacheTelemetry: false,
    lastCompletedAt: ''
  }
}

export function emptyModelBucket(model: string): ModelUsageAccumulator {
  return { model, ...emptyCounters(), threadIds: new Set<string>(), hasCacheTelemetry: false }
}

type CounterFields = Omit<DailyUsageCounters, 'thread_count'>

function counters(bucket: CounterFields): CounterFields {
  return {
    input_tokens: bucket.input_tokens,
    output_tokens: bucket.output_tokens,
    reasoning_tokens: bucket.reasoning_tokens,
    cached_tokens: bucket.cached_tokens,
    cache_write_tokens: bucket.cache_write_tokens,
    cache_miss_tokens: bucket.cache_miss_tokens,
    total_tokens: bucket.total_tokens,
    cost_usd: bucket.cost_usd,
    cost_cny: bucket.cost_cny,
    value_estimate_usd: bucket.value_estimate_usd,
    value_estimate_cny: bucket.value_estimate_cny,
    value_estimate_coverage: bucket.value_estimate_coverage,
    value_estimate_priced_requests: bucket.value_estimate_priced_requests,
    value_estimate_unpriced_requests: bucket.value_estimate_unpriced_requests,
    cache_savings_usd: bucket.cache_savings_usd,
    cache_savings_cny: bucket.cache_savings_cny,
    token_economy_savings_tokens: bucket.token_economy_savings_tokens,
    token_economy_savings_usd: bucket.token_economy_savings_usd,
    token_economy_savings_cny: bucket.token_economy_savings_cny,
    turns: bucket.turns,
    cache_hit_rate: bucket.cache_hit_rate
  }
}

export function finalizeDailyBucket(bucket: DailyUsageAccumulator): DailyUsageBucket {
  const finalized = counters(finalizeCacheRate(bucket, bucket.hasCacheTelemetry))
  return { date: bucket.date, ...finalized, thread_count: bucket.thread_count }
}

export function finalizeThreadBucket(bucket: ThreadUsageAccumulator): ThreadUsageBucket {
  const finalized = counters(finalizeCacheRate(
    { ...bucket, thread_count: 0 },
    bucket.hasCacheTelemetry
  ))
  return {
    thread_id: bucket.thread_id,
    ...finalized,
    last_turn_cache_hit_rate: bucket.last_turn_cache_hit_rate,
    last_turn_cacheable_hit_rate: bucket.last_turn_cacheable_hit_rate,
    last_turn_total_input_hit_rate: bucket.last_turn_total_input_hit_rate,
    last_cache_miss_reasons: bucket.last_cache_miss_reasons,
    last_cache_suggestions: bucket.last_cache_suggestions,
    avg_ttft_ms: bucket.avg_ttft_ms,
    avg_tokens_per_second: bucket.avg_tokens_per_second
  }
}

export function finalizeModelBucket(bucket: ModelUsageAccumulator): ModelUsageBucket {
  const finalized = counters(finalizeCacheRate(bucket, bucket.hasCacheTelemetry))
  return { model: bucket.model, ...finalized, thread_count: bucket.thread_count }
}

function referenceCoverage(value: Pick<
  DailyUsageCounters,
  'value_estimate_priced_requests' | 'value_estimate_unpriced_requests'
>): DailyUsageCounters['value_estimate_coverage'] {
  if (value.value_estimate_priced_requests === 0) return 'unavailable'
  return value.value_estimate_unpriced_requests > 0 ? 'partial' : 'complete'
}

function hasRequestUsage(usage: UsageSnapshot): boolean {
  return usage.promptTokens > 0 || usage.completionTokens > 0 || usage.totalTokens > 0
}

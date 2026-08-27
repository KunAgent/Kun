import {
  aggregateCodexReferencePriceBreakdown,
  aggregateCodexReferenceValue,
  isLegacyCodexModel,
  type CodexReferencePriceBreakdown,
  type CodexSubscriptionValueInput
} from '../adapters/model/codex-subscription-pricing.js'
import type {
  DailyUsageResponse,
  ModelUsageResponse,
  ThreadUsageResponse,
  TurnUsageActualCost,
  TurnUsageCounters,
  TurnUsageReferencePriceBreakdown,
  TurnUsageResponse,
  UsageSnapshot
} from '../contracts/usage.js'
import { addUtcDays, assertValidTimezone, type DailyUsageAccumulator, type DailyUsageQuery, dateString, formatDateInTimezone, inclusiveDayCount, type ModelUsageAccumulator, type ModelUsageQuery, parseDateString, type ThreadUsageAccumulator, type ThreadUsageRecord, type TurnUsageQuery } from './usage-service-query.js'
import { addUsageCounters, emptyCounters, emptyDailyBucket, emptyModelBucket, emptyThreadBucket, finalizeCacheRate, finalizeDailyBucket, finalizeModelBucket, finalizeThreadBucket } from './usage-service-aggregation.js'

type SummedCounters = Pick<DailyUsageResponse['totals'],
  | 'input_tokens' | 'output_tokens' | 'reasoning_tokens' | 'cached_tokens' | 'cache_write_tokens' | 'cache_miss_tokens'
  | 'total_tokens' | 'cost_usd' | 'cost_cny' | 'value_estimate_usd' | 'value_estimate_cny'
  | 'value_estimate_priced_requests' | 'value_estimate_unpriced_requests'
  | 'cache_savings_usd' | 'cache_savings_cny' | 'token_economy_savings_tokens'
  | 'token_economy_savings_usd' | 'token_economy_savings_cny' | 'turns'
>

function addFinalCounters(target: ReturnType<typeof emptyCounters>, bucket: SummedCounters): void {
  target.input_tokens += bucket.input_tokens
  target.output_tokens += bucket.output_tokens
  target.reasoning_tokens += bucket.reasoning_tokens
  target.cached_tokens += bucket.cached_tokens
  target.cache_write_tokens += bucket.cache_write_tokens
  target.cache_miss_tokens += bucket.cache_miss_tokens
  target.total_tokens += bucket.total_tokens
  target.cost_usd += bucket.cost_usd
  target.cost_cny += bucket.cost_cny
  target.value_estimate_usd += bucket.value_estimate_usd
  target.value_estimate_cny += bucket.value_estimate_cny
  target.value_estimate_priced_requests += bucket.value_estimate_priced_requests
  target.value_estimate_unpriced_requests += bucket.value_estimate_unpriced_requests
  target.cache_savings_usd += bucket.cache_savings_usd
  target.cache_savings_cny += bucket.cache_savings_cny
  target.token_economy_savings_tokens += bucket.token_economy_savings_tokens
  target.token_economy_savings_usd += bucket.token_economy_savings_usd
  target.token_economy_savings_cny += bucket.token_economy_savings_cny
  target.turns += bucket.turns
}

export function buildThreadUsageResponse(records: readonly ThreadUsageRecord[]): ThreadUsageResponse {
  const buckets = new Map<string, ThreadUsageAccumulator>()
  for (const record of records) {
    const bucket = buckets.get(record.threadId) ?? emptyThreadBucket(record.threadId)
    const added = addUsageCounters(
      bucket, record.usage, record.model, record.completedAt, record.providerId
    )
    bucket.hasCacheTelemetry ||= added.hasCacheTelemetry
    if (record.completedAt >= bucket.lastCompletedAt) {
      bucket.lastCompletedAt = record.completedAt
      bucket.last_turn_cache_hit_rate = record.usage.cacheHitRate ?? null
      bucket.last_turn_cacheable_hit_rate = record.usage.cacheableTokenHitRate ?? null
      bucket.last_turn_total_input_hit_rate = record.usage.totalInputTokenHitRate ?? null
      bucket.last_cache_miss_reasons = record.usage.cacheMissReasons ?? []
      bucket.last_cache_suggestions = record.usage.cacheSuggestions ?? []
      bucket.avg_ttft_ms = record.usage.avgTtftMs ?? null
      bucket.avg_tokens_per_second = record.usage.avgTokensPerSecond ?? null
    }
    buckets.set(record.threadId, bucket)
  }
  const finalized = [...buckets.values()].map(finalizeThreadBucket)
    .sort((a, b) => b.total_tokens - a.total_tokens || a.thread_id.localeCompare(b.thread_id))
  const totalsBase = { ...emptyCounters(), thread_count: finalized.length }
  for (const bucket of finalized) addFinalCounters(totalsBase, bucket)
  return {
    group_by: 'thread',
    buckets: finalized,
    totals: finalizeCacheRate(totalsBase, [...buckets.values()].some((bucket) => bucket.hasCacheTelemetry))
  }
}

export function buildDailyUsageResponse(records: readonly ThreadUsageRecord[], query: DailyUsageQuery): DailyUsageResponse {
  const days = inclusiveDayCount(query.from, query.to)
  assertValidTimezone(query.timezone)
  const buckets = new Map<string, DailyUsageAccumulator>()
  const start = parseDateString(query.from, 'from')
  for (let offset = 0; offset < days; offset += 1) {
    const day = dateString(addUtcDays(start, offset))
    buckets.set(day, emptyDailyBucket(day))
  }
  for (const record of records) {
    const day = formatDateInTimezone(record.completedAt, query.timezone)
    const bucket = day ? buckets.get(day) : undefined
    if (!bucket) continue
    const added = addUsageCounters(
      bucket, record.usage, record.model, record.completedAt, record.providerId
    )
    bucket.threadIds.add(record.threadId)
    bucket.thread_count = bucket.threadIds.size
    bucket.hasCacheTelemetry ||= added.hasCacheTelemetry
  }
  const finalized = [...buckets.values()].map(finalizeDailyBucket)
  const totalsBase = { ...emptyCounters(), days, active_days: 0 }
  const threadIds = new Set<string>()
  for (const bucket of finalized) {
    addFinalCounters(totalsBase, bucket)
    const accumulator = buckets.get(bucket.date)
    for (const id of accumulator?.threadIds ?? []) threadIds.add(id)
    if (bucket.turns || bucket.total_tokens || bucket.cost_usd || bucket.cost_cny || bucket.value_estimate_usd) totalsBase.active_days += 1
  }
  totalsBase.thread_count = threadIds.size
  return { group_by: 'day', from: query.from, to: query.to, timezone: query.timezone, buckets: finalized, totals: finalizeCacheRate(totalsBase, [...buckets.values()].some((bucket) => bucket.hasCacheTelemetry)) }
}

export function buildModelUsageResponse(records: readonly ThreadUsageRecord[], query: ModelUsageQuery): ModelUsageResponse {
  const days = inclusiveDayCount(query.from, query.to)
  assertValidTimezone(query.timezone)
  const start = parseDateString(query.from, 'from')
  const dayBuckets = new Map<string, DailyUsageAccumulator>()
  const modelBuckets = new Map<string, ModelUsageAccumulator>()
  for (let offset = 0; offset < days; offset += 1) dayBuckets.set(dateString(addUtcDays(start, offset)), emptyDailyBucket(dateString(addUtcDays(start, offset))))
  for (const record of records) {
    const day = formatDateInTimezone(record.completedAt, query.timezone)
    const dayBucket = day ? dayBuckets.get(day) : undefined
    if (!dayBucket) continue
    const model = record.model?.trim() || 'unknown'
    const modelBucket = modelBuckets.get(model) ?? emptyModelBucket(model)
    for (const bucket of [dayBucket, modelBucket]) {
      const added = addUsageCounters(
        bucket, record.usage, record.model, record.completedAt, record.providerId
      )
      bucket.threadIds.add(record.threadId)
      bucket.thread_count = bucket.threadIds.size
      bucket.hasCacheTelemetry ||= added.hasCacheTelemetry
    }
    modelBuckets.set(model, modelBucket)
  }
  const finalizedDays = [...dayBuckets.values()].map(finalizeDailyBucket)
  const finalizedModels = [...modelBuckets.values()].map(finalizeModelBucket)
    .sort((a, b) => b.total_tokens - a.total_tokens || a.model.localeCompare(b.model))
  const totalsBase = { ...emptyCounters(), days, active_days: 0 }
  for (const bucket of finalizedDays) {
    addFinalCounters(totalsBase, bucket)
    if (bucket.turns || bucket.total_tokens || bucket.cost_usd || bucket.cost_cny || bucket.value_estimate_usd) totalsBase.active_days += 1
  }
  const ids = new Set<string>()
  for (const bucket of modelBuckets.values()) for (const id of bucket.threadIds) ids.add(id)
  totalsBase.thread_count = ids.size
  return { group_by: 'model', from: query.from, to: query.to, timezone: query.timezone, buckets: finalizedModels, days: finalizedDays, totals: finalizeCacheRate(totalsBase, [...modelBuckets.values()].some((bucket) => bucket.hasCacheTelemetry)) }
}

type TurnAccumulator = {
  turnId: string
  completedAt: string
  requests: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cachedTokens: number
  cacheWriteTokens: number
  totalTokens: number
  actualCosts: Map<string, number>
  referenceInputs: CodexSubscriptionValueInput[]
  providerIds: Set<string>
  models: Set<string>
}

export function buildTurnUsageResponse(
  records: readonly ThreadUsageRecord[],
  query: TurnUsageQuery
): TurnUsageResponse {
  const buckets = new Map<string, TurnAccumulator>()
  const totals = emptyTurnAccumulator('totals')
  for (const record of records) {
    const turnId = record.turnId?.trim()
    if (record.threadId !== query.threadId || !turnId) continue
    const bucket = buckets.get(turnId) ?? emptyTurnAccumulator(turnId)
    foldTurnRecord(bucket, record)
    foldTurnRecord(totals, record)
    buckets.set(turnId, bucket)
  }
  return {
    group_by: 'turn',
    thread_id: query.threadId,
    buckets: [...buckets.values()]
      .sort((left, right) => left.completedAt.localeCompare(right.completedAt) ||
        left.turnId.localeCompare(right.turnId))
      .map(finalizeTurnBucket),
    totals: finalizeTurnCounters(totals)
  }
}

function emptyTurnAccumulator(turnId: string): TurnAccumulator {
  return {
    turnId,
    completedAt: '',
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    actualCosts: new Map(),
    referenceInputs: [],
    providerIds: new Set(),
    models: new Set()
  }
}

function foldTurnRecord(target: TurnAccumulator, record: ThreadUsageRecord): void {
  const usage = record.usage
  const requests = usage.turns > 0 ? usage.turns : hasRequestUsage(usage) ? 1 : 0
  target.completedAt = target.completedAt < record.completedAt ? record.completedAt : target.completedAt
  target.requests += requests
  target.inputTokens += usage.promptTokens
  target.outputTokens += usage.completionTokens
  target.reasoningTokens += usage.reasoningTokens ?? 0
  target.cachedTokens += usage.cacheHitTokens ?? usage.cachedTokens ?? 0
  target.cacheWriteTokens += usage.cacheWriteTokens ?? 0
  target.totalTokens += usage.totalTokens
  const model = usage.actualModelId ?? usage.requestedModelId ?? record.model?.trim() ?? 'unknown'
  if (model) target.models.add(model)
  if (usage.actualProviderId?.trim()) target.providerIds.add(usage.actualProviderId.trim())
  const referenceValue = usage.billingKind === 'subscription' || (
    usage.billingKind == null && isLegacyCodexModel(model)
  )
  if (!referenceValue) addActualCosts(target.actualCosts, usage)
  if (referenceValue) {
    target.referenceInputs.push({
      model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      reasoningTokens: usage.reasoningTokens,
      cacheHitTokens: usage.cacheHitTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      completedAt: record.completedAt,
      serviceTier: usage.serviceTier,
      requestCount: requests
    })
  }
}

function finalizeTurnCounters(bucket: TurnAccumulator): TurnUsageCounters {
  const reference = aggregateCodexReferenceValue(bucket.referenceInputs)
  return {
    requests: bucket.requests,
    input_tokens: bucket.inputTokens,
    output_tokens: bucket.outputTokens,
    reasoning_tokens: bucket.reasoningTokens,
    cached_tokens: bucket.cachedTokens,
    cache_write_tokens: bucket.cacheWriteTokens,
    total_tokens: bucket.totalTokens,
    actual_cost: singleActualCost(bucket.actualCosts),
    reference_estimate_usd: reference.amountUsd,
    estimate_coverage: reference.coverage,
    provider_ids: [...bucket.providerIds].sort(),
    models: [...bucket.models].sort()
  }
}

function finalizeTurnBucket(bucket: TurnAccumulator): TurnUsageResponse['buckets'][number] {
  const reference = aggregateCodexReferencePriceBreakdown(bucket.referenceInputs)
  return {
    turn_id: bucket.turnId,
    ...finalizeTurnCounters(bucket),
    reference_price_breakdown: mapReferencePriceBreakdown(reference)
  }
}

function mapReferencePriceBreakdown(
  reference: CodexReferencePriceBreakdown
): TurnUsageReferencePriceBreakdown | null {
  if (reference.amountUsd === null || reference.pricedRequests === 0) return null
  return {
    currency: 'USD',
    amount: reference.amountUsd,
    priced_requests: reference.pricedRequests,
    unpriced_requests: reference.unpricedRequests,
    groups: reference.groups.map((group) => ({
      model: group.model,
      pricing_mode: group.pricingMode,
      request_count: group.requestCount,
      fast_multiplier: group.fastMultiplier,
      amount: group.amountUsd,
      items: group.items.map((item) => ({
        kind: item.kind,
        tokens: item.tokens,
        rate_per_million: item.ratePerMillionUsd,
        amount: item.amountUsd
      }))
    }))
  }
}

function addActualCosts(target: Map<string, number>, usage: UsageSnapshot): void {
  const reported = Object.entries(usage.costByCurrency ?? {})
  if (reported.length > 0) {
    for (const [currency, amount] of reported) {
      target.set(currency, (target.get(currency) ?? 0) + amount)
    }
    return
  }
  if (usage.costUsd !== undefined) {
    target.set('USD', (target.get('USD') ?? 0) + usage.costUsd)
  } else if (usage.costCny !== undefined) {
    target.set('CNY', (target.get('CNY') ?? 0) + usage.costCny)
  }
}

function singleActualCost(costs: Map<string, number>): TurnUsageActualCost | null {
  if (costs.size !== 1) return null
  const [currency, amount] = costs.entries().next().value as [string, number]
  return { currency, amount }
}

function hasRequestUsage(usage: UsageSnapshot): boolean {
  return usage.promptTokens > 0 || usage.completionTokens > 0 || usage.totalTokens > 0
}

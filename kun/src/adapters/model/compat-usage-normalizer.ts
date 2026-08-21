import { emptyUsageSnapshot, type UsageSnapshot } from '../../contracts/usage.js'
import { isCodexEndpoint } from './compat-model-support.js'
import { estimateDeepseekCost } from './deepseek-pricing.js'
import { estimateMiniMaxCost } from './minimax-pricing.js'

export function normalizeCompatUsage(input: {
  usage: Record<string, unknown>
  model: string
  providerBaseUrl: string
  billingKind?: 'subscription'
}): UsageSnapshot {
  const { usage, model, providerBaseUrl, billingKind } = input
  const subscription = billingKind === 'subscription' || isCodexEndpoint(providerBaseUrl)
  const completionTokens = numberValue(usage.completion_tokens ?? usage.eval_count ?? usage.output_tokens)
  const promptDetails = recordValue(usage.prompt_tokens_details)
  const inputDetails = recordValue(usage.input_tokens_details)
  const nativeHit = numberValue(usage.prompt_cache_hit_tokens)
  const nativeMiss = numberValue(usage.prompt_cache_miss_tokens)
  const hasNativeCache = nativeHit > 0 || nativeMiss > 0
  const cachedTokens = numberValue(promptDetails.cached_tokens ?? inputDetails.cached_tokens)
  const cacheRead = numberValue(usage.cache_read_input_tokens)
  const cacheCreation = numberValue(
    usage.cache_creation_input_tokens ??
    usage.cache_write_input_tokens ??
    usage.cache_write_tokens ??
    promptDetails.cache_write_tokens ??
    inputDetails.cache_write_tokens
  )
  const anthropicUsage = usage.prompt_tokens === undefined &&
    usage.prompt_eval_count === undefined &&
    usage.input_tokens !== undefined &&
    inputDetails.cached_tokens === undefined
  const reportedPromptTokens = numberValue(
    usage.prompt_tokens ?? usage.prompt_eval_count ?? usage.input_tokens
  )
  const promptTokens = anthropicUsage
    ? reportedPromptTokens + cacheRead + cacheCreation
    : reportedPromptTokens
  const cacheHit = hasNativeCache ? nativeHit : (cachedTokens > 0 ? cachedTokens : cacheRead)
  const cacheMiss = hasNativeCache ? nativeMiss : Math.max(promptTokens - cacheHit, 0)
  const cacheTotal = cacheHit + cacheMiss
  const totalTokens = anthropicUsage
    ? promptTokens + completionTokens
    : numberValue(usage.total_tokens, promptTokens + completionTokens)
  const pricingCacheRead = cacheRead || cacheHit
  const pricingCacheWrite = cacheCreation
  const pricingInputTokens = anthropicUsage
    ? reportedPromptTokens
    : Math.max(promptTokens - pricingCacheRead - pricingCacheWrite, 0)
  const estimatedCost = estimateDeepseekCost({
    model,
    providerHost: providerBaseUrl,
    cacheHitTokens: cacheHit,
    cacheMissTokens: cacheMiss,
    outputTokens: completionTokens
  }) ?? estimateMiniMaxCost({
    model,
    providerHost: providerBaseUrl,
    inputTokens: pricingInputTokens,
    cacheReadTokens: pricingCacheRead,
    cacheWriteTokens: pricingCacheWrite,
    outputTokens: completionTokens
  })
  const reportedCostUsd = Number(usage.cost_usd ?? usage.costUsd)
  const reportedCostCny = Number(usage.cost_cny ?? usage.costCny)
  return {
    ...emptyUsageSnapshot(),
    promptTokens,
    completionTokens,
    totalTokens,
    cachedTokens: cacheHit || cachedTokens || cacheRead || 0,
    cacheHitTokens: cacheHit,
    cacheMissTokens: cacheMiss,
    cacheWriteTokens: pricingCacheWrite,
    cacheHitRate: cacheTotal === 0 ? null : cacheHit / cacheTotal,
    turns: 1,
    actualModelId: model,
    billingKind: subscription ? 'subscription' : 'api',
    costUsd: Number.isFinite(reportedCostUsd) ? reportedCostUsd : estimatedCost?.costUsd,
    costCny: Number.isFinite(reportedCostCny) ? reportedCostCny : estimatedCost?.costCny
  }
}

function numberValue(value: unknown, fallback = 0): number {
  const number = Number(value ?? fallback)
  return Number.isFinite(number) ? number : fallback
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

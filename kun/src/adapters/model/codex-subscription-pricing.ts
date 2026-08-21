export const USD_TO_CNY_REFERENCE_RATE = 7.2

const TOKENS_PER_MILLION = 1_000_000
const LONG_CONTEXT_THRESHOLD = 272_000
const GPT_56_PRICE_CUTOFF_MS = Date.parse('2026-07-30T00:00:00.000Z')

type CodexPrice = {
  input: number
  cacheRead?: number
  cacheWrite?: number
  output: number
  longContext?: {
    input: number
    cacheRead?: number
    cacheWrite?: number
    output: number
  }
}

/**
 * OpenAI list prices per million tokens. GPT-5.6 cache writes are billed at
 * 1.25x uncached input. Older models without an explicit write rate fall back
 * to their uncached-input rate.
 */
const CURRENT_PRICES: Readonly<Record<string, CodexPrice>> = {
  'gpt-5': price(1.25, 0.125, 10),
  'gpt-5-codex': price(1.25, 0.125, 10),
  'gpt-5-mini': price(0.25, 0.025, 2),
  'gpt-5-nano': price(0.05, 0.005, 0.4),
  'gpt-5-pro': price(15, undefined, 120),
  'gpt-5.1': price(1.25, 0.125, 10),
  'gpt-5.1-codex': price(1.25, 0.125, 10),
  'gpt-5.1-codex-max': price(1.25, 0.125, 10),
  'gpt-5.1-codex-mini': price(0.25, 0.025, 2),
  'gpt-5.2': price(1.75, 0.175, 14),
  'gpt-5.2-codex': price(1.75, 0.175, 14),
  'gpt-5.2-pro': price(21, undefined, 168),
  'gpt-5.3-codex': price(1.75, 0.175, 14),
  'gpt-5.3-codex-spark': price(0, 0, 0),
  'gpt-5.4': tieredPrice(2.5, 0.25, 15, 5, 0.5, 22.5),
  'gpt-5.4-mini': price(0.75, 0.075, 4.5),
  'gpt-5.4-nano': price(0.2, 0.02, 1.25),
  'gpt-5.4-pro': price(30, undefined, 180),
  'gpt-5.5': tieredPrice(5, 0.5, 30, 10, 1, 45),
  'gpt-5.5-pro': price(30, undefined, 180),
  'gpt-5.6-sol': tieredPrice(5, 0.5, 30, 10, 1, 45, 6.25, 12.5),
  'gpt-5.6-terra': tieredPrice(2, 0.2, 12, 4, 0.4, 18, 2.5, 5),
  'gpt-5.6-luna': tieredPrice(0.2, 0.02, 1.2, 0.4, 0.04, 1.8, 0.25, 0.5)
}

const HISTORICAL_GPT_56_PRICES: Readonly<Record<string, CodexPrice>> = {
  'gpt-5.6-terra': tieredPrice(2.5, 0.25, 15, 5, 0.5, 22.5, 3.125, 6.25),
  'gpt-5.6-luna': tieredPrice(1, 0.1, 6, 2, 0.2, 9, 1.25, 2.5)
}

const FAST_MULTIPLIERS: Readonly<Record<string, number>> = {
  'gpt-5.4': 2,
  'gpt-5.4-mini': 2,
  'gpt-5.5': 2.5,
  'gpt-5.6-sol': 2,
  'gpt-5.6-terra': 2,
  'gpt-5.6-luna': 2
}

export type CodexSubscriptionValueInput = {
  model: string
  promptTokens: number
  completionTokens: number
  /** Included for telemetry completeness; completion tokens already contain billable reasoning. */
  reasoningTokens?: number
  cacheHitTokens?: number
  cacheWriteTokens?: number
  completedAt?: string | Date
  serviceTier?: 'priority'
  /** Number of model requests represented by this aggregate row. */
  requestCount?: number
}

export type CodexSubscriptionEstimate = {
  valueEstimateUsd: number
  valueEstimateCny: number
  normalizedModel: string
  pricingMode: CodexReferencePricingMode
  fastMultiplier: number | null
  items: CodexReferencePriceItem[]
}

export type CodexReferencePricingMode = 'standard' | 'fast' | 'long_context'

export type CodexReferencePriceItemKind =
  | 'uncached_input'
  | 'cache_read'
  | 'cache_write'
  | 'output'

export type CodexReferencePriceItem = {
  kind: CodexReferencePriceItemKind
  tokens: number
  ratePerMillionUsd: number
  amountUsd: number
}

export type CodexReferencePriceGroup = {
  model: string
  pricingMode: CodexReferencePricingMode
  requestCount: number
  fastMultiplier: number | null
  amountUsd: number
  items: CodexReferencePriceItem[]
}

export type CodexReferencePriceBreakdown = CodexReferenceValueSummary & {
  groups: CodexReferencePriceGroup[]
}

export type CodexReferenceCoverage = 'complete' | 'partial' | 'unavailable'

export type CodexReferenceValueSummary = {
  amountUsd: number | null
  amountCny: number | null
  coverage: CodexReferenceCoverage
  pricedRequests: number
  unpricedRequests: number
}

/**
 * Estimate public API list-price value for one Codex subscription request.
 * This is a reference value, never an account charge or subscription bill.
 */
export function estimateCodexSubscriptionValue(
  input: CodexSubscriptionValueInput
): CodexSubscriptionEstimate | null {
  const model = normalizeModelId(input.model)
  const prices = priceForDate(model, input.completedAt)
  if (!prices) return null

  const totalInput = nonNegative(input.promptTokens)
  const cacheRead = Math.min(nonNegative(input.cacheHitTokens), totalInput)
  const cacheWrite = Math.min(nonNegative(input.cacheWriteTokens), totalInput - cacheRead)
  const freshInput = totalInput - cacheRead - cacheWrite
  const overLongContextThreshold = totalInput > LONG_CONTEXT_THRESHOLD
  const usesLongContextRates = overLongContextThreshold && prices.longContext !== undefined

  const rates = usesLongContextRates ? prices.longContext as NonNullable<CodexPrice['longContext']> : prices
  const inputRate = rates.input
  const cacheReadRate = rates.cacheRead ?? inputRate
  const cacheWriteRate = rates.cacheWrite ?? inputRate
  const outputRate = rates.output
  // Priority is the backward-compatible request tag for API Fast. Fast is not
  // available for long context or every historical model; those requests
  // remain priceable at their normal Standard/long-context rate.
  const multiplier = input.serviceTier === 'priority' && !overLongContextThreshold
    ? recordValue(FAST_MULTIPLIERS, model) ?? 1
    : 1
  const pricingMode: CodexReferencePricingMode = usesLongContextRates
    ? 'long_context'
    : multiplier > 1
      ? 'fast'
      : 'standard'
  const fastMultiplier = pricingMode === 'fast' ? multiplier : null
  const items = [
    priceItem('uncached_input', freshInput, inputRate * multiplier),
    priceItem('cache_read', cacheRead, cacheReadRate * multiplier),
    priceItem('cache_write', cacheWrite, cacheWriteRate * multiplier),
    priceItem('output', nonNegative(input.completionTokens), outputRate * multiplier)
  ]
  const usd = items.reduce((sum, item) => sum + item.amountUsd, 0)
  return {
    valueEstimateUsd: usd,
    valueEstimateCny: usd * USD_TO_CNY_REFERENCE_RATE,
    normalizedModel: model,
    pricingMode,
    fastMultiplier,
    items
  }
}

/** Aggregate known reference values while retaining explicit unknown coverage. */
export function aggregateCodexReferenceValue(
  inputs: readonly CodexSubscriptionValueInput[]
): CodexReferenceValueSummary {
  const breakdown = aggregateCodexReferencePriceBreakdown(inputs)
  return {
    amountUsd: breakdown.amountUsd,
    amountCny: breakdown.amountCny,
    coverage: breakdown.coverage,
    pricedRequests: breakdown.pricedRequests,
    unpricedRequests: breakdown.unpricedRequests
  }
}

/** Aggregate value and exact effective-rate groups for a per-turn explanation. */
export function aggregateCodexReferencePriceBreakdown(
  inputs: readonly CodexSubscriptionValueInput[]
): CodexReferencePriceBreakdown {
  let amountUsd = 0
  let pricedRequests = 0
  let unpricedRequests = 0
  const groups = new Map<string, CodexReferencePriceGroup>()
  for (const input of inputs) {
    const requests = referenceRequestCount(input)
    if (requests <= 0) continue
    const estimate = estimateCodexSubscriptionValue(input)
    if (!estimate) {
      unpricedRequests += requests
      continue
    }
    amountUsd += estimate.valueEstimateUsd
    pricedRequests += requests
    addReferencePriceGroup(groups, estimate, requests)
  }
  const coverage: CodexReferenceCoverage = pricedRequests === 0
    ? 'unavailable'
    : unpricedRequests > 0
      ? 'partial'
      : 'complete'
  return {
    amountUsd: pricedRequests > 0 ? amountUsd : null,
    amountCny: pricedRequests > 0 ? amountUsd * USD_TO_CNY_REFERENCE_RATE : null,
    coverage,
    pricedRequests,
    unpricedRequests,
    groups: [...groups.values()]
  }
}

/**
 * Resolve legacy unattributed Codex usage only when exactly one configured
 * account can own it. Explicit attribution never falls through to a sibling.
 */
export function resolveCodexUsageProviderId(
  actualProviderId: string | undefined,
  configuredCodexProviderIds: readonly string[]
): string | null {
  const configured = [...new Set(configuredCodexProviderIds.map((id) => id.trim()).filter(Boolean))]
  const actual = actualProviderId?.trim()
  if (actual) return configured.includes(actual) ? actual : null
  return configured.length === 1 ? configured[0] : null
}

export function isLegacyCodexModel(model: string): boolean {
  return /^codex\//iu.test(model.trim())
}

function priceForDate(model: string, completedAt: string | Date | undefined): CodexPrice | undefined {
  const completedAtMs = completedAt instanceof Date
    ? completedAt.getTime()
    : typeof completedAt === 'string'
      ? Date.parse(completedAt)
      : Number.NaN
  if (
    Number.isFinite(completedAtMs) &&
    completedAtMs < GPT_56_PRICE_CUTOFF_MS &&
    recordValue(HISTORICAL_GPT_56_PRICES, model)
  ) {
    return recordValue(HISTORICAL_GPT_56_PRICES, model)
  }
  return recordValue(CURRENT_PRICES, model)
}

function normalizeModelId(model: string): string {
  const withoutLabel = model.trim().toLowerCase().replace(/\s*\([^)]*\)\s*$/u, '')
  const qualified = /^(codex|openai)\/([^/]+)$/u.exec(withoutLabel)
  const candidate = qualified?.[2] ?? (withoutLabel.includes('/') || withoutLabel.includes(':')
    ? ''
    : withoutLabel)
  const dated = /^(.+)-\d{4}-\d{2}-\d{2}$/u.exec(candidate)
  const normalized = dated?.[1] && (recordValue(CURRENT_PRICES, dated[1]) || dated[1] === 'gpt-5.6')
    ? dated[1]
    : candidate
  return normalized === 'gpt-5.6' ? 'gpt-5.6-sol' : normalized
}

function nonNegative(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

function recordValue<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined
}

function referenceRequestCount(input: CodexSubscriptionValueInput): number {
  if (input.requestCount !== undefined) return Math.max(0, Math.floor(input.requestCount))
  return 1
}

function priceItem(
  kind: CodexReferencePriceItemKind,
  tokens: number,
  ratePerMillionUsd: number
): CodexReferencePriceItem {
  return {
    kind,
    tokens,
    ratePerMillionUsd,
    amountUsd: tokens * ratePerMillionUsd / TOKENS_PER_MILLION
  }
}

function addReferencePriceGroup(
  groups: Map<string, CodexReferencePriceGroup>,
  estimate: CodexSubscriptionEstimate,
  requests: number
): void {
  const key = JSON.stringify([
    estimate.normalizedModel,
    estimate.pricingMode,
    estimate.fastMultiplier,
    ...estimate.items.map((item) => item.ratePerMillionUsd)
  ])
  const existing = groups.get(key)
  if (!existing) {
    groups.set(key, {
      model: estimate.normalizedModel,
      pricingMode: estimate.pricingMode,
      requestCount: requests,
      fastMultiplier: estimate.fastMultiplier,
      amountUsd: estimate.valueEstimateUsd,
      items: estimate.items.map((item) => ({ ...item }))
    })
    return
  }
  existing.requestCount += requests
  existing.amountUsd += estimate.valueEstimateUsd
  for (const [index, item] of estimate.items.entries()) {
    const target = existing.items[index]
    if (!target) continue
    target.tokens += item.tokens
    target.amountUsd += item.amountUsd
  }
}

function price(input: number, cacheRead: number | undefined, output: number): CodexPrice {
  return { input, ...(cacheRead !== undefined ? { cacheRead } : {}), output }
}

function tieredPrice(
  input: number,
  cacheRead: number | undefined,
  output: number,
  longInput: number,
  longCacheRead: number | undefined,
  longOutput: number,
  cacheWrite?: number,
  longCacheWrite?: number
): CodexPrice {
  return {
    input,
    ...(cacheRead !== undefined ? { cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cacheWrite } : {}),
    output,
    longContext: {
      input: longInput,
      ...(longCacheRead !== undefined ? { cacheRead: longCacheRead } : {}),
      ...(longCacheWrite !== undefined ? { cacheWrite: longCacheWrite } : {}),
      output: longOutput
    }
  }
}

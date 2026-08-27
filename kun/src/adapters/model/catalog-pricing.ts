import type { ModelCatalogPricing } from '../../contracts/capabilities-core.js'
import { USD_TO_CNY_REFERENCE_RATE } from './codex-subscription-pricing.js'

export type CatalogCostEstimate = {
  costUsd: number
  costCny: number
}

/**
 * Last-resort local cost estimate from catalog reference pricing
 * (USD per million tokens). Cache prices fall back to the input price when
 * the catalog omits them, matching models.dev pricing semantics.
 */
export function estimateCatalogCost(input: {
  pricing: ModelCatalogPricing | undefined
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
}): CatalogCostEstimate | null {
  const { pricing } = input
  if (!pricing) return null
  const perMillion = (tokens: number, price: number): number =>
    tokens * price / 1_000_000
  const costUsd =
    perMillion(input.inputTokens, pricing.inputUsdPerMillion) +
    perMillion(input.cacheReadTokens, pricing.cacheReadUsdPerMillion ?? pricing.inputUsdPerMillion) +
    perMillion(input.cacheWriteTokens, pricing.cacheWriteUsdPerMillion ?? pricing.inputUsdPerMillion) +
    perMillion(input.outputTokens, pricing.outputUsdPerMillion)
  if (!Number.isFinite(costUsd)) return null
  return {
    costUsd,
    costCny: costUsd * USD_TO_CNY_REFERENCE_RATE
  }
}

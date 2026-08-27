import { isDeepSeekHost } from './model-error-probe.js'

export type DeepseekCurrencyCosts = {
  costUsd: number
  costCny: number
}

type DeepseekPrice = {
  inputCacheHit: number
  inputCacheMiss: number
  output: number
}

type DeepseekPriceSet = {
  usd: DeepseekPrice
  cny: DeepseekPrice
}

type DeepseekTimePriceSet = {
  offPeak: DeepseekPriceSet
  peak: DeepseekPriceSet
}

const TOKENS_PER_MILLION = 1_000_000
const BEIJING_UTC_OFFSET_MS = 8 * 60 * 60 * 1_000
const TIME_BASED_PRICING_EFFECTIVE_AT_MS = Date.UTC(2026, 7, 16, 16)
const WEEKEND_OFF_PEAK_EFFECTIVE_AT_MS = Date.UTC(2026, 7, 22, 16)

// Official DeepSeek API prices per 1M tokens before time-based pricing began.
// Kept so callers that explicitly price historical usage do not apply the new
// schedule retroactively.
const DEEPSEEK_V4_LEGACY_PRICES: Record<'flash' | 'pro', DeepseekPriceSet> = {
  flash: {
    usd: {
      inputCacheHit: 0.0028,
      inputCacheMiss: 0.14,
      output: 0.28
    },
    cny: {
      inputCacheHit: 0.02,
      inputCacheMiss: 1,
      output: 2
    }
  },
  pro: {
    usd: {
      inputCacheHit: 0.003625,
      inputCacheMiss: 0.435,
      output: 0.87
    },
    cny: {
      inputCacheHit: 0.025,
      inputCacheMiss: 3,
      output: 6
    }
  }
}

// Official DeepSeek API prices per 1M tokens since 2026-08-17.
// deepseek-chat/deepseek-reasoner retain their v4-flash alias behavior.
const DEEPSEEK_V4_PRICES: Record<'flash' | 'pro', DeepseekTimePriceSet> = {
  flash: {
    offPeak: {
      usd: { inputCacheHit: 0.007, inputCacheMiss: 0.22, output: 0.66 },
      cny: { inputCacheHit: 0.05, inputCacheMiss: 1.5, output: 4.5 }
    },
    peak: {
      usd: { inputCacheHit: 0.014, inputCacheMiss: 0.44, output: 1.32 },
      cny: { inputCacheHit: 0.1, inputCacheMiss: 3, output: 9 }
    }
  },
  pro: {
    offPeak: {
      usd: { inputCacheHit: 0.022, inputCacheMiss: 0.66, output: 1.98 },
      cny: { inputCacheHit: 0.15, inputCacheMiss: 4.5, output: 13.5 }
    },
    peak: {
      usd: { inputCacheHit: 0.044, inputCacheMiss: 1.32, output: 3.96 },
      cny: { inputCacheHit: 0.3, inputCacheMiss: 9, output: 27 }
    }
  }
}

type DeepseekPricingTier = keyof typeof DEEPSEEK_V4_PRICES

function pricingTierForModel(model: string): DeepseekPricingTier | null {
  const normalized = model.trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'deepseek-v4-pro' || normalized.endsWith('/deepseek-v4-pro')) return 'pro'
  if (
    normalized === 'deepseek-v4-flash' ||
    normalized === 'deepseek-chat' ||
    normalized === 'deepseek-reasoner' ||
    normalized.endsWith('/deepseek-v4-flash') ||
    normalized.endsWith('/deepseek-chat') ||
    normalized.endsWith('/deepseek-reasoner')
  ) {
    return 'flash'
  }
  return null
}

function isPeakPriceAt(atMs: number): boolean {
  // An invalid explicit date should never make the estimate look cheaper.
  if (!Number.isFinite(atMs)) return true
  const beijing = new Date(atMs + BEIJING_UTC_OFFSET_MS)
  const weekDay = beijing.getUTCDay()
  if (
    atMs >= WEEKEND_OFF_PEAK_EFFECTIVE_AT_MS &&
    (weekDay === 0 || weekDay === 6)
  ) {
    return false
  }
  const minute = beijing.getUTCHours() * 60 + beijing.getUTCMinutes()
  return (minute >= 9 * 60 && minute < 12 * 60) ||
    (minute >= 14 * 60 && minute < 18 * 60)
}

function pricesFor(tier: DeepseekPricingTier, at: Date): DeepseekPriceSet {
  const atMs = at.getTime()
  if (Number.isFinite(atMs) && atMs < TIME_BASED_PRICING_EFFECTIVE_AT_MS) {
    return DEEPSEEK_V4_LEGACY_PRICES[tier]
  }
  const prices = DEEPSEEK_V4_PRICES[tier]
  return isPeakPriceAt(atMs) ? prices.peak : prices.offPeak
}

function computeCost(
  price: DeepseekPrice,
  cacheHitTokens: number,
  cacheMissTokens: number,
  outputTokens: number
): number {
  return (
    (cacheHitTokens / TOKENS_PER_MILLION) * price.inputCacheHit +
    (cacheMissTokens / TOKENS_PER_MILLION) * price.inputCacheMiss +
    (outputTokens / TOKENS_PER_MILLION) * price.output
  )
}

export function estimateDeepseekCost(input: {
  model: string
  cacheHitTokens: number
  cacheMissTokens: number
  outputTokens: number
  /**
   * When the request occurred. DeepSeek switches between peak and off-peak
   * prices using Beijing time. Defaults to the current instant.
   */
  at?: Date
  /**
   * Optional upstream base URL. When provided, the function returns
   * null for non-DeepSeek hosts (OpenRouter, llama.cpp, etc.) because
   * we don't have authoritative prices for third-party providers.
   * Callers that omit it keep the legacy behavior: trust the model
   * name. See issue #26.
   */
  providerHost?: string
}): DeepseekCurrencyCosts | null {
  if (input.providerHost !== undefined && !isDeepSeekHost(input.providerHost)) {
    return null
  }
  const tier = pricingTierForModel(input.model)
  if (!tier) return null
  const prices = pricesFor(tier, input.at ?? new Date())
  return {
    costUsd: computeCost(prices.usd, input.cacheHitTokens, input.cacheMissTokens, input.outputTokens),
    costCny: computeCost(prices.cny, input.cacheHitTokens, input.cacheMissTokens, input.outputTokens)
  }
}

// Savings are reported in tokens only. Money estimates for savings were
// removed: list prices drift and third-party providers make any currency
// figure unreliable, so the UI now shows saved tokens instead.

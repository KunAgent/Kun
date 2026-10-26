export type MiniMaxCurrencyCosts = {
  costUsd?: number
  costCny?: number
}

type MiniMaxPrice = {
  input: number
  output: number
  cacheRead: number
  cacheWrite?: number
}

const TOKENS_PER_MILLION = 1_000_000
const M3_LONG_CONTEXT_THRESHOLD = 512_000

// Official MiniMax pay-as-you-go language model prices, CNY per 1M tokens.
// Token Plan credits are deducted at the matching pay-as-you-go list price.
const MINIMAX_TEXT_PRICES: Record<string, MiniMaxPrice> = {
  'minimax-m2.7': {
    input: 2.1,
    output: 8.4,
    cacheRead: 0.42,
    cacheWrite: 2.625
  },
  'minimax-m2.7-highspeed': {
    input: 4.2,
    output: 16.8,
    cacheRead: 0.42,
    cacheWrite: 2.625
  },
  'minimax-m2.5': {
    input: 2.1,
    output: 8.4,
    cacheRead: 0.21,
    cacheWrite: 2.625
  },
  'minimax-m2.5-highspeed': {
    input: 4.2,
    output: 16.8,
    cacheRead: 0.21,
    cacheWrite: 2.625
  },
  'minimax-m2.1': {
    input: 2.1,
    output: 8.4,
    cacheRead: 0.21,
    cacheWrite: 2.625
  },
  'minimax-m2.1-highspeed': {
    input: 4.2,
    output: 16.8,
    cacheRead: 0.21,
    cacheWrite: 2.625
  },
  'minimax-m2': {
    input: 2.1,
    output: 8.4,
    cacheRead: 0.21,
    cacheWrite: 2.625
  }
}

const MINIMAX_M3_STANDARD_PRICE: MiniMaxPrice = {
  input: 2.1,
  output: 8.4,
  cacheRead: 0.42
}

const MINIMAX_M3_LONG_CONTEXT_PRICE: MiniMaxPrice = {
  input: 4.2,
  output: 16.8,
  cacheRead: 0.84
}

// MiniMax-M3.1-Flash published prices per 1M tokens. The China platform bills
// CNY and the international platform bills USD, so the request host picks the table.
const MINIMAX_M31_FLASH_CNY_PRICE: MiniMaxPrice = {
  input: 1,
  output: 4,
  cacheRead: 0.1
}

const MINIMAX_M31_FLASH_USD_PRICE: MiniMaxPrice = {
  input: 0.15,
  output: 0.6,
  cacheRead: 0.015
}

function isMiniMaxHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    return host === 'api.minimaxi.com' || host === 'api.minimax.io' || host === 'api.minimax.chat'
  } catch {
    return false
  }
}

function normalizeModel(model: string): string {
  const normalized = model.trim().toLowerCase()
  const parts = normalized.split('/').filter(Boolean)
  return parts.at(-1) ?? normalized
}

function priceForModel(model: string, billableInputTokens: number): MiniMaxPrice | null {
  const normalized = normalizeModel(model)
  if (normalized === 'minimax-m3') {
    return billableInputTokens > M3_LONG_CONTEXT_THRESHOLD
      ? MINIMAX_M3_LONG_CONTEXT_PRICE
      : MINIMAX_M3_STANDARD_PRICE
  }
  return MINIMAX_TEXT_PRICES[normalized] ?? null
}

function flashPriceForHost(providerHost: string | undefined): {
  price: MiniMaxPrice
  currency: 'CNY' | 'USD'
} {
  try {
    const host = providerHost ? new URL(providerHost).hostname.toLowerCase() : ''
    if (host === 'api.minimax.io' || host === 'api.minimax.chat') {
      return { price: MINIMAX_M31_FLASH_USD_PRICE, currency: 'USD' }
    }
  } catch {
    // Fall through to the China platform price.
  }
  return { price: MINIMAX_M31_FLASH_CNY_PRICE, currency: 'CNY' }
}

function costForPrice(input: {
  price: MiniMaxPrice
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
}): number {
  const cacheWritePrice = input.price.cacheWrite ?? input.price.input
  return (
    (input.inputTokens / TOKENS_PER_MILLION) * input.price.input +
    (input.cacheReadTokens / TOKENS_PER_MILLION) * input.price.cacheRead +
    (input.cacheWriteTokens / TOKENS_PER_MILLION) * cacheWritePrice +
    (input.outputTokens / TOKENS_PER_MILLION) * input.price.output
  )
}

export function estimateMiniMaxCost(input: {
  model: string
  providerHost?: string
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
}): MiniMaxCurrencyCosts | null {
  if (input.providerHost !== undefined && !isMiniMaxHost(input.providerHost)) {
    return null
  }
  const billableInputTokens = Math.max(
    0,
    input.inputTokens + input.cacheReadTokens + input.cacheWriteTokens
  )
  const normalizedModel = normalizeModel(input.model)
  const costInput = {
    inputTokens: Math.max(0, input.inputTokens),
    cacheReadTokens: Math.max(0, input.cacheReadTokens),
    cacheWriteTokens: Math.max(0, input.cacheWriteTokens),
    outputTokens: Math.max(0, input.outputTokens)
  }
  if (normalizedModel === 'minimax-m3.1-flash') {
    const { price, currency } = flashPriceForHost(input.providerHost)
    const cost = costForPrice({ price, ...costInput })
    return currency === 'USD' ? { costUsd: cost } : { costCny: cost }
  }
  const price = priceForModel(input.model, billableInputTokens)
  if (!price) return null
  return {
    costCny: costForPrice({ price, ...costInput })
  }
}

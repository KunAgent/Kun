import { describe, expect, it } from 'vitest'
import { estimateCatalogCost } from './catalog-pricing.js'
import { USD_TO_CNY_REFERENCE_RATE } from './codex-subscription-pricing.js'

describe('estimateCatalogCost', () => {
  it('computes USD and CNY costs from per-million catalog pricing', () => {
    const result = estimateCatalogCost({
      pricing: {
        inputUsdPerMillion: 1,
        outputUsdPerMillion: 4,
        cacheReadUsdPerMillion: 0.1,
        cacheWriteUsdPerMillion: 1.5
      },
      inputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
      outputTokens: 500_000
    })
    expect(result?.costUsd).toBeCloseTo(1 + 0.1 + 1.5 + 2)
    expect(result?.costCny).toBeCloseTo((1 + 0.1 + 1.5 + 2) * USD_TO_CNY_REFERENCE_RATE)
  })

  it('falls back to the input price when cache prices are omitted', () => {
    const result = estimateCatalogCost({
      pricing: { inputUsdPerMillion: 2, outputUsdPerMillion: 6 },
      inputTokens: 100_000,
      cacheReadTokens: 300_000,
      cacheWriteTokens: 100_000,
      outputTokens: 50_000
    })
    expect(result?.costUsd).toBeCloseTo(
      (100_000 * 2 + 300_000 * 2 + 100_000 * 2 + 50_000 * 6) / 1_000_000
    )
  })

  it('returns zero cost for free models with zero prices', () => {
    const result = estimateCatalogCost({
      pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
      inputTokens: 1_000_000,
      cacheReadTokens: 500_000,
      cacheWriteTokens: 0,
      outputTokens: 1_000_000
    })
    expect(result).toEqual({ costUsd: 0, costCny: 0 })
  })

  it('returns null without pricing metadata', () => {
    expect(estimateCatalogCost({
      pricing: undefined,
      inputTokens: 1_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1_000
    })).toBeNull()
  })
})

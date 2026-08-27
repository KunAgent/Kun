import { describe, expect, it } from 'vitest'
import { estimateDeepseekCost } from '../src/adapters/model/deepseek-pricing.js'

describe('DeepSeek pricing — provider-aware gate (issue #26)', () => {
  it('returns null for non-DeepSeek host when providerHost is provided', () => {
    // OpenRouter
    expect(estimateDeepseekCost({
      model: 'deepseek-v4-pro',
      providerHost: 'https://openrouter.ai/api/v1',
      cacheHitTokens: 0, cacheMissTokens: 1000, outputTokens: 500
    })).toBeNull()

    // Local llama.cpp
    expect(estimateDeepseekCost({
      model: 'deepseek-v4-flash',
      providerHost: 'http://127.0.0.1:1234/v1',
      cacheHitTokens: 0, cacheMissTokens: 1000, outputTokens: 500
    })).toBeNull()

    // A path that pretends to be DeepSeek but is actually on a different host
    expect(estimateDeepseekCost({
      model: 'deepseek-v4-pro',
      providerHost: 'https://my-mirror.deepseek-proxy.example.com',
      cacheHitTokens: 0, cacheMissTokens: 1000, outputTokens: 500
    })).toBeNull()
  })

  it('returns cost for the official DeepSeek host', () => {
    const cost = estimateDeepseekCost({
      model: 'deepseek-v4-pro',
      providerHost: 'https://api.deepseek.com',
      cacheHitTokens: 0, cacheMissTokens: 1000, outputTokens: 500
    })
    expect(cost).not.toBeNull()
    expect(cost!.costUsd).toBeGreaterThan(0)
    expect(cost!.costCny).toBeGreaterThan(0)
  })

  it('returns cost for the official *.deepseek.com subdomain', () => {
    const cost = estimateDeepseekCost({
      model: 'deepseek-v4-flash',
      providerHost: 'https://api-beta.deepseek.com',
      cacheHitTokens: 0, cacheMissTokens: 1000, outputTokens: 500
    })
    expect(cost).not.toBeNull()
  })

  it('keeps legacy behavior when providerHost is omitted (additive signature)', () => {
    // Old callers (e.g. agent-loop.ts:1458) that don't know about host
    // must still get cost for known DeepSeek model aliases.
    const cost = estimateDeepseekCost({
      model: 'deepseek-v4-pro',
      cacheHitTokens: 0, cacheMissTokens: 1000, outputTokens: 500
    })
    expect(cost).not.toBeNull()
    expect(cost!.costUsd).toBeGreaterThan(0)
  })

  it('still returns null for unknown model names even on DeepSeek host', () => {
    // Defensive: an unknown model on the official host should still be null
    // because we don't have authoritative prices for it.
    expect(estimateDeepseekCost({
      model: 'gpt-4-turbo',
      providerHost: 'https://api.deepseek.com',
      cacheHitTokens: 0, cacheMissTokens: 1000, outputTokens: 500
    })).toBeNull()
  })
})

describe('DeepSeek V4 time-based pricing (issue #1231)', () => {
  const allTokenTypes = (model: string, at: string) => estimateDeepseekCost({
    model,
    providerHost: 'https://api.deepseek.com',
    cacheHitTokens: 1_000_000,
    cacheMissTokens: 1_000_000,
    outputTokens: 1_000_000,
    at: new Date(at)
  })!

  const cacheHitUsd = (at: string) => estimateDeepseekCost({
    model: 'deepseek-v4-pro',
    providerHost: 'https://api.deepseek.com',
    cacheHitTokens: 1_000_000,
    cacheMissTokens: 0,
    outputTokens: 0,
    at: new Date(at)
  })!.costUsd

  it('uses the official off-peak and peak prices for flash and pro', () => {
    const offPeakAt = '2026-08-24T00:00:00.000Z' // Monday 08:00 Beijing
    const peakAt = '2026-08-24T01:00:00.000Z' // Monday 09:00 Beijing

    expect(allTokenTypes('deepseek-v4-flash', offPeakAt)).toEqual({
      costUsd: 0.007 + 0.22 + 0.66,
      costCny: 0.05 + 1.5 + 4.5
    })
    expect(allTokenTypes('deepseek-v4-flash', peakAt)).toEqual({
      costUsd: 0.014 + 0.44 + 1.32,
      costCny: 0.1 + 3 + 9
    })
    expect(allTokenTypes('deepseek-v4-pro', offPeakAt)).toEqual({
      costUsd: 0.022 + 0.66 + 1.98,
      costCny: 0.15 + 4.5 + 13.5
    })
    expect(allTokenTypes('deepseek-v4-pro', peakAt)).toEqual({
      costUsd: 0.044 + 1.32 + 3.96,
      costCny: 0.3 + 9 + 27
    })
  })

  it('uses half-open Beijing-time peak windows', () => {
    const cases: Array<[string, number]> = [
      ['2026-08-24T00:59:59.999Z', 0.022],
      ['2026-08-24T01:00:00.000Z', 0.044],
      ['2026-08-24T03:59:59.999Z', 0.044],
      ['2026-08-24T04:00:00.000Z', 0.022],
      ['2026-08-24T05:59:59.999Z', 0.022],
      ['2026-08-24T06:00:00.000Z', 0.044],
      ['2026-08-24T09:59:59.999Z', 0.044],
      ['2026-08-24T10:00:00.000Z', 0.022]
    ]
    for (const [at, expected] of cases) expect(cacheHitUsd(at)).toBe(expected)
  })

  it('applies the weekend rule only from its 2026-08-23 effective date', () => {
    // Saturday 2026-08-22 14:00 Beijing still followed the daily peak window.
    expect(cacheHitUsd('2026-08-22T06:00:00.000Z')).toBe(0.044)
    // Sunday 2026-08-23 09:00 Beijing and later weekends are always off-peak.
    expect(cacheHitUsd('2026-08-23T01:00:00.000Z')).toBe(0.022)
    expect(cacheHitUsd('2026-08-29T06:00:00.000Z')).toBe(0.022)
  })

  it('keeps the pre-2026-08-17 flat price for historical estimates', () => {
    const before = allTokenTypes('deepseek-v4-pro', '2026-08-16T15:59:59.999Z')
    expect(before.costUsd).toBe(0.003625 + 0.435 + 0.87)
    expect(before.costCny).toBe(0.025 + 3 + 6)

    const atCutover = allTokenTypes('deepseek-v4-pro', '2026-08-16T16:00:00.000Z')
    expect(atCutover.costUsd).toBe(0.022 + 0.66 + 1.98)
    expect(atCutover.costCny).toBe(0.15 + 4.5 + 13.5)
  })

  it('uses the conservative peak price for an invalid explicit date', () => {
    expect(cacheHitUsd('not-a-date')).toBe(0.044)
  })
})

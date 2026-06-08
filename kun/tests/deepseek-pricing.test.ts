import { describe, expect, it } from 'vitest'
import {
  estimateDeepseekCacheSavings,
  estimateDeepseekCost,
  estimateDeepseekInputTokenCost
} from '../src/adapters/model/deepseek-pricing.js'

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

  it('estimateDeepseekInputTokenCost honors providerHost', () => {
    expect(estimateDeepseekInputTokenCost({
      model: 'deepseek-v4-pro',
      inputTokens: 1000,
      providerHost: 'https://openrouter.ai/api/v1'
    })).toBeNull()

    const cost = estimateDeepseekInputTokenCost({
      model: 'deepseek-v4-pro',
      inputTokens: 1000,
      providerHost: 'https://api.deepseek.com'
    })
    expect(cost).not.toBeNull()
  })

  it('estimateDeepseekCacheSavings honors providerHost', () => {
    expect(estimateDeepseekCacheSavings({
      model: 'deepseek-v4-pro',
      cacheHitTokens: 500,
      providerHost: 'https://openrouter.ai/api/v1'
    })).toBeNull()

    const savings = estimateDeepseekCacheSavings({
      model: 'deepseek-v4-pro',
      cacheHitTokens: 500,
      providerHost: 'https://api.deepseek.com'
    })
    expect(savings).not.toBeNull()
    expect(savings!.costUsd).toBeGreaterThan(0)
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

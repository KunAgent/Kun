import { describe, expect, it } from 'vitest'
import { normalizeCompatUsage } from './compat-usage-normalizer.js'

describe('normalizeCompatUsage', () => {
  it('prefers provider-native cache hit and miss counters', () => {
    expect(normalizeCompatUsage({
      usage: {
        prompt_tokens: 100,
        completion_tokens: 10,
        total_tokens: 110,
        prompt_cache_hit_tokens: 80,
        prompt_cache_miss_tokens: 20
      },
      model: 'deepseek-chat',
      providerBaseUrl: 'https://api.deepseek.com'
    })).toMatchObject({
      promptTokens: 100,
      completionTokens: 10,
      totalTokens: 110,
      cacheHitTokens: 80,
      cacheMissTokens: 20,
      cacheHitRate: 0.8
    })
  })

  it('adds Anthropic cache reads and writes to reported input tokens', () => {
    expect(normalizeCompatUsage({
      usage: {
        input_tokens: 20,
        output_tokens: 5,
        cache_read_input_tokens: 70,
        cache_creation_input_tokens: 10
      },
      model: 'MiniMax-M2',
      providerBaseUrl: 'https://api.minimaxi.com/anthropic'
    })).toMatchObject({
      promptTokens: 100,
      completionTokens: 5,
      totalTokens: 105,
      cacheHitTokens: 70,
      cacheMissTokens: 30,
      cacheWriteTokens: 10,
      cacheHitRate: 0.7
    })
  })

  it('uses Responses cached-token details when native counters are absent', () => {
    expect(normalizeCompatUsage({
      usage: {
        input_tokens: 50,
        output_tokens: 5,
        total_tokens: 55,
        input_tokens_details: { cached_tokens: 30 }
      },
      model: 'gpt-5',
      providerBaseUrl: 'https://api.openai.com/v1'
    })).toMatchObject({ cacheHitTokens: 30, cacheMissTokens: 20, cacheHitRate: 0.6 })
  })

  it('reads cache writes from Responses token details', () => {
    expect(normalizeCompatUsage({
      usage: {
        input_tokens: 100,
        output_tokens: 5,
        total_tokens: 105,
        input_tokens_details: { cached_tokens: 30, cache_write_tokens: 20 }
      },
      model: 'gpt-5.6-sol',
      providerBaseUrl: 'https://chatgpt.com/backend-api/codex'
    })).toMatchObject({
      cacheHitTokens: 30,
      cacheWriteTokens: 20,
      billingKind: 'subscription'
    })
  })

  it('uses configured subscription billing for a proxied Codex request', () => {
    expect(normalizeCompatUsage({
      usage: { input_tokens: 25_300, output_tokens: 700 },
      model: 'gpt-5.6-luna',
      providerBaseUrl: 'https://proxy.example/v1',
      billingKind: 'subscription'
    })).toMatchObject({
      actualModelId: 'gpt-5.6-luna',
      billingKind: 'subscription'
    })
  })

  it('marks a non-subscription GPT request as API billing', () => {
    expect(normalizeCompatUsage({
      usage: { input_tokens: 25_300, output_tokens: 700 },
      model: 'gpt-5.6-luna',
      providerBaseUrl: 'https://gateway.example/v1'
    }).billingKind).toBe('api')
  })

  it('estimates cost from catalog pricing when no first-party estimator matches', () => {
    expect(normalizeCompatUsage({
      usage: { input_tokens: 1_000_000, output_tokens: 500_000 },
      model: 'custom-model',
      providerBaseUrl: 'https://gateway.example/v1',
      catalogPricing: {
        inputUsdPerMillion: 1,
        outputUsdPerMillion: 4,
        cacheReadUsdPerMillion: 0.1
      }
    })).toMatchObject({
      billingKind: 'api',
      costUsd: 1 + 2,
      costCny: (1 + 2) * 7.2
    })
  })

  it('prefers provider-reported cost over catalog pricing estimates', () => {
    expect(normalizeCompatUsage({
      usage: { input_tokens: 1_000_000, output_tokens: 500_000, cost_usd: 0.5 },
      model: 'custom-model',
      providerBaseUrl: 'https://gateway.example/v1',
      catalogPricing: { inputUsdPerMillion: 1, outputUsdPerMillion: 4 }
    }).costUsd).toBe(0.5)
  })

  it('prefers the DeepSeek estimator over catalog pricing on a DeepSeek host', () => {
    const result = normalizeCompatUsage({
      usage: { prompt_tokens: 1_000_000, completion_tokens: 500_000 },
      model: 'deepseek-chat',
      providerBaseUrl: 'https://api.deepseek.com',
      catalogPricing: { inputUsdPerMillion: 99, outputUsdPerMillion: 99 }
    })
    expect(result.costUsd).toBeDefined()
    expect(result.costUsd).not.toBe(99 + 99 * 0.5)
  })

  it('writes catalog pricing as a value estimate for subscription billing', () => {
    const result = normalizeCompatUsage({
      usage: { input_tokens: 1_000_000, output_tokens: 500_000 },
      model: 'k3',
      providerBaseUrl: 'https://api.kimi.com/coding/v1',
      billingKind: 'subscription',
      catalogPricing: { inputUsdPerMillion: 1, outputUsdPerMillion: 4 }
    })
    expect(result.billingKind).toBe('subscription')
    expect(result.valueEstimateUsd).toBeCloseTo(1 + 2)
    expect(result.valueEstimateCny).toBeCloseTo((1 + 2) * 7.2)
  })

  it('does not write a value estimate for non-subscription billing', () => {
    const result = normalizeCompatUsage({
      usage: { input_tokens: 1_000_000, output_tokens: 500_000 },
      model: 'custom-model',
      providerBaseUrl: 'https://gateway.example/v1',
      catalogPricing: { inputUsdPerMillion: 1, outputUsdPerMillion: 4 }
    })
    expect(result.billingKind).toBe('api')
    expect(result.valueEstimateUsd).toBeUndefined()
    expect(result.valueEstimateCny).toBeUndefined()
  })
})

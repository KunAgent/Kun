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
})

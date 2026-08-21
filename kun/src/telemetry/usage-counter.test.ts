import { describe, expect, it } from 'vitest'
import { emptyUsageSnapshot } from '../contracts/usage.js'
import type { UsageSnapshot } from '../contracts/usage.js'
import { UsageCounter } from './usage-counter.js'

function snapshot(overrides: Partial<UsageSnapshot>): UsageSnapshot {
  return { ...emptyUsageSnapshot(), ...overrides }
}

describe('UsageCounter.total cross-thread aggregate', () => {
  it('unions cache miss reasons across threads instead of dropping them', () => {
    const counter = new UsageCounter()
    counter.record(
      'thread-a',
      snapshot({
        promptTokens: 100,
        cacheHitTokens: 60,
        cacheMissTokens: 40,
        cacheMissReasons: ['cold_request'],
        cacheSuggestions: ['warm the cache']
      })
    )
    counter.record(
      'thread-b',
      snapshot({
        promptTokens: 100,
        cacheHitTokens: 40,
        cacheMissTokens: 60,
        cacheMissReasons: ['cold_request', 'tool_catalog_changed'],
        cacheSuggestions: ['keep MCP tools stable']
      })
    )

    const total = counter.total()
    expect(total.cacheMissReasons).toEqual(['cold_request', 'tool_catalog_changed'])
    expect(total.cacheSuggestions).toEqual(['warm the cache', 'keep MCP tools stable'])
  })

  it('recomputes the aggregate hit rate from summed token counts', () => {
    const counter = new UsageCounter()
    counter.record(
      'thread-a',
      snapshot({ promptTokens: 100, cacheHitTokens: 60, cacheMissTokens: 40 })
    )
    counter.record(
      'thread-b',
      snapshot({ promptTokens: 100, cacheHitTokens: 40, cacheMissTokens: 60 })
    )

    const total = counter.total()
    // 100 hits / 200 cacheable = 0.5.
    expect(total.cacheableTokenHitRate).toBe(0.5)
    expect(total.totalInputTokenHitRate).toBe(0.5)
  })

  it('keeps consecutive Responses cache deltas cumulative and isolated by thread', () => {
    const counter = new UsageCounter()
    counter.record('thread-a', snapshot({
      promptTokens: 1_000,
      completionTokens: 10,
      cachedTokens: 0,
      cacheHitTokens: 0,
      cacheMissTokens: 1_000,
      turns: 1
    }))
    counter.record('thread-a', snapshot({
      promptTokens: 1_000,
      completionTokens: 10,
      cachedTokens: 900,
      cacheHitTokens: 900,
      cacheMissTokens: 100,
      turns: 1
    }))
    counter.record('thread-b', snapshot({
      promptTokens: 1_000,
      completionTokens: 10,
      cachedTokens: 0,
      cacheHitTokens: 0,
      cacheMissTokens: 1_000,
      turns: 1
    }))

    expect(counter.forThread('thread-a')).toMatchObject({
      promptTokens: 2_000,
      completionTokens: 20,
      cachedTokens: 900,
      cacheHitTokens: 900,
      cacheMissTokens: 1_100,
      cacheHitRate: 0.45,
      turns: 2
    })
    expect(counter.forThread('thread-b')).toMatchObject({
      promptTokens: 1_000,
      completionTokens: 10,
      cachedTokens: 0,
      cacheHitTokens: 0,
      cacheMissTokens: 1_000,
      cacheHitRate: 0,
      turns: 1
    })
  })

  it('leaves aggregate rates and reasons unset without telemetry', () => {
    const counter = new UsageCounter()
    counter.record('thread-a', snapshot({ promptTokens: 100 }))

    const total = counter.total()
    expect(total.cacheableTokenHitRate).toBeUndefined()
    expect(total.totalInputTokenHitRate).toBeUndefined()
    expect(total.cacheMissReasons).toBeUndefined()
    expect(total.cacheSuggestions).toBeUndefined()
  })

  it('preserves reasoning, cache-write, and arbitrary currency usage', () => {
    const counter = new UsageCounter()
    counter.record('thread-a', snapshot({
      reasoningTokens: 7,
      cacheWriteTokens: 11,
      costByCurrency: { EUR: 0.25 }
    }))
    counter.record('thread-a', snapshot({
      reasoningTokens: 3,
      cacheWriteTokens: 5,
      costByCurrency: { EUR: 0.15 }
    }))

    expect(counter.forThread('thread-a')).toMatchObject({
      reasoningTokens: 10,
      cacheWriteTokens: 16,
      costByCurrency: { EUR: 0.4 }
    })
  })

  it('uses current request attribution without inheriting subscription or Priority', () => {
    const counter = new UsageCounter()
    counter.record('thread-a', snapshot({
      promptTokens: 100,
      totalTokens: 100,
      turns: 1,
      actualProviderId: 'codex-work',
      actualModelId: 'gpt-5.6-sol',
      billingKind: 'subscription',
      serviceTier: 'priority'
    }))
    const standardApi = counter.record('thread-a', snapshot({
      promptTokens: 50,
      totalTokens: 50,
      turns: 1,
      actualProviderId: 'openai-api',
      actualModelId: 'gpt-5.4-mini',
      billingKind: 'api'
    }))

    expect(standardApi).toMatchObject({
      actualProviderId: 'openai-api',
      actualModelId: 'gpt-5.4-mini',
      billingKind: 'api'
    })
    expect(standardApi.serviceTier).toBeUndefined()
  })
})

describe('UsageCounter timing aggregation', () => {
  it('derives thread-cumulative TTFT and tokens-per-second averages', () => {
    const counter = new UsageCounter()
    // TTFT simple mean: (800 + 1200) / 2 = 1000ms.
    // TPS weighted: (50 + 150) / (2s + 2s) * 1000 = 50 tok/s.
    counter.record('thread-a', snapshot({
      completionTokens: 50,
      requestTtftMs: 800,
      requestGenerationMs: 2_000
    }))
    counter.record('thread-a', snapshot({
      completionTokens: 150,
      requestTtftMs: 1_200,
      requestGenerationMs: 2_000
    }))

    const usage = counter.forThread('thread-a')
    expect(usage.avgTtftMs).toBe(1_000)
    expect(usage.avgTokensPerSecond).toBe(50)
  })

  it('treats missing timing fields as null instead of zero', () => {
    const counter = new UsageCounter()
    counter.record('thread-a', snapshot({ completionTokens: 10 }))

    const usage = counter.forThread('thread-a')
    expect(usage.avgTtftMs).toBeNull()
    expect(usage.avgTokensPerSecond).toBeNull()
  })

  it('ignores invalid timing and mixes timed and untimed requests', () => {
    const counter = new UsageCounter()
    counter.record('thread-a', snapshot({ completionTokens: 100 }))
    counter.record('thread-a', snapshot({
      completionTokens: 100,
      requestTtftMs: 400,
      requestGenerationMs: 1_000
    }))

    const usage = counter.forThread('thread-a')
    // Only the timed request contributes to the TTFT average.
    expect(usage.avgTtftMs).toBe(400)
    expect(usage.avgTokensPerSecond).toBe(100)
  })

  it('recomputes timing averages across threads in total()', () => {
    const counter = new UsageCounter()
    counter.record('thread-a', snapshot({
      completionTokens: 100,
      requestTtftMs: 1_000,
      requestGenerationMs: 2_000
    }))
    counter.record('thread-b', snapshot({
      completionTokens: 300,
      requestTtftMs: 3_000,
      requestGenerationMs: 2_000
    }))

    const total = counter.total()
    expect(total.avgTtftMs).toBe(2_000)
    expect(total.avgTokensPerSecond).toBe(100)
  })

  it('resets timing together with the thread counter', () => {
    const counter = new UsageCounter()
    counter.record('thread-a', snapshot({
      completionTokens: 100,
      requestTtftMs: 1_000,
      requestGenerationMs: 2_000
    }))
    counter.reset('thread-a')
    expect(counter.forThread('thread-a').avgTtftMs).toBeNull()
    expect(counter.forThread('thread-a').avgTokensPerSecond).toBeNull()

    // Seed restores snapshot values but starts timing history fresh.
    counter.seed('thread-a', snapshot({ promptTokens: 5, completionTokens: 5 }))
    expect(counter.forThread('thread-a').promptTokens).toBe(5)
    expect(counter.forThread('thread-a').avgTtftMs).toBeNull()
  })
})

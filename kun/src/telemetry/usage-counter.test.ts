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

  it('leaves aggregate rates and reasons unset without telemetry', () => {
    const counter = new UsageCounter()
    counter.record('thread-a', snapshot({ promptTokens: 100 }))

    const total = counter.total()
    expect(total.cacheableTokenHitRate).toBeUndefined()
    expect(total.totalInputTokenHitRate).toBeUndefined()
    expect(total.cacheMissReasons).toBeUndefined()
    expect(total.cacheSuggestions).toBeUndefined()
  })
})

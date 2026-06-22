import { describe, expect, it } from 'vitest'
import { emptyUsageSnapshot } from '../contracts/usage.js'
import type { UsageSnapshot } from '../contracts/usage.js'
import { addUsage, zeroUsage } from './usage.js'

function delta(overrides: Partial<UsageSnapshot>): UsageSnapshot {
  return { ...emptyUsageSnapshot(), ...overrides }
}

describe('addUsage', () => {
  it('sums token counters across deltas', () => {
    const result = addUsage(
      delta({ promptTokens: 100, completionTokens: 10, cacheHitTokens: 40, cacheMissTokens: 60 }),
      delta({ promptTokens: 200, completionTokens: 20, cacheHitTokens: 80, cacheMissTokens: 20 })
    )
    expect(result.promptTokens).toBe(300)
    expect(result.completionTokens).toBe(30)
    expect(result.totalTokens).toBe(330)
    expect(result.cacheHitTokens).toBe(120)
    expect(result.cacheMissTokens).toBe(80)
  })

  it('unions cache miss reasons across deltas instead of clobbering', () => {
    const into = delta({
      cacheMissReasons: ['cold_request', 'model_changed'],
      cacheSuggestions: ['keep the model unchanged']
    })
    const next = delta({
      cacheMissReasons: ['model_changed', 'tool_catalog_changed'],
      cacheSuggestions: ['keep MCP tools stable']
    })
    const result = addUsage(into, next)
    // Accumulated reasons preserved; duplicates deduped; new ones added.
    expect(result.cacheMissReasons).toEqual([
      'cold_request',
      'model_changed',
      'tool_catalog_changed'
    ])
    expect(result.cacheSuggestions).toEqual([
      'keep the model unchanged',
      'keep MCP tools stable'
    ])
  })

  it('does not clobber accumulated reasons when the latest delta has none', () => {
    const into = delta({ cacheMissReasons: ['cold_request'] })
    const next = delta({})
    const result = addUsage(into, next)
    expect(result.cacheMissReasons).toEqual(['cold_request'])
  })

  it('leaves diagnostic arrays unset when no delta reported any', () => {
    const result = addUsage(zeroUsage(), delta({ promptTokens: 50 }))
    expect(result.cacheMissReasons).toBeUndefined()
    expect(result.cacheSuggestions).toBeUndefined()
  })

  it('recomputes hit rates from aggregated token counts rather than the latest delta', () => {
    const result = addUsage(
      delta({ promptTokens: 100, cacheHitTokens: 40, cacheMissTokens: 60, cacheableTokenHitRate: 0.4 }),
      delta({ promptTokens: 100, cacheHitTokens: 80, cacheMissTokens: 20, cacheableTokenHitRate: 0.8 })
    )
    // 120 hits / 200 cacheable = 0.6, NOT the stale single-turn 0.8.
    expect(result.cacheableTokenHitRate).toBe(0.6)
    // 120 hits / 200 prompt = 0.6.
    expect(result.totalInputTokenHitRate).toBe(0.6)
  })

  it('leaves rates undefined when no cache telemetry exists', () => {
    const result = addUsage(
      delta({ promptTokens: 100, cacheableTokenHitRate: 0.9, totalInputTokenHitRate: 0.9 }),
      delta({ promptTokens: 100 })
    )
    // No hit/miss counters folded in -> no fabricated aggregate rate.
    expect(result.cacheableTokenHitRate).toBeUndefined()
    expect(result.totalInputTokenHitRate).toBeUndefined()
  })
})

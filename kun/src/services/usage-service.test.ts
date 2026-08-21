import { describe, expect, it } from 'vitest'
import {
  buildModelUsageResponse,
  buildThreadUsageResponse,
  buildTurnUsageResponse,
  type ThreadUsageRecord,
  UsageService
} from './usage-service.js'

const signature = {
  model: 'model-a',
  providerId: 'provider-a',
  endpointFormat: 'chat_completions',
  prefixFingerprint: 'prefix-a',
  toolCatalogFingerprint: 'tools-a',
  activeSkillIds: ['skill-a']
}

describe('usage cache diagnostics', () => {
  it('attaches cache diagnostics to recorded usage snapshots', () => {
    const usage = new UsageService()

    usage.record('thread-a', {
      promptTokens: 1_000,
      completionTokens: 20,
      totalTokens: 1_020,
      cacheHitTokens: 600,
      cacheMissTokens: 200,
      cacheHitRate: 0.75,
      turns: 1
    }, signature)

    const current = usage.forThread('thread-a')
    expect(current.cacheableTokenHitRate).toBe(0.75)
    expect(current.totalInputTokenHitRate).toBe(0.6)
    expect(current.cacheMissReasons).toContain('cold_request')
  })

  it('explains a hit-rate regression once a thread has a warm baseline', () => {
    const usage = new UsageService()
    const warm = (hit: number, miss: number) => ({
      promptTokens: hit + miss,
      completionTokens: 10,
      totalTokens: hit + miss + 10,
      cacheHitTokens: hit,
      cacheMissTokens: miss,
      cacheHitRate: hit / (hit + miss),
      turns: 1
    })

    // Two warm turns at ~90% establish the baseline (no regression yet).
    usage.record('thread-r', warm(900, 100), signature)
    usage.record('thread-r', warm(900, 100), signature)
    // A prefix change collapses the hit rate — should be explained.
    const dropped = usage.record('thread-r', warm(50, 950), {
      ...signature,
      prefixFingerprint: 'prefix-b'
    })

    expect(dropped.cacheMissReasons).toContain('stable_prefix_changed')
    expect(dropped.cacheSuggestions?.some((s) => /Cache hit rate dropped/.test(s))).toBe(true)
    expect(dropped.cacheSuggestions?.some((s) => /stable system prefix changed/.test(s))).toBe(true)
  })

  it('does not re-announce the same regression every turn (cooldown)', () => {
    const usage = new UsageService()
    const warm = (hit: number, miss: number) => ({
      promptTokens: hit + miss,
      completionTokens: 10,
      totalTokens: hit + miss + 10,
      cacheHitTokens: hit,
      cacheMissTokens: miss,
      cacheHitRate: hit / (hit + miss),
      turns: 1
    })
    usage.record('thread-c', warm(900, 100), signature)
    usage.record('thread-c', warm(900, 100), signature)
    const first = usage.record('thread-c', warm(50, 950), { ...signature, prefixFingerprint: 'prefix-b' })
    const second = usage.record('thread-c', warm(50, 950), { ...signature, prefixFingerprint: 'prefix-b' })

    expect(first.cacheSuggestions?.some((s) => /Cache hit rate dropped/.test(s))).toBe(true)
    // The very next turn at the same low rate must NOT repeat the announcement.
    expect(second.cacheSuggestions?.some((s) => /Cache hit rate dropped/.test(s))).toBe(false)
  })

  it('starts a fresh baseline when the model changes (no cross-model false regression)', () => {
    const usage = new UsageService()
    const warm = (hit: number, miss: number) => ({
      promptTokens: hit + miss,
      completionTokens: 10,
      totalTokens: hit + miss + 10,
      cacheHitTokens: hit,
      cacheMissTokens: miss,
      cacheHitRate: hit / (hit + miss),
      turns: 1
    })
    usage.record('thread-m', warm(900, 100), signature)
    usage.record('thread-m', warm(900, 100), signature)
    // Switch model: the first turn on model-b is cold and has a low hit rate,
    // but must not be reported as a regression against model-a's baseline.
    const switched = usage.record('thread-m', warm(50, 950), { ...signature, model: 'model-b' })
    expect(switched.cacheSuggestions?.some((s) => /Cache hit rate dropped/.test(s))).toBe(false)
  })

  it('aggregates a gpt-5.6-luna subscription estimate without mixing it into API cost', () => {
    const response = buildThreadUsageResponse([{
      threadId: 'thread-luna',
      model: 'gpt-5.6-luna',
      completedAt: '2026-08-18T00:00:00.000Z',
      usage: {
        promptTokens: 25_300,
        completionTokens: 700,
        totalTokens: 26_000,
        cacheHitRate: 0,
        billingKind: 'subscription',
        turns: 1
      }
    }])

    expect(response.buckets[0]).toMatchObject({
      thread_id: 'thread-luna',
      cost_usd: 0,
      cost_cny: 0
    })
    expect(response.buckets[0]?.value_estimate_usd).toBeGreaterThan(0)
    expect(response.buckets[0]?.value_estimate_cny).toBeGreaterThan(0)
  })

  it('restores a reference estimate for legacy known-model records without billing metadata', () => {
    const response = buildThreadUsageResponse([{
      threadId: 'thread-legacy-luna',
      model: 'codex/gpt-5.6-luna',
      completedAt: '2026-08-18T00:00:00.000Z',
      usage: {
        promptTokens: 25_000,
        completionTokens: 1_000,
        totalTokens: 26_000,
        cacheHitRate: null,
        turns: 1
      }
    }])

    expect(response.buckets[0]).toMatchObject({
      thread_id: 'thread-legacy-luna',
      cost_usd: 0,
      cost_cny: 0
    })
    expect(response.buckets[0]?.value_estimate_usd).toBeGreaterThan(0)
    expect(response.buckets[0]?.value_estimate_cny).toBeGreaterThan(0)
  })

  it('does not infer subscription value from an unqualified API model record', () => {
    const response = buildThreadUsageResponse([{
      threadId: 'thread-api-luna',
      model: 'gpt-5.6-luna',
      completedAt: '2026-08-18T00:00:00.000Z',
      usage: {
        promptTokens: 25_000,
        completionTokens: 1_000,
        totalTokens: 26_000,
        cacheHitRate: null,
        costUsd: 0.02,
        turns: 1
      }
    }])

    expect(response.buckets[0]).toMatchObject({
      cost_usd: 0.02,
      value_estimate_usd: 0,
      value_estimate_cny: 0
    })
  })

  it('surfaces the latest-turn cache diagnostic fields in thread usage', () => {
    const records: ThreadUsageRecord[] = [
      {
        threadId: 'thread-a',
        completedAt: '2026-06-21T00:00:00.000Z',
        usage: {
          promptTokens: 1_000,
          completionTokens: 20,
          totalTokens: 1_020,
          cacheHitTokens: 600,
          cacheMissTokens: 200,
          cacheHitRate: 0.75,
          cacheableTokenHitRate: 0.75,
          totalInputTokenHitRate: 0.6,
          cacheMissReasons: ['tool_catalog_changed'],
          cacheSuggestions: ['Keep MCP and Skill tools stable within a thread.'],
          avgTtftMs: 850,
          avgTokensPerSecond: 42.5,
          turns: 1
        }
      }
    ]

    const response = buildThreadUsageResponse(records)
    expect(response.buckets[0]).toMatchObject({
      thread_id: 'thread-a',
      last_turn_cacheable_hit_rate: 0.75,
      last_turn_total_input_hit_rate: 0.6,
      last_cache_miss_reasons: ['tool_catalog_changed'],
      last_cache_suggestions: ['Keep MCP and Skill tools stable within a thread.'],
      avg_ttft_ms: 850,
      avg_tokens_per_second: 42.5
    })
  })
})

describe('model usage aggregation', () => {
  it('keeps every model family, sorts buckets stably, and preserves unknown records', () => {
    const tokensByModel: Array<[string | undefined, number]> = [
      ['deepseek-v4', 700],
      ['gpt-5.6-sol', 600],
      ['glm-5.2', 500],
      ['qwen3-coder', 400],
      ['gemini-3-pro', 300],
      ['claude-opus-4', 200],
      ['custom/model', 100],
      [undefined, 50],
      ['tie-z', 25],
      ['tie-a', 25]
    ]
    const records: ThreadUsageRecord[] = tokensByModel.map(([model, totalTokens], index) => ({
      threadId: `thread-${index}`,
      ...(model ? { model } : {}),
      completedAt: '2026-08-09T00:00:00.000Z',
      usage: {
        promptTokens: totalTokens,
        completionTokens: 0,
        totalTokens,
        cacheHitRate: null,
        turns: 1
      }
    }))

    const response = buildModelUsageResponse(records, {
      groupBy: 'model',
      from: '2026-08-01',
      to: '2026-08-09',
      timezone: 'UTC'
    })

    expect(response.buckets.map((bucket) => bucket.model)).toEqual([
      'deepseek-v4',
      'gpt-5.6-sol',
      'glm-5.2',
      'qwen3-coder',
      'gemini-3-pro',
      'claude-opus-4',
      'custom/model',
      'unknown',
      'tie-a',
      'tie-z'
    ])
    expect(response.buckets).toHaveLength(tokensByModel.length)
    expect(response.totals.total_tokens).toBe(2_900)
  })
})

describe('turn reference price breakdown', () => {
  it('returns mixed effective-rate groups only on buckets and preserves partial coverage', () => {
    const response = buildTurnUsageResponse([
      {
        threadId: 'thread-priced', turnId: 'turn-mixed', model: 'gpt-5.6-sol',
        completedAt: '2026-08-20T00:00:00.000Z',
        usage: {
          promptTokens: 100_000, completionTokens: 1_000, totalTokens: 101_000,
          cacheHitTokens: 80_000, cacheHitRate: 0.8, turns: 1,
          billingKind: 'subscription', serviceTier: 'priority'
        }
      },
      {
        threadId: 'thread-priced', turnId: 'turn-mixed', model: 'gpt-5.6-sol',
        completedAt: '2026-08-20T00:01:00.000Z',
        usage: {
          promptTokens: 300_000, completionTokens: 2_000, totalTokens: 302_000,
          cacheHitTokens: 250_000, cacheHitRate: 5 / 6, turns: 1,
          billingKind: 'subscription'
        }
      },
      {
        threadId: 'thread-priced', turnId: 'turn-mixed', model: 'unknown-model',
        completedAt: '2026-08-20T00:02:00.000Z',
        usage: {
          promptTokens: 10, completionTokens: 1, totalTokens: 11,
          cacheHitRate: null, turns: 1, billingKind: 'subscription'
        }
      }
    ], { groupBy: 'turn', threadId: 'thread-priced' })

    expect(response.buckets[0]).toMatchObject({
      estimate_coverage: 'partial',
      reference_price_breakdown: {
        currency: 'USD', priced_requests: 2, unpriced_requests: 1,
        groups: [
          expect.objectContaining({ pricing_mode: 'fast', fast_multiplier: 2 }),
          expect.objectContaining({ pricing_mode: 'long_context', fast_multiplier: null })
        ]
      }
    })
    expect(response.totals).not.toHaveProperty('reference_price_breakdown')
    const breakdown = response.buckets[0]?.reference_price_breakdown
    expect(breakdown?.groups.reduce((sum, group) => sum + group.amount, 0))
      .toBe(response.buckets[0]?.reference_estimate_usd)
  })
})

describe('usage per-turn timing aggregation', () => {
  const timed = (overrides: Record<string, unknown>) => ({
    promptTokens: 100,
    completionTokens: 10,
    totalTokens: 110,
    cacheHitRate: null,
    turns: 1,
    ...overrides
  })

  it('attaches turn averages to the cumulative snapshot per turnId', () => {
    const usage = new UsageService()
    // Turn A: two model calls within one user turn.
    usage.record('thread-a', timed({ completionTokens: 40, requestTtftMs: 800, requestGenerationMs: 2_000 }), undefined, 'turn-a')
    const turnASnapshot = usage.record('thread-a', timed({ completionTokens: 120, requestTtftMs: 1_200, requestGenerationMs: 2_000 }), undefined, 'turn-a')
    // Turn B: separate averages, must not bleed into turn A.
    const afterTurnB = usage.record('thread-a', timed({ completionTokens: 50, requestTtftMs: 500, requestGenerationMs: 1_000 }), undefined, 'turn-b')

    expect(turnASnapshot.turnAvgTtftMs).toBe(1_000)
    expect(turnASnapshot.turnAvgTokensPerSecond).toBe(40)
    // Session averages aggregate across all calls in the thread.
    expect(afterTurnB.avgTtftMs).toBe((800 + 1_200 + 500) / 3)
    expect(afterTurnB.avgTokensPerSecond).toBe(210 / 5_000 * 1_000)
    // Turn B has its own fresh averages.
    expect(afterTurnB.turnAvgTtftMs).toBe(500)
  })

  it('reports null turn averages without timing data', () => {
    const usage = new UsageService()
    const snapshot = usage.record('thread-a', timed({}), undefined, 'turn-a')

    expect(snapshot.turnAvgTtftMs).toBeNull()
    expect(snapshot.turnAvgTokensPerSecond).toBeNull()
  })

  it('does not fold timing into a turn when turnId is omitted', () => {
    const usage = new UsageService()
    const snapshot = usage.record('thread-a', timed({ requestTtftMs: 900, requestGenerationMs: 1_000 }))

    expect(snapshot.turnAvgTtftMs).toBeUndefined()
    // Session aggregation still applies.
    expect(snapshot.avgTtftMs).toBe(900)
  })

  it('endTurn releases per-turn aggregation for finished turns', () => {
    const usage = new UsageService()
    usage.record('thread-a', timed({ requestTtftMs: 800, requestGenerationMs: 1_000 }), undefined, 'turn-a')
    usage.endTurn('thread-a', 'turn-a')

    // A new call in the same turnId starts a fresh aggregation window.
    const next = usage.record('thread-a', timed({ requestTtftMs: 200, requestGenerationMs: 1_000 }), undefined, 'turn-a')
    expect(next.turnAvgTtftMs).toBe(200)
  })
})

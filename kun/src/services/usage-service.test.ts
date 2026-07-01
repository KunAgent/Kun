import { describe, expect, it } from 'vitest'
import { buildThreadUsageResponse, type ThreadUsageRecord, UsageService } from './usage-service.js'

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
      last_cache_suggestions: ['Keep MCP and Skill tools stable within a thread.']
    })
  })
})

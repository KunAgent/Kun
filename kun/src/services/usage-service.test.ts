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

import { describe, expect, it } from 'vitest'
import { diagnoseCacheUsage } from './cache-diagnostics.js'

const stable = {
  model: 'model-a',
  providerId: 'provider-a',
  endpointFormat: 'chat_completions',
  prefixFingerprint: 'prefix-a',
  toolCatalogFingerprint: 'tools-a',
  activeSkillIds: ['skill-a']
}

describe('cache diagnostics', () => {
  it('does not report drift categories on the cold request', () => {
    const result = diagnoseCacheUsage({
      usage: { promptTokens: 500, cacheHitTokens: 0, cacheMissTokens: 500 },
      current: stable
    })
    expect(result.reasons).toContain('cold_request')
    expect(result.reasons).not.toContain('model_changed')
    expect(result.reasons).not.toContain('tool_catalog_changed')
    expect(result.reasons).not.toContain('skills_changed')
  })

  it('reports both cacheable and total-input token hit rates', () => {
    const result = diagnoseCacheUsage({
      usage: { promptTokens: 1_000, cacheHitTokens: 600, cacheMissTokens: 200 },
      previous: stable,
      current: stable
    })
    expect(result.cacheableTokenHitRate).toBe(0.75)
    expect(result.totalInputTokenHitRate).toBe(0.6)
    expect(result.reasons).toEqual([])
  })

  it('explains tool and skill drift instead of guessing TTL expiry', () => {
    const result = diagnoseCacheUsage({
      usage: { promptTokens: 900, cacheHitTokens: 0, cacheMissTokens: 800 },
      previous: stable,
      current: { ...stable, toolCatalogFingerprint: 'tools-b', activeSkillIds: ['skill-b'] }
    })
    expect(result.reasons).toEqual(expect.arrayContaining([
      'tool_catalog_changed', 'skills_changed', 'provider_cache_miss'
    ]))
    expect(result.suggestions.join(' ')).toContain('MCP')
  })

  it('reports endpoint changes separately from provider changes', () => {
    const result = diagnoseCacheUsage({
      usage: { promptTokens: 900, cacheHitTokens: 0, cacheMissTokens: 700 },
      previous: stable,
      current: { ...stable, endpointFormat: 'responses' }
    })
    expect(result.reasons).toEqual(expect.arrayContaining([
      'endpoint_changed',
      'provider_cache_miss'
    ]))
  })

  it('does not invent rates when provider cache metrics are unavailable', () => {
    const result = diagnoseCacheUsage({
      usage: { promptTokens: 900 },
      previous: stable,
      current: stable
    })
    expect(result.cacheableTokenHitRate).toBeNull()
    expect(result.totalInputTokenHitRate).toBeNull()
    expect(result.reasons).toContain('provider_metrics_unavailable')
  })

  it('treats hit-only telemetry as unavailable rather than perfect coverage', () => {
    const result = diagnoseCacheUsage({
      // Provider reported hits but no miss counter — partial telemetry.
      usage: { promptTokens: 1_000, cacheHitTokens: 600 },
      previous: stable,
      current: stable
    })
    // Must not fabricate a 1.0 "perfect" rate from the incomplete denominator.
    expect(result.cacheableTokenHitRate).toBeNull()
    expect(result.totalInputTokenHitRate).toBeNull()
    expect(result.reasons).toContain('provider_metrics_unavailable')
    // The clean-miss branch must not run on partial telemetry.
    expect(result.reasons).not.toContain('provider_cache_miss')
  })

  it('treats miss-only telemetry as unavailable rather than verified', () => {
    const result = diagnoseCacheUsage({
      // Provider reported misses but no hit counter — partial telemetry.
      usage: { promptTokens: 1_000, cacheMissTokens: 400 },
      previous: stable,
      current: stable
    })
    expect(result.cacheableTokenHitRate).toBeNull()
    expect(result.totalInputTokenHitRate).toBeNull()
    expect(result.reasons).toContain('provider_metrics_unavailable')
    expect(result.reasons).not.toContain('provider_cache_miss')
  })
})

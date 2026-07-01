import { describe, expect, it } from 'vitest'
import { analyzeCacheRegression, explainCacheRegression } from './cache-regression.js'

describe('analyzeCacheRegression', () => {
  it('reports no regression when the hit rate holds steady', () => {
    const report = analyzeCacheRegression({
      current: 0.9,
      baseline: [0.92, 0.91, 0.93],
      reasons: []
    })
    expect(report.severity).toBe('none')
    expect(report.explanation).toBeNull()
  })

  it('classifies a catastrophic drop as a cliff and attributes the prefix change', () => {
    const report = analyzeCacheRegression({
      current: 0.05,
      baseline: [0.95, 0.93, 0.94],
      reasons: ['stable_prefix_changed', 'provider_cache_miss']
    })
    expect(report.severity).toBe('cliff')
    expect(report.primaryReason).toBe('stable_prefix_changed')
    expect(report.dropPercentagePoints).toBeGreaterThan(80)
    expect(report.explanation).toContain('Cache hit rate dropped')
    expect(report.explanation).toContain('stable system prefix changed')
  })

  it('classifies a mid-size drop as major and a small one as minor', () => {
    expect(analyzeCacheRegression({ current: 0.6, baseline: [0.9, 0.9], reasons: [] }).severity).toBe('major')
    expect(analyzeCacheRegression({ current: 0.81, baseline: [0.9, 0.92], reasons: [] }).severity).toBe('minor')
  })

  it('prefers the most decisive reason when several are present', () => {
    const report = analyzeCacheRegression({
      current: 0.1,
      baseline: [0.9, 0.9],
      reasons: ['provider_cache_miss', 'tool_catalog_changed', 'cache_ttl_unknown']
    })
    expect(report.primaryReason).toBe('tool_catalog_changed')
  })

  it('stays silent until enough baseline samples exist', () => {
    const report = analyzeCacheRegression({
      current: 0.0,
      baseline: [0.95],
      reasons: ['stable_prefix_changed'],
      minBaselineSamples: 2
    })
    expect(report.severity).toBe('none')
    expect(report.explanation).toBeNull()
  })

  it('ignores non-rate samples and null current values', () => {
    expect(analyzeCacheRegression({ current: null, baseline: [0.9, 0.9], reasons: [] }).severity).toBe('none')
    const report = analyzeCacheRegression({
      current: 0.1,
      baseline: [null, 0.9, Number.NaN as unknown as number, 0.9],
      reasons: ['stable_prefix_changed']
    })
    expect(report.severity).toBe('cliff')
    expect(report.baselineHitRate).toBeCloseTo(0.9, 5)
  })

  it('uses a median baseline so a single cold-start outlier does not fake a regression', () => {
    // [0.9, 0.0(cold start), 0.9] → median 0.9; current 0.85 is a 5pp dip, not a drop.
    const report = analyzeCacheRegression({ current: 0.85, baseline: [0.9, 0.0, 0.9], reasons: [] })
    expect(report.baselineHitRate).toBeCloseTo(0.9, 5)
    expect(report.severity).toBe('none')
  })
})
describe('explainCacheRegression', () => {
  it('formats a percentage-point drop with the attributed cause', () => {
    const text = explainCacheRegression({ baseline: 0.92, current: 0.08, primaryReason: 'tool_catalog_changed' })
    expect(text).toBe('Cache hit rate dropped from 92% to 8% (-84pp). Likely cause: the tool catalog changed (MCP/Skill tools), which invalidated the cached prefix.')
  })

  it('omits the cause clause when no reason is known', () => {
    const text = explainCacheRegression({ baseline: 0.8, current: 0.5, primaryReason: null })
    expect(text).toBe('Cache hit rate dropped from 80% to 50% (-30pp).')
  })
})

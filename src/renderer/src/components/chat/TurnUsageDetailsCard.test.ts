import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import type { TurnUsageSummary } from '../../hooks/use-turn-usage'
import { TurnUsageDetailsCard } from './TurnUsageDetailsCard'

function fastUsage(overrides: Partial<TurnUsageSummary> = {}): TurnUsageSummary {
  return {
    turnId: 'turn-fast',
    requests: 21,
    inputTokens: 575_361,
    outputTokens: 4_466,
    reasoningTokens: 500,
    cachedTokens: 521_216,
    cacheWriteTokens: 0,
    totalTokens: 579_827,
    actualCost: null,
    referenceEstimateUsd: 1.330626,
    referencePriceBreakdown: {
      currency: 'USD', amount: 1.330626, pricedRequests: 21, unpricedRequests: 0,
      groups: [{
        model: 'gpt-5.6-sol', pricingMode: 'fast', requestCount: 21,
        fastMultiplier: 2, amount: 1.330626,
        items: [
          { kind: 'uncached_input', tokens: 54_145, ratePerMillion: 10, amount: 0.54145 },
          { kind: 'cache_read', tokens: 521_216, ratePerMillion: 1, amount: 0.521216 },
          { kind: 'cache_write', tokens: 0, ratePerMillion: 12.5, amount: 0 },
          { kind: 'output', tokens: 4_466, ratePerMillion: 60, amount: 0.26796 }
        ]
      }]
    },
    estimateCoverage: 'complete',
    providerIds: ['codex'],
    models: ['gpt-5.6-sol'],
    ...overrides
  }
}

describe('TurnUsageDetailsCard', () => {
  beforeEach(async () => i18n.changeLanguage('en'))

  it('renders exact tokens, effective Fast rates, and an auditable total', () => {
    const html = renderToStaticMarkup(createElement(TurnUsageDetailsCard, {
      usage: fastUsage()
    }))

    expect(html).toContain('575,361')
    expect(html).toContain('Cache read (90.6%)')
    expect(html).toContain('Reasoning (included in output)')
    expect(html).toContain('gpt-5.6-sol · Fast ×2 · 21 requests')
    expect(html).toContain('54,145 × $10/M')
    expect(html).toContain('$0.5415')
    expect(html).toContain('≈$1.3306')
    expect(html).not.toContain('Cache write ·')
  })

  it('separates mixed groups and identifies unpriced, actual, and stale data', () => {
    const standardGroup = {
      model: 'gpt-5.6-luna', pricingMode: 'standard' as const, requestCount: 1,
      fastMultiplier: null, amount: 0.01,
      items: [{ kind: 'output' as const, tokens: 1_000, ratePerMillion: 1.2, amount: 0.0012 }]
    }
    const usage = fastUsage({
      actualCost: { currency: 'USD', amount: 0.0312 },
      estimateCoverage: 'partial',
      referencePriceBreakdown: {
        ...fastUsage().referencePriceBreakdown!,
        unpricedRequests: 2,
        groups: [...fastUsage().referencePriceBreakdown!.groups, standardGroup]
      }
    })
    const html = renderToStaticMarkup(createElement(TurnUsageDetailsCard, { usage, stale: true }))

    expect(html).toContain('Recorded cost')
    expect(html).toContain('$0.0312')
    expect(html).toContain('gpt-5.6-luna · Standard · 1 requests')
    expect(html).toContain('2 requests have no trusted reference price.')
    expect(html).toContain('Partial estimate')
    expect(html).toContain('Showing the last successfully loaded usage')
  })

  it('keeps legacy estimates useful without inventing line-item rates', () => {
    const html = renderToStaticMarkup(createElement(TurnUsageDetailsCard, {
      usage: fastUsage({ referencePriceBreakdown: null })
    }))

    expect(html).toContain('reference estimate without an itemized price breakdown')
    expect(html).not.toContain('data-turn-usage-price-details')
  })
})

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import type { TurnUsageSummary } from '../../hooks/use-turn-usage'
import { TurnUsageRow } from './TurnUsageRow'

function usage(overrides: Partial<TurnUsageSummary> = {}): TurnUsageSummary {
  return {
    turnId: 'turn-1',
    requests: 1,
    inputTokens: 1_000,
    outputTokens: 200,
    reasoningTokens: 0,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 1_200,
    actualCost: null,
    referenceEstimateUsd: null,
    referencePriceBreakdown: null,
    estimateCoverage: 'unavailable',
    providerIds: ['codex'],
    models: ['gpt-5.6-sol'],
    ...overrides
  }
}

describe('TurnUsageRow', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('shows actual cost and a distinctly labeled partial reference estimate', () => {
    const html = renderToStaticMarkup(createElement(TurnUsageRow, {
      usage: usage({
        actualCost: { currency: 'USD', amount: 0.0123 },
        referenceEstimateUsd: 0.0456,
        estimateCoverage: 'partial'
      })
    }))

    expect(html).toContain('1,200 tokens')
    expect(html).toContain('Cost $0.0123')
    expect(html).toContain('Estimate ≈$0.0456')
    expect(html).toContain('Partial estimate')
    expect(html).toContain('data-turn-usage-partial')
    expect(html).toContain('flex-wrap')
  })

  it('renders a trusted zero estimate instead of treating it as unavailable', () => {
    const html = renderToStaticMarkup(createElement(TurnUsageRow, {
      usage: usage({ referenceEstimateUsd: 0, estimateCoverage: 'complete' })
    }))

    expect(html).toContain('Estimate ≈$0.0000')
    expect(html).not.toContain('data-turn-usage-unavailable')
  })

  it('renders unavailable and stale states without hiding token usage', () => {
    const html = renderToStaticMarkup(createElement(TurnUsageRow, {
      usage: usage(),
      stale: true
    }))

    expect(html).toContain('1,200 tokens')
    expect(html).toContain('Price unavailable')
    expect(html).toContain('May be stale')
    expect(html).toContain('data-stale="true"')
  })
})

import { createElement } from 'react'
import { act, create as createRenderer } from 'react-test-renderer'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import type { DailyUsageBucket } from '../../hooks/use-daily-usage'
import {
  SidebarUsageHistoryCard,
  buildContributionWeeks,
  heatmapWeeksForWidth
} from './SidebarUsageHistoryCard'

function bucket(date: string, totalTokens: number): DailyUsageBucket {
  return {
    date,
    inputTokens: totalTokens,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    cacheMissTokens: totalTokens,
    totalTokens,
    costUsd: totalTokens / 1_000_000,
    costCny: totalTokens / 1_000_000 * 7.2,
    valueEstimateUsd: 0,
    valueEstimateCny: null,
    valueEstimateCoverage: 'unavailable',
    valueEstimateUnpricedRequests: 0,
    tokenEconomySavingsTokens: 0,
    turns: totalTokens > 0 ? 1 : 0,
    threadCount: totalTokens > 0 ? 1 : 0,
    cacheHitRate: null
  }
}

function twelveWeeks(): DailyUsageBucket[] {
  const start = new Date('2026-06-01T00:00:00.000Z')
  return Array.from({ length: 84 }, (_, index) => {
    const date = new Date(start)
    date.setUTCDate(start.getUTCDate() + index)
    return bucket(date.toISOString().slice(0, 10), index % 3 === 0 ? (index + 1) * 1_000 : 0)
  })
}

const metrics = [
  { label: 'Tokens', value: '1.2M', accent: true },
  { label: 'Cost', value: '$1.20' },
  { label: 'Cache hit', value: '97%' },
  { label: 'Sessions', value: '42' }
]

describe('SidebarUsageHistoryCard', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('builds a Monday-first 7 by 12 contribution calendar', () => {
    const weeks = buildContributionWeeks(twelveWeeks())

    expect(weeks).toHaveLength(12)
    expect(weeks.every((week) => week.cells.length === 7)).toBe(true)
    expect(weeks[0].cells[0]?.date).toBe('2026-06-01')
    expect(weeks[11].cells[6]?.date).toBe('2026-08-23')
  })

  it('computes a responsive week count that fills the available width', () => {
    expect(heatmapWeeksForWidth(280)).toBe(12)
    expect(heatmapWeeksForWidth(760)).toBe(40)
    expect(heatmapWeeksForWidth(1200)).toBe(52)
  })

  it('renders a fixed-size GitHub style grid without stretching or scrolling', () => {
    const html = renderToStaticMarkup(createElement(SidebarUsageHistoryCard, {
      buckets: twelveWeeks(),
      error: null,
      hasUsage: true,
      loading: false,
      metrics
    }))

    expect(html).toContain('data-usage-contribution-heatmap="true"')
    expect(html).toContain('Last 12 weeks')
    expect(html).toContain('Daily token usage')
    expect(html).toContain('Current streak:')
    expect(html).toContain('Most active:')
    expect(html.match(/role="gridcell"/g)).toHaveLength(84)
    expect(html).toContain('repeat(12, 13px)')
    expect(html).toContain('column-gap:4px')
    expect(html).toContain('bg-[#eef2f7]')
    expect(html).toContain('bg-[#cce9ff]')
    expect(html).toContain('bg-[#80c9ff]')
    expect(html).toContain('bg-[#2da9f7]')
    expect(html).toContain('bg-[#0066cc]')
    expect(html).not.toContain('overflow-x-auto')
    expect(html).not.toContain('1fr')
  })

  it('places one month label at the column where each month starts', () => {
    const html = renderToStaticMarkup(createElement(SidebarUsageHistoryCard, {
      buckets: twelveWeeks(),
      error: null,
      hasUsage: true,
      loading: false,
      metrics
    }))

    expect(html.match(/>Jun</g)).toHaveLength(1)
    expect(html.match(/>Jul</g)).toHaveLength(1)
    expect(html.match(/>Aug</g)).toHaveLength(1)
  })

  it('marks the selected day with a dark outline like the design mock', async () => {
    let renderer!: ReturnType<typeof createRenderer>
    await act(async () => {
      renderer = createRenderer(createElement(SidebarUsageHistoryCard, {
        buckets: twelveWeeks(),
        error: null,
        hasUsage: true,
        loading: false,
        metrics
      }))
    })

    const cells = renderer.root.findAllByProps({ role: 'gridcell' })
    expect(cells.length).toBeGreaterThan(0)
    const fakeElement = {
      getBoundingClientRect: () => ({ left: 100, top: 100, width: 13, height: 13, bottom: 113 })
    } as unknown as HTMLElement
    await act(async () => cells[0].props.onClick({ currentTarget: fakeElement }))

    expect(JSON.stringify(renderer.toJSON())).toContain('ring-ds-ink')
    renderer.unmount()
  })

  it('switches the heatmap between token and cost intensity', async () => {
    let renderer!: ReturnType<typeof createRenderer>
    await act(async () => {
      renderer = createRenderer(createElement(SidebarUsageHistoryCard, {
        buckets: twelveWeeks(),
        error: null,
        hasUsage: true,
        loading: false,
        metrics
      }))
    })

    const costButton = renderer.root.findAllByType('button')
      .find((button) => button.children.includes('Cost'))!
    await act(async () => costButton.props.onClick())

    expect(JSON.stringify(renderer.toJSON())).toContain('Daily cost')
    expect(costButton.props['aria-pressed']).toBe(true)
    renderer.unmount()
  })
})

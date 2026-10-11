import { describe, expect, it } from 'vitest'
import type { ProviderQuotaEntry, ProviderQuotaMetric } from '@shared/provider-quota'
import {
  classifyQuotaEntries,
  formatQuotaAmount,
  quotaCountText,
  quotaFillPercent,
  quotaPace,
  quotaPlanLabel,
  quotaResetParts,
  quotaUsedPercent,
  quotaWindowName
} from './quota-view-model'

const HOUR = 3_600_000
const NOW = Date.parse('2027-01-15T08:00:00.000Z')

function metric(patch: Partial<ProviderQuotaMetric>): ProviderQuotaMetric {
  return { id: 'm', label: 'Usage', unit: 'percent', ...patch }
}

function entry(providerId: string, patch: Partial<ProviderQuotaEntry>): ProviderQuotaEntry {
  return { providerId, providerName: providerId, status: 'available', metrics: [], ...patch }
}

describe('quota view model', () => {
  it('splits providers into allowances, balances, problems and unsupported', () => {
    const sections = classifyQuotaEntries([
      entry('loose', { metrics: [metric({ id: 'a', usedPercent: 10 })] }),
      entry('tight', { metrics: [metric({ id: 'a', usedPercent: 90 })] }),
      entry('wallet', { metrics: [metric({ id: 'balance', unit: 'USD', remaining: 3 })] }),
      entry('empty', { metrics: [] }),
      entry('broken', { status: 'error' }),
      entry('unknown', { status: 'unsupported' })
    ])
    expect(sections.allowances.map((item) => item.providerId)).toEqual(['tight', 'loose'])
    expect(sections.balances.map((item) => item.providerId)).toEqual(['wallet'])
    expect(sections.problems.map((item) => item.providerId)).toEqual(['empty', 'broken'])
    expect(sections.unsupported.map((item) => item.providerId)).toEqual(['unknown'])
  })

  it('reads the used share from whichever figures a provider gives', () => {
    expect(quotaUsedPercent(metric({ usedPercent: 140 }))).toBe(100)
    expect(quotaUsedPercent(metric({ unit: 'requests', used: 25, limit: 100 }))).toBe(25)
    expect(quotaUsedPercent(metric({ unit: 'requests', remaining: 60, limit: 80 }))).toBe(25)
    expect(quotaUsedPercent(metric({ unit: 'USD', remaining: 5 }))).toBeUndefined()
    expect(quotaFillPercent(30, 'left')).toBe(70)
  })

  it('names windows by span and the models they count', () => {
    expect(quotaWindowName(metric({ id: 'five-hour', label: '5-hour usage', windowSeconds: 18_000 })))
      .toEqual({ span: { unit: 'hours', count: 5 } })
    expect(quotaWindowName(metric({ id: 'seven-day-opus', label: '7-day Opus usage', windowSeconds: 604_800 })))
      .toEqual({ scope: 'Opus', span: { unit: 'days', count: 7 } })
    expect(quotaWindowName(metric({ id: 'additional-0-primary', label: 'Spark - 5h usage', windowSeconds: 18_000 })))
      .toEqual({ scope: 'Spark', span: { unit: 'hours', count: 5 } })
    expect(quotaWindowName(metric({ id: 'interval-0', label: 'MiniMax-M3 interval quota', windowSeconds: 18_000 })))
      .toEqual({ scope: 'MiniMax-M3', span: { unit: 'hours', count: 5 } })
    expect(quotaWindowName(metric({ id: 'included-plan', label: 'Included plan usage' })))
      .toEqual({ raw: 'Included plan' })
  })

  it('places the even-pace line between a window start and its reset', () => {
    const window = metric({ usedPercent: 70, windowSeconds: 10 * 3_600, resetsAt: new Date(NOW + 5 * HOUR).toISOString() })
    expect(quotaPace(window, NOW)).toEqual({ expectedUsedPercent: 50, ahead: true })
    expect(quotaPace({ ...window, usedPercent: 55 }, NOW)?.ahead).toBe(false)
    expect(quotaPace({ ...window, windowSeconds: undefined }, NOW)).toBeUndefined()
    expect(quotaPace({ ...window, resetsAt: new Date(NOW - HOUR).toISOString() }, NOW)).toBeUndefined()
  })

  it('says when a window resets, on the clock and from now', () => {
    const soon = quotaResetParts(new Date(NOW + 2 * HOUR).toISOString(), NOW, 'en')
    expect(soon?.relative).toBe('in 2 hr.')
    const far = quotaResetParts(new Date(NOW + 20 * 24 * HOUR).toISOString(), NOW, 'en')
    expect(far?.relative).toBe('in 20 days')
    expect(quotaResetParts(new Date(NOW - HOUR).toISOString(), NOW, 'en')?.relative).toBeUndefined()
  })

  it('formats amounts as money or counts, with the unit once', () => {
    expect(formatQuotaAmount(86.4, 'CNY', 'zh-CN')).toBe('¥86.40')
    expect(formatQuotaAmount(23.75, 'usd', 'en')).toBe('$23.75')
    expect(formatQuotaAmount(250_000, 'tokens', 'en')).toBe('250K tokens')
    expect(quotaCountText(metric({ unit: 'requests', used: 340, limit: 1_500 }), 'used', 'en'))
      .toBe('340 / 1,500 requests')
    expect(quotaCountText(metric({ unit: 'USD', used: 11.5, limit: 20 }), 'left', 'en'))
      .toBe('$8.50 / $20.00')
    expect(quotaCountText(metric({ usedPercent: 10 }), 'used', 'en')).toBeUndefined()
  })

  it('reads plan names and leaves account addresses alone', () => {
    expect(quotaPlanLabel('max')).toBe('Max')
    expect(quotaPlanLabel('team_plus')).toBe('Team Plus')
    expect(quotaPlanLabel('Pro+')).toBe('Pro+')
    expect(quotaPlanLabel('me@example.com')).toBeUndefined()
  })
})

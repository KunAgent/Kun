import { describe, expect, it, vi } from 'vitest'
import type { ThreadUsageResponse } from '../contracts/usage.js'
import { stripAnsi } from './layout.js'
import {
  UsageDialog,
  usageReportBody,
  usageReportVisibleWidth,
  type UsageReportData
} from './usage-report.js'

const counters = {
  input_tokens: 104_920,
  output_tokens: 21_562,
  reasoning_tokens: 8_214,
  cached_tokens: 96_440,
  cache_write_tokens: 0,
  cache_miss_tokens: 8_480,
  total_tokens: 126_482,
  cost_usd: 0.2,
  cost_cny: 1.42,
  value_estimate_usd: 0,
  value_estimate_cny: 0,
  value_estimate_coverage: 'unavailable' as const,
  value_estimate_priced_requests: 0,
  value_estimate_unpriced_requests: 0,
  cache_savings_usd: 0,
  cache_savings_cny: 0,
  token_economy_savings_tokens: 18_000,
  token_economy_savings_usd: 0,
  token_economy_savings_cny: 0,
  turns: 18,
  cache_hit_rate: 0.92
}

const usage: ThreadUsageResponse = {
  group_by: 'thread',
  buckets: [
    {
      thread_id: 'thread-current',
      ...counters,
      last_turn_cache_hit_rate: 0.95,
      last_turn_cacheable_hit_rate: 0.96,
      last_turn_total_input_hit_rate: 0.9,
      last_cache_miss_reasons: [],
      last_cache_suggestions: []
    },
    {
      thread_id: 'thread-second',
      ...counters,
      total_tokens: 98_741,
      turns: 12,
      last_turn_cache_hit_rate: 0.9,
      last_turn_cacheable_hit_rate: 0.91,
      last_turn_total_input_hit_rate: 0.84,
      last_cache_miss_reasons: [],
      last_cache_suggestions: []
    },
    {
      thread_id: 'thread-third',
      ...counters,
      total_tokens: 65_218,
      turns: 9,
      last_turn_cache_hit_rate: null,
      last_turn_cacheable_hit_rate: null,
      last_turn_total_input_hit_rate: null,
      last_cache_miss_reasons: [],
      last_cache_suggestions: []
    }
  ],
  totals: {
    ...counters,
    input_tokens: 4_010_114,
    output_tokens: 810_916,
    reasoning_tokens: 125_000,
    cached_tokens: 3_522_448,
    cache_miss_tokens: 487_666,
    total_tokens: 4_821_030,
    cost_usd: 5.93,
    cost_cny: 42.68,
    token_economy_savings_tokens: 684_220,
    turns: 488,
    thread_count: 47,
    cache_hit_rate: 0.88
  }
}

const snapshot: UsageReportData = {
  usage,
  activeThreadId: 'thread-current',
  threadTitles: {
    'thread-current': 'Agent research workflow',
    'thread-second': 'Multi-file refactor plan'
  }
}

describe('TUI usage report', () => {
  it.each([120, 80, 42])('renders current, total, and top-session usage within %i columns', (width) => {
    const lines = usageReportBody(snapshot, width)
    const plain = lines.map(stripAnsi).join('\n')

    expect(plain).toContain('CURRENT SESSION')
    expect(plain).toContain('126,482')
    expect(plain).toContain('ALL SESSIONS')
    expect(plain).toContain('4,821,030')
    expect(plain).toContain('TOP SESSIONS')
    expect(plain).toContain('Agent research workflow')
    expect(plain).toContain('thread-third')
    expect(usageReportVisibleWidth(lines)).toBeLessThanOrEqual(width)
  })

  it('keeps accumulated totals when no active session is open', () => {
    const plain = usageReportBody({ usage, threadTitles: {} }, 80).map(stripAnsi).join('\n')

    expect(plain).toContain('No current session is open')
    expect(plain).toContain('4,821,030')
  })

  it('retains the previous snapshot on refresh failure and supports scrolling and close', async () => {
    const requestRender = vi.fn()
    const close = vi.fn()
    let reject = false
    const load = vi.fn(async () => {
      if (reject) throw new Error('refresh failed with token=super-secret-value')
      return snapshot
    })
    const dialog = new UsageDialog(
      { requestRender } as never,
      load,
      close,
      () => 10,
      () => Date.parse('2026-07-29T08:00:00.000Z')
    )

    const pending = dialog.refresh()
    expect(dialog.render(70).map(stripAnsi).join('\n')).toContain('Loading Kun usage')
    await pending
    const first = dialog.render(70).map(stripAnsi).join('\n')
    expect(first).toContain('126,482')

    dialog.handleInput('\x1b[6~')
    const second = dialog.render(70).map(stripAnsi).join('\n')
    expect(second).not.toBe(first)

    reject = true
    await dialog.refresh()
    const failed = dialog.render(70).map(stripAnsi).join('\n')
    expect(failed).toContain('Refresh failed')
    expect(failed).not.toContain('super-secret-value')

    dialog.handleInput('\x1b')
    expect(close).toHaveBeenCalledTimes(1)
  })
})

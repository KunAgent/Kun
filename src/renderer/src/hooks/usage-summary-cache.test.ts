import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  readUsageSummaryCache,
  resetUsageSummaryCacheForTests,
  USAGE_SUMMARY_FRESH_MS,
  writeUsageSummaryCache
} from './usage-summary-cache'

afterEach(() => {
  vi.useRealTimers()
  resetUsageSummaryCacheForTests()
})

describe('usage summary cache', () => {
  it('returns fresh data for 30 minutes and retains it as stale afterwards', () => {
    const now = Date.parse('2026-08-31T00:00:00.000Z')
    writeUsageSummaryCache('/day', { tokens: 10 }, now)

    expect(readUsageSummaryCache<{ tokens: number }>('/day', now + USAGE_SUMMARY_FRESH_MS - 1))
      .toMatchObject({ value: { tokens: 10 }, stale: false })
    expect(readUsageSummaryCache<{ tokens: number }>('/day', now + USAGE_SUMMARY_FRESH_MS))
      .toMatchObject({ value: { tokens: 10 }, stale: true })
  })

  it('keeps paths independent and resets entries for tests', () => {
    writeUsageSummaryCache('/day', { kind: 'day' }, 1)
    writeUsageSummaryCache('/model?days=90', { kind: 'model' }, 2)

    expect(readUsageSummaryCache<{ kind: string }>('/day', 3)?.value.kind).toBe('day')
    expect(readUsageSummaryCache<{ kind: string }>('/model?days=90', 3)?.value.kind).toBe('model')
    resetUsageSummaryCacheForTests()
    expect(readUsageSummaryCache('/day', 3)).toBeNull()
  })

  it('evicts least recently used entries when the cache is bounded', () => {
    for (let index = 0; index < 12; index += 1) {
      writeUsageSummaryCache(`/usage/${index}`, index, index + 1)
    }
    readUsageSummaryCache('/usage/0', 100)
    writeUsageSummaryCache('/usage/new', 13, 101)

    expect(readUsageSummaryCache('/usage/0', 102)).not.toBeNull()
    expect(readUsageSummaryCache('/usage/1', 102)).toBeNull()
  })
})

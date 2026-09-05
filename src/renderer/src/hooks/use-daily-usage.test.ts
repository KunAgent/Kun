import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildDailyUsagePath,
  defaultDailyUsageRange,
  loadDailyUsage,
  normalizeDailyUsageResponse
} from './use-daily-usage'

type RuntimeRequest = (path: string, method?: string) => Promise<{ ok: boolean; status: number; body: string }>

function setRuntimeRequest(runtimeRequest: RuntimeRequest): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      kunGui: {
        runtimeRequest
      }
    }
  })
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  Reflect.deleteProperty(globalThis, 'window')
})

describe('daily usage helpers', () => {
  it('builds the default 90-day range ending on the current client date', () => {
    const range = defaultDailyUsageRange(new Date('2026-06-01T12:00:00.000Z'))

    expect(range.from).toBe('2026-03-04')
    expect(range.to).toBe('2026-06-01')
    expect(range.to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(range.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(range.timezone).toBeTruthy()
  })

  it('builds an encoded daily usage request path', () => {
    expect(
      buildDailyUsagePath({
        from: '2026-05-01',
        to: '2026-05-31',
        timezone: 'Asia/Shanghai'
      })
    ).toBe('/v1/usage?group_by=day&from=2026-05-01&to=2026-05-31&timezone=Asia%2FShanghai')
  })

  it('normalizes buckets and totals into renderer naming', () => {
    const normalized = normalizeDailyUsageResponse({
      group_by: 'day',
      from: '2026-05-01',
      to: '2026-05-01',
      timezone: 'UTC',
      buckets: [
        {
          date: '2026-05-01',
          input_tokens: 100,
          output_tokens: 30,
          total_tokens: 130,
          cost_usd: 0.02,
          cache_savings_usd: 0.006,
          cache_savings_cny: 0.0432,
          token_economy_savings_tokens: 2048,
          token_economy_savings_usd: 0.0009,
          token_economy_savings_cny: 0.0063,
          turns: 2,
          thread_count: 1,
          cache_hit_rate: 0.5
        }
      ],
      totals: {
        total_tokens: 130,
        cache_savings_usd: 0.006,
        token_economy_savings_tokens: 2048,
        token_economy_savings_usd: 0.0009,
        turns: 2,
        thread_count: 1,
        days: 1,
        active_days: 1
      }
    })

    expect(normalized.buckets[0]).toMatchObject({
      date: '2026-05-01',
      inputTokens: 100,
      outputTokens: 30,
      totalTokens: 130,
      tokenEconomySavingsTokens: 2048,
      turns: 2,
      threadCount: 1,
      cacheHitRate: 0.5
    })
    expect(normalized.totals.tokenEconomySavingsTokens).toBe(2048)
    expect(normalized.totals.activeDays).toBe(1)
  })

  it('normalizes subscription value estimates with coverage into renderer naming', () => {
    const normalized = normalizeDailyUsageResponse({
      group_by: 'day',
      from: '2026-08-20',
      to: '2026-08-20',
      timezone: 'UTC',
      buckets: [
        {
          date: '2026-08-20',
          input_tokens: 1_000_000,
          output_tokens: 50_000,
          total_tokens: 1_050_000,
          cost_usd: 0.0,
          cost_cny: 0,
          value_estimate_usd: 32.5,
          value_estimate_cny: 234,
          value_estimate_coverage: 'partial',
          value_estimate_priced_requests: 40,
          value_estimate_unpriced_requests: 7,
          turns: 40,
          thread_count: 3
        }
      ],
      totals: {
        total_tokens: 1_050_000,
        value_estimate_usd: 32.5,
        value_estimate_cny: 234,
        value_estimate_coverage: 'partial',
        value_estimate_unpriced_requests: 7,
        turns: 40,
        days: 1,
        active_days: 1
      }
    })

    expect(normalized.buckets[0]).toMatchObject({
      valueEstimateUsd: 32.5,
      valueEstimateCny: 234,
      valueEstimateCoverage: 'partial',
      valueEstimateUnpricedRequests: 7
    })
    expect(normalized.totals.valueEstimateUsd).toBe(32.5)
    expect(normalized.totals.valueEstimateCny).toBe(234)
    expect(normalized.totals.valueEstimateCoverage).toBe('partial')
    expect(normalized.totals.valueEstimateUnpricedRequests).toBe(7)
  })

  it('falls back to unavailable coverage for malformed estimate values', () => {
    const normalized = normalizeDailyUsageResponse({
      group_by: 'day',
      from: '2026-08-20',
      to: '2026-08-20',
      timezone: 'UTC',
      buckets: [
        { date: '2026-08-20', input_tokens: 10, output_tokens: 2, value_estimate_coverage: 'weird' }
      ],
      totals: { days: 1, active_days: 1 }
    })

    expect(normalized.buckets[0].valueEstimateCoverage).toBe('unavailable')
    expect(normalized.buckets[0].valueEstimateUsd).toBe(0)
    expect(normalized.buckets[0].valueEstimateCny).toBeNull()
    expect(normalized.totals.valueEstimateCoverage).toBe('unavailable')
  })

  it('loads daily usage from the runtime request bridge', async () => {
    const runtimeRequest = vi.fn<RuntimeRequest>(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        group_by: 'day',
        from: '2026-05-01',
        to: '2026-05-01',
        timezone: 'UTC',
        buckets: [{ date: '2026-05-01', total_tokens: 10, turns: 1 }],
        totals: { total_tokens: 10, turns: 1, days: 1, active_days: 1 }
      })
    }))
    setRuntimeRequest(runtimeRequest)

    const loaded = await loadDailyUsage({ from: '2026-05-01', to: '2026-05-01', timezone: 'UTC' })

    expect(loaded?.totals.totalTokens).toBe(10)
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/usage?group_by=day&from=2026-05-01&to=2026-05-01&timezone=UTC',
      'GET'
    )
  })

  it('loads an empty usage response without inventing activity', async () => {
    setRuntimeRequest(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        group_by: 'day',
        from: '2026-05-01',
        to: '2026-05-01',
        timezone: 'UTC',
        buckets: [
          {
            date: '2026-05-01',
            input_tokens: 0,
            output_tokens: 0,
            total_tokens: 0,
            turns: 0,
            thread_count: 0
          }
        ],
        totals: { total_tokens: 0, turns: 0, days: 1, active_days: 0, thread_count: 0 }
      })
    }))

    const loaded = await loadDailyUsage({ from: '2026-05-01', to: '2026-05-01', timezone: 'UTC' })

    expect(loaded?.totals.activeDays).toBe(0)
    expect(loaded?.buckets[0]?.totalTokens).toBe(0)
  })

  it('throws a recoverable error when the runtime request fails', async () => {
    setRuntimeRequest(async () => ({ ok: false, status: 400, body: '{}' }))

    await expect(
      loadDailyUsage({ from: '2026-05-01', to: '2026-05-01', timezone: 'UTC' })
    ).rejects.toThrow('daily usage request failed: 400')
  })

  it('preserves a structured runtime error code for diagnostics', async () => {
    setRuntimeRequest(async () => ({
      ok: false,
      status: 503,
      body: JSON.stringify({
        code: 'usage_query_timeout',
        message: 'Usage index query timed out.'
      })
    }))

    await expect(
      loadDailyUsage({ from: '2026-05-01', to: '2026-05-01', timezone: 'UTC' })
    ).rejects.toThrow(
      'daily usage request failed: 503 (usage_query_timeout: Usage index query timed out.)'
    )
  })

  it('waits for the runtime bridge to settle without a renderer timeout', async () => {
    let resolve!: (value: { ok: boolean; status: number; body: string }) => void
    setRuntimeRequest(() => new Promise((done) => { resolve = done }))

    const pending = loadDailyUsage({ from: '2026-05-01', to: '2026-05-01', timezone: 'UTC' })
    resolve({
      ok: true,
      status: 200,
      body: JSON.stringify({ group_by: 'day', buckets: [], totals: {} })
    })

    await expect(pending).resolves.toMatchObject({ groupBy: 'day' })
  })

  it('reports invalid JSON daily usage responses with a stable error', async () => {
    setRuntimeRequest(async () => ({ ok: true, status: 200, body: '{bad-json' }))

    await expect(
      loadDailyUsage({ from: '2026-05-01', to: '2026-05-01', timezone: 'UTC' })
    ).rejects.toThrow('daily usage response was not valid JSON')
  })
})

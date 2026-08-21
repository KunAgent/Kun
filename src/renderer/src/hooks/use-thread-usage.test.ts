import { createElement, useEffect } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cumulativeCacheHitRate,
  formatCost,
  loadThreadUsage,
  primaryCacheHitRate,
  retainPendingThreadUsage,
  summarizeThreadMoney,
  useThreadUsageState,
  type ThreadUsageState,
  type ThreadUsageSummary
} from './use-thread-usage'

type RuntimeRequest = (path: string, method?: string) => Promise<{ ok: boolean; status: number; body: string }>

function threadUsagePath(threadId: string): string {
  const params = new URLSearchParams({ group_by: 'thread', thread_id: threadId })
  return `/v1/usage?${params.toString()}`
}

function usageSummary(overrides: Partial<ThreadUsageSummary> = {}): ThreadUsageSummary {
  return {
    inputTokens: 100,
    outputTokens: 20,
    reasoningTokens: 0,
    cachedTokens: 80,
    cacheMissTokens: 20,
    cacheHitRate: 0.8,
    lastTurnCacheHitRate: 0.8,
    totalTokens: 120,
    costUsd: null,
    costCny: null,
    valueEstimateUsd: null,
    valueEstimateCny: null,
    tokenEconomySavingsTokens: 0,
    turns: 1,
    avgTtftMs: null,
    avgTokensPerSecond: null,
    ...overrides
  }
}

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

function ThreadUsageProbe({ onState }: { onState: (state: ThreadUsageState) => void }): null {
  const state = useThreadUsageState('thr_retry', true, 'reload')
  useEffect(() => onState(state), [onState, state])
  return null
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  Reflect.deleteProperty(globalThis, 'window')
})

describe('thread usage formatting', () => {
  it('retries a transient usage request failure after reopening a thread', async () => {
    vi.useFakeTimers()
    const runtimeRequest = vi.fn<RuntimeRequest>()
      .mockResolvedValueOnce({ ok: false, status: 503, body: '' })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: JSON.stringify({
          buckets: [{
            thread_id: 'thr_retry',
            input_tokens: 100,
            output_tokens: 20,
            cached_tokens: 90,
            cache_miss_tokens: 10,
            cache_hit_rate: 0.9,
            last_turn_cache_hit_rate: 0.9,
            turns: 1
          }]
        })
      })
    setRuntimeRequest(runtimeRequest)
    let latest: ThreadUsageState | undefined

    await act(async () => {
      create(createElement(ThreadUsageProbe, { onState: (state) => { latest = state } }))
      await Promise.resolve()
    })
    expect(runtimeRequest).toHaveBeenCalledTimes(1)
    expect(latest).toMatchObject({ loading: true, loaded: false })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })

    expect(runtimeRequest).toHaveBeenCalledTimes(2)
    expect(latest).toMatchObject({
      loading: false,
      loaded: true,
      usage: expect.objectContaining({ cacheHitRate: 0.9, lastTurnCacheHitRate: 0.9 })
    })
  })
  it('uses RMB for Chinese locales and USD for English locales', () => {
    expect(formatCost(0.125, 'zh', 0.88)).toBe('￥0.8800')
    expect(formatCost(0.125, 'zh-CN', 0.88)).toBe('￥0.8800')
    expect(formatCost(0.125, 'en')).toBe('$0.1250')
    expect(formatCost(null, 'zh-CN', null)).toBe('-')
    expect(formatCost(null, 'en', 0.88)).toBe('$0.1222')
    expect(formatCost(null, 'ja', 0.88)).toBe('$0.1222')
    expect(formatCost(0.125, 'zh-CN')).toBe('￥0.9000')
    expect(formatCost(0.00000001, 'en')).toBe('$<0.0001')
  })

  it('keeps actual API cost and subscription value estimates separate', () => {
    expect(summarizeThreadMoney({
      costUsd: 0.125, costCny: null, valueEstimateUsd: 0.5, valueEstimateCny: null, locale: 'en'
    })).toEqual([
      { kind: 'actual', value: '$0.1250' },
      { kind: 'estimate', value: '$0.5000', coverage: 'complete' }
    ])
    expect(summarizeThreadMoney({
      costUsd: 0.125, costCny: null, valueEstimateUsd: 0.5, valueEstimateCny: null, locale: 'zh'
    })).toEqual([
      { kind: 'actual', value: '￥0.9000' },
      { kind: 'estimate', value: '￥3.60', coverage: 'complete' }
    ])
  })

  it('preserves trusted zero and partial reference estimate semantics', () => {
    expect(summarizeThreadMoney({
      costUsd: null,
      costCny: null,
      valueEstimateUsd: 0,
      valueEstimateCny: 0,
      valueEstimateCoverage: 'complete',
      locale: 'en'
    })).toEqual([{ kind: 'estimate', value: '$0.0000', coverage: 'complete' }])
    expect(summarizeThreadMoney({
      costUsd: null,
      costCny: null,
      valueEstimateUsd: 0.25,
      valueEstimateCny: 1.8,
      valueEstimateCoverage: 'partial',
      locale: 'zh'
    })).toEqual([{ kind: 'estimate', value: '￥1.80', coverage: 'partial' }])
  })

  it('prefers the latest LLM cache result, including zero, then falls back to cumulative usage', () => {
    expect(primaryCacheHitRate({ cacheHitRate: 0.4, lastTurnCacheHitRate: 0.95 })).toBe(0.95)
    expect(primaryCacheHitRate({ cacheHitRate: 0.4, lastTurnCacheHitRate: 0 })).toBe(0)
    expect(primaryCacheHitRate({ cacheHitRate: 0.4, lastTurnCacheHitRate: null })).toBe(0.4)
    expect(primaryCacheHitRate({ cacheHitRate: null, lastTurnCacheHitRate: null })).toBeNull()
  })

  it('retains the last confirmed cache result while refreshed telemetry is pending', () => {
    const previous = usageSummary({
      lastTurnCacheHitRate: 0.95,
      lastTurnCacheableHitRate: 0.95,
      cacheMissReasons: ['cold_request']
    })
    const pending = usageSummary({
      inputTokens: 180,
      lastTurnCacheHitRate: null,
      lastTurnCacheableHitRate: null,
      cacheMissReasons: []
    })

    expect(retainPendingThreadUsage(previous, pending)).toMatchObject({
      inputTokens: 180,
      lastTurnCacheHitRate: 0.95,
      lastTurnCacheableHitRate: 0.95,
      cacheMissReasons: ['cold_request']
    })
    expect(retainPendingThreadUsage(previous, usageSummary({ lastTurnCacheHitRate: 0.72 })))
      .toMatchObject({ lastTurnCacheHitRate: 0.72 })
    expect(retainPendingThreadUsage(previous, usageSummary({ lastTurnCacheHitRate: 0 })))
      .toMatchObject({ lastTurnCacheHitRate: 0 })
    expect(retainPendingThreadUsage(previous, null)).toBe(previous)
  })

  it('derives the cumulative cache rate from tokens to match the overall usage panel (#654)', () => {
    // Last-turn rate could be 0 while the thread cumulative is non-zero — the
    // aggregate panel keeps using the token-derived cumulative value.
    expect(cumulativeCacheHitRate({ cachedTokens: 41, cacheMissTokens: 959, cacheHitRate: 0 })).toBeCloseTo(0.041, 3)
    // Falls back to the provided rate when there is no token telemetry.
    expect(cumulativeCacheHitRate({ cachedTokens: 0, cacheMissTokens: 0, cacheHitRate: 0.8 })).toBe(0.8)
    expect(cumulativeCacheHitRate({ cachedTokens: 0, cacheMissTokens: 0, cacheHitRate: null })).toBeNull()
  })

  it('keeps cache hit rate unknown for cachedTokens-only thread usage buckets', async () => {
    const runtimeRequest = vi.fn<RuntimeRequest>(async (path) => {
      if (path === threadUsagePath('thr_cached_only')) {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            buckets: [
              {
                thread_id: 'thr_cached_only',
                input_tokens: 100,
                output_tokens: 20,
                total_tokens: 120,
                cached_tokens: 42,
                cache_hit_rate: null,
                turns: 1
              }
            ]
          })
        }
      }
      throw new Error(`unexpected request: ${path}`)
    })
    setRuntimeRequest(runtimeRequest)

    const usage = await loadThreadUsage('thr_cached_only')

    expect(usage).toMatchObject({
      inputTokens: 100,
      outputTokens: 20,
      cachedTokens: 0,
      cacheMissTokens: 0,
      cacheHitRate: null,
      costUsd: null,
      costCny: null
    })
    expect(runtimeRequest).toHaveBeenCalledTimes(1)
  })

  it('keeps CNY-only thread cost instead of coercing it to USD zero', async () => {
    const runtimeRequest = vi.fn<RuntimeRequest>(async (path) => {
      if (path === threadUsagePath('thr_cny_only')) {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            buckets: [
              {
                thread_id: 'thr_cny_only',
                input_tokens: 100,
                output_tokens: 20,
                total_tokens: 120,
                cost_usd: 0,
                cost_cny: 0.06909,
                turns: 1
              }
            ]
          })
        }
      }
      throw new Error(`unexpected request: ${path}`)
    })
    setRuntimeRequest(runtimeRequest)

    const usage = await loadThreadUsage('thr_cny_only')

    expect(usage).toMatchObject({
      costUsd: null,
      costCny: 0.06909
    })
  })

  it('loads aggregate estimate coverage without collapsing a known zero to null', async () => {
    const runtimeRequest = vi.fn<RuntimeRequest>(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        buckets: [{
          thread_id: 'thr_zero_estimate',
          input_tokens: 100,
          output_tokens: 20,
          total_tokens: 120,
          value_estimate_usd: 0,
          value_estimate_cny: 0,
          value_estimate_coverage: 'complete',
          value_estimate_priced_requests: 1,
          value_estimate_unpriced_requests: 0,
          turns: 1
        }]
      })
    }))
    setRuntimeRequest(runtimeRequest)

    await expect(loadThreadUsage('thr_zero_estimate')).resolves.toMatchObject({
      valueEstimateUsd: 0,
      valueEstimateCny: 0,
      valueEstimateCoverage: 'complete',
      valueEstimatePricedRequests: 1,
      valueEstimateUnpricedRequests: 0
    })
  })

  it('uses explicit aggregate thread cache telemetry when available', async () => {
    const runtimeRequest = vi.fn<RuntimeRequest>(async (path) => {
      if (path === threadUsagePath('thr_aggregate_cache')) {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            buckets: [
              {
                thread_id: 'thr_aggregate_cache',
                input_tokens: 100,
                output_tokens: 20,
                total_tokens: 120,
                cache_savings_usd: 0.003,
                cache_savings_cny: 0.0216,
                token_economy_savings_tokens: 4096,
                token_economy_savings_usd: 0.0018,
                token_economy_savings_cny: 0.0126,
                cached_tokens: 40,
                cache_miss_tokens: 60,
                cache_hit_rate: 0.4,
                turns: 1
              }
            ]
          })
        }
      }
      throw new Error(`unexpected request: ${path}`)
    })
    setRuntimeRequest(runtimeRequest)

    const usage = await loadThreadUsage('thr_aggregate_cache')

    expect(usage).toMatchObject({
      cachedTokens: 40,
      cacheMissTokens: 60,
      cacheHitRate: 0.4,
      tokenEconomySavingsTokens: 4096
    })
    expect(runtimeRequest).toHaveBeenCalledTimes(1)
  })

  it('requests only the selected thread usage bucket', async () => {
    const runtimeRequest = vi.fn<RuntimeRequest>(async (path) => {
      if (path === threadUsagePath('thr_native_cache')) {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            buckets: [
              {
                thread_id: 'thr_native_cache',
                input_tokens: 100,
                output_tokens: 20,
                total_tokens: 120,
                cached_tokens: 80,
                cache_miss_tokens: 20,
                cache_hit_rate: 0.8,
                turns: 1
              }
            ]
          })
        }
      }
      throw new Error(`unexpected request: ${path}`)
    })
    setRuntimeRequest(runtimeRequest)

    const usage = await loadThreadUsage('thr_native_cache')

    expect(usage).toMatchObject({
      cachedTokens: 80,
      cacheMissTokens: 20,
      cacheHitRate: 0.8
    })
    expect(runtimeRequest).toHaveBeenCalledTimes(1)
    expect(runtimeRequest).toHaveBeenCalledWith(threadUsagePath('thr_native_cache'), 'GET')
  })

  it('surfaces the latest-turn cache rate distinctly from the cumulative rate', async () => {
    const runtimeRequest = vi.fn<RuntimeRequest>(async (path) => {
      if (path === threadUsagePath('thr_last_turn')) {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            buckets: [
              {
                thread_id: 'thr_last_turn',
                input_tokens: 100,
                output_tokens: 20,
                total_tokens: 120,
                cached_tokens: 80,
                cache_miss_tokens: 20,
                cache_hit_rate: 0.55,
                last_turn_cache_hit_rate: 0.986,
                turns: 2
              }
            ]
          })
        }
      }
      throw new Error(`unexpected request: ${path}`)
    })
    setRuntimeRequest(runtimeRequest)

    const usage = await loadThreadUsage('thr_last_turn')

    expect(usage).toMatchObject({
      cacheHitRate: 0.55,
      lastTurnCacheHitRate: 0.986
    })
  })

  it('surfaces latest-turn cache diagnostics', async () => {
    const runtimeRequest = vi.fn<RuntimeRequest>(async (path) => {
      if (path === threadUsagePath('thr_cache_diagnostics')) {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            buckets: [
              {
                thread_id: 'thr_cache_diagnostics',
                input_tokens: 1000,
                output_tokens: 20,
                total_tokens: 1020,
                cached_tokens: 600,
                cache_miss_tokens: 200,
                cache_hit_rate: 0.75,
                last_turn_cache_hit_rate: 0.75,
                last_turn_cacheable_hit_rate: 0.75,
                last_turn_total_input_hit_rate: 0.6,
                last_cache_miss_reasons: ['tool_catalog_changed'],
                last_cache_suggestions: ['Keep MCP and Skill tools stable within a thread.'],
                turns: 1
              }
            ]
          })
        }
      }
      throw new Error(`unexpected request: ${path}`)
    })
    setRuntimeRequest(runtimeRequest)

    const usage = await loadThreadUsage('thr_cache_diagnostics')

    expect(usage).toMatchObject({
      lastTurnCacheableHitRate: 0.75,
      lastTurnTotalInputHitRate: 0.6,
      cacheMissReasons: ['tool_catalog_changed'],
      cacheSuggestions: ['Keep MCP and Skill tools stable within a thread.']
    })
  })

  it('falls back to null last-turn cache rate when the field is absent', async () => {
    const runtimeRequest = vi.fn<RuntimeRequest>(async (path) => {
      if (path === threadUsagePath('thr_no_last_turn')) {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            buckets: [
              {
                thread_id: 'thr_no_last_turn',
                input_tokens: 100,
                output_tokens: 20,
                total_tokens: 120,
                cached_tokens: 80,
                cache_miss_tokens: 20,
                cache_hit_rate: 0.8,
                turns: 1
              }
            ]
          })
        }
      }
      throw new Error(`unexpected request: ${path}`)
    })
    setRuntimeRequest(runtimeRequest)

    const usage = await loadThreadUsage('thr_no_last_turn')

    expect(usage?.lastTurnCacheHitRate).toBeNull()
    expect(usage?.cacheHitRate).toBe(0.8)
  })

  it('reports invalid JSON thread usage responses with a stable error', async () => {
    const runtimeRequest = vi.fn<RuntimeRequest>(async (path) => {
      if (path === threadUsagePath('thr_bad_json')) {
        return { ok: true, status: 200, body: '{bad-json' }
      }
      throw new Error(`unexpected request: ${path}`)
    })
    setRuntimeRequest(runtimeRequest)

    await expect(loadThreadUsage('thr_bad_json')).rejects.toThrow(
      'thread usage response was not valid JSON'
    )
  })

  it('uses aggregate telemetry without requesting thread detail', async () => {
    const runtimeRequest = vi.fn<RuntimeRequest>(async (path) => {
      if (path === threadUsagePath('thr_no_detail_request')) {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            buckets: [
              {
                thread_id: 'thr_no_detail_request',
                input_tokens: 100,
                output_tokens: 20,
                cached_tokens: 40,
                cache_miss_tokens: 60,
                cache_hit_rate: 0.4,
                turns: 1
              }
            ]
          })
        }
      }
      throw new Error(`unexpected request: ${path}`)
    })
    setRuntimeRequest(runtimeRequest)

    const usage = await loadThreadUsage('thr_no_detail_request')

    expect(usage).toMatchObject({
      cachedTokens: 40,
      cacheMissTokens: 60,
      cacheHitRate: 0.4
    })
    expect(runtimeRequest).toHaveBeenCalledTimes(1)
  })
})

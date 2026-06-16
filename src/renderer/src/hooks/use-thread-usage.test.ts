import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatCost, loadThreadUsage, primaryCacheHitRate } from './use-thread-usage'

type RuntimeRequest = (path: string, method?: string) => Promise<{ ok: boolean; status: number; body: string }>

function threadUsagePath(threadId: string): string {
  const params = new URLSearchParams({ group_by: 'thread', thread_id: threadId })
  return `/v1/usage?${params.toString()}`
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

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(globalThis, 'window')
})

describe('thread usage formatting', () => {
  it('uses RMB for Chinese locales and USD for English locales', () => {
    expect(formatCost(0.125, 'zh', 0.88)).toBe('￥0.8800')
    expect(formatCost(0.125, 'zh-CN', 0.88)).toBe('￥0.8800')
    expect(formatCost(0.125, 'en')).toBe('$0.1250')
    expect(formatCost(null, 'zh-CN', null)).toBe('-')
    expect(formatCost(null, 'en', 0.88)).toBe('￥0.8800')
    expect(formatCost(0.00000001, 'en')).toBe('$<0.0001')
  })

  it('prefers latest-turn cache hit rate for compact cache chips', () => {
    expect(primaryCacheHitRate({ cacheHitRate: 0.4, lastTurnCacheHitRate: 0.95 })).toBe(0.95)
    expect(primaryCacheHitRate({ cacheHitRate: 0.4, lastTurnCacheHitRate: null })).toBe(0.4)
    expect(primaryCacheHitRate({ cacheHitRate: null, lastTurnCacheHitRate: null })).toBeNull()
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

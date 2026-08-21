import { createElement, useEffect } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  loadTurnUsage,
  parseTurnUsageResponse,
  useTurnUsageState,
  type TurnUsageState
} from './use-turn-usage'

function TurnUsageProbe({
  refreshKey,
  onState
}: {
  refreshKey: number
  onState: (state: TurnUsageState) => void
}): null {
  const state = useTurnUsageState('thread-1', refreshKey)
  useEffect(() => onState(state), [onState, state])
  return null
}

describe('turn usage client', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('parses actual, zero reference, coverage, and attribution fields', () => {
    const result = parseTurnUsageResponse(JSON.stringify({
      group_by: 'turn',
      thread_id: 'thread-1',
      buckets: [{
        turn_id: 'turn-1',
        requests: 2,
        input_tokens: 1_000,
        output_tokens: 200,
        reasoning_tokens: 50,
        cached_tokens: 600,
        cache_write_tokens: 100,
        total_tokens: 1_200,
        actual_cost: { currency: 'USD', amount: 0.03 },
        reference_estimate_usd: 0,
        reference_price_breakdown: {
          currency: 'USD',
          amount: 0,
          priced_requests: 2,
          unpriced_requests: 0,
          groups: [{
            model: 'gpt-5.3-codex-spark',
            pricing_mode: 'standard',
            request_count: 2,
            fast_multiplier: null,
            amount: 0,
            items: [{
              kind: 'uncached_input', tokens: 300, rate_per_million: 0, amount: 0
            }]
          }]
        },
        estimate_coverage: 'complete',
        provider_ids: ['codex-work'],
        models: ['gpt-5.6-sol']
      }],
      totals: {}
    }), 'thread-1')

    expect(result.get('turn-1')).toEqual({
      turnId: 'turn-1',
      requests: 2,
      inputTokens: 1_000,
      outputTokens: 200,
      reasoningTokens: 50,
      cachedTokens: 600,
      cacheWriteTokens: 100,
      totalTokens: 1_200,
      actualCost: { currency: 'USD', amount: 0.03 },
      referenceEstimateUsd: 0,
      referencePriceBreakdown: {
        currency: 'USD',
        amount: 0,
        pricedRequests: 2,
        unpricedRequests: 0,
        groups: [{
          model: 'gpt-5.3-codex-spark',
          pricingMode: 'standard',
          requestCount: 2,
          fastMultiplier: null,
          amount: 0,
          items: [{ kind: 'uncached_input', tokens: 300, ratePerMillion: 0, amount: 0 }]
        }]
      },
      estimateCoverage: 'complete',
      providerIds: ['codex-work'],
      models: ['gpt-5.6-sol']
    })
  })

  it('falls back to token-only details for legacy or malformed breakdowns', () => {
    const result = parseTurnUsageResponse(JSON.stringify({
      group_by: 'turn', thread_id: 'thread-1', buckets: [{
        turn_id: 'turn-legacy', requests: 1, input_tokens: 100, output_tokens: 20,
        reasoning_tokens: 0, cached_tokens: 50, cache_write_tokens: 0, total_tokens: 120,
        actual_cost: null, reference_estimate_usd: 0.01, estimate_coverage: 'complete',
        provider_ids: ['codex'], models: ['gpt-5.6-sol'],
        reference_price_breakdown: { currency: 'EUR', amount: 0.01, groups: [] }
      }]
    }), 'thread-1')

    expect(result.get('turn-legacy')?.referencePriceBreakdown).toBeNull()
    expect(result.get('turn-legacy')?.referenceEstimateUsd).toBe(0.01)
  })

  it('requests only the active thread turn grouping', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        group_by: 'turn',
        thread_id: 'thread A',
        buckets: []
      })
    }))
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })

    await expect(loadTurnUsage('thread A')).resolves.toEqual(new Map())
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/usage?group_by=turn&thread_id=thread+A',
      'GET'
    )
  })

  it('rejects a response scoped to another thread', () => {
    expect(() => parseTurnUsageResponse(JSON.stringify({
      group_by: 'turn',
      thread_id: 'thread-2',
      buckets: []
    }), 'thread-1')).toThrow('invalid turn usage')
  })

  it('coalesces rapid refresh events while retaining the last successful map', async () => {
    vi.useFakeTimers()
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        group_by: 'turn',
        thread_id: 'thread-1',
        buckets: [{
          turn_id: 'turn-1',
          requests: 1,
          input_tokens: 100,
          output_tokens: 20,
          reasoning_tokens: 0,
          cached_tokens: 0,
          cache_write_tokens: 0,
          total_tokens: 120,
          actual_cost: null,
          reference_estimate_usd: 0.01,
          estimate_coverage: 'complete',
          provider_ids: ['codex'],
          models: ['gpt-5.6-sol']
        }]
      })
    }))
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })
    let latest: TurnUsageState | undefined
    const onState = (state: TurnUsageState): void => { latest = state }

    let renderer!: ReturnType<typeof create>
    await act(async () => {
      renderer = create(createElement(TurnUsageProbe, { refreshKey: 0, onState }))
      await Promise.resolve()
    })
    expect(runtimeRequest).toHaveBeenCalledTimes(1)
    expect(latest?.byTurnId.has('turn-1')).toBe(true)

    await act(async () => {
      renderer.update(createElement(TurnUsageProbe, { refreshKey: 1, onState }))
    })
    await act(async () => {
      renderer.update(createElement(TurnUsageProbe, { refreshKey: 2, onState }))
    })
    expect(runtimeRequest).toHaveBeenCalledTimes(1)
    expect(latest).toMatchObject({ loading: true, stale: false })
    expect(latest?.byTurnId.has('turn-1')).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })
    expect(runtimeRequest).toHaveBeenCalledTimes(2)
    expect(latest).toMatchObject({ loading: false, stale: false })
    await act(async () => renderer.unmount())
  })
})

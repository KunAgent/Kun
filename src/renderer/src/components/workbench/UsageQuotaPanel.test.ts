import { createElement } from 'react'
import { act, create as createRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetUsageRequestCacheForTests } from '../../hooks/usage-request-cache'
import { resetUsageSummaryCacheForTests } from '../../hooks/usage-summary-cache'
import i18n from '../../i18n'
import { UsageQuotaPanel } from './UsageQuotaPanel'

function usageResponse(
  path: string,
  modelBucketsOverride?: Array<Record<string, string | number>>
): { ok: boolean; status: number; body: string } {
  if (path.includes('group_by=day')) {
    return {
      ok: true,
      status: 200,
      body: JSON.stringify({
        group_by: 'day',
        from: '2026-07-01',
        to: '2026-07-29',
        timezone: 'UTC',
        buckets: [{
          date: '2026-07-29',
          input_tokens: 900,
          output_tokens: 100,
          reasoning_tokens: 20,
          cached_tokens: 720,
          cache_miss_tokens: 180,
          total_tokens: 1000,
          cost_usd: 1.3583333333,
          cost_cny: 9.78,
          value_estimate_usd: 2344.4486111111,
          value_estimate_cny: 16880.03,
          value_estimate_coverage: 'complete',
          value_estimate_priced_requests: 2,
          value_estimate_unpriced_requests: 0,
          token_economy_savings_tokens: 100,
          turns: 2,
          thread_count: 1,
          cache_hit_rate: 0.8
        }],
        totals: {}
      })
    }
  }
  if (path.includes('group_by=model')) {
    return {
      ok: true,
      status: 200,
      body: JSON.stringify({
        group_by: 'model',
        from: '2026-07-01',
        to: '2026-07-29',
        timezone: 'UTC',
        buckets: modelBucketsOverride ?? [
          { model: 'deepseek-v4', input_tokens: 900, output_tokens: 100, total_tokens: 1000 },
          { model: 'gpt-5.6-sol', input_tokens: 700, output_tokens: 100, total_tokens: 800 },
          { model: 'claude-opus-4', input_tokens: 500, output_tokens: 100, total_tokens: 600 },
          { model: 'gemini-3-pro', input_tokens: 300, output_tokens: 100, total_tokens: 400 },
          { model: 'glm-5.2', input_tokens: 180, output_tokens: 20, total_tokens: 200 },
          { model: 'custom/qwen3-coder', input_tokens: 90, output_tokens: 10, total_tokens: 100 },
          { model: 'glm-4-zero-usage', input_tokens: 0, output_tokens: 0, total_tokens: 0 }
        ],
        days: [],
        totals: { total_tokens: 3100 }
      })
    }
  }
  return {
    ok: true,
    status: 200,
    body: JSON.stringify({
      group_by: 'thread',
      buckets: [{
        thread_id: 'thread-a',
        input_tokens: 900,
        output_tokens: 100,
        reasoning_tokens: 20,
        cached_tokens: 720,
        cache_miss_tokens: 180,
        total_tokens: 1000,
        cost_usd: 1.3583333333,
        cost_cny: 9.78,
        value_estimate_usd: 2344.4486111111,
        value_estimate_cny: 16880.03,
        value_estimate_coverage: 'complete',
        value_estimate_priced_requests: 2,
        value_estimate_unpriced_requests: 0,
        token_economy_savings_tokens: 100,
        turns: 2,
        cache_hit_rate: 0.8,
        last_turn_cache_hit_rate: 0.9
      }],
      totals: {}
    })
  }
}

function inclusiveRangeDays(path: string): number {
  const query = new URL(path, 'http://localhost').searchParams
  const from = new Date(`${query.get('from')}T00:00:00.000Z`)
  const to = new Date(`${query.get('to')}T00:00:00.000Z`)
  return Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1
}

function expectUsageRange(
  runtimeRequest: ReturnType<typeof vi.fn>,
  groupBy: 'day' | 'model',
  days: number
): void {
  const path = runtimeRequest.mock.calls
    .filter(([path]) => path.includes(`group_by=${groupBy}`))
    .at(-1)?.[0]
  expect(path).toBeTypeOf('string')
  expect(inclusiveRangeDays(path as string)).toBe(days)
}
function stubWindow(
  kunGui: Record<string, unknown>,
  storedTab?: 'usage' | 'quota'
): Map<string, string> {
  const store = new Map<string, string>(storedTab ? [['kun.usagePanel.tab', storedTab]] : [])
  vi.stubGlobal('window', {
    kunGui,
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value)
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    setInterval: vi.fn(() => 1),
    clearInterval: vi.fn()
  })
  return store
}

describe('UsageQuotaPanel', () => {
  beforeEach(async () => {
    resetUsageRequestCacheForTests()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    await i18n.changeLanguage('en')
  })

  afterEach(() => {
    resetUsageRequestCacheForTests()
    resetUsageSummaryCacheForTests()
    vi.unstubAllGlobals()
  })

  it('opens on allowances and loads usage only once its tab is chosen', async () => {
    const runtimeRequest = vi.fn(async (path: string) => usageResponse(path))
    const listProviderQuotas = vi.fn(async () => ({
      refreshedAt: '2026-07-29T08:00:00.000Z',
      entries: []
    }))
    const store = stubWindow({ runtimeRequest, listProviderQuotas })

    let renderer!: ReturnType<typeof createRenderer>
    await act(async () => {
      renderer = createRenderer(createElement(UsageQuotaPanel, { activeThreadId: 'thread-a' }))
    })

    expect(renderer.root.findByProps({ id: 'usage-quota-tab-quota' }).props['aria-selected']).toBe(true)
    expect(renderer.root.findByProps({ 'data-provider-quota-panel': true })).toBeTruthy()
    expect(listProviderQuotas).toHaveBeenCalledTimes(1)
    expect(runtimeRequest).not.toHaveBeenCalled()

    await act(async () => {
      renderer.root.findByProps({ id: 'usage-quota-tab-usage' }).props.onClick()
    })

    expect(renderer.root.findByProps({ id: 'usage-quota-tab-usage' }).props['data-active']).toBe('true')
    expect(renderer.root.findByProps({ 'data-sidebar-usage-panel': true })).toBeTruthy()
    expect(store.get('kun.usagePanel.tab')).toBe('usage')
    expectUsageRange(runtimeRequest, 'day', 90)
    expectUsageRange(runtimeRequest, 'model', 7)
    act(() => renderer.unmount())
  })

  it('ranks models by tokens, five at first, and follows the chosen period', async () => {
    const runtimeRequest = vi.fn(async (path: string) => usageResponse(path))
    stubWindow({ runtimeRequest, listProviderQuotas: vi.fn() }, 'usage')

    let renderer!: ReturnType<typeof createRenderer>
    await act(async () => {
      renderer = createRenderer(createElement(UsageQuotaPanel, { activeThreadId: 'thread-a' }))
    })

    expect(renderer.root.findByProps({ 'data-usage-period': '7d' }).props['aria-checked']).toBe(true)
    const models = (): string[] => renderer.root.findAllByProps({ className: 'usage-model' })
      .map((row) => row.props['data-usage-model'])
    expect(models()).toEqual(['deepseek-v4', 'gpt-5.6-sol', 'claude-opus-4', 'gemini-3-pro', 'glm-5.2'])
    const output = JSON.stringify(renderer.toJSON())
    expect(output).not.toContain('glm-4-zero-usage')
    expect(output).toContain('1.0k')
    expect(output).toContain('Show all 6')

    await act(async () => {
      renderer.root.findByProps({ className: 'kq-text-button usage-models-more' }).props.onClick()
    })
    expect(models()).toContain('custom/qwen3-coder')

    await act(async () => {
      renderer.root.findByProps({ 'data-usage-period': '30d' }).props.onClick()
    })
    expectUsageRange(runtimeRequest, 'day', 90)
    expectUsageRange(runtimeRequest, 'model', 30)
    expect(models()).toHaveLength(5)

    await act(async () => {
      renderer.root.findByProps({ 'data-usage-period': 'today' }).props.onClick()
    })
    expectUsageRange(runtimeRequest, 'model', 1)
    act(() => renderer.unmount())
  })

  it('shows the models empty state when every returned model bucket has zero usage', async () => {
    const runtimeRequest = vi.fn(async (path: string) =>
      usageResponse(path, [
        { model: 'glm-4-zero-usage', input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        { model: 'deepseek-v4-idle', input_tokens: 0, output_tokens: 0, total_tokens: 0 }
      ]))
    stubWindow({ runtimeRequest, listProviderQuotas: vi.fn() }, 'usage')

    let renderer!: ReturnType<typeof createRenderer>
    await act(async () => {
      renderer = createRenderer(createElement(UsageQuotaPanel, { activeThreadId: 'thread-a' }))
    })

    const output = JSON.stringify(renderer.toJSON())
    expect(output).toContain('No model usage in this period')
    expect(output).not.toContain('glm-4-zero-usage')
    expect(output).not.toContain('deepseek-v4-idle')
    act(() => renderer.unmount())
  })

  it('labels Chinese reference estimates separately from recorded cost', async () => {
    await i18n.changeLanguage('zh')
    const runtimeRequest = vi.fn(async (path: string) => usageResponse(path))
    stubWindow({ runtimeRequest, listProviderQuotas: vi.fn(async () => ({ entries: [] })) }, 'usage')

    let renderer!: ReturnType<typeof createRenderer>
    await act(async () => {
      renderer = createRenderer(createElement(UsageQuotaPanel, { activeThreadId: 'thread-a' }))
    })

    const output = JSON.stringify(renderer.toJSON())
    expect(output).toContain('￥9.78')
    expect(output).toContain('订阅折合 ≈￥16,880.03')
    expect(output).not.toContain('￥9.78 · ≈￥16880.03')
    act(() => renderer.unmount())
  })

  it('refreshes only the active Usage tab', async () => {
    const runtimeRequest = vi.fn(async (path: string) => usageResponse(path))
    const listProviderQuotas = vi.fn(async () => ({ refreshedAt: '', entries: [] }))
    stubWindow({ runtimeRequest, listProviderQuotas }, 'usage')

    let renderer!: ReturnType<typeof createRenderer>
    await act(async () => {
      renderer = createRenderer(createElement(UsageQuotaPanel, { activeThreadId: 'thread-a' }))
    })
    const initialUsageRequests = runtimeRequest.mock.calls.length

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'Refresh' }).props.onClick()
    })

    expect(runtimeRequest.mock.calls.length).toBeGreaterThan(initialUsageRequests)
    expect(listProviderQuotas).not.toHaveBeenCalled()
    act(() => renderer.unmount())
  })

  it('refreshes only provider quota, asking the vendors again, on the allowances tab', async () => {
    const runtimeRequest = vi.fn(async (path: string) => usageResponse(path))
    const listProviderQuotas = vi.fn(async () => ({
      refreshedAt: '2026-07-29T08:00:00.000Z',
      entries: []
    }))
    stubWindow({ runtimeRequest, listProviderQuotas }, 'quota')

    let renderer!: ReturnType<typeof createRenderer>
    await act(async () => {
      renderer = createRenderer(createElement(UsageQuotaPanel, { activeThreadId: 'thread-a' }))
    })
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'Refresh' }).props.onClick()
    })

    expect(listProviderQuotas).toHaveBeenCalledTimes(2)
    expect(listProviderQuotas).toHaveBeenLastCalledWith({ forceRefresh: true })
    expect(runtimeRequest).not.toHaveBeenCalled()
    act(() => renderer.unmount())
  })
})

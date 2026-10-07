import { createElement } from 'react'
import { act, create as createRenderer, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderQuotaListResult } from '@shared/provider-quota'
import i18n from '../../i18n'
import { ProviderQuotaPanel, type ProviderQuotaPanelProps } from './ProviderQuotaPanel'

const NOW = Date.parse('2027-01-15T08:00:00.000Z')

const result: ProviderQuotaListResult = {
  refreshedAt: '2027-01-15T08:00:00.000Z',
  entries: [{
    providerId: 'codex',
    providerName: 'Codex',
    presetId: 'codex',
    status: 'available',
    summary: 'plus',
    dashboardUrl: 'https://chatgpt.com/codex/settings/usage',
    metrics: [{
      id: 'primary',
      label: '5h usage',
      unit: 'percent',
      usedPercent: 20,
      resetsAt: '2027-01-15T10:00:00.000Z',
      windowSeconds: 5 * 3_600
    }, {
      id: 'secondary',
      label: '7d usage',
      unit: 'percent',
      usedPercent: 125,
      resetsAt: '2027-01-20T08:00:00.000Z',
      windowSeconds: 7 * 86_400
    }]
  }, {
    providerId: 'deepseek-work',
    providerName: 'DeepSeek Work',
    status: 'available',
    dashboardUrl: 'https://platform.deepseek.com/usage',
    metrics: [{ id: 'balance', label: 'Balance', unit: 'CNY', remaining: 12.5 }]
  }, {
    providerId: 'custom',
    providerName: 'Custom provider',
    status: 'unsupported',
    metrics: []
  }, {
    providerId: 'needs-login',
    providerName: 'Needs login',
    status: 'missing_credentials',
    metrics: [],
    message: 'Sign in before refreshing quota.'
  }, {
    providerId: 'request-failed',
    providerName: 'Request failed',
    status: 'error',
    metrics: [],
    message: 'The provider rejected the quota request.',
    localCost: {
      kind: 'reference_api_estimate',
      currency: 'USD',
      today: { requests: 0, totalTokens: 0, amount: 0, coverage: 'complete' },
      last30Days: { requests: 3, totalTokens: 5_000, amount: 0.08, coverage: 'partial' },
      updatedAt: '2027-01-15T08:00:00.000Z'
    }
  }]
}

function stubWindow(listProviderQuotas: ReturnType<typeof vi.fn>, openExternal = vi.fn()): void {
  const store = new Map<string, string>()
  vi.stubGlobal('window', {
    kunGui: { listProviderQuotas, openExternal },
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
  vi.stubGlobal('document', { visibilityState: 'visible' })
}

function text(renderer: ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON())
}

describe('ProviderQuotaPanel', () => {
  beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    await i18n.changeLanguage('en')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('lays allowances, balances, problems and unsupported providers out as sections', async () => {
    const listProviderQuotas = vi.fn(async () => result)
    const openExternal = vi.fn()
    stubWindow(listProviderQuotas, openExternal)

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = createRenderer(createElement(ProviderQuotaPanel))
    })

    expect(listProviderQuotas).toHaveBeenCalledWith(undefined)
    const scroller = renderer.root.findByProps({ 'data-provider-quota-scroller': true })
    const stopPropagation = vi.fn()
    scroller.props.onWheel({ stopPropagation })
    expect(stopPropagation).toHaveBeenCalledTimes(1)

    // Every window is visible at once, no card to expand first.
    const meters = renderer.root.findAllByProps({ role: 'progressbar' })
    expect(meters).toHaveLength(2)
    expect(meters.map((meter) => meter.props['aria-valuenow'])).toEqual([20, 100])
    expect(renderer.root.findByProps({ 'data-quota-metric': 'secondary', className: 'kq-meter' })
      .props['data-severity']).toBe('danger')
    const html = text(renderer)
    expect(html).toContain('5-hour')
    expect(html).toContain('7-day')
    expect(html).toContain('Plus')
    expect(html).toContain('20% used')
    expect(html).toContain('in 2 hr.')

    expect(renderer.root.findByProps({ className: 'kq-balance', 'data-quota-provider': 'deepseek-work' }))
      .toBeTruthy()
    expect(html).toContain('¥12.50')

    const problems = renderer.root.findAllByProps({ className: 'kq-problem' })
    expect(problems.map((row) => row.props['data-quota-provider'])).toEqual(['needs-login', 'request-failed'])
    expect(html).toContain('Sign in before refreshing quota.')
    expect(renderer.root.findByProps({ 'data-provider-local-cost': true })).toBeTruthy()

    expect(renderer.root.findByProps({ 'data-quota-unsupported': true })).toBeTruthy()
    expect(html).toContain('Custom provider')

    act(() => renderer.root.findByProps({ 'aria-label': 'Open Codex dashboard' }).props.onClick())
    expect(openExternal).toHaveBeenCalledWith('https://chatgpt.com/codex/settings/usage')
    act(() => renderer.unmount())
  })

  it('turns every meter between used and left from one toggle', async () => {
    stubWindow(vi.fn(async () => result))
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = createRenderer(createElement(ProviderQuotaPanel))
    })

    act(() => renderer.root.findByProps({ 'data-quota-mode': 'left' }).props.onClick())
    const meters = renderer.root.findAllByProps({ role: 'progressbar' })
    expect(meters.map((meter) => meter.props['aria-valuenow'])).toEqual([80, 0])
    expect(text(renderer)).toContain('80% left')
    expect(window.localStorage.getItem('kun.quota.displayMode')).toBe('left')

    // A click on a meter's figure turns them back.
    act(() => renderer.root.findAllByProps({ className: 'kq-meter-value' })[0]!.props.onClick())
    expect(renderer.root.findAllByProps({ role: 'progressbar' })[0]!.props['aria-valuenow']).toBe(20)
    act(() => renderer.unmount())
  })

  it('retries a failed provider by asking the vendors again', async () => {
    const listProviderQuotas = vi.fn(async () => result)
    stubWindow(listProviderQuotas)
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = createRenderer(createElement(ProviderQuotaPanel))
    })

    await act(async () => renderer.root.findByProps({ 'aria-label': 'Retry Request failed' }).props.onClick())
    expect(listProviderQuotas).toHaveBeenLastCalledWith({ forceRefresh: true })
    act(() => renderer.unmount())
  })

  it('keeps the last allowances on screen when a refresh fails', async () => {
    const listProviderQuotas = vi.fn()
      .mockResolvedValueOnce(result)
      .mockRejectedValueOnce(new Error('provider offline'))
    stubWindow(listProviderQuotas)
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = createRenderer(createElement<ProviderQuotaPanelProps>(ProviderQuotaPanel, { refreshKey: 0 }))
    })
    await act(async () => renderer.update(createElement<ProviderQuotaPanelProps>(ProviderQuotaPanel, { refreshKey: 1 })))

    expect(listProviderQuotas).toHaveBeenLastCalledWith({ forceRefresh: true })
    expect(text(renderer)).toContain('Refresh failed; showing the last data read')
    expect(renderer.root.findAllByProps({ role: 'progressbar' })).toHaveLength(2)
    act(() => renderer.unmount())
  })

  it('offers adding a provider when nothing reports an allowance', async () => {
    stubWindow(vi.fn(async () => ({ refreshedAt: result.refreshedAt, entries: [] })))
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = createRenderer(createElement(ProviderQuotaPanel))
    })

    const html = text(renderer)
    expect(html).toContain('No allowances to show yet')
    expect(html).toContain('Add a provider')
    act(() => renderer.unmount())
  })
})

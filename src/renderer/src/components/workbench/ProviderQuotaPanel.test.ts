import { createElement } from 'react'
import { act, create as createRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import {
  formatQuotaValue,
  ProviderQuotaPanel,
  type ProviderQuotaPanelProps
} from './ProviderQuotaPanel'

describe('ProviderQuotaPanel', () => {
  beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    await i18n.changeLanguage('en')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads and renders configured providers with available and unsupported states', async () => {
    const openExternal = vi.fn()
    const listProviderQuotas = vi.fn(async () => ({
      refreshedAt: '2027-01-15T08:00:00.000Z',
      entries: [{
        providerId: 'deepseek-work',
        providerName: 'DeepSeek Work',
        status: 'available' as const,
        source: 'DeepSeek balance API',
        dashboardUrl: 'https://platform.deepseek.com/usage',
        metrics: [{
          id: 'balance',
          label: 'Account balance',
          unit: 'CNY',
          remaining: 12.5,
          usedPercent: 25
        }],
        updatedAt: '2027-01-15T08:00:00.000Z'
      }, {
        providerId: 'custom',
        providerName: 'Custom provider',
        status: 'unsupported' as const,
        dashboardUrl: 'https://models.example.com/dashboard',
        metrics: [],
        message: 'This provider does not expose a supported quota API in this version.'
      }, {
        providerId: 'needs-login',
        providerName: 'Needs login',
        status: 'missing_credentials' as const,
        metrics: [],
        message: 'Sign in before refreshing quota.'
      }, {
        providerId: 'request-failed',
        providerName: 'Request failed',
        status: 'error' as const,
        metrics: [],
        message: 'The provider rejected the quota request.'
      }]
    }))
    vi.stubGlobal('window', {
      kunGui: {
        listProviderQuotas,
        openExternal
      }
    })

    let renderer!: ReturnType<typeof createRenderer>
    await act(async () => {
      renderer = createRenderer(createElement(ProviderQuotaPanel))
    })

    expect(listProviderQuotas).toHaveBeenCalledTimes(1)
    expect(renderer.root.findByProps({ 'data-provider-quota-panel': true }).props['data-embedded'])
      .toBe('false')
    expect(renderer.root.findAllByProps({ 'data-provider-quota-status': 'available' })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ 'data-provider-quota-status': 'unsupported' })).toHaveLength(0)
    expect(renderer.root.findAllByProps({ 'data-provider-quota-status': 'missing_credentials' })).toHaveLength(0)
    expect(renderer.root.findAllByProps({ 'data-provider-quota-status': 'error' })).toHaveLength(0)
    expect(renderer.root.findAllByProps({
      'data-provider-quota-status-group': 'missing_credentials'
    })).toHaveLength(1)
    expect(renderer.root.findAllByProps({
      'data-provider-quota-status-group': 'error'
    })).toHaveLength(1)
    expect(renderer.root.findAllByProps({
      'data-provider-quota-status-group': 'unsupported'
    })).toHaveLength(1)
    expect(renderer.root.findByProps({ 'aria-label': 'Refresh' })).toBeTruthy()
    const scroller = renderer.root.findByProps({ 'data-provider-quota-scroller': true })
    expect(scroller.props.className).toContain('h-0')
    expect(scroller.props.className).toContain('overflow-y-auto')
    expect(scroller.props.className).toContain('overscroll-contain')
    const stopPropagation = vi.fn()
    scroller.props.onWheel({ stopPropagation })
    expect(stopPropagation).toHaveBeenCalledTimes(1)

    const deepSeekToggle = renderer.root.findByProps({
      'data-provider-quota-toggle': 'deepseek-work'
    })
    expect(deepSeekToggle.props['aria-expanded']).toBe(false)
    expect(renderer.root.findByProps({
      'data-provider-quota-status-group-toggle': 'missing_credentials'
    }).props['aria-expanded']).toBe(false)
    expect(renderer.root.findByProps({
      'data-provider-quota-status-group-toggle': 'error'
    }).props['aria-expanded']).toBe(false)
    expect(renderer.root.findByProps({
      'data-provider-quota-status-group-toggle': 'unsupported'
    }).props['aria-expanded']).toBe(false)
    expect(renderer.root.findAllByProps({
      'data-provider-quota-status-group-details': 'unsupported'
    })).toHaveLength(0)
    expect(renderer.root.findAllByProps({
      'data-provider-quota-details': 'deepseek-work'
    })).toHaveLength(0)
    expect(renderer.root.findAllByProps({ role: 'progressbar' })).toHaveLength(0)
    expect(JSON.stringify(renderer.toJSON())).toContain('12.5 CNY')

    act(() => deepSeekToggle.props.onClick())
    expect(renderer.root.findByProps({
      'data-provider-quota-toggle': 'deepseek-work'
    }).props['aria-expanded']).toBe(true)
    expect(renderer.root.findByProps({
      'data-provider-quota-status-group-toggle': 'unsupported'
    }).props['aria-expanded']).toBe(false)
    expect(renderer.root.findAllByProps({
      'data-provider-quota-details': 'deepseek-work'
    })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ role: 'progressbar' })).toHaveLength(1)
    expect(renderer.root.findByProps({ role: 'progressbar' }).props['aria-valuenow']).toBe(25)
    expect(renderer.root.findByProps({ 'data-provider-quota-metric': 'balance' })).toBeTruthy()
    expect(renderer.root.findByProps({ 'data-level': 'neutral' }).props.style.width).toBe('25%')

    act(() => renderer.root.findByProps({
      'data-provider-quota-status-group-toggle': 'unsupported'
    }).props.onClick())
    expect(renderer.root.findByProps({
      'data-provider-quota-status-group-toggle': 'unsupported'
    }).props['aria-expanded']).toBe(true)
    expect(renderer.root.findByProps({
      'data-provider-quota-status-group-toggle': 'error'
    }).props['aria-expanded']).toBe(false)
    expect(renderer.root.findAllByProps({
      'data-provider-quota-status': 'unsupported'
    })).toHaveLength(1)
    expect(renderer.root.findByProps({
      'data-provider-quota-toggle': 'custom'
    }).props['aria-expanded']).toBe(false)

    act(() => renderer.root.findByProps({
      'aria-label': 'Open Custom provider dashboard'
    }).props.onClick())
    expect(openExternal).toHaveBeenCalledWith('https://models.example.com/dashboard')
    expect(renderer.root.findByProps({
      'data-provider-quota-toggle': 'custom'
    }).props['aria-expanded']).toBe(false)

    act(() => renderer.root.findByProps({
      'data-provider-quota-toggle': 'custom'
    }).props.onClick())
    expect(renderer.root.findAllByProps({
      'data-provider-quota-details': 'deepseek-work'
    })).toHaveLength(1)
    expect(renderer.root.findAllByProps({
      'data-provider-quota-details': 'custom'
    })).toHaveLength(1)

    act(() => renderer.root.findByProps({
      'data-provider-quota-status-group-toggle': 'error'
    }).props.onClick())
    expect(renderer.root.findByProps({
      'data-provider-quota-status-group-toggle': 'unsupported'
    }).props['aria-expanded']).toBe(true)
    expect(renderer.root.findByProps({
      'data-provider-quota-status-group-toggle': 'error'
    }).props['aria-expanded']).toBe(true)
    expect(renderer.root.findByProps({
      'data-provider-quota-toggle': 'request-failed'
    }).props['aria-expanded']).toBe(false)
    act(() => renderer.unmount())
  })

  it('clamps invalid provider percentages before rendering progress semantics', async () => {
    vi.stubGlobal('window', {
      kunGui: {
        listProviderQuotas: vi.fn(async () => ({
          refreshedAt: '2027-01-15T08:00:00.000Z',
          entries: [{
            providerId: 'over-limit',
            providerName: 'Over Limit',
            status: 'available' as const,
            metrics: [{
              id: 'requests',
              label: 'Requests',
              unit: 'requests',
              usedPercent: 125
            }]
          }]
        }))
      }
    })

    let renderer!: ReturnType<typeof createRenderer>
    await act(async () => {
      renderer = createRenderer(createElement<ProviderQuotaPanelProps>(
        ProviderQuotaPanel,
        { embedded: true }
      ))
    })

    expect(renderer.root.findByProps({ 'data-provider-quota-panel': true }).props['data-embedded'])
      .toBe('true')
    expect(renderer.root.findAllByProps({ className: 'provider-quota-header' })).toHaveLength(0)
    act(() => renderer.root.findByProps({
      'data-provider-quota-toggle': 'over-limit'
    }).props.onClick())

    expect(renderer.root.findByProps({ role: 'progressbar' }).props['aria-valuenow']).toBe(100)
    expect(renderer.root.findByProps({ 'data-level': 'danger' }).props.style.width).toBe('100%')
    act(() => renderer.unmount())
  })

  it('keeps Codex local value visible when the upstream probe fails', async () => {
    vi.stubGlobal('window', {
      kunGui: {
        listProviderQuotas: vi.fn(async () => ({
          refreshedAt: '2026-08-20T12:00:00.000Z',
          entries: [{
            providerId: 'codex-work',
            providerName: 'Codex work',
            presetId: 'codex',
            status: 'error' as const,
            metrics: [],
            message: 'Sign-in expired.',
            localCost: {
              kind: 'reference_api_estimate' as const,
              currency: 'USD' as const,
              today: { requests: 0, totalTokens: 0, amount: 0, coverage: 'complete' as const },
              last30Days: { requests: 3, totalTokens: 5_000, amount: 0.08, coverage: 'partial' as const },
              updatedAt: '2026-08-20T12:00:00.000Z'
            }
          }]
        }))
      }
    })

    let renderer!: ReturnType<typeof createRenderer>
    await act(async () => {
      renderer = createRenderer(createElement(ProviderQuotaPanel))
    })

    expect(renderer.root.findAllByProps({ 'data-provider-quota-status': 'error' })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ 'data-provider-quota-status-group': 'error' })).toHaveLength(0)
    expect(renderer.root.findByProps({ 'data-provider-icon': 'codex' })).toBeTruthy()
    act(() => renderer.root.findByProps({
      'data-provider-quota-toggle': 'codex-work'
    }).props.onClick())
    expect(renderer.root.findByProps({ 'data-provider-local-cost': 'workbench' })).toBeTruthy()
    expect(renderer.root.findByProps({
      'data-provider-local-cost-window': 'today'
    }).props['data-coverage']).toBe('complete')
    expect(renderer.root.findByProps({
      'data-provider-local-cost-window': 'last-30-days'
    }).props['data-coverage']).toBe('partial')
    const html = JSON.stringify(renderer.toJSON())
    expect(html).toContain('$0.0000')
    expect(html).toContain('Partial')
    expect(html).toContain('not an actual subscription charge')
    act(() => renderer.unmount())
  })

  it('formats large quotas compactly while preserving their unit', () => {
    expect(formatQuotaValue(250_000, 'tokens', 'en')).toBe('250K tokens')
  })
})

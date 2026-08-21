import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderQuotaListResult } from '@shared/provider-quota'
import type { KunTrayProviderQuotaApi } from '@shared/tray-provider-quota'
import i18n from '../../i18n'
import { readStylesheetBundle } from '../../testing/stylesheet-bundle'
import { TrayProviderQuotaPopover } from './TrayProviderQuotaPopover'

const result: ProviderQuotaListResult = {
  refreshedAt: '2026-07-28T02:30:00.000Z',
  entries: [
    {
      providerId: 'codex',
      providerName: 'Codex',
      status: 'available',
      source: 'ChatGPT Codex usage API',
      dashboardUrl: 'https://chatgpt.com/codex/settings/usage',
      metrics: [{
        id: 'weekly',
        label: 'Weekly',
        unit: 'requests',
        used: 23,
        limit: 100,
        remaining: 77,
        usedPercent: 23,
        resetsAt: '2026-08-03T00:00:00.000Z'
      }],
      localCost: {
        kind: 'reference_api_estimate',
        currency: 'USD',
        today: { requests: 2, totalTokens: 1_500, amount: 0.025, coverage: 'complete' },
        last30Days: { requests: 7, totalTokens: 9_000, amount: 0.12, coverage: 'partial' },
        updatedAt: '2026-07-28T02:30:00.000Z'
      }
    },
    {
      providerId: 'claude-subscription',
      providerName: 'Claude subscription',
      status: 'unsupported',
      metrics: [],
      message: 'No supported endpoint'
    }
  ]
}

function createApi(overrides: Partial<KunTrayProviderQuotaApi> = {}): KunTrayProviderQuotaApi {
  return {
    list: vi.fn(async () => result),
    context: vi.fn(async () => ({
      locale: 'en' as const,
      colorMode: 'light' as const,
      platform: 'win32' as const
    })),
    action: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
    onRefresh: vi.fn(() => () => undefined),
    ...overrides
  }
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string): number => {
    const channels = hex.match(/[a-f\d]{2}/gi)?.map((channel) => {
      const value = Number.parseInt(channel, 16) / 255
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4
    }) ?? []
    const [red = 0, green = 0, blue = 0] = channels
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue
  }
  const foregroundLuminance = luminance(foreground)
  const backgroundLuminance = luminance(background)
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
}

describe('TrayProviderQuotaPopover', () => {
  let keydown: ((event: KeyboardEvent) => void) | undefined

  beforeAll(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterAll(() => {
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })

  beforeEach(async () => {
    await i18n.changeLanguage('en')
    keydown = undefined
    vi.stubGlobal('document', {
      documentElement: { lang: 'en', dataset: {} }
    })
    vi.stubGlobal('window', {
      addEventListener: vi.fn((name: string, handler: (event: KeyboardEvent) => void) => {
        if (name === 'keydown') keydown = handler
      }),
      removeEventListener: vi.fn()
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('selects the first configured provider and exposes overview/provider tabs', async () => {
    const api = createApi()
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(TrayProviderQuotaPopover, { api }))
    })

    const tabs = renderer.root.findAllByProps({ role: 'tab' })
    expect(tabs).toHaveLength(3)
    expect(tabs[1].props['aria-selected']).toBe(true)
    expect((document.documentElement.dataset as Record<string, string>).platform).toBe('win32')
    expect(renderer.root.findByType('main').props['data-context-ready']).toBe('true')
    expect(JSON.stringify(renderer.toJSON())).toContain('Weekly')
    expect(JSON.stringify(renderer.toJSON())).toContain('77 requests')
    expect(JSON.stringify(renderer.toJSON())).toContain('Local API reference value')
    expect(JSON.stringify(renderer.toJSON())).toContain('$0.0250')
    expect(renderer.root.findAllByProps({ 'data-provider-icon': 'codex' }).length).toBeGreaterThan(0)

    await act(async () => tabs[0].props.onClick())
    expect(renderer.root.findAllByProps({ role: 'tab' })[0].props['aria-selected']).toBe(true)
    expect(JSON.stringify(renderer.toJSON())).toContain('Claude subscription')
    expect(renderer.root.findByProps({ 'aria-label': 'Codex: Available' })).toBeTruthy()
    expect(renderer.root.findByProps({
      'data-provider-local-cost': 'tray-overview'
    }).props['aria-hidden']).toBe(true)
    await act(async () => renderer.unmount())
  })

  it('applies the macOS dark appearance before revealing the popover', async () => {
    const api = createApi({
      context: vi.fn(async () => ({
        locale: 'zh' as const,
        colorMode: 'dark' as const,
        platform: 'darwin' as const
      }))
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(TrayProviderQuotaPopover, { api }))
    })

    expect(document.documentElement.lang).toBe('zh')
    expect(document.documentElement.dataset).toMatchObject({
      theme: 'dark',
      platform: 'darwin'
    })
    await vi.waitFor(() => {
      expect(renderer.root.findByType('main').props['data-context-ready']).toBe('true')
    })
    await act(async () => renderer.unmount())
  })

  it('maps a mouse wheel to the overflowing provider switcher', async () => {
    const api = createApi()
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(TrayProviderQuotaPopover, { api }))
    })

    const switcher = renderer.root.findByProps({ className: 'tray-quota-switcher' })
    const scrollTarget = {
      clientWidth: 400,
      scrollLeft: 20,
      scrollWidth: 800
    }
    const preventDefault = vi.fn()
    switcher.props.onWheel({
      currentTarget: scrollTarget,
      deltaMode: 1,
      deltaX: 0,
      deltaY: 3,
      preventDefault
    })

    expect(scrollTarget.scrollLeft).toBe(92)
    expect(preventDefault).not.toHaveBeenCalled()

    scrollTarget.scrollWidth = scrollTarget.clientWidth
    switcher.props.onWheel({
      currentTarget: scrollTarget,
      deltaMode: 0,
      deltaX: 0,
      deltaY: 80,
      preventDefault
    })
    expect(scrollTarget.scrollLeft).toBe(92)
    expect(preventDefault).not.toHaveBeenCalled()
    await act(async () => renderer.unmount())
  })

  it('retains the last quota data when a refresh fails', async () => {
    let publishRefresh: (() => void) | undefined
    const list = vi.fn()
      .mockResolvedValueOnce(result)
      .mockRejectedValueOnce(new Error('provider offline'))
    const api = createApi({
      list,
      onRefresh: vi.fn((handler) => {
        publishRefresh = handler
        return () => undefined
      })
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(TrayProviderQuotaPopover, { api }))
    })
    await act(async () => publishRefresh?.())

    const html = JSON.stringify(renderer.toJSON())
    expect(html).toContain('provider offline')
    expect(html).toContain('Weekly')
    await act(async () => renderer.unmount())
  })

  it('dispatches close on Escape and new-chat from the fixed action footer', async () => {
    const api = createApi()
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(TrayProviderQuotaPopover, { api }))
    })

    await act(async () => keydown?.({ key: 'Escape' } as KeyboardEvent))
    const newChat = renderer.root.findAllByType('button').find(
      (button) => button.children.includes('New chat')
    )
    expect(newChat).toBeDefined()
    await act(async () => newChat!.props.onClick())

    expect(api.action).toHaveBeenCalledWith('close')
    expect(api.action).toHaveBeenCalledWith('new-chat')
    await act(async () => renderer.unmount())
  })

  it('keeps providers in one horizontal row and quota details independently scrollable', async () => {
    const css = await readStylesheetBundle(new URL('../../styles/tray-provider-quota.css', import.meta.url))

    expect(css).toMatch(/\.tray-quota-tabs \{[\s\S]*display: flex/)
    expect(css).toMatch(/\.tray-provider-tab \{[\s\S]*flex: 1 0 56px/)
    expect(css).toMatch(/\.tray-quota-switcher \{[\s\S]*overflow-x: auto/)
    expect(css).toMatch(/\.tray-quota-switcher \{[\s\S]*overflow-y: hidden/)
    expect(css).toMatch(/\.tray-quota-switcher \{[\s\S]*scrollbar-width: thin/)
    expect(css).toMatch(/\.tray-quota-switcher::-webkit-scrollbar \{[\s\S]*height: 5px/)
    expect(css).toMatch(/\.tray-quota-content \{[\s\S]*min-height: 0;[\s\S]*overflow-y: auto/)
    expect(css).toMatch(/\.tray-quota-content::-webkit-scrollbar \{[\s\S]*width: 8px/)
    expect(css).toMatch(/\.tray-quota-footer \{[\s\S]*flex: none/)
    expect(css).not.toMatch(/\.tray-quota-switcher::-webkit-scrollbar \{[^}]*display: none/)
    expect(css).toContain(':root[data-platform="win32"] .tray-quota-popover')
    expect(css).toContain('@media (forced-colors: active)')
  })

  it('uses the shared neutral visual language without glass or undersized copy', async () => {
    const css = await readStylesheetBundle(new URL('../../styles/tray-provider-quota.css', import.meta.url))

    expect(css).toContain('--tray-bg: #ededed')
    expect(css).toContain('--tray-panel: #f8f8f8')
    expect(css).toContain('--tray-text: #3c3f43')
    expect(css).toContain('--tray-bg: #2a2828')
    expect(css).toContain('--tray-panel: #312f2f')
    expect(css).toContain('--tray-text: #d4d4d4')
    expect(css).toContain('--tray-radius-control: 8px')
    expect(css).toContain('--tray-radius-card: 12px')
    expect(css).toContain('--tray-radius-pill: 9999px')
    expect(css).toMatch(
      /\.tray-quota-footer button\.is-primary \{[\s\S]*background: var\(--tray-control\)/
    )
    expect(css).not.toContain('linear-gradient')
    expect(css).not.toContain('backdrop-filter')
    expect(css).not.toMatch(/font-size:\s*(?:8(?:\.5)?|9(?:\.5)?|10(?:\.5)?)px/)
    expect(css).not.toMatch(/font-weight:\s*(?:5[1-9]\d|6\d{2}|7\d{2})/)
    expect(contrastRatio('#686b72', '#f8f8f8')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#999ba0', '#312f2f')).toBeGreaterThanOrEqual(4.5)
  })
})

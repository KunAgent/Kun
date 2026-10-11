// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComposerSubscriptionQuotaResult } from '@shared/composer-subscription-quota'
import { clearComposerSubscriptionQuotaCache } from '../../hooks/composer-subscription-quota-cache'
import { QUOTA_FRESH_MS } from '../../lib/quota-cache'
import { FloatingComposerContextCapacity } from './FloatingComposerContextCapacity'
import i18n from '../../i18n'

const client = vi.hoisted(() => vi.fn())
vi.mock('../../agent/composer-subscription-quota-client', () => ({ requestComposerSubscriptionQuota: client }))
vi.mock('../../store/chat-store', () => ({
  useChatStore: (selector: (value: unknown) => unknown) => selector({ lastContextSnapshot: null, composerHarnessId: 'claude-code' })
}))
vi.mock('../../store/harness-store', () => ({
  useHarnessStore: (selector: (value: unknown) => unknown) => selector({ rows: [] })
}))

const quota = (usedPercent: number, name = 'Claude'): ComposerSubscriptionQuotaResult => ({
  refreshedAt: '2026-10-11T08:00:00Z',
  entry: { providerId: 'native:claude-code', providerName: name, status: 'available',
    metrics: [{ id: 'weekly', label: 'Weekly', unit: 'percent', usedPercent, windowSeconds: 604_800 }] }
})

describe('composer subscription popover over the shared quota cache', () => {
  let root: Root, host: HTMLDivElement
  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    await i18n.changeLanguage('en')
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    client.mockReset(); clearComposerSubscriptionQuotaCache()
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  })
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks() })

  const popup = (): Element | null => document.querySelector('[data-context-capacity-popover]')
  const open = (): Promise<void> => act(async () => host.querySelector<HTMLButtonElement>('button')!.click())
  const close = (): Promise<void> => act(async () => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
  const render = (): Promise<void> => act(async () => root.render(createElement(FloatingComposerContextCapacity, {
    compact: false, route: 'chat', activeThreadId: 'thread', selectedModel: 'haiku',
    subscriptionSelection: { harnessId: 'claude-code', credentialMode: 'native-login', providerId: 'default' }
  })))

  it('opens the popover again and again from the cache without a request or a "checking" flash', async () => {
    client.mockResolvedValue(quota(30))
    await render()
    expect(client).toHaveBeenCalledTimes(1)
    for (let index = 0; index < 4; index += 1) {
      await open()
      expect(popup()?.textContent).toContain('70% left')
      expect(document.querySelector('[data-composer-subscription-checking]')).toBeNull()
      await close()
      expect(popup()).toBeNull()
      await act(async () => vi.advanceTimersByTime(10_000))
    }
    expect(client).toHaveBeenCalledTimes(1)
  })

  it('re-reads quietly once the answer is stale, keeping the figures on screen until the new ones arrive', async () => {
    let release!: (value: ComposerSubscriptionQuotaResult) => void
    client.mockResolvedValueOnce(quota(30)).mockReturnValueOnce(new Promise<ComposerSubscriptionQuotaResult>((resolve) => { release = resolve }))
    await render()
    await act(async () => vi.advanceTimersByTime(QUOTA_FRESH_MS + 1))
    await open()
    expect(client).toHaveBeenCalledTimes(2)
    expect(popup()?.textContent).toContain('70% left')
    expect(document.querySelector('[data-composer-subscription-checking]')).toBeNull()
    expect(popup()?.querySelector<HTMLButtonElement>('[aria-label="Refresh subscription limits"]')!.disabled).toBe(false)
    await act(async () => release(quota(55)))
    expect(popup()?.textContent).toContain('45% left')
  })
})

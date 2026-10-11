// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RequestContextSnapshot } from '../../agent/types'
import type { ComposerSubscriptionQuotaResult } from '@shared/composer-subscription-quota'
import { FloatingComposerContextCapacity, calculateContextCapacityPopoverPlacement } from './FloatingComposerContextCapacity'
import i18n from '../../i18n'

const state = vi.hoisted(() => ({
  chat: { lastContextSnapshot: null as RequestContextSnapshot | null, composerHarnessId: 'codex' },
  quota: { result: null as ComposerSubscriptionQuotaResult | null, refreshing: false, verifyingIdentity: false, refresh: vi.fn(), revalidate: vi.fn() }
}))
vi.mock('../../store/chat-store', () => ({ useChatStore: (selector: (value: typeof state.chat) => unknown) => selector(state.chat) }))
vi.mock('../../store/harness-store', () => ({ useHarnessStore: (selector: (value: unknown) => unknown) => selector({ rows: [{ definition: { id: 'codex', displayName: 'Codex' } }] }) }))
vi.mock('../../hooks/use-composer-subscription-quota', () => ({ useComposerSubscriptionQuota: () => state.quota }))

const snapshot: RequestContextSnapshot = {
  threadId: 'thread', model: 'gpt', providerId: 'default', stepIndex: 0, contextWindowTokens: 100_000,
  softThresholdTokens: 90_000, hardThresholdTokens: 100_000, estimatedInputTokens: 10_000,
  breakdown: { tools: 0, system: 0, skills: 0, messages: 10_000, other: 0 }, toolCount: 0, activeSkillIds: [],
  contextManagement: 'sdk-managed', nativeHistory: 'known', occupancySource: 'agent'
}
const quota: ComposerSubscriptionQuotaResult = {
  refreshedAt: '2026-10-11T08:00:00Z', entry: {
    providerId: 'native-codex', providerName: 'Codex', status: 'available', summary: 'Plus',
    metrics: [
      { id: 'primary', label: 'Primary', unit: 'percent', usedPercent: 100, windowSeconds: 18_000, resetsAt: '2026-10-11T13:00:00Z' },
      { id: 'weekly', label: 'Weekly', unit: 'percent', usedPercent: 14, windowSeconds: 604_800 }
    ]
  }
}

describe('composer context and subscription popup', () => {
  let root: Root, host: HTMLDivElement
  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    state.chat.lastContextSnapshot = null; state.quota.result = null; state.quota.refreshing = false; state.quota.verifyingIdentity = false
    state.quota.refresh.mockReset(); state.quota.revalidate.mockReset()
    await i18n.changeLanguage('en')
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  })
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks() })
  const render = async (): Promise<void> => {
    await act(async () => root.render(createElement(FloatingComposerContextCapacity, {
      compact: false, route: 'chat', activeThreadId: 'thread', selectedModel: 'gpt', selectedProviderId: 'default',
      subscriptionSelection: { harnessId: 'codex', credentialMode: 'native-login' }
    })))
  }
  const open = async (): Promise<void> => { await act(async () => host.querySelector<HTMLButtonElement>('button')!.click()) }

  it('shows no placeholder when neither source has useful data', async () => {
    await render(); expect(host.childElementCount).toBe(0)
    state.quota.result = { ...quota, entry: { ...quota.entry!, status: 'missing_credentials' } }
    await render(); expect(host.childElementCount).toBe(0)
  })

  it('offers an honest quota-only trigger without a fake context ring or token count', async () => {
    state.quota.result = quota
    await render()
    expect(host.querySelector('[data-composer-capacity-trigger="subscription"]')).not.toBeNull()
    await open()
    const popup = document.querySelector('[data-context-capacity-popover]')!
    expect(popup.querySelector('.ds-context-capacity')).toBeNull()
    expect(popup.textContent).toContain('0% left')
    expect(popup.textContent).toContain('86% left')
    expect(popup.textContent).toContain('Weekly')
    expect(popup.textContent).toContain('Plus')
    expect(popup.querySelector('[aria-valuenow="0"]')).not.toBeNull()
  })

  it('keeps context usage above subscription remaining and refreshes the selected subscription', async () => {
    state.chat.lastContextSnapshot = snapshot; state.quota.result = quota
    await render(); await open()
    const popup = document.querySelector('[data-context-capacity-popover]')!
    expect(popup.querySelector('.ds-context-capacity')?.nextElementSibling?.hasAttribute('data-composer-subscription-quota')).toBe(true)
    expect(popup.textContent).toContain('10%')
    expect(popup.querySelectorAll('[role="dialog"]')).toHaveLength(0)
    await act(async () => popup.querySelector<HTMLButtonElement>('[aria-label="Refresh subscription limits"]')!.click())
    expect(state.quota.refresh).toHaveBeenCalledOnce()
  })

  it('revalidates on opening and hides previous-account figures while retaining the existing trigger', async () => {
    state.quota.result = quota
    await render(); await open()
    expect(state.quota.revalidate).toHaveBeenCalledOnce()
    state.quota.result = null; state.quota.verifyingIdentity = true
    await render()
    expect(host.querySelector('[data-composer-capacity-trigger="subscription"]')).not.toBeNull()
    expect(document.querySelector('[data-composer-subscription-checking]')).not.toBeNull()
    expect(document.querySelector('[data-context-capacity-popover]')?.textContent).not.toContain('86% left')
    state.quota.result = { ...quota, scopeKey: 'new-account', entry: { ...quota.entry!, providerName: 'New account',
      metrics: [{ id: 'weekly', label: 'Weekly', unit: 'percent', usedPercent: 50 }] } }
    state.quota.verifyingIdentity = false
    await render()
    expect(document.querySelector('[data-context-capacity-popover]')?.textContent).toContain('New account')
    expect(document.querySelector('[data-context-capacity-popover]')?.textContent).toContain('50% left')
  })

  it('retains keyboard focus inside the portal, closes on Escape, and restores the trigger', async () => {
    state.quota.result = quota
    await render()
    const trigger = host.querySelector<HTMLButtonElement>('button')!
    await act(async () => trigger.focus())
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Refresh subscription limits"]')!.focus())
    await act(async () => vi.advanceTimersByTime(200))
    expect(document.querySelector('[data-context-capacity-popover]')).not.toBeNull()
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(document.querySelector('[data-context-capacity-popover]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('localizes remaining allowance and does not invent a five-hour window for an unknown primary label', async () => {
    await act(async () => i18n.changeLanguage('zh'))
    state.quota.result = { ...quota, entry: { ...quota.entry!, metrics: [{ id: 'primary', label: 'Primary', unit: 'percent', usedPercent: 40 }] } }
    await render(); await open()
    const popup = document.querySelector('[data-context-capacity-popover]')!
    expect(popup.textContent).toContain('剩余 60%')
    expect(popup.textContent).toContain('Primary')
    expect(popup.textContent).not.toContain('5 小时')
  })

  it('bounds the combined popup to a narrow or zoomed viewport', () => {
    const placement = calculateContextCapacityPopoverPlacement({ anchorRect: { top: 460, bottom: 492, right: 310 },
      popoverHeight: 510, viewportHeight: 500, viewportWidth: 320 })
    expect(placement.width).toBe(296)
    expect(placement.left).toBeGreaterThanOrEqual(12)
    expect(placement.top).toBeGreaterThanOrEqual(12)
    expect(placement.top + placement.maxHeight).toBeLessThanOrEqual(488)
  })
})

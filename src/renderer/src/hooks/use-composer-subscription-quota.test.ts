// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComposerSubscriptionQuotaRequest, ComposerSubscriptionQuotaResult } from '@shared/composer-subscription-quota'
import { QUOTA_FRESH_MS } from '../lib/quota-cache'
import { clearComposerSubscriptionQuotaCache } from './composer-subscription-quota-cache'
import { clearProviderQuotaListCache, providerQuotaListCache } from './provider-quota-list-cache'
import { COMPOSER_SUBSCRIPTION_REFRESH_MS, useComposerSubscriptionQuota } from './use-composer-subscription-quota'

const client = vi.hoisted(() => vi.fn())
vi.mock('../agent/composer-subscription-quota-client', () => ({ requestComposerSubscriptionQuota: client }))
const codex: ComposerSubscriptionQuotaRequest = { harnessId: 'codex', credentialMode: 'native-login', providerId: 'default' }
const claude: ComposerSubscriptionQuotaRequest = { harnessId: 'claude-code', credentialMode: 'native-login', providerId: 'default' }
const result = (name: string): ComposerSubscriptionQuotaResult => ({ refreshedAt: '2026-10-11T00:00:00Z', entry: {
  providerId: name, providerName: name, status: 'available', metrics: [{ id: 'weekly', label: 'Weekly', unit: 'percent', usedPercent: 30 }]
} })
function deferred() { let resolve!: (value: ComposerSubscriptionQuotaResult) => void; const promise = new Promise<ComposerSubscriptionQuotaResult>((done) => { resolve = done }); return { promise, resolve } }
function Probe({ selection, route = 'thread-a' }: { selection?: ComposerSubscriptionQuotaRequest; route?: string }) {
  const state = useComposerSubscriptionQuota(selection, route)
  return createElement('button', { onClick: state.refresh, onMouseEnter: state.revalidate, 'data-refreshing': state.refreshing, 'data-verifying': state.verifyingIdentity },
    state.result?.entry?.providerName ?? 'absent')
}

describe('composer subscription request lifecycle', () => {
  let root: Root, host: HTMLDivElement
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    vi.useFakeTimers(); client.mockReset(); clearComposerSubscriptionQuotaCache(); clearProviderQuotaListCache()
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  })
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers() })

  it('coalesces concurrent consumers and reuses the held answer on a later mount while it is fresh', async () => {
    const pending = deferred(); client.mockReturnValueOnce(pending.promise).mockResolvedValue(result('Codex new account'))
    await act(async () => root.render(createElement('div', null, createElement(Probe, { selection: codex }), createElement(Probe, { selection: codex }))))
    expect(client).toHaveBeenCalledTimes(1)
    await act(async () => pending.resolve(result('Codex old account')))
    expect(host.textContent).toContain('Codex old account')
    await act(async () => root.render(null))
    await act(async () => root.render(createElement(Probe, { selection: codex, route: 'thread-b' })))
    expect(host.textContent).toBe('Codex old account')
    expect(client).toHaveBeenCalledTimes(1)
  })

  it('shares one answer across routes with the same selection, and never across selections', async () => {
    client.mockResolvedValueOnce(result('Codex')).mockResolvedValueOnce(result('Claude'))
    await act(async () => root.render(createElement(Probe, { selection: codex, route: 'thread-a' })))
    await act(async () => root.render(createElement(Probe, { selection: codex, route: 'thread-b' })))
    expect(host.textContent).toBe('Codex')
    expect(client).toHaveBeenCalledTimes(1)
    await act(async () => root.render(createElement(Probe, { selection: claude, route: 'thread-b' })))
    expect(client).toHaveBeenCalledTimes(2)
    expect(host.textContent).toBe('Claude')
  })

  it('clears an old route immediately and ignores its late request', async () => {
    const old = deferred(), fresh = deferred()
    client.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    await act(async () => root.render(createElement(Probe, { selection: codex })))
    await act(async () => root.render(createElement(Probe, { selection: claude, route: 'thread-b' })))
    expect(host.textContent).toBe('absent')
    await act(async () => fresh.resolve(result('Claude account')))
    await act(async () => old.resolve(result('Wrong Codex account')))
    expect(host.textContent).toBe('Claude account')
    await act(async () => root.render(createElement(Probe)))
    expect(host.textContent).toBe('absent')
  })

  it('does not request while hidden, refreshes on visibility and explicitly forces manual refresh', async () => {
    client.mockResolvedValue(result('Codex'))
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    await act(async () => root.render(createElement(Probe, { selection: codex })))
    await act(async () => vi.advanceTimersByTime(COMPOSER_SUBSCRIPTION_REFRESH_MS))
    expect(client).not.toHaveBeenCalled()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(client).toHaveBeenCalledTimes(1)
    await act(async () => host.querySelector('button')!.click())
    expect(client).toHaveBeenLastCalledWith({ ...codex, forceRefresh: true })
    client.mockRejectedValueOnce(new Error('Unavailable'))
    await act(async () => vi.advanceTimersByTime(COMPOSER_SUBSCRIPTION_REFRESH_MS))
    expect(host.textContent).toBe('absent')
  })

  it('does not ask again when the popover is reopened while the answer is fresh', async () => {
    client.mockResolvedValue(result('Codex'))
    await act(async () => root.render(createElement(Probe, { selection: codex })))
    expect(client).toHaveBeenCalledTimes(1)
    const hover = (): Promise<void> => act(async () => { host.querySelector('button')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })
    await hover()
    await act(async () => vi.advanceTimersByTime(QUOTA_FRESH_MS - 1))
    await hover()
    expect(client).toHaveBeenCalledTimes(1)
    expect(host.textContent).toBe('Codex')
  })

  it('keeps showing the held answer while it is re-read once stale, then follows an account change', async () => {
    const next = deferred()
    client.mockResolvedValueOnce({ ...result('Old account'), scopeKey: 'old' }).mockReturnValueOnce(next.promise)
    await act(async () => root.render(createElement(Probe, { selection: codex })))
    expect(host.textContent).toBe('Old account')
    await act(async () => vi.advanceTimersByTime(QUOTA_FRESH_MS + 1))
    await act(async () => host.querySelector('button')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    expect(client).toHaveBeenCalledTimes(2)
    expect(client).toHaveBeenLastCalledWith(codex)
    const button = host.querySelector('button')!
    expect(host.textContent).toBe('Old account')
    expect(button.getAttribute('data-verifying')).toBe('false')
    expect(button.getAttribute('data-refreshing')).toBe('false')
    await act(async () => next.resolve({ ...result('New account'), scopeKey: 'new' }))
    expect(host.textContent).toBe('New account')
  })

  it('shows nothing, not an older answer, once an account can no longer be read', async () => {
    client.mockResolvedValueOnce(result('Codex')).mockRejectedValueOnce(new Error('Unavailable'))
    await act(async () => root.render(createElement(Probe, { selection: codex })))
    await act(async () => vi.advanceTimersByTime(QUOTA_FRESH_MS + 1))
    await act(async () => host.querySelector('button')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    expect(host.textContent).toBe('absent')
  })

  it('spins only for a manual refresh, which asks the vendors and marks the other surfaces stale', async () => {
    const forced = deferred()
    client.mockResolvedValueOnce(result('Codex')).mockReturnValueOnce(forced.promise)
    await providerQuotaListCache.load('all', async () => ({ refreshedAt: '2026-10-11T00:00:00Z', entries: [] }))
    await act(async () => root.render(createElement(Probe, { selection: codex })))
    expect(providerQuotaListCache.peek('all')?.stale).toBe(false)
    await act(async () => host.querySelector('button')!.click())
    expect(client).toHaveBeenLastCalledWith({ ...codex, forceRefresh: true })
    expect(host.querySelector('button')!.getAttribute('data-refreshing')).toBe('true')
    await act(async () => forced.resolve(result('Codex forced')))
    expect(host.querySelector('button')!.getAttribute('data-refreshing')).toBe('false')
    expect(host.textContent).toBe('Codex forced')
    expect(providerQuotaListCache.peek('all')?.stale).toBe(true)
  })

  it('re-reads quietly when another surface forced a refresh', async () => {
    client.mockResolvedValueOnce(result('Codex')).mockResolvedValueOnce(result('Codex refreshed elsewhere'))
    await act(async () => root.render(createElement(Probe, { selection: codex })))
    await act(async () => { await providerQuotaListCache.load('all', async () => ({ refreshedAt: '2026-10-11T00:00:00Z', entries: [] }), true) })
    expect(client).toHaveBeenCalledTimes(2)
    expect(client).toHaveBeenLastCalledWith(codex)
    expect(host.textContent).toBe('Codex refreshed elsewhere')
  })
})

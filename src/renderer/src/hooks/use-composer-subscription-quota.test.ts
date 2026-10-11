// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComposerSubscriptionQuotaRequest, ComposerSubscriptionQuotaResult } from '@shared/composer-subscription-quota'
import { clearComposerSubscriptionQuotaCache } from './composer-subscription-quota-cache'
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
  return createElement('button', { onClick: state.refresh, onMouseEnter: state.revalidate, 'data-refreshing': state.refreshing }, state.result?.entry?.providerName ?? 'absent')
}

describe('composer subscription request lifecycle', () => {
  let root: Root, host: HTMLDivElement
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    vi.useFakeTimers(); client.mockReset(); clearComposerSubscriptionQuotaCache()
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  })
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers() })

  it('coalesces concurrent consumers but rechecks identity on a later mount', async () => {
    const pending = deferred(); client.mockReturnValueOnce(pending.promise).mockResolvedValue(result('Codex new account'))
    await act(async () => root.render(createElement('div', null, createElement(Probe, { selection: codex }), createElement(Probe, { selection: codex }))))
    expect(client).toHaveBeenCalledTimes(1)
    await act(async () => pending.resolve(result('Codex old account')))
    expect(host.textContent).toContain('Codex old account')
    await act(async () => root.render(null))
    await act(async () => root.render(createElement(Probe, { selection: codex })))
    expect(client).toHaveBeenCalledTimes(2)
    expect(host.textContent).toBe('Codex new account')
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

  it('revalidates unchanged native selection on reopen and never exposes the previous scope while pending', async () => {
    const next = deferred()
    client.mockResolvedValueOnce({ ...result('Old account'), scopeKey: 'old' }).mockReturnValueOnce(next.promise)
    await act(async () => root.render(createElement(Probe, { selection: codex })))
    expect(host.textContent).toBe('Old account')
    await act(async () => host.querySelector('button')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    expect(client).toHaveBeenLastCalledWith(codex)
    expect(host.textContent).toBe('absent')
    await act(async () => next.resolve({ ...result('New account'), scopeKey: 'new' }))
    expect(host.textContent).toBe('New account')
  })
})

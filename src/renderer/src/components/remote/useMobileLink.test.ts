// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AccountEntitlements } from '@kun/remote-protocol'
import type { MobileLinkStatus } from '@shared/mobile-link'
import { useMobileLink, type MobileLink } from './useMobileLink'
import { MobileChannelRow, MobileGrantRows } from './RemoteMobileLink'
import i18n from '../../i18n'

vi.mock('../account/useKunAccount', () => ({ useKunAccount: () => ({
  state: { status: 'authenticated', user: { id: 'owner' }, error: null }
}) }))
vi.mock('../../extensions/protected-user-activation', () => ({
  runTrustedUserActivation: (_event: unknown, action: () => void) => { action(); return true }
}))
let root: Root, container: HTMLDivElement, link: MobileLink, status: MobileLinkStatus
let api: ReturnType<typeof createApi>
function createApi() {
  return {
    status: vi.fn(async () => status),
    entitlements: vi.fn(async (): Promise<AccountEntitlements> => { throw new Error('HTTP 503 ENTITLEMENTS_UNAVAILABLE') }),
    enable: vi.fn(async (enabled: boolean) => { status = { ...status, enabled, online: enabled }; return status }),
    reconnect: vi.fn(async () => status), resetIdentity: vi.fn(async () => status),
    confirm: vi.fn(async () => status), setScopes: vi.fn(async () => status),
    revoke: vi.fn(async () => { status = { ...status, grants: [] }; return status })
  }
}
function Harness() {
  link = useMobileLink()
  return createElement('div', null,
    createElement(MobileChannelRow, { link }), ...MobileGrantRows({ link }))
}
const stopSwitch = () => container.querySelector('[role="switch"]') as HTMLButtonElement
beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  await i18n.changeLanguage('en')
  status = { enabled: true, online: true, desktopAccess: true, pairings: [],
    grants: [{ id: 'phone', controllerId: 'controller', name: 'iPhone', scopes: ['personal'] }] }
  api = createApi(); vi.stubGlobal('kunGui', { mobileLink: api })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks()
})
it('keeps actual online access and explicit stop/revoke controls after an entitlement 503', async () => {
  await act(async () => root.render(createElement(Harness)))
  expect(api.entitlements).toHaveBeenCalledOnce()
  expect(link.membershipState).toBe('unavailable')
  expect(link.enabled).toBe(true); expect(link.state?.online).toBe(true)
  expect(api.enable).not.toHaveBeenCalled()
  expect(container.textContent).toContain('Membership could not be verified')
  expect(stopSwitch().getAttribute('aria-label')).toBe('Stop phone access')
  expect(stopSwitch().getAttribute('aria-checked')).toBe('true')
  expect(stopSwitch().disabled).toBe(false)
  const revoke = [...container.querySelectorAll('button')].find(button => button.textContent === i18n.t('remoteCompact.revoke'))!
  expect(revoke).toBeTruthy(); expect(revoke.disabled).toBe(false)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  await act(async () => revoke.click())
  expect(api.revoke).toHaveBeenCalledWith('phone')
  await act(async () => stopSwitch().click())
  expect(api.enable).toHaveBeenCalledExactlyOnceWith(false)
  expect(link.enabled).toBe(false); expect(link.state?.online).toBe(false)
})
it('fails closed for new starts, reconnects and authorizations while membership is unknown', async () => {
  status = { enabled: false, online: false, pairings: [], grants: [] }
  await act(async () => root.render(createElement(Harness)))
  expect(stopSwitch().disabled).toBe(true)
  await act(async () => {
    link.toggle(); link.retryVip(); link.confirm('pair', ['personal'])
    expect(await link.setScopes('phone', ['personal'])).toBe(false)
  })
  expect(api.enable).not.toHaveBeenCalled(); expect(api.reconnect).not.toHaveBeenCalled()
  expect(api.confirm).not.toHaveBeenCalled(); expect(api.setScopes).not.toHaveBeenCalled()
})
it('allows new connections and authorizations after membership is verified', async () => {
  status = { enabled: false, online: false, pairings: [], grants: [] }
  api.entitlements.mockResolvedValueOnce({ version: 1, userId: 'owner', tier: 'plus', effectiveTier: 'plus',
    status: 'active', expiresAt: null, checkedAt: new Date().toISOString(), revision: 1,
    features: { mobileRemote: true, personalAssistant: false } })
  await act(async () => root.render(createElement(Harness)))
  expect(stopSwitch().disabled).toBe(false)
  await act(async () => link.toggle())
  expect(api.enable).toHaveBeenCalledExactlyOnceWith(true)
  await act(async () => link.confirm('pair', ['personal']))
  expect(api.confirm).toHaveBeenCalledExactlyOnceWith('pair', ['personal'])
  await act(async () => { expect(await link.setScopes('phone', ['personal'])).toBe(true) })
  expect(api.setScopes).toHaveBeenCalledExactlyOnceWith('phone', ['personal'])
})
it('does not silently stop a running connection when a membership refresh fails', async () => {
  // Exercise a real entitlement transition, not only an initial failed fetch.
  api.entitlements.mockResolvedValueOnce({ version: 1, userId: 'owner', tier: 'plus', effectiveTier: 'plus',
    status: 'active', expiresAt: null, checkedAt: new Date().toISOString(), revision: 1,
    features: { mobileRemote: true, personalAssistant: false } })
  await act(async () => root.render(createElement(Harness)))
  expect(link.mobileAllowed).toBe(true)
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(link.membershipState).toBe('unavailable')
  expect(link.enabled).toBe(true); expect(link.state?.online).toBe(true)
  expect(api.enable).not.toHaveBeenCalled(); expect(stopSwitch().disabled).toBe(false)
  await act(async () => { link.retryVip(); link.confirm('pair') })
  expect(api.reconnect).not.toHaveBeenCalled(); expect(api.confirm).not.toHaveBeenCalled()
})

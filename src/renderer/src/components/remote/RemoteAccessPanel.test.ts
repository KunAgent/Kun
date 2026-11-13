// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ComputerAccessApi } from '@shared/computer-access'
import type { ControlPackageApi } from '@shared/control-package'
import type { RemoteAccessStatus } from '@shared/remote-access'
import type { DesktopAccessStatus } from '@shared/remote-desktop'
import type { MobileLink } from './useMobileLink'
import { RemoteAccessPanel } from './RemoteAccessPanel'
import i18n from '../../i18n'

const mocks = vi.hoisted(() => ({ link: null as unknown as MobileLink, gate: true }))
vi.mock('./useMobileLink', () => ({ useMobileLink: () => mocks.link }))
vi.mock('../../extensions/protected-user-activation', () => ({ runTrustedUserActivation: (_event: unknown, action: () => void) => { if (mocks.gate) action(); return mocks.gate } }))
let root: Root, container: HTMLDivElement
let status: RemoteAccessStatus, desktop: DesktopAccessStatus
let emit: (value: RemoteAccessStatus) => void
let api: {
  remoteAccessGetStatus: ReturnType<typeof vi.fn>
  remoteAccessSetConfig: ReturnType<typeof vi.fn>
  remoteAccessRevokeSessions: ReturnType<typeof vi.fn>
  remoteAccessDetectTailscale: ReturnType<typeof vi.fn>
  requestComputerUsePermission: ReturnType<typeof vi.fn>
  onRemoteAccessStatusChanged: (listener: typeof emit) => () => void
  mobileLink: { desktopStatus: ReturnType<typeof vi.fn>; desktopConfigure: ReturnType<typeof vi.fn>; desktopStop: ReturnType<typeof vi.fn>; controlPackage: ControlPackageApi; computers?: ComputerAccessApi }
}
const control = (label: string) => container.querySelector(`[role="switch"][aria-label="${label}"]`) as HTMLButtonElement
const button = (text: string) => [...container.querySelectorAll('button')].find(b => b.textContent?.includes(text))!
async function click(text: string) { expect(button(text)).toBeTruthy(); await act(async () => button(text).click()) }
async function render() { await act(async () => root.render(createElement(RemoteAccessPanel))) }
beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  await i18n.changeLanguage('en')
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  status = { enabled: true, running: true, passwordSet: true, bind: 'lan', port: 42659, lastError: '', devMode: false, clients: [],
    urls: { local: 'http://127.0.0.1:42659', primary: 'http://192.168.1.2:42659', lan: ['http://192.168.1.2:42659'], listen: 'http://0.0.0.0:42659' } }
  desktop = { supported: true, enabled: false, ready: false, screenRecordingReady: false, inputReady: false,
    displays: [{ token: 'screen', revision: 'r1', label: 'Retina', pixelWidth: 3024, pixelHeight: 1964, rotation: 0, allowed: true }] }
  api = {
    remoteAccessGetStatus: vi.fn(async () => status),
    remoteAccessSetConfig: vi.fn(async patch => { status = { ...status, ...patch }; return status }),
    remoteAccessRevokeSessions: vi.fn(async () => status),
    remoteAccessDetectTailscale: vi.fn(async () => ({ installed: false, connected: false, ipv4: null })),
    requestComputerUsePermission: vi.fn(async () => undefined),
    onRemoteAccessStatusChanged: listener => { emit = listener; return () => {} },
    mobileLink: {
      computers: {
        status: vi.fn(async () => ({ supported: true, online: true, devices: [] })),
        refresh: vi.fn(async () => ({ supported: true, online: true, devices: [] })),
        pair: vi.fn(), open: vi.fn(), close: vi.fn(), confirmClosed: vi.fn(), enableHost: vi.fn()
      },
      controlPackage: {
        status: vi.fn(async () => ({ phase: 'ready', version: '0.1.7' })),
        check: vi.fn(), install: vi.fn(), apply: vi.fn()
      },
      desktopStatus: vi.fn(async () => desktop),
      desktopConfigure: vi.fn(async patch => { desktop = { ...desktop, ...patch }; return desktop }),
      desktopStop: vi.fn(async () => { desktop = { ...desktop, active: undefined }; return desktop })
    }
  }
  mocks.link = { api: api.mobileLink, zh: false, account: { state: { user: { id: 'owner' } } }, signedIn: true,
    state: { enabled: true, desktopAccess: true, online: true, pairings: [], grants: [{ id: 'phone', controllerId: 'controller', name: 'iPhone', scopes: ['personal', 'desktop.view', 'desktop.control'] }] },
    enabled: true, starting: false, busy: null, canStop: true, mobileAllowed: true, membershipState: 'active', connectionError: '',
    computerAllowed: false, computerMembershipState: 'maxRequired',
    toggle: vi.fn(), confirm: vi.fn(), setScopes: vi.fn(async () => true), revoke: vi.fn(), refreshMembership: vi.fn() } as unknown as MobileLink
  mocks.gate = true
  vi.stubGlobal('kunGui', api)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('shows a compact overview without settings forms, a QR image or nested buttons', async () => {
  await render()
  expect(container.querySelectorAll('[role="switch"]')).toHaveLength(2)
  expect(container.querySelector('input')).toBeNull()
  expect(container.querySelector('[role="img"]')).toBeNull()
  expect(button('Authorize')).toBeUndefined()
  expect(container.querySelector('button button')).toBeNull()
  expect(container.querySelectorAll('.overflow-y-auto')).toHaveLength(1)
  expect(container.querySelector('section')?.className).toContain('overscroll-contain')
  expect(container.querySelectorAll('button').length).toBeLessThan(12)
})
it.each(['maxRequired', 'expired', 'loading', 'unavailable', 'signedOut'] as const)('hides the computer entry when membership is %s', async computerMembershipState => {
  mocks.link = { ...mocks.link, computerMembershipState, signedIn: computerMembershipState !== 'signedOut' }
  await render()
  expect(button('Computer to computer desktop')).toBeUndefined()
  expect(container.textContent).not.toContain('Max')
  expect(api.mobileLink.computers!.status).not.toHaveBeenCalled()
  expect(api.mobileLink.computers!.refresh).not.toHaveBeenCalled()
})
it.each([false, true])('shows the computer entry without a Max label for active Max members (zh=%s)', async zh => {
  mocks.link = { ...mocks.link, zh, computerAllowed: true, computerMembershipState: 'active' }
  await render()
  const label = zh ? '电脑与电脑远程桌面' : 'Computer to computer desktop'
  expect(button(label)?.querySelector('span')?.textContent).toBe(label)
  await click(label)
  expect(container.textContent).toContain(zh ? '连接其他电脑' : 'Connect to a computer')
  expect(api.mobileLink.computers!.refresh).toHaveBeenCalledOnce()
})
it('updates the computer entry when Max eligibility changes', async () => {
  await render()
  expect(button('Computer to computer desktop')).toBeUndefined()
  mocks.link = { ...mocks.link, computerAllowed: true, computerMembershipState: 'active' }
  await render()
  expect(button('Computer to computer desktop')).toBeTruthy()
  mocks.link = { ...mocks.link, computerAllowed: false, computerMembershipState: 'expired' }
  await render()
  expect(button('Computer to computer desktop')).toBeUndefined()
})
it('hides the computer entry after sign-out even with stale Max eligibility', async () => {
  mocks.link = { ...mocks.link, signedIn: false, computerAllowed: true, computerMembershipState: 'signedOut' }
  await render()
  expect(button('Computer to computer desktop')).toBeUndefined()
})
it('hides the computer entry when the computer API is unavailable', async () => {
  mocks.link = { ...mocks.link, computerAllowed: true, computerMembershipState: 'active' }
  delete api.mobileLink.computers
  await render()
  expect(button('Computer to computer desktop')).toBeUndefined()
})
it.each(['free', 'loading', 'unavailable', 'signedOut'] as const)('hides mobile and package UI when membership is %s without gating the browser', async membershipState => {
  mocks.link = { ...mocks.link, mobileAllowed: false, membershipState, signedIn: membershipState !== 'signedOut', enabled: false, canStop: false,
    state: { ...mocks.link.state!, enabled: false, online: false, grants: [] } }
  mocks.link.state!.pairings = [{ id: 'pair', name: 'New phone' }] as NonNullable<MobileLink['state']>['pairings']
  await render()
  expect(container.textContent).not.toContain('Phone remote access')
  expect(container.textContent).not.toContain('Remote control package')
  expect(container.textContent).not.toContain('Requires Plus')
  expect(container.textContent).not.toContain(i18n.t('remoteCompact.mobileConnected'))
  expect(container.textContent).not.toContain('New phone wants access')
  expect(container.textContent).not.toContain('iPhone')
  expect(control('Enable phone access')).toBeNull()
  expect(control('Stop phone access')).toBeNull()
  expect(api.mobileLink.controlPackage.status).not.toHaveBeenCalled()
  expect(control(i18n.t('remoteAccessEnable')).disabled).toBe(false)
  await click('Browser')
  expect(container.querySelector('input[type="password"]')).toBeTruthy()
})
it('keeps browser and desktop stop controls usable after entitlement/password loss', async () => {
  status.passwordSet = false; desktop.enabled = true; desktop.active = { peer: 'iPhone', mode: 'control', sessionId: 'session' }
  mocks.link = { ...mocks.link, mobileAllowed: false, membershipState: 'free' }
  await render()
  expect(control(i18n.t('remoteAccessEnable')).disabled).toBe(false)
  await act(async () => control(i18n.t('remoteAccessEnable')).click())
  expect(api.remoteAccessSetConfig).toHaveBeenCalledWith({ enabled: false })
  expect(control('Stop phone access').disabled).toBe(false)
  expect(mocks.link.toggle).not.toHaveBeenCalled()
  await click('End remote session'); expect(api.mobileLink.desktopStop).toHaveBeenCalledOnce()
})
it('retains trusted activation for the unified remote switch', async () => {
  await render(); mocks.gate = false
  await act(async () => control('Stop phone access').click())
  expect(mocks.link.toggle).not.toHaveBeenCalled()
  expect(api.mobileLink.desktopConfigure).not.toHaveBeenCalled()
})
it('allows configuring a browser with no password and hides addresses when not running', async () => {
  status = { ...status, enabled: false, running: false, passwordSet: false }
  await render(); expect(control(i18n.t('remoteAccessEnable')).disabled).toBe(true)
  expect(container.querySelector('[title="http://192.168.1.2:42659"]')).toBeNull()
  await click('Browser')
  expect(container.querySelector('input[type="password"]')).toBeTruthy()
  expect(container.querySelector('details[open]')?.textContent).toContain('Password')
})
it('keeps pairing visible on detail pages and requires the consent gate', async () => {
  mocks.link.state!.pairings = [{ id: 'pair', name: 'New phone' }] as NonNullable<MobileLink['state']>['pairings']
  await render(); await click('Browser')
  expect(container.textContent).toContain('New phone wants access')
  mocks.gate = false; await click('Allow'); expect(mocks.link.confirm).not.toHaveBeenCalled()
  mocks.gate = true; await click('Allow'); expect(mocks.link.confirm).toHaveBeenCalledWith('pair', ['personal'])
})
it('keeps draft permissions on cancelled navigation and discards only after confirmation', async () => {
  await render(); await click('iPhone')
  await act(async () => (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click())
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const back = () => container.querySelector('[aria-label="Back to remote access"]') as HTMLButtonElement
  await act(async () => back().click())
  expect(container.textContent).toContain('Unsaved permission changes')
  confirm.mockReturnValue(true); await act(async () => back().click())
  expect(container.textContent).not.toContain('Unsaved permission changes')
  expect(container.querySelectorAll('[role="switch"]')).toHaveLength(2)
})
it('shows an initial status error with retry instead of trapping the user in loading', async () => {
  api.remoteAccessGetStatus.mockRejectedValueOnce(new Error('status unavailable'))
  await render(); expect(container.querySelector('[role="alert"]')?.textContent).toContain('status unavailable')
  await click('Retry'); expect(api.remoteAccessGetStatus).toHaveBeenCalledTimes(2)
  expect(container.querySelector('[role="alert"]')).toBeNull()
})
it('receives browser updates and reports logout failures beside the view', async () => {
  await render()
  await act(async () => emit({ ...status, enabled: false, running: false }))
  expect(control(i18n.t('remoteAccessEnable')).getAttribute('aria-checked')).toBe('false')
  await act(async () => emit({ ...status, clients: [{ id: 'client', userAgent: 'Safari/Mac OS X', remoteAddress: '192.168.1.4', connectedAt: 'now' }] }))
  await click('Browser'); api.remoteAccessRevokeSessions.mockRejectedValueOnce(new Error('logout failed'))
  await click('Log out all browsers')
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('logout failed')
})
it('never polls the desktop API when signed out', async () => {
  mocks.link = { ...mocks.link, signedIn: false, mobileAllowed: false, enabled: false, canStop: false, membershipState: 'signedOut' }
  await render(); expect(api.mobileLink.desktopStatus).not.toHaveBeenCalled()
  expect(control('Enable phone access')).toBeNull()
  expect(api.mobileLink.controlPackage.status).not.toHaveBeenCalled()
  expect(control('Desktop control')).toBeNull()
})
it('shows granted screen permission with sharing off and no selected display', async () => {
  desktop = { ...desktop, screenRecordingReady: true, inputReady: true, displays: desktop.displays.map(d => ({ ...d, allowed: false })) }
  await render(); await click('Phone remote access')
  expect(container.textContent?.match(/Granted/g)).toHaveLength(2)
  expect(button('Authorize')).toBeUndefined()
  await click('Recheck')
  expect(api.mobileLink.desktopStatus).toHaveBeenCalledTimes(2)
  expect(container.textContent?.match(/Granted/g)).toHaveLength(2)
})
it('rechecks permissions immediately when returning from System Settings', async () => {
  await render(); await click('Phone remote access')
  desktop = { ...desktop, screenRecordingReady: true, inputReady: true }
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(api.mobileLink.desktopStatus).toHaveBeenCalledTimes(2)
  expect(container.textContent?.match(/Granted/g)).toHaveLength(2)
})
it('rechecks on visibility restoration and reflects revoked permissions', async () => {
  desktop = { ...desktop, screenRecordingReady: true, inputReady: true }
  await render(); await click('Phone remote access')
  desktop = { ...desktop, screenRecordingReady: false, inputReady: false }
  await act(async () => document.dispatchEvent(new Event('visibilitychange')))
  expect(api.mobileLink.desktopStatus).toHaveBeenCalledTimes(2)
  expect(container.textContent).not.toContain('Granted')
  expect(container.textContent?.match(/Authorize/g)).toHaveLength(2)
})
it('refreshes after a permission request and reports failures beside the controls', async () => {
  await render(); await click('Phone remote access')
  api.requestComputerUsePermission.mockImplementationOnce(async () => {
    desktop = { ...desktop, screenRecordingReady: true }
  })
  await click('Authorize')
  expect(api.requestComputerUsePermission).toHaveBeenCalledWith('screenRecording')
  expect(api.mobileLink.desktopStatus).toHaveBeenCalledTimes(2)
  expect(container.textContent?.match(/Granted/g)).toHaveLength(1)
  api.requestComputerUsePermission.mockRejectedValueOnce(Error('settings unavailable'))
  await click('Authorize')
  expect(api.requestComputerUsePermission).toHaveBeenLastCalledWith('accessibility')
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be confirmed')
})
it('reads the package only for an entitled account and never checks or installs on mount', async () => {
  await render()
  expect(container.textContent).toContain('Remote control package')
  expect(api.mobileLink.controlPackage.status).toHaveBeenCalledOnce()
  expect(api.mobileLink.controlPackage.check).not.toHaveBeenCalled()
  expect(api.mobileLink.controlPackage.install).not.toHaveBeenCalled()
  expect(api.mobileLink.controlPackage.apply).not.toHaveBeenCalled()
})
it('unmounts package polling but retains existing mobile management when entitlement is lost', async () => {
  vi.useFakeTimers()
  await render()
  expect(api.mobileLink.controlPackage.status).toHaveBeenCalledOnce()
  mocks.link = { ...mocks.link, mobileAllowed: false, membershipState: 'free' }
  await render()
  expect(container.textContent).not.toContain('Remote control package')
  expect(container.textContent).toContain('Phone remote access')
  expect(container.textContent).toContain('iPhone')
  expect(control('Stop phone access').disabled).toBe(false)
  await act(async () => vi.advanceTimersByTimeAsync(6000))
  expect(api.mobileLink.controlPackage.status).toHaveBeenCalledOnce()
  mocks.link = { ...mocks.link, mobileAllowed: true, membershipState: 'active' }
  await render()
  expect(container.textContent).toContain('Remote control package')
  expect(container.textContent).toContain('Phone remote access')
  expect(api.mobileLink.controlPackage.status).toHaveBeenCalledTimes(2)
})
it.each(['Phone remote access', 'iPhone'])('retains %s management details when mobile permission is lost', async detail => {
  await render(); await click(detail)
  mocks.link = { ...mocks.link, mobileAllowed: false, membershipState: 'unavailable' }
  await render()
  expect(container.textContent).not.toContain('Remote control package')
  expect(container.querySelector('[aria-label="Back to remote access"]')).toBeTruthy()
  if (detail === 'iPhone') {
    expect(button(i18n.t('remoteCompact.revoke')).disabled).toBe(false)
    expect([...container.querySelectorAll('input[type="checkbox"]')].every(input => (input as HTMLInputElement).disabled)).toBe(true)
  } else expect(container.textContent).toContain('Membership could not be verified')
})
it('does not report a stopped, unentitled mobile connection as running', async () => {
  mocks.link = { ...mocks.link, mobileAllowed: false, membershipState: 'free', enabled: false, canStop: false,
    state: { ...mocks.link.state!, enabled: false, online: false, grants: [] } }
  status = { ...status, enabled: false, running: false }
  await render()
  expect(container.querySelector('h2')?.textContent).toBe(i18n.t('remoteCompact.disabled'))
  expect(container.textContent).not.toContain(i18n.t('remoteCompact.mobileConnected'))
})
it('shows actual online status and retains stop and revoke management when membership verification fails', async () => {
  status = { ...status, enabled: false, running: false }
  desktop = { ...desktop, enabled: true, ready: true, screenRecordingReady: true, inputReady: true }
  mocks.link = { ...mocks.link, mobileAllowed: false, membershipState: 'unavailable' }
  await render()
  expect(container.querySelector('h2')?.textContent).toBe(i18n.t('remoteCompact.enabled'))
  expect(container.textContent).toContain(i18n.t('remoteCompact.mobileConnected'))
  expect(container.textContent).toContain('Membership could not be verified')
  expect(control('Stop phone access').getAttribute('aria-checked')).toBe('true')
  expect(control('Stop phone access').disabled).toBe(false)
  await act(async () => control('Stop phone access').click())
  expect(mocks.link.toggle).toHaveBeenCalledOnce()
  await click('iPhone')
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  await click(i18n.t('remoteCompact.revoke'))
  expect(mocks.link.revoke).toHaveBeenCalledWith('phone')
  expect(api.mobileLink.controlPackage.status).not.toHaveBeenCalled()
})
it('keeps existing grants revocable after stopping without reporting the connection as on', async () => {
  status = { ...status, enabled: false, running: false }
  mocks.link = { ...mocks.link, mobileAllowed: false, membershipState: 'free', enabled: false, canStop: false,
    state: { ...mocks.link.state!, enabled: false, online: false } }
  await render()
  expect(container.querySelector('h2')?.textContent).toBe(i18n.t('remoteCompact.disabled'))
  expect(control('Enable phone access').disabled).toBe(true)
  await click('iPhone')
  expect(button(i18n.t('remoteCompact.revoke')).disabled).toBe(false)
})
it('requires a signed-in owner even if the previous entitlement flag remains true', async () => {
  mocks.link = { ...mocks.link, signedIn: false }
  await render()
  expect(container.textContent).not.toContain('Phone remote access')
  expect(container.textContent).not.toContain('Remote control package')
  expect(api.mobileLink.controlPackage.status).not.toHaveBeenCalled()
})
it('preserves local/private and Max computer access independently of mobile relay membership', async () => {
  const direct = {
    status: vi.fn(async () => ({ ready: true, running: false, enabled: false, bind: 'lan', port: 0,
      addresses: [], localAddresses: [], hasIceServers: false, grants: [] })),
    configure: vi.fn()
  }
  Object.assign(api.mobileLink, { direct })
  mocks.link = { ...mocks.link, mobileAllowed: false, membershipState: 'free', enabled: false, canStop: false,
    computerAllowed: true, computerMembershipState: 'active',
    state: { ...mocks.link.state!, enabled: false, online: false, grants: [] } }
  await render()
  expect(container.textContent).not.toContain('Remote control package')
  expect(container.textContent).not.toContain('Phone remote access')
  expect(control('Local network and private connections')?.disabled).toBe(false)
  expect(button('Computer to computer desktop')).toBeTruthy()
  expect(control(i18n.t('remoteAccessEnable')).disabled).toBe(false)
  expect(direct.status).toHaveBeenCalledOnce()
  expect(direct.configure).not.toHaveBeenCalled()
})

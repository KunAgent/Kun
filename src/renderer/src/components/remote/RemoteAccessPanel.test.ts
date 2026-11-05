// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
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
  mobileLink: { desktopStatus: ReturnType<typeof vi.fn>; desktopConfigure: ReturnType<typeof vi.fn>; desktopStop: ReturnType<typeof vi.fn> }
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
      desktopStatus: vi.fn(async () => desktop),
      desktopConfigure: vi.fn(async patch => { desktop = { ...desktop, ...patch }; return desktop }),
      desktopStop: vi.fn(async () => { desktop = { ...desktop, active: undefined }; return desktop })
    }
  }
  mocks.link = { api: api.mobileLink, zh: false, account: { state: { user: { id: 'owner' } } }, signedIn: true,
    state: { enabled: true, desktopAccess: true, online: true, pairings: [], grants: [{ id: 'phone', controllerId: 'controller', name: 'iPhone', scopes: ['personal', 'desktop.view', 'desktop.control'] }] },
    enabled: true, starting: false, busy: null, canStop: true, mobileAllowed: true, membershipState: 'active', connectionError: '',
    toggle: vi.fn(), confirm: vi.fn(), setScopes: vi.fn(async () => true), revoke: vi.fn(), refreshMembership: vi.fn() } as unknown as MobileLink
  mocks.gate = true
  vi.stubGlobal('kunGui', api)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
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
it('locks the combined entry but leaves browser and system permission details accessible', async () => {
  mocks.link = { ...mocks.link, mobileAllowed: false, membershipState: 'free', enabled: false, canStop: false }
  await render()
  expect(container.textContent?.match(/Requires Plus membership or higher/g)).toHaveLength(1)
  expect(control('Enable phone access').disabled).toBe(true)
  expect(control('Desktop control')).toBeNull()
  expect(control(i18n.t('remoteAccessEnable')).disabled).toBe(false)
  await click('Phone remote access')
  expect(container.textContent).toContain('Requires Plus membership or higher')
  expect(container.querySelector('[role="switch"]')).toBeNull()
})
it('keeps browser and desktop stop controls usable after entitlement/password loss', async () => {
  status.passwordSet = false; desktop.enabled = true; desktop.active = { peer: 'iPhone', mode: 'control', sessionId: 'session' }
  mocks.link = { ...mocks.link, mobileAllowed: false, membershipState: 'free' }
  await render()
  expect(control(i18n.t('remoteAccessEnable')).disabled).toBe(false)
  await act(async () => control(i18n.t('remoteAccessEnable')).click())
  expect(api.remoteAccessSetConfig).toHaveBeenCalledWith({ enabled: false })
  expect(control('Stop phone access').disabled).toBe(false)
  await act(async () => control('Stop phone access').click())
  expect(mocks.link.toggle).toHaveBeenCalledOnce()
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
  expect(control('Enable phone access').disabled).toBe(true)
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

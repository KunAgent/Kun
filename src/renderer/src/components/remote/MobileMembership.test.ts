// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MobileChannelRow } from './RemoteMobileLink'
import type { MobileLink } from './useMobileLink'
import i18n from '../../i18n'

let root: Root, container: HTMLDivElement
function link(patch: Partial<MobileLink> = {}): MobileLink {
  return { api: {}, account: { state: { status: 'authenticated' } }, signedIn: true,
    state: { enabled: false, pairings: [], grants: [] }, busy: null, starting: false, canStop: false, enabled: false,
    connectionError: '', mobileAllowed: false, membershipState: 'free', toggle: vi.fn(), retryVip: vi.fn(), refreshMembership: vi.fn(), resetIdentity: vi.fn(), ...patch } as unknown as MobileLink
}
beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  await i18n.changeLanguage('en'); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })
const render = async (value: MobileLink) => { await act(async () => root.render(createElement(MobileChannelRow, { link: value }))) }
const control = () => container.querySelector('[role="switch"]') as HTMLButtonElement
it('keeps free and unverified entries visible but prevents enabling', async () => {
  await render(link()); expect(control().disabled).toBe(true)
  expect(container.textContent).toContain('Requires Plus membership or higher')
  expect(container.querySelector('[role="alert"]')).toBeNull()
  await render(link({ mobileAllowed: true, membershipState: 'active' })); expect(control().disabled).toBe(false)
})
it('membership loss never prevents stopping existing remote access', async () => {
  const current = link({ enabled: true, canStop: true })
  await render(current); expect(control().disabled).toBe(false)
  await act(async () => control().click()); expect(current.toggle).toHaveBeenCalledOnce()
})
it('distinguishes signed-out, loading and failed verification without hiding switches', async () => {
  await render(link({ signedIn: false, membershipState: 'signedOut' }))
  expect(control().disabled).toBe(true); expect(container.textContent).toContain('Sign in to Kun')
  await render(link({ membershipState: 'loading' }))
  expect(container.textContent).toContain('Checking membership'); expect(container.textContent).not.toContain('Requires Plus')
  await render(link({ membershipState: 'unavailable' }))
  expect(container.textContent).toContain('Membership could not be verified')
  expect(container.querySelector('[role="alert"]')).toBeNull()
  expect([...container.querySelectorAll('button')].some(b => b.textContent === 'Retry')).toBe(true)
})
it('offers device recovery only for a rejected, stopped device', async () => {
  const value = link({ mobileAllowed: true, membershipState: 'active', state: { enabled: false, error: 'DEVICE_AUTHORIZATION_REQUIRED', pairings: [], grants: [] } as unknown as MobileLink['state'] })
  await render(value); expect(container.textContent).toContain('Reset remote device')
  await render({ ...value, enabled: true }); expect(container.textContent).not.toContain('Reset remote device')
})

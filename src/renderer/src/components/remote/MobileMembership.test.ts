// @vitest-environment jsdom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { MobileChannelRow } from './RemoteMobileLink'
import type { MobileLink } from './useMobileLink'

function switchState(mobileAllowed: boolean, enabled: boolean) {
  const link = { api: {}, zh: true, account: { state: { status: 'authenticated' } }, signedIn: true,
    state: { enabled, pairings: [], grants: [] }, busy: null, starting: false, canStop: enabled, enabled,
    connectionError: '', mobileAllowed, toggle() {}, retryVip() {}, refreshMembership() {} } as unknown as MobileLink
  const element = document.createElement('div')
  element.innerHTML = renderToStaticMarkup(createElement(MobileChannelRow, { link }))
  return element.querySelector('[role="switch"]') as HTMLButtonElement
}
it('free and unverified accounts cannot enable remote access', () => {
  expect(switchState(false, false).disabled).toBe(true)
  expect(switchState(true, false).disabled).toBe(false)
})
it('membership loss never prevents stopping existing remote access', () => {
  expect(switchState(false, true).disabled).toBe(false)
})

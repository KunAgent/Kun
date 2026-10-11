import { describe, expect, it } from 'vitest'
import type { KunAccountState } from '@shared/kun-account'
import { kunAccountBadge, kunAccountCardCopy, kunAccountErrorCopy, kunAccountPanelPlacement, kunAccountView } from './kun-account-view'

const user = { id: 'u', email: 'lin@example.test', name: '林夏', avatarUrl: null }
const state = (patch: Partial<KunAccountState>): KunAccountState => ({ status: 'anonymous', user: null, error: null, ...patch })

describe('Kun account view state', () => {
  it('maps redacted states to one panel view', () => {
    expect(kunAccountView(state({ status: 'loading' }), false)).toBe('none')
    expect(kunAccountView(state({ status: 'authorizing' }), false)).toBe('waiting')
    expect(kunAccountView(state({ status: 'authenticated', user }), true)).toBe('welcome')
    expect(kunAccountView(state({ status: 'authenticated', user }), false)).toBe('menu')
    expect(kunAccountView(state({ status: 'error', user, error: 'network' }), false)).toBe('menu')
    expect(kunAccountView(state({}), false)).toBe('guest')
    expect(kunAccountView(state({ error: 'unavailable' }), false, true)).toBe('guest')
  })

  it('explains a failed sign-in once, then the card opens the guest menu', () => {
    expect(kunAccountView(state({ error: 'timeout' }), false, true)).toBe('error')
    expect(kunAccountView(state({ error: 'timeout' }), false)).toBe('guest')
  })

  it('badges only what needs the user: amber keeps the account, red asks to sign in', () => {
    expect(kunAccountBadge(state({ status: 'error', user, error: 'network' }))).toBe('warning')
    expect(kunAccountBadge(state({ error: 'expired' }))).toBe('attention')
    expect(kunAccountBadge(state({ error: 'cancelled' }))).toBe('none')
    expect(kunAccountBadge(state({}))).toBe('none')
  })

  it('gives the card one second line by priority', () => {
    expect(kunAccountCardCopy(state({ status: 'authorizing' }))).toEqual({ title: 'kunAccountSigningIn', hint: 'kunAccountCardWaitingHint', tone: 'live' })
    expect(kunAccountCardCopy(state({ error: 'expired' }))).toMatchObject({ title: 'kunAccountCardExpired', tone: 'bad' })
    expect(kunAccountCardCopy(state({ error: 'timeout' }))).toMatchObject({ hint: 'kunAccountCardFailedHint', tone: 'bad' })
    expect(kunAccountCardCopy(state({ error: 'cancelled' }))).toMatchObject({ hint: 'kunAccountCardSignedOutHint', tone: 'plain' })
    expect(kunAccountCardCopy(state({ status: 'error', user, error: 'service' }))).toEqual({ title: null, hint: 'kunAccountCardSyncHint', tone: 'warn' })
    expect(kunAccountCardCopy(state({ status: 'authenticated', user }))).toEqual({ title: null, hint: null, tone: 'plain' })
  })

  it('names the macOS keychain only on macOS and never retries a broken build', () => {
    expect(kunAccountErrorCopy('secure_storage', 'darwin').title).toBe('kunAccountErrorKeychainTitle')
    expect(kunAccountErrorCopy('secure_storage', 'win32').title).toBe('kunAccountErrorCredentialTitle')
    expect(kunAccountErrorCopy('configuration', 'darwin').action).toBe('dismiss')
    expect(kunAccountErrorCopy('timeout', 'linux')).toMatchObject({ action: 'login', art: 'sleep' })
  })

  it('opens above the card with left edges aligned, in layout pixels under body zoom', () => {
    const placed = kunAccountPanelPlacement({ anchor: { top: 656, left: 9.84 }, viewportWidth: 1000, viewportHeight: 820, scale: 0.82 })
    expect(placed.left).toBe(12)
    expect(placed.width).toBe(296)
    expect(placed.bottom).toBeCloseTo(820 / 0.82 - 656 / 0.82 + 8)
    expect(kunAccountPanelPlacement({ anchor: { top: 656, left: 41 }, viewportWidth: 1000, viewportHeight: 820, scale: 0.82 }).left).toBeCloseTo(50)
    const narrow = kunAccountPanelPlacement({ anchor: { top: 400, left: 100 }, viewportWidth: 280, viewportHeight: 500 })
    expect(narrow.width).toBe(256)
    expect(narrow.left).toBe(12)
  })
})

/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KunAccountState } from '@shared/kun-account'
import { KunAccountControl } from './KunAccountControl'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) => values ? `${key}:${Object.values(values).join(',')}` : key,
    i18n: { language: 'zh' }
  })
}))
let container: HTMLDivElement
let root: Root
let notify: (state: KunAccountState) => void
const anonymous: KunAccountState = { status: 'anonymous', user: null, error: null }
const authorizing: KunAccountState = { status: 'authorizing', user: null, error: null }
const signedIn: KunAccountState = { status: 'authenticated', error: null, user: { id: 'user', email: 'p@example.test', name: 'Person', avatarUrl: null } }
const bridge = {
  getState: vi.fn(async () => anonymous), login: vi.fn(async () => authorizing), reopenLogin: vi.fn(async () => authorizing),
  cancelLogin: vi.fn(async () => anonymous), refresh: vi.fn(async () => signedIn), logout: vi.fn(async () => anonymous),
  openAccountCenter: vi.fn(async () => {}), onState: vi.fn((handler: (state: KunAccountState) => void) => { notify = handler; return vi.fn() })
}
const kunGui = { kunAccount: bridge, platform: 'darwin', isRemoteWeb: false }
const text = () => document.body.textContent ?? ''
const entry = () => container.querySelector<HTMLButtonElement>('[data-kun-account-login]')!
const button = (label: string) => [...document.querySelectorAll('button')].find((item) => item.textContent?.includes(label))!

beforeEach(() => {
  vi.clearAllMocks()
  kunGui.isRemoteWeb = false
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(window, 'kunGui', { configurable: true, value: kunGui })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false }) })

describe('sidebar Kun account control', () => {
  it('starts the browser sign-in from one click and follows it live', async () => {
    await act(async () => root.render(createElement(KunAccountControl)))
    expect(entry().textContent).toContain('kunAccountSignIn')
    await act(async () => entry().click())
    expect(bridge.login).toHaveBeenCalledOnce()
    expect(entry().dataset.entry).toBe('busy')
    expect(text()).toContain('kunAccountWaitingTitle')
    expect(text()).toContain('kunAccountStepVerify')
    await act(async () => button('kunAccountReopen').click())
    expect(bridge.reopenLogin).toHaveBeenCalledOnce()
    expect(bridge.login).toHaveBeenCalledOnce()
    expect(text()).toContain('kunAccountReopened')
    await act(async () => button('kunAccountCancel').click())
    expect(bridge.cancelLogin).toHaveBeenCalledOnce()
    expect(document.querySelector('.kun-account-panel')).toBeNull()
    expect(entry().dataset.entry).toBe('login')
  })

  it('opens a welcome on its own when the browser sign-in finishes, without tokens in the DOM', async () => {
    bridge.getState.mockResolvedValueOnce(authorizing)
    await act(async () => root.render(createElement(KunAccountControl)))
    expect(document.querySelector('.kun-account-panel')).toBeNull()
    await act(async () => notify(signedIn))
    expect(text()).toContain('kunAccountWelcomeTitle:Person')
    expect(text()).toContain('kunAccountWelcomeBody:p@example.test')
    expect(document.activeElement).not.toBe(button('kunAccountWelcomeOk'))
    await act(async () => button('kunAccountWelcomeOk').click())
    expect(document.querySelector('.kun-account-panel')).toBeNull()
    expect(entry().dataset.entry).toBe('avatar')
    expect(entry().textContent).toBe('P')
    expect(entry().getAttribute('aria-label')).toBe('kunAccountOpenMenu:Person')
  })

  it('renders the account menu with manage, refresh and local sign-out', async () => {
    bridge.getState.mockResolvedValueOnce(signedIn)
    await act(async () => root.render(createElement(KunAccountControl)))
    await act(async () => entry().click())
    expect(text()).toContain('p@example.test')
    expect(text()).toContain('kunAccountKeychainNote')
    await act(async () => button('kunAccountRefresh').click())
    expect(bridge.refresh).toHaveBeenCalledOnce()
    expect(text()).toContain('kunAccountRefreshed')
    await act(async () => button('kunAccountManage').click())
    expect(bridge.openAccountCenter).toHaveBeenCalledOnce()
    await act(async () => entry().click())
    await act(async () => button('kunAccountSignOut').click())
    expect(bridge.logout).toHaveBeenCalledOnce()
    expect(text()).not.toContain('p@example.test')
    expect(entry().dataset.entry).toBe('login')
  })

  it('pops the error open when a pending sign-in fails and retries in one click', async () => {
    bridge.getState.mockResolvedValueOnce(authorizing)
    await act(async () => root.render(createElement(KunAccountControl)))
    await act(async () => notify({ status: 'anonymous', user: null, error: 'timeout' }))
    expect(text()).toContain('kunAccountErrorTimeoutTitle')
    expect(entry().dataset.badge).toBe('attention')
    await act(async () => button('kunAccountSignInAgain').click())
    expect(bridge.login).toHaveBeenCalledOnce()
    expect(text()).toContain('kunAccountWaitingTitle')
  })

  it('closes on Escape and returns focus to the entry', async () => {
    bridge.getState.mockResolvedValueOnce(signedIn)
    await act(async () => root.render(createElement(KunAccountControl)))
    await act(async () => entry().click())
    expect(document.querySelector('.kun-account-panel')).not.toBeNull()
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(document.querySelector('.kun-account-panel')).toBeNull()
    expect(document.activeElement).toBe(entry())
  })

  it('stays out of the remote browser client', async () => {
    kunGui.isRemoteWeb = true
    await act(async () => root.render(createElement(KunAccountControl)))
    expect(container.innerHTML).toBe('')
  })
})

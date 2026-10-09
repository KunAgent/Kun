/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KunAccountState } from '@shared/kun-account'
import { KunAccountControl } from './KunAccountControl'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }))
let container: HTMLDivElement
let root: Root
let notify: (state: KunAccountState) => void
const anonymous: KunAccountState = { status: 'anonymous', user: null, error: null }
const bridge = {
  getState: vi.fn(async () => anonymous), login: vi.fn(async () => ({ ...anonymous, status: 'authorizing' as const })),
  cancelLogin: vi.fn(async () => anonymous), refresh: vi.fn(async () => anonymous), logout: vi.fn(async () => anonymous),
  openAccountCenter: vi.fn(async () => {}), onState: vi.fn((handler: (state: KunAccountState) => void) => { notify = handler; return vi.fn() })
}
beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(window, 'kunGui', { configurable: true, value: { kunAccount: bridge } })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false }) })

describe('sidebar Kun account control', () => {
  it('opens native sign-in and supports cancellation without putting tokens in renderer state', async () => {
    await act(async () => root.render(createElement(KunAccountControl)))
    const trigger = container.querySelector<HTMLButtonElement>('[data-kun-account-login]')!
    expect(trigger.textContent).toContain('登录')
    await act(async () => trigger.click())
    expect(bridge.login).toHaveBeenCalledOnce()
    expect(document.body.textContent).toContain('请在浏览器完成邮箱登录')
    const cancel = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('取消登录'))!
    await act(async () => cancel.click())
    expect(bridge.cancelLogin).toHaveBeenCalledOnce()
  })
  it('renders the returned account and exposes manage, refresh, and local logout', async () => {
    await act(async () => root.render(createElement(KunAccountControl)))
    await act(async () => notify({ status: 'authenticated', error: null, user: { id: 'user', email: 'p@example.test', name: 'Person', avatarUrl: null } }))
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
    expect(document.body.textContent).toContain('p@example.test')
    const manage = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('管理账号'))!
    await act(async () => manage.click())
    expect(bridge.openAccountCenter).toHaveBeenCalledOnce()
    const logout = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('退出此应用'))!
    await act(async () => logout.click())
    expect(bridge.logout).toHaveBeenCalledOnce()
    expect(document.body.textContent).not.toContain('p@example.test')
  })
})

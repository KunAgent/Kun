/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KunAccountState } from '@shared/kun-account'
import { createKunWardrobe, type KunWardrobeDrop } from '@shared/rooms-api'
import { useChatStore } from '../../store/chat-store'
import { acceptWardrobe } from '../rooms/room-wardrobe'
import { useWardrobeRoute } from '../wardrobe/wardrobe-route'
import { useWardrobeTabRequest } from '../wardrobe/wardrobe-tab-request'
import { SidebarStandardFooter } from '../sidebar/SidebarStandardFooter'
import { KunAccountControl } from './KunAccountControl'

const roomsRequest = vi.hoisted(() => vi.fn())
vi.mock('../rooms/rooms-client', () => ({ roomsRequest }))
vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) => values ? `${key}:${Object.values(values).join(',')}` : key,
    i18n: { language: 'zh' }
  })
}))
let container: HTMLDivElement
let root: Root
const handlers = new Set<(state: KunAccountState) => void>()
// The account hook and the wardrobe store both follow the account, as in the app.
const notify = (state: KunAccountState) => handlers.forEach((handler) => handler(state))
const anonymous: KunAccountState = { status: 'anonymous', user: null, error: null }
const authorizing: KunAccountState = { status: 'authorizing', user: null, error: null }
const signedIn: KunAccountState = { status: 'authenticated', error: null, user: { id: 'user', email: 'p@example.test', name: 'Person', avatarUrl: null } }
let current: KunAccountState
const bridge = {
  getState: vi.fn(async () => current), login: vi.fn(async () => authorizing), reopenLogin: vi.fn(async () => authorizing),
  cancelLogin: vi.fn(async () => anonymous), refresh: vi.fn(async () => signedIn), logout: vi.fn(async () => anonymous),
  openAccountCenter: vi.fn(async () => {}),
  onState: vi.fn((handler: (state: KunAccountState) => void) => { handlers.add(handler); return () => { handlers.delete(handler) } })
}
const kunGui = { kunAccount: bridge, platform: 'darwin', isRemoteWeb: false }
const text = () => document.body.textContent ?? ''
const card = () => container.querySelector<HTMLElement>('[data-kun-account-card]')!
const entry = () => container.querySelector<HTMLButtonElement>('[data-kun-account-login]')!
const panel = () => document.querySelector<HTMLElement>('.kun-account-panel')
const button = (label: string) => [...document.querySelectorAll('button')].find((item) => item.textContent?.includes(label))!
/** The account's wardrobe mirror, as a refresh after sign-in would deliver it. */
const seed = () => acceptWardrobe({ wardrobe: { ...createKunWardrobe(1), feathers: 40, pending: [1, 2, 3].map(drop) }, revision: 1, mode: 'account' })
const drop = (index: number): KunWardrobeDrop => ({ id: `drop-${index}`, kind: 'item', rarity: 'common', item: { category: 'prop', id: 'book' },
  duplicate: false, feathers: 0, runId: `run-${index}`, createdAt: new Date(2026, 9, 10, 9, index).toISOString() })

beforeEach(() => {
  vi.clearAllMocks()
  current = anonymous
  kunGui.isRemoteWeb = false
  roomsRequest.mockRejectedValue(new Error('offline'))
  useChatStore.setState({ route: 'chat', runtimeConnection: 'ready' })
  useWardrobeRoute.setState({ returnRoute: 'chat' })
    useWardrobeTabRequest.setState({ request: null })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(window, 'kunGui', { configurable: true, value: kunGui })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false }) })

describe('sidebar Kun account card', () => {
  it('starts the browser sign-in from the card and follows it live', async () => {
    await act(async () => root.render(createElement(KunAccountControl)))
    expect(card().dataset.account).toBe('signed-out')
    expect(card().textContent).toContain('kunAccountCardSignedOut')
    await act(async () => button('kunAccountSignIn').click())
    expect(bridge.login).toHaveBeenCalledOnce()
    expect(card().dataset.account).toBe('busy')
    expect(card().textContent).toContain('kunAccountCardWaitingHint')
    expect(text()).toContain('kunAccountWaitingTitle')
    await act(async () => button('kunAccountReopen').click())
    expect(bridge.reopenLogin).toHaveBeenCalledOnce()
    expect(text()).toContain('kunAccountReopened')
    await act(async () => button('kunAccountCancel').click())
    expect(bridge.cancelLogin).toHaveBeenCalledOnce()
    expect(panel()).toBeNull()
    expect(card().dataset.account).toBe('signed-out')
  })

  it('opens the guest menu from the card, with sign-in and the starter wardrobe', async () => {
    await act(async () => root.render(createElement(KunAccountControl)))
    await act(async () => entry().click())
    expect(panel()?.dataset.view).toBe('guest')
    expect(entry().getAttribute('aria-expanded')).toBe('true')
    expect(text()).toContain('kunAccountGuestBody')
    expect(document.querySelector('[data-kun-account-nav="shop"]')).toBeNull()
    await act(async () => document.querySelector<HTMLButtonElement>('[data-kun-account-nav="items"]')!.click())
    expect(useChatStore.getState().route).toBe('wardrobe')
    expect(useWardrobeTabRequest.getState().request?.tab).toBe('items')
    expect(panel()).toBeNull()
    expect(card().dataset.active).toBe('true')
    await act(async () => entry().click())
    expect(text()).toContain('kunAccountMenuViewing')
    await act(async () => button('kunAccountGuestSignIn').click())
    expect(bridge.login).toHaveBeenCalledOnce()
    expect(text()).toContain('kunAccountWaitingTitle')
  })

  it('opens a welcome on its own when the browser sign-in finishes, then the card is the account', async () => {
    current = authorizing
    await act(async () => root.render(createElement(KunAccountControl)))
    expect(panel()).toBeNull()
    await act(async () => { current = signedIn; notify(signedIn); seed() })
    expect(text()).toContain('kunAccountWelcomeTitle:Person')
    expect(document.activeElement).not.toBe(button('kunAccountWelcomeOk'))
    await act(async () => button('kunAccountWelcomeOk').click())
    expect(panel()).toBeNull()
    expect(card().dataset.account).toBe('signed-in')
    expect(card().textContent).toContain('Person')
    expect(card().textContent).toContain('p@example.test')
    expect(card().querySelector('[data-sidebar-bottles="3"]')).not.toBeNull()
    expect(entry().getAttribute('aria-label')).toContain('kunAccountOpenMenu:Person')
    expect(entry().getAttribute('aria-label')).toContain('wardrobePageBadgeHint:3')
  })

  it('shows the account, its wardrobe numbers and the links into the wardrobe page', async () => {
    current = signedIn
    await act(async () => root.render(createElement(KunAccountControl)))
    await act(async () => seed())
    await act(async () => entry().click())
    expect(panel()?.dataset.view).toBe('menu')
    const stats = [...document.querySelectorAll('.kun-account-stat dd')].map((node) => node.textContent)
    expect(stats).toEqual(['3', '40', expect.stringMatching(/^\d+$/)])
    expect(text()).toContain('kunAccountKeychainShort')
    expect(text()).toContain('Kun · sidebarKunStatusReady')
    await act(async () => document.querySelector<HTMLButtonElement>('[data-kun-account-nav="invite"]')!.click())
    expect(useChatStore.getState().route).toBe('wardrobe')
    expect(useWardrobeTabRequest.getState().request?.tab).toBe('invite')
    expect(panel()).toBeNull()
    await act(async () => entry().click())
    await act(async () => document.querySelector<HTMLButtonElement>('[data-kun-account-nav="shop"]')!.click())
    expect(useWardrobeTabRequest.getState().request).toMatchObject({ tab: 'shop', serial: 2 })
  })

  it('keeps manage, refresh and local sign-out in the menu', async () => {
    current = signedIn
    await act(async () => root.render(createElement(KunAccountControl)))
    await act(async () => seed())
    await act(async () => entry().click())
    await act(async () => button('kunAccountRefresh').click())
    expect(bridge.refresh).toHaveBeenCalledOnce()
    expect(text()).toContain('kunAccountRefreshed')
    await act(async () => button('kunAccountManage').click())
    expect(bridge.openAccountCenter).toHaveBeenCalledOnce()
    await act(async () => entry().click())
    await act(async () => button('kunAccountSignOut').click())
    expect(bridge.logout).toHaveBeenCalledOnce()
    expect(card().textContent).not.toContain('p@example.test')
    expect(card().dataset.account).toBe('signed-out')
    expect(document.activeElement).toBe(entry())
  })

  it('explains a failed sign-in once; the card then opens the guest menu with the reason', async () => {
    current = authorizing
    await act(async () => root.render(createElement(KunAccountControl)))
    await act(async () => notify({ status: 'anonymous', user: null, error: 'timeout' }))
    expect(panel()?.dataset.view).toBe('error')
    expect(text()).toContain('kunAccountErrorTimeoutTitle')
    expect(card().textContent).toContain('kunAccountCardFailedHint')
    expect(container.querySelector('.kun-account-card-login')?.hasAttribute('data-badge')).toBe(true)
    await act(async () => entry().click())
    expect(panel()).toBeNull()
    await act(async () => entry().click())
    expect(panel()?.dataset.view).toBe('guest')
    expect(text()).toContain('kunAccountErrorTimeoutTitle')
    await act(async () => button('kunAccountGuestSignIn').click())
    expect(bridge.login).toHaveBeenCalledOnce()
  })

  it('walks the menu with the arrow keys and closes on Escape back to the card', async () => {
    current = signedIn
    await act(async () => root.render(createElement(KunAccountControl)))
    await act(async () => seed())
    await act(async () => entry().click())
    const rows = [...panel()!.querySelectorAll<HTMLButtonElement>('.kun-account-view button')]
    rows[0].focus()
    await act(async () => rows[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    expect(document.activeElement).toBe(rows[1])
    await act(async () => rows[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })))
    await act(async () => rows[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })))
    expect(document.activeElement).toBe(rows[rows.length - 1])
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(panel()).toBeNull()
    expect(document.activeElement).toBe(entry())
  })

  it('uses one line in the compact form', async () => {
    await act(async () => root.render(createElement(KunAccountControl, { variant: 'compact' })))
    expect(card().dataset.variant).toBe('compact')
    expect(card().textContent).toContain('kunAccountSignInLabel')
    expect(container.querySelector('.kun-account-card-login')).toBeNull()
    await act(async () => entry().click())
    expect(panel()?.dataset.view).toBe('guest')
  })

  it('keeps the full card in the sidebar footer whether Focus mode is on or off', async () => {
    const footer = (focusModeEnabled: boolean) => createElement(SidebarStandardFooter, {
      focusModeEnabled, connectPhoneSidebarOpen: false, onFocusModeChange: vi.fn(), onOpenSettings: vi.fn(), onToggleConnectPhone: vi.fn()
    })
    await act(async () => root.render(footer(false)))
    const before = card()
    expect(before.dataset.variant).toBe('card')
    await act(async () => root.render(footer(true)))
    expect(container.querySelectorAll('[data-kun-account-card]')).toHaveLength(1)
    expect(card()).toBe(before)
    expect(card().dataset.variant).toBe('card')
    expect(container.querySelector('.kun-account-card-login')).not.toBeNull()
  })

  it('stays out of the remote browser client', async () => {
    kunGui.isRemoteWeb = true
    await act(async () => root.render(createElement(KunAccountControl)))
    expect(container.innerHTML).toBe('')
  })
})

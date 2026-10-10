/** @vitest-environment jsdom */
import { grantKunWardrobeItems } from '../../../../../kun/src/test-support/wardrobe-simulator'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  KUN_AVATAR_PRESETS, createKunWardrobe, type KunWardrobe, type KunWardrobeDrop, type RoomAvatarReference
} from '@shared/rooms-api'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' },
  t: (key: string, values?: Record<string, unknown>) => values ? `${key}:${Object.values(values).join(',')}` : key }) }))
vi.mock('../rooms/RoomAvatar', () => ({ RoomAvatar: (props: { avatar?: RoomAvatarReference | null }) =>
  createElement('span', { 'data-avatar': JSON.stringify(props.avatar ?? null) }) }))
vi.mock('../rooms/room-avatar-composed', () => ({ useRoomComposedAvatar: () => 'blob:figure' }))
vi.mock('../rooms/rooms-client', () => ({ roomsRequest: mocks.request, roomRequestId: () => 'request-id' }))

import { acceptWardrobe } from '../rooms/room-wardrobe'
import { useRoomUserProfile } from '../rooms/room-user-profile'
import { WardrobePageView } from './WardrobePageView'
import { requestWardrobeTab } from './wardrobe-tab-request'

const parts = { color: 'sky', face: 'normal', bg: '#eef6ff', headwear: 'baseball-cap' }
const bottle = (index: number): KunWardrobeDrop => ({ id: `drop-${index}`, kind: 'item', rarity: 'common', item: { category: 'prop', id: 'book' },
  duplicate: false, feathers: 0, source: 'room', runId: `run-${index}`, createdAt: new Date(2026, 9, 10, 9, index).toISOString() })
const wardrobe: KunWardrobe = { ...grantKunWardrobeItems(createKunWardrobe(1), ['headwear/baseball-cap', 'headwear/pilot-cap', 'glasses/square']),
  seen: ['headwear/baseball-cap', 'headwear/pilot-cap', 'glasses/square'], pending: [1, 2, 3].map(bottle), roles: [] }

function setReactActEnvironment(value: boolean): void {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = value
}

describe('wardrobe page', () => {
  let container: HTMLDivElement
  let root: Root
  const $ = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T & HTMLElement>(selector)
  const $$ = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)]
  const puts = () => mocks.request.mock.calls.filter((call) => call[1] === 'PUT').map((call) => call[2])

  beforeEach(async () => {
    setReactActEnvironment(true)
    mocks.request.mockReset()
    mocks.request.mockImplementation(async (path: string, method?: string, body?: { avatar: RoomAvatarReference; expectedRevision: number }) => {
      if (path === '/v1/rooms/user-profile' && method === 'PUT') return { profile: { avatar: body!.avatar }, revision: body!.expectedRevision + 1 }
      if (path === '/v1/rooms/user-profile') return { profile: { avatar: { kind: 'composed', version: 1, parts } }, revision: 3 }
      return { wardrobe, revision: 5 }
    })
    useRoomUserProfile.setState({ profile: { avatar: null }, revision: null })
    acceptWardrobe({ wardrobe, revision: 4, mode: 'account' })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root.render(createElement(WardrobePageView, { leftSidebarCollapsed: false, onToggleLeftSidebar: vi.fn() })))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    setReactActEnvironment(false)
  })

  it('shows the fitting room, the shelf, and items not found yet without names or art', () => {
    expect($('[data-wardrobe-figure]')?.getAttribute('src')).toBe('blob:figure')
    expect($('[data-wardrobe-slot="headwear"]')?.getAttribute('aria-label')).toContain('Baseball cap')
    expect($('[data-wardrobe-shelf]')?.dataset.wardrobeShelf).toBe('3')
    expect($<HTMLButtonElement>('[data-shelf-open="one"]')?.disabled).toBe(false)
    expect($<HTMLButtonElement>('[data-shelf-open="ten"]')?.disabled).toBe(true)
    const unknown = $$('[data-wardrobe-item="unknown"]')
    expect(unknown).toHaveLength(54)
    expect(container.textContent).not.toContain('Space helmet')
    expect($('[data-wardrobe-item="headwear/baseball-cap"]')?.dataset.worn).toBe('true')
  })

  it('tries an item on when hovered and wears it with a click, with undo', async () => {
    const cap = $('[data-wardrobe-item="headwear/pilot-cap"]')!
    await act(async () => cap.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })))
    expect(container.textContent).toContain('wardrobePageTryBadge')
    await act(async () => cap.click())
    await vi.waitFor(() => expect(puts()).toHaveLength(1))
    expect(puts()[0]).toMatchObject({ avatar: { kind: 'composed', parts: { headwear: 'pilot-cap' } }, expectedRevision: 3 })
    expect(container.textContent).toContain('wardrobePageToastWear:Pilot cap')
    expect($('[data-wardrobe-item="headwear/pilot-cap"]')?.dataset.worn).toBe('true')
    expect($('[data-wardrobe-sheet]')?.textContent).toContain('wardrobePageTakeOff')
    await act(async () => $('[data-wardrobe-undo]')!.click())
    await vi.waitFor(() => expect(puts()).toHaveLength(2))
    expect(puts()[1]).toMatchObject({ avatar: { parts: { headwear: 'baseball-cap' } } })
  })

  it('previews a backdrop on hover and hands the stage back once the pointer is off every tile', async () => {
    await act(async () => $('[data-wardrobe-tab="look"]')!.click())
    const over = (element: Element) => act(async () => element.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })))
    await over($('[data-wardrobe-look="scene-sunset-bay"]')!)
    expect(container.textContent).toContain('wardrobePageTryBadge')
    await over($('.kun-wardrobe-look header')!)
    expect(container.textContent).not.toContain('wardrobePageTryBadge')
    await over($('[data-wardrobe-look="bg-transparent"]')!)
    expect(container.textContent).toContain('wardrobePageTryBadge')
    await act(async () => window.dispatchEvent(new Event('blur')))
    expect(container.textContent).not.toContain('wardrobePageTryBadge')
  })

  it('keeps an unknown item secret in the detail bar and offers the feather trade', async () => {
    await act(async () => $$('[data-wardrobe-item="unknown"]')[0]!.click())
    const sheet = $('[data-wardrobe-sheet]')!
    expect(sheet.textContent).toContain('roomsWardrobeUnknownItem')
    expect(sheet.textContent).toContain('roomsWardrobeExchangeHint')
    expect(sheet.querySelector<HTMLButtonElement>('.kun-wardrobe-sheet-action')?.disabled).toBe(true)
  })

  it('shows every unrevealed role card face down and opens the drop settings', async () => {
    await act(async () => $('[data-wardrobe-tab="cards"]')!.click())
    expect($$('[data-wardrobe-card]')).toHaveLength(KUN_AVATAR_PRESETS.length)
    expect($$('[data-wardrobe-card="unknown"]')).toHaveLength(KUN_AVATAR_PRESETS.length)
    await act(async () => $('[data-wardrobe-settings]')!.click())
    expect($('[role="dialog"] [data-wardrobe-setting="drops"]')).not.toBeNull()
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect($('[role="dialog"]')).toBeNull()
  })

  it('restores Little Kun as the default avatar', async () => {
    await act(async () => $('[data-wardrobe-restore]')!.click())
    await vi.waitFor(() => expect(puts()).toHaveLength(1))
    expect(puts()[0]).toMatchObject({ avatar: null })
  })

  it('says the wardrobe is synced to the account and offers the shop and invitations', () => {
    expect($('[data-wardrobe-mode]')?.dataset.wardrobeMode).toBe('account')
    expect($$('[data-wardrobe-tab]').map((tab) => tab.dataset.wardrobeTab)).toEqual(['items', 'cards', 'look', 'log', 'shop', 'invite'])
  })

  it('closes from its own header button once the host hands it a way back', async () => {
    expect($('[data-wardrobe-close]')).toBeNull()
    const onClose = vi.fn()
    await act(async () => root.render(createElement(WardrobePageView, { leftSidebarCollapsed: false, onToggleLeftSidebar: vi.fn(), onClose })))
    expect($('[data-wardrobe-close]')?.getAttribute('aria-label')).toBe('wardrobePageLeave')
    await act(async () => $('[data-wardrobe-close]')!.click())
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('switches to the tab the account menu asks for, also while the page is open', async () => {
    const pressed = () => $$('[data-wardrobe-tab]').find((tab) => tab.getAttribute('aria-pressed') === 'true')?.dataset.wardrobeTab
    expect(pressed()).toBe('items')
    await act(async () => requestWardrobeTab('invite'))
    expect(pressed()).toBe('invite')
    await act(async () => $('[data-wardrobe-tab="cards"]')!.click())
    await act(async () => requestWardrobeTab('invite'))
    expect(pressed()).toBe('invite')
    await act(async () => requestWardrobeTab(undefined))
    expect(pressed()).toBe('invite')
  })

  it('signed out, swaps the shelf for sign-in, locks the shop, and keeps unknown items out of reach', async () => {
    await act(async () => acceptWardrobe({ wardrobe: { ...wardrobe, pending: [] }, revision: 6, mode: 'guest' }))
    expect($('[data-wardrobe-shelf]')).toBeNull()
    expect($('[data-wardrobe-guest]')).not.toBeNull()
    expect($('[data-wardrobe-feathers]')).toBeNull()
    expect($('[data-wardrobe-settings]')).toBeNull()
    await act(async () => $('[data-wardrobe-tab="shop"]')!.click())
    expect($('[data-wardrobe-locked="shop"]')).not.toBeNull()
    await act(async () => $('[data-wardrobe-tab="items"]')!.click())
    await act(async () => $$('[data-wardrobe-item="unknown"]')[0]!.click())
    const sheet = $('[data-wardrobe-sheet]')!
    expect(sheet.textContent).toContain('wardrobeAccountGuestItemHint')
    expect(sheet.querySelector<HTMLButtonElement>('.kun-wardrobe-sheet-action')?.disabled).toBe(true)
  })
  it('guides guests to sign in for randomize, reset and photo without saving any appearance', async () => {
    const login = vi.fn(async () => ({}))
    Object.defineProperty(window, 'kunGui', { configurable: true, value: { kunAccount: { login } } })
    await act(async () => acceptWardrobe({ wardrobe, revision: 5, mode: 'guest' }))
    expect($('[data-wardrobe-guest]')).not.toBeNull()
    const before = puts().length
    for (const selector of ['[data-wardrobe-random]', '[data-wardrobe-restore]', '[data-wardrobe-upload]']) {
      await act(async () => $<HTMLButtonElement>(selector)!.click())
    }
    expect(login).toHaveBeenCalledTimes(3)
    expect(puts()).toHaveLength(before)
    expect($('[data-wardrobe-shelf]')).toBeNull()
    Object.defineProperty(window, 'kunGui', { configurable: true, value: undefined })
  })

})

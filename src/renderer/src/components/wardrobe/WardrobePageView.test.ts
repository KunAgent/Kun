/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  KUN_AVATAR_PRESETS, createKunWardrobe, grantKunWardrobeItems, type KunWardrobe, type KunWardrobeDrop, type RoomAvatarReference
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
    acceptWardrobe({ wardrobe, revision: 4 })
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
})

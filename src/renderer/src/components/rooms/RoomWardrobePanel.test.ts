import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KUN_AVATAR_PRESETS, createKunWardrobe, grantKunWardrobeItems, type KunWardrobe, type RoomAvatarReference } from '@shared/rooms-api'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' },
  t: (key: string, values?: Record<string, unknown>) => values ? `${key}:${Object.values(values).join(',')}` : key }) }))
vi.mock('./RoomAvatar', () => ({ RoomAvatar: (props: { avatar?: RoomAvatarReference; label: string }) =>
  createElement('span', { 'data-avatar': props.avatar, 'aria-label': props.label }) }))
vi.mock('./RoomUserAvatarEditor', () => ({ RoomUserAvatarEditor: () => createElement('div', { 'data-editor': true }) }))
vi.mock('./RoomModal', () => ({ RoomModal: ({ children }: { children: ReactNode }) => createElement('div', { role: 'dialog' }, children) }))
vi.mock('./rooms-client', () => ({ roomsRequest: mocks.request, roomRequestId: () => 'request-id' }))
vi.mock('./room-user-profile', () => ({ acceptRoomUserProfile: vi.fn(),
  useRoomUserProfile: (select: (state: { revision: number }) => unknown) => select({ revision: 3 }) }))

import { RoomWardrobePanel } from './RoomWardrobePanel'
import { acceptWardrobe } from './room-wardrobe'

let renderer: ReactTestRenderer
const wardrobe: KunWardrobe = {
  ...grantKunWardrobeItems(createKunWardrobe(1), ['glasses/square', 'outfit/black-hoodie']),
  pending: [{ id: 'drop-code-t1', kind: 'item', rarity: 'epic', item: { category: 'headwear', id: 'pilot-cap' }, duplicate: false, feathers: 0,
    source: 'code', threadId: 'thread-1', sourceLabel: 'Fix login timeout', runId: 'code-t1', createdAt: new Date().toISOString() }],
  history: [{ id: 'drop-run-1', kind: 'item', rarity: 'common', item: { category: 'prop', id: 'notebook' }, duplicate: true, feathers: 5,
    source: 'room', roomId: 'room-1', sourceLabel: 'Little Kun', runId: 'run-1', createdAt: new Date().toISOString(), openedAt: new Date().toISOString() }]
}
const button = (props: Record<string, unknown>) => renderer.root.findAll((node) => node.type === 'button' &&
  Object.entries(props).every(([key, value]) => node.props[key] === value))[0]!
const text = () => JSON.stringify(renderer.toJSON())
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  acceptWardrobe({ wardrobe, revision: 4 })
})
afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.unstubAllGlobals() })

describe('wardrobe right panel', () => {
  it('shows progress, today, the bottle to open, and locked items without wearing them', async () => {
    await act(async () => { renderer = create(createElement(RoomWardrobePanel)) })
    expect(text()).toContain('roomsWardrobeStatItems')
    expect(renderer.root.findByProps({ 'data-wardrobe-drop': 'drop-code-t1' })).toBeDefined()
    act(() => button({ 'data-wardrobe-item': 'headwear/astronaut-helmet' }).props.onClick())
    expect(text()).toContain('roomsWardrobeExchangeHint')
    const trade = renderer.root.findAll((node) => node.type === 'button' && node.props.className === 'rooms-run-primary')[0]!
    expect(trade.props.disabled).toBe(true)
  })

  it('hides every unrevealed role card behind its back, without the name', async () => {
    await act(async () => { renderer = create(createElement(RoomWardrobePanel)) })
    act(() => button({ 'data-wardrobe-tab': 'cards' }).props.onClick())
    const cards = renderer.root.findAll((node) => node.type === 'button' && node.props['data-wardrobe-card'] !== undefined)
    expect(cards).toHaveLength(KUN_AVATAR_PRESETS.length)
    expect(cards.filter((node) => node.props['data-wardrobe-card'] === 'unknown')).toHaveLength(KUN_AVATAR_PRESETS.length - 1)
    expect(text()).not.toContain('Astronaut')
    expect(text()).toContain('Coder')
  })

  it('lists Code task and conversation drops in the log', async () => {
    await act(async () => { renderer = create(createElement(RoomWardrobePanel)) })
    act(() => button({ 'data-wardrobe-tab': 'log' }).props.onClick())
    expect(text()).toContain('Code · Fix login timeout')
    expect(text()).toContain('Little Kun')
    expect(text()).toContain('roomsWardrobeFeatherGain:5')
  })

  it('starts with both drop switches on and saves a change', async () => {
    mocks.request.mockResolvedValue({ wardrobe: { ...wardrobe, settings: { drops: true, code: false, notice: 'card' } }, revision: 5 })
    await act(async () => { renderer = create(createElement(RoomWardrobePanel)) })
    act(() => button({ 'data-wardrobe-tab': 'settings' }).props.onClick())
    expect(button({ 'data-wardrobe-setting': 'drops' }).props['aria-checked']).toBe(true)
    expect(button({ 'data-wardrobe-setting': 'code' }).props['aria-checked']).toBe(true)
    await act(async () => { button({ 'data-wardrobe-setting': 'code' }).props.onClick() })
    expect(mocks.request).toHaveBeenCalledWith('/v1/rooms/wardrobe/settings', 'POST',
      { settings: { code: false }, clientRequestId: 'request-id', expectedRevision: 4 })
    expect(button({ 'data-wardrobe-setting': 'code' }).props['aria-checked']).toBe(false)
  })
})

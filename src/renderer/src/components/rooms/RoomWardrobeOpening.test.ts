import { createElement, useEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createKunWardrobe, type KunWardrobeDrop, type RoomAvatarReference } from '@shared/rooms-api'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' },
  t: (key: string, values?: Record<string, unknown>) => values ? `${key}:${Object.values(values).join(',')}` : key }) }))
vi.mock('./RoomAvatar', () => ({ RoomAvatar: (props: { avatar?: RoomAvatarReference }) => createElement('span', { 'data-avatar': props.avatar }) }))
vi.mock('./rooms-client', () => ({ roomsRequest: mocks.request, roomRequestId: () => 'request-id' }))

import { RoomWardrobeOpening, useWardrobeOpener } from './RoomWardrobeOpening'
import { RoomWardrobeShelf } from './RoomWardrobeShelf'
import { acceptWardrobe, type WardrobeOpenResult } from './room-wardrobe'

let renderer: ReactTestRenderer
const bottle = (index: number, patch: Partial<KunWardrobeDrop> = {}): KunWardrobeDrop => ({ id: 'drop-' + index, kind: 'item', rarity: 'common',
  item: { category: 'prop', id: 'leaf' }, duplicate: false, feathers: 0, runId: 'run-' + index, source: 'code',
  createdAt: new Date(Date.UTC(2026, 9, 9, 9, index)).toISOString(), ...patch })
const ten = Array.from({ length: 10 }, (_, index) => bottle(index + 1, index === 2 ? { rarity: 'legendary', item: { category: 'headwear', id: 'wizard-hat' } }
  : index === 4 ? { duplicate: true, feathers: 5 } : index === 7 ? { kind: 'card', item: undefined, cardId: 'navigator', rarity: 'rare' } : {}))
const result = (drops: KunWardrobeDrop[], patch: Partial<WardrobeOpenResult> = {}): WardrobeOpenResult => ({
  wardrobe: createKunWardrobe(1), revision: 5, drops, drop: drops[0]!, granted: [], feathers: drops.reduce((sum, drop) => sum + drop.feathers, 0),
  guaranteed: false, ...patch })
const node = (props: Record<string, unknown>) => renderer.root.findAll((item) => typeof item.type === 'string' &&
  Object.entries(props).every(([key, value]) => item.props[key] === value))[0]
const text = () => JSON.stringify(renderer.toJSON())
const advance = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms) }) }

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true) })
afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('bottle opening stage', () => {
  it('runs a ten-pull from shaking bottles to flipped cards and a summary', async () => {
    await act(async () => { renderer = create(createElement(RoomWardrobeOpening, { mode: 'ten', result: result(ten), error: '', shelfCount: 3,
      onClose: vi.fn(), onOpenOne: vi.fn(), onOpenTen: vi.fn() })) })
    const phase = () => node({ className: 'kun-gacha' })!.props['data-phase']
    expect(phase()).toBe('shake')
    // Rarity stays hidden while the bottles shake.
    expect(node({ className: 'kun-gacha' })!.props['data-top-rarity']).toBeUndefined()
    await advance(700); expect(phase()).toBe('charge')
    expect(node({ className: 'kun-gacha' })!.props['data-top-rarity']).toBe('legendary')
    await advance(900); expect(phase()).toBe('burst')
    await advance(450); expect(phase()).toBe('reveal')
    expect(renderer.root.findAll((item) => item.props['data-gacha-card'] !== undefined && typeof item.type === 'string')).toHaveLength(10)
    await advance(10 * 140 + 550); expect(phase()).toBe('done')
    expect(text()).toContain('roomsGachaLegendary:Wizard hat')
    expect(text()).toContain('roomsGachaSumDuplicate:1,5')
    expect(text()).toContain('roomsGachaSumCards:1')
    expect(node({ 'data-gacha-again': true })!.props.disabled).toBe(true)
  })

  it('skips straight to the result and shows the guarantee', async () => {
    const plain = ten.map((drop, index) => index === 9 ? { ...drop, rarity: 'rare' as const, upgraded: true, item: { category: 'headwear' as const, id: 'straw-hat' } }
      : { ...drop, rarity: 'common' as const, kind: 'item' as const, item: { category: 'prop' as const, id: 'leaf' }, cardId: undefined })
    await act(async () => { renderer = create(createElement(RoomWardrobeOpening, { mode: 'ten', result: result(plain, { guaranteed: true }), error: '',
      shelfCount: 12, onClose: vi.fn(), onOpenOne: vi.fn(), onOpenTen: vi.fn() })) })
    act(() => node({ 'data-gacha-skip': true })!.props.onClick())
    expect(node({ className: 'kun-gacha' })!.props['data-phase']).toBe('done')
    expect(text()).toContain('roomsGachaPity')
    expect(text()).toContain('roomsGachaPityTag')
    expect(node({ 'data-gacha-again': true })!.props.disabled).toBe(false)
  })

  it('opens the oldest ten through the opener and wears a single result on request', async () => {
    const shelf = Array.from({ length: 12 }, (_, index) => bottle(12 - index))
    acceptWardrobe({ wardrobe: { ...createKunWardrobe(2), pending: shelf }, revision: 7 })
    const onWear = vi.fn()
    let api: ReturnType<typeof useWardrobeOpener> | undefined
    function Harness() { const opener = useWardrobeOpener({ onWear }); useEffect(() => { api = opener }); return createElement('div', null, opener.overlay) }
    mocks.request.mockResolvedValueOnce(result(ten))
    await act(async () => { renderer = create(createElement(Harness)) })
    await act(async () => { api!.openTen() })
    expect(mocks.request).toHaveBeenCalledWith('/v1/rooms/wardrobe/open', 'POST',
      { dropIds: Array.from({ length: 10 }, (_, index) => 'drop-' + (index + 1)), clientRequestId: 'request-id', expectedRevision: 7 })
    act(() => node({ className: 'kun-gacha-close' })!.props.onClick())
    mocks.request.mockResolvedValueOnce(result([bottle(11, { rarity: 'epic', item: { category: 'headwear', id: 'pilot-cap' } })]))
    await act(async () => { api!.openOne('drop-11') })
    act(() => node({ 'data-gacha-skip': true })!.props.onClick())
    await act(async () => { node({ 'data-gacha-wear': true })!.props.onClick() })
    expect(onWear).toHaveBeenCalledWith(expect.objectContaining({ id: 'drop-11', rarity: 'epic' }))
  })

  it('shows the idle shelf on the stage and saves up toward ten', async () => {
    await act(async () => { renderer = create(createElement(RoomWardrobeOpening, { mode: 'idle', result: null, error: '', shelfCount: 4,
      onClose: vi.fn(), onOpenOne: vi.fn(), onOpenTen: vi.fn() })) })
    expect(node({ 'data-gacha-open': 'one' })!.props.disabled).toBe(false)
    expect(node({ 'data-gacha-open': 'ten' })!.props.disabled).toBe(true)
    expect(text()).toContain('roomsGachaShort:6')
    act(() => renderer.unmount())
    const wardrobe = { ...createKunWardrobe(3), pending: Array.from({ length: 23 }, (_, index) => bottle(index)) }
    await act(async () => { renderer = create(createElement(RoomWardrobeShelf, { wardrobe, onOpenOne: vi.fn(), onOpenTen: vi.fn() })) })
    expect(text()).toContain('roomsShelfReadyMany:23,2')
    expect(node({ 'data-shelf-open': 'ten' })!.props.disabled).toBe(false)
  })
})

import { createElement, useState, type ReactElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  KUN_AVATAR_DEFAULT_PARTS, KUN_AVATAR_PRESETS, createKunWardrobe, grantKunWardrobeItems, type KunWardrobe, type RoomAvatarReference
} from '@shared/rooms-api'
import { RoomAvatarComposer } from './RoomAvatarComposer'
import { wearWardrobeDrop } from './room-wardrobe'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' },
  t: (key: string, values?: Record<string, unknown>) => values ? `${key}:${Object.values(values).join(',')}` : key }) }))
vi.mock('./RoomAvatar', () => ({ RoomAvatar: (props: { avatar?: RoomAvatarReference; label: string }) =>
  createElement('span', { 'data-avatar': props.avatar, 'aria-label': props.label }) }))
vi.mock('./rooms-client', () => ({ roomsRequest: vi.fn(), roomRequestId: () => 'request-id' }))

let renderer: ReactTestRenderer
const options = () => renderer.root.findAllByProps({ className: 'rooms-avatar-composer-option' })
const option = (label: string) => options().find((node) => node.props['aria-label'] === label)!
const preview = () => renderer.root.findByType(RoomAvatarComposer).props.avatar as RoomAvatarReference | null | undefined
const changeCategory = (category: string) => act(() => renderer.root.findByProps({ 'data-avatar-tab': category }).props.onClick())
async function mount(node: ReactElement) { await act(async () => { renderer = create(node) }) }
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true) })
afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.unstubAllGlobals() })

const starter: KunWardrobe = grantKunWardrobeItems(createKunWardrobe(1), ['glasses/square', 'outfit/black-hoodie', 'headwear/headset'])
function Harness({ wardrobe, onSeen }: { wardrobe: KunWardrobe | null; onSeen?: (keys: string[]) => void }) {
  const [avatar, setAvatar] = useState<RoomAvatarReference | null>({ kind: 'composed', version: 1, parts: KUN_AVATAR_DEFAULT_PARTS })
  return createElement(RoomAvatarComposer, { id: 'agent', label: 'Agent', avatar, wardrobe, onSeen, onChange: setAvatar, onUpload: vi.fn() }) as ReactNode as ReactElement
}

describe('wardrobe-gated dress-up studio', () => {
  it('locks unowned items as silhouettes that preview but never get worn', async () => {
    await mount(createElement(Harness, { wardrobe: starter }))
    changeCategory('headwear')
    expect(option('Headset').props['data-locked']).toBeUndefined()
    const helmet = option('Space helmet')
    expect(helmet.props['data-locked']).toBe(true)
    expect(helmet.props['aria-disabled']).toBe(true)
    act(() => helmet.props.onClick())
    expect(preview()).toMatchObject({ parts: KUN_AVATAR_DEFAULT_PARTS })
    expect(renderer.root.findByProps({ role: 'status' }).children.join('')).toBe('roomsWardrobeLockedHint')
    act(() => option('Headset').props.onClick())
    expect(preview()).toMatchObject({ parts: { headwear: 'headset' } })
  })

  it('lights only complete role cards, filters to owned items, and randomizes within the wardrobe', async () => {
    await mount(createElement(Harness, { wardrobe: starter }))
    expect(options()).toHaveLength(KUN_AVATAR_PRESETS.length)
    expect(option('Coder').props['data-locked']).toBeUndefined()
    expect(option('Astronaut').props['data-locked']).toBe(true)
    act(() => renderer.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }))
    expect(options().map((node) => node.props['aria-label'])).toEqual(['Coordinator', 'Coder'])
    changeCategory('outfit')
    expect(options().map((node) => node.props['aria-label'])).toEqual(['roomsAvatarNone', 'Black hoodie'])
    for (let attempt = 0; attempt < 20; attempt++) {
      act(() => renderer.root.findAllByType('button').find((node) => node.children.includes('roomsAvatarRandom'))!.props.onClick())
      const parts = (preview() as { parts: Record<string, string> }).parts
      for (const [slot, allowed] of [['headwear', 'headset'], ['glasses', 'square'], ['outfit', 'black-hoodie'], ['prop', undefined]] as const) {
        if (parts[slot] !== undefined) expect(parts[slot]).toBe(allowed)
      }
    }
  })

  it('marks fresh items as seen after the shelf has been looked at, and leaves everything open without a wardrobe', async () => {
    vi.useFakeTimers()
    const onSeen = vi.fn()
    const fresh = { ...starter, seen: starter.seen.filter((key) => key !== 'outfit/black-hoodie') }
    await mount(createElement(Harness, { wardrobe: fresh, onSeen }))
    changeCategory('outfit')
    expect(option('Black hoodie').props['data-fresh']).toBe(true)
    await act(async () => { vi.advanceTimersByTime(2100) })
    expect(onSeen).toHaveBeenCalledWith(['outfit/black-hoodie'])
    vi.useRealTimers()
    act(() => renderer.unmount())
    await mount(createElement(Harness, { wardrobe: null }))
    changeCategory('headwear')
    expect(options().every((node) => node.props['data-locked'] === undefined)).toBe(true)
    expect(renderer.root.findAllByProps({ type: 'checkbox' })).toHaveLength(0)
  })

  it('wears an opened item on the current look and swaps a card in without touching the backdrop', () => {
    const base = { ...KUN_AVATAR_DEFAULT_PARTS, bg: 'scene:cafe', glasses: 'square' as const }
    const drop = { id: 'd', kind: 'item' as const, rarity: 'legendary' as const, item: { category: 'headwear' as const, id: 'astronaut-helmet' },
      duplicate: false, feathers: 0, roomId: 'r', runId: 'run', createdAt: 'now' }
    expect(wearWardrobeDrop(base, drop)).toEqual({ color: 'sky', face: 'normal', headwear: 'astronaut-helmet', bg: 'scene:cafe' })
    const card = { ...drop, kind: 'card' as const, item: undefined, cardId: 'magician' }
    expect(wearWardrobeDrop(base, card)).toEqual({ color: 'periwinkle', face: 'normal', headwear: 'wizard-hat', outfit: 'wizard-cape', bg: 'scene:cafe' })
  })
})

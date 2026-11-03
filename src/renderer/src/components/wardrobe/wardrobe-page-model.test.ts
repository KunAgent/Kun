import { grantKunWardrobeItems } from '../../../../../kun/src/test-support/wardrobe-simulator'
import { describe, expect, it } from 'vitest'
import { KUN_AVATAR_PRESETS, KUN_AVATAR_RARITIES, createKunWardrobe } from '@shared/rooms-api'
import { toggleWardrobeItem, wardrobeCategoryCounts, wardrobeRoleCards, wardrobeTiles, wardrobeUnseen } from './wardrobe-page-model'

const wardrobe = grantKunWardrobeItems(createKunWardrobe(1), ['glasses/square', 'headwear/pilot-cap', 'outfit/black-hoodie'])
const rank = (rarity: string) => KUN_AVATAR_RARITIES.indexOf(rarity as never)

describe('wardrobe page model', () => {
  it('lists owned items first, rarest first, and keeps anonymous slots after them', () => {
    const tiles = wardrobeTiles(wardrobe, false, 'all', false)
    const owned = tiles.filter((tile) => tile.owned)
    expect(owned.map((tile) => tile.key)).toEqual(['headwear/pilot-cap', 'glasses/square', 'outfit/black-hoodie'])
    expect(tiles.slice(0, owned.length).every((tile) => tile.owned)).toBe(true)
    expect(owned.every((tile, index) => index === 0 || rank(owned[index - 1]!.rarity) >= rank(tile.rarity))).toBe(true)
    const unknown = tiles.filter((tile) => !tile.owned)
    expect(unknown).toHaveLength(54)
    expect(unknown.every((tile, index) => index === 0 || unknown[index - 1]!.order < tile.order)).toBe(true)
    for (const slot of unknown) {
      expect(Object.keys(slot).sort()).toEqual(['category', 'key', 'order', 'owned'])
      expect(slot.key).toMatch(/^unknown\/(headwear|glasses|outfit|prop)\/\d+$/)
    }
    expect(wardrobeTiles(wardrobe, false, 'glasses', true).map((tile) => tile.key)).toEqual(['glasses/square'])
    expect(wardrobeCategoryCounts(wardrobe, false, 'headwear')).toEqual({ owned: 1, total: 19 })
    expect(wardrobeTiles(wardrobe, true, 'all', true)).toHaveLength(57)
  })

  it('puts lit role cards first and finds the ones missing a single item', () => {
    const lit = { ...wardrobe, roles: ['coder'] }
    const cards = wardrobeRoleCards(lit, false)
    expect(cards).toHaveLength(KUN_AVATAR_PRESETS.length)
    expect(cards[0]!.preset.id).toBe('coder')
    const near = wardrobeRoleCards(lit, false, 'near')
    expect(near.length).toBeGreaterThan(0)
    expect(near.every((card) => !card.lit && card.total - card.have === 1)).toBe(true)
    expect(wardrobeRoleCards(lit, false, 'lit').map((card) => card.preset.id)).toEqual(['coder'])
  })

  it('represents missing positions identically regardless of which equipment is owned', () => {
    const first = { ...createKunWardrobe(1), items: { 'headwear/headset': 1 } }
    const second = { ...createKunWardrobe(1), items: { 'headwear/pilot-cap': 1 } }
    const slots = (value: typeof first | typeof second) => wardrobeTiles(value, false, 'headwear', false).filter((tile) => !tile.owned)
    expect(slots(first)).toEqual(slots(second))
  })

  it('takes off what is worn and drops glasses under the space helmet', () => {
    const parts = { color: 'sky', face: 'normal', bg: '#eef6ff', glasses: 'round' } as const
    expect(toggleWardrobeItem({ ...parts }, 'glasses', 'round', true).parts.glasses).toBeUndefined()
    const helmet = toggleWardrobeItem({ ...parts }, 'headwear', 'astronaut-helmet', false)
    expect(helmet.parts.headwear).toBe('astronaut-helmet')
    expect(helmet.parts.glasses).toBeUndefined()
    expect(helmet.removed).toContain('glasses')
  })

  it('names unseen items and lit cards by the keys the wardrobe marks seen', () => {
    const seenOne = { ...wardrobe, seen: ['glasses/square'], roles: ['coder'] }
    expect(wardrobeUnseen(seenOne, 'items').sort()).toEqual(['headwear/pilot-cap', 'outfit/black-hoodie'])
    expect(wardrobeUnseen(seenOne, 'cards')).toEqual(['card/coder'])
  })
})

import { KUN_WARDROBE_RULES, grantKunWardrobeItems, rollKunWardrobeDrop } from '../test-support/wardrobe-simulator.js'
import {seedWardrobeBottles} from '../test-support/wardrobe-seed.js'
import { describe, expect, it } from 'vitest'
import { createKunWardrobe, kunWardrobeItems, type KunWardrobe, type KunWardrobeDrop } from './kun-wardrobe.js'
import { kunWardrobeShelf, openKunWardrobeDrops, stashKunWardrobeDrops } from '../test-support/wardrobe-open-simulator.js'

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 9, 10, minutes))
const bottle = (id: string, patch: Partial<KunWardrobeDrop> = {}): KunWardrobeDrop => ({ id, kind: 'item', rarity: 'common',
  item: { category: 'prop', id: 'leaf' }, duplicate: false, feathers: 0, runId: id, source: 'code', createdAt: at(Number(id.replace(/\D/g, '')) || 0).toISOString(), ...patch })
const commons = kunWardrobeItems().filter((item) => item.rarity === 'common')
const withShelf = (drops: KunWardrobeDrop[]): KunWardrobe => ({ ...createKunWardrobe(5), pending: drops })

describe('opening bottles from the shelf', () => {
  it('opens ten in order, newest first in the log, and keeps the shelf oldest first', () => {
    const drops = commons.slice(0, 9).map((item, index) => bottle('b' + (index + 1), { item: { category: item.category, id: item.id } }))
      .concat([bottle('b10', { rarity: 'epic', item: { category: 'headwear', id: 'detective-hat' } })])
    const wardrobe = withShelf([...drops].reverse())
    expect(kunWardrobeShelf(wardrobe).map((drop) => drop.id)).toEqual(drops.map((drop) => drop.id))
    const result = openKunWardrobeDrops(wardrobe, drops.map((drop) => drop.id), at(30))
    expect(result.drops.map((drop) => drop.id)).toEqual(drops.map((drop) => drop.id))
    expect(result.guaranteed).toBe(false)
    expect(result.wardrobe.pending).toEqual([])
    expect(result.wardrobe.history[0]!.id).toBe('b10')
    expect(result.granted).toHaveLength(10)
    expect(() => openKunWardrobeDrops(result.wardrobe, ['b1'])).toThrow('not found')
    expect(() => openKunWardrobeDrops(withShelf(Array.from({ length: 11 }, (_, i) => bottle('x' + i))), Array.from({ length: 11 }, (_, i) => 'x' + i))).toThrow('1 to 10')
  })

  it('raises the last of an all-common ten-pull to a rare item the user does not own', () => {
    const drops = commons.slice(0, 10).map((item, index) => bottle('c' + (index + 1), { item: { category: item.category, id: item.id } }))
    const result = openKunWardrobeDrops(withShelf(drops), drops.map((drop) => drop.id))
    expect(result.guaranteed).toBe(true)
    const last = result.drops[9]!
    expect(last).toMatchObject({ kind: 'item', rarity: 'rare', upgraded: true, duplicate: false })
    expect(result.wardrobe.items[`${last.item!.category}/${last.item!.id}`]).toBe(1)
    expect(result.wardrobe.rngState).not.toBe(createKunWardrobe(5).rngState)
    // Fewer than ten never triggers the guarantee.
    expect(openKunWardrobeDrops(withShelf(drops), drops.slice(0, 9).map((drop) => drop.id)).guaranteed).toBe(false)
  })

  it('judges duplicates at opening: the same item twice pays feathers the second time, and so does a lit card', () => {
    const drops = [bottle('d1', { rarity: 'rare', item: { category: 'headwear', id: 'beret' } }),
      bottle('d2', { rarity: 'rare', item: { category: 'headwear', id: 'beret' } }),
      bottle('d3', { kind: 'card', item: undefined, cardId: 'coder', rarity: 'common' })]
    const owned = grantKunWardrobeItems(withShelf(drops), ['glasses/square', 'outfit/black-hoodie'])
    expect(owned.roles).toContain('coder')
    const result = openKunWardrobeDrops(owned, ['d1', 'd2', 'd3'])
    expect(result.drops.map((drop) => [drop.duplicate, drop.feathers])).toEqual([[false, 0], [true, 15], [true, 5]])
    expect(result.feathers).toBe(20)
    expect(result.wardrobe.feathers).toBe(20)
    expect(result.wardrobe.items['headwear/beret']).toBe(2)
  })

  it('stashes bottles once, and a full shelf stops counting turns', () => {
    const wardrobe = withShelf([bottle('s1'), bottle('s2')])
    const stashed = stashKunWardrobeDrops(wardrobe, ['s1'], at(5))
    expect(stashed.pending.map((drop) => drop.stashedAt)).toEqual([at(5).toISOString(), undefined])
    expect(stashKunWardrobeDrops(stashed, ['s1'], at(9))).toBe(stashed)
    const full = { ...withShelf(Array.from({ length: KUN_WARDROBE_RULES.shelfLimit }, (_, i) => bottle('f' + i))), totalDrops: 99 }
    expect(rollKunWardrobeDrop(full, { runId: 'r', now: at(40) })).toMatchObject({ counted: false, drop: null })
  })

  it('seeds a debug shelf without spending the day', () => {
    const seeded = seedWardrobeBottles(createKunWardrobe(3), 12, at(0))
    expect(seeded.pending).toHaveLength(12)
    expect(seeded.pending.every((drop) => drop.stashedAt)).toBe(true)
    expect(seeded.daily.drops).toBe(0)
    expect(rollKunWardrobeDrop(seeded, { runId: 'first-today', now: at(10) }).drop).not.toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import {
  KUN_WARDROBE_RULES, createKunWardrobe, exchangeKunWardrobeItem, grantKunWardrobeItems, kunWardrobeItems,
  kunWardrobeLitCards, kunWardrobeMissingParts, kunWardrobeProgress, openKunWardrobeDrop, rollKunWardrobeDrop,
  type KunWardrobe
} from './kun-wardrobe.js'
import { KUN_AVATAR_PRESETS } from './kun-avatar-presets.js'

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 9, 10, minutes))
const roll = (wardrobe: KunWardrobe, index: number, now = at(index * 2)) =>
  rollKunWardrobeDrop(wardrobe, { roomId: 'room', runId: 'run-' + index, now })

describe('wardrobe drop rules', () => {
  it('always drops a common or rare item on the first counted turn', () => {
    for (let seed = 0; seed < 50; seed++) {
      const result = roll(createKunWardrobe(seed), 0)
      expect(result.counted).toBe(true)
      expect(result.drop?.kind).toBe('item')
      expect(['common', 'rare']).toContain(result.drop?.rarity)
      expect(result.wardrobe.pending).toHaveLength(1)
      expect(result.wardrobe.totalDrops).toBe(1)
    }
  })

  it('lands near the configured drop rate and never waits past the pity counter', () => {
    let wardrobe: KunWardrobe = { ...createKunWardrobe(7), totalDrops: 1, firstDropAt: at(0).toISOString() }
    let drops = 0, longest = 0, dry = 0
    const turns = 20_000
    for (let index = 1; index <= turns; index++) {
      // Keep every turn countable: fresh day, open interval.
      const base = { ...wardrobe, daily: { date: '2000-01-01', drops: 0 }, pity: { ...wardrobe.pity, lastCountedAt: null }, pending: [] }
      const result = roll(base, index)
      if (result.drop) { drops++; longest = Math.max(longest, dry); dry = 0 } else dry++
      wardrobe = result.wardrobe
    }
    // Pity lifts the plain 12% a little; the observed rate stays within a few points of it.
    expect(drops / turns).toBeGreaterThan(0.12)
    expect(drops / turns).toBeLessThan(0.17)
    expect(longest).toBeLessThanOrEqual(KUN_WARDROBE_RULES.pity - 1)
  })

  it('skips turns inside the minimum interval and after the daily cap, without consuming the counter', () => {
    let wardrobe = roll(createKunWardrobe(1), 0).wardrobe
    const quick = rollKunWardrobeDrop(wardrobe, { roomId: 'room', runId: 'run-quick', now: new Date(at(0).getTime() + 30_000) })
    expect(quick.counted).toBe(false)
    expect(quick.wardrobe).toBe(wardrobe)
    wardrobe = { ...wardrobe, daily: { date: wardrobe.daily.date, drops: KUN_WARDROBE_RULES.dailyCap }, pity: { ...wardrobe.pity, sinceDrop: 11 } }
    const capped = roll(wardrobe, 5)
    expect(capped.counted).toBe(false)
    expect(capped.drop).toBeNull()
    expect(capped.wardrobe.pity.sinceDrop).toBe(11)
    // A new local day resets the cap.
    const tomorrow = rollKunWardrobeDrop(wardrobe, { roomId: 'room', runId: 'run-next-day', now: new Date(Date.UTC(2026, 9, 10, 10)) })
    expect(tomorrow.counted).toBe(true)
    expect(tomorrow.wardrobe.daily).toEqual({ date: '2026-10-10', drops: 1 })
  })

  it('forces an epic or better once the epic pity runs out, and only deals unlit cards', () => {
    const base = { ...createKunWardrobe(3), totalDrops: 1, firstDropAt: at(0).toISOString(), pity: { sinceDrop: 11, sinceEpic: 9, lastCountedAt: null } }
    const result = roll(base, 1)
    expect(result.drop).not.toBeNull()
    if (result.drop!.kind === 'item') expect(['epic', 'legendary']).toContain(result.drop!.rarity)
    const everything = kunWardrobeItems().map((item) => item.key)
    const complete = grantKunWardrobeItems({ ...createKunWardrobe(9), totalDrops: 1, firstDropAt: at(0).toISOString() }, everything)
    expect(kunWardrobeLitCards(complete)).toHaveLength(KUN_AVATAR_PRESETS.length)
    for (let index = 1; index < 300; index++) {
      const drop = roll({ ...complete, pity: { sinceDrop: 11, sinceEpic: 0, lastCountedAt: null }, rngState: index * 7919 }, index).drop!
      expect(drop.kind).toBe('item')
      expect(drop.duplicate).toBe(true)
      expect(drop.feathers).toBe(KUN_WARDROBE_RULES.duplicateFeathers[drop.rarity])
    }
  })

  it('opens bottles into owned items, feathers for duplicates, and lit cards with their missing pieces', () => {
    const first = roll(createKunWardrobe(11), 0)
    const opened = openKunWardrobeDrop(first.wardrobe, first.drop!.id, at(1))
    const key = `${first.drop!.item!.category}/${first.drop!.item!.id}`
    expect(opened.wardrobe.items[key]).toBe(1)
    expect(opened.wardrobe.pending).toHaveLength(0)
    expect(opened.granted).toEqual([key])
    expect(opened.wardrobe.seen).not.toContain(key)
    expect(opened.drop.openedAt).toBe(at(1).toISOString())
    const duplicate = { ...opened.wardrobe, pending: [{ ...first.drop!, id: 'drop-dup', duplicate: true, feathers: 15 }] }
    const paid = openKunWardrobeDrop(duplicate, 'drop-dup')
    expect(paid.wardrobe.items[key]).toBe(2)
    expect(paid.wardrobe.feathers).toBe(15)
    const card = { ...paid.wardrobe, pending: [{ ...first.drop!, id: 'drop-card', kind: 'card' as const, item: undefined, cardId: 'astronaut', rarity: 'legendary' as const }] }
    const lit = openKunWardrobeDrop(card, 'drop-card')
    expect(lit.wardrobe.roles).toContain('astronaut')
    expect(kunWardrobeMissingParts(lit.wardrobe, KUN_AVATAR_PRESETS.find((preset) => preset.id === 'astronaut')!.parts)).toEqual([])
    expect(lit.granted).toEqual(expect.arrayContaining(['headwear/astronaut-helmet', 'outfit/spacesuit']))
    expect(() => openKunWardrobeDrop(lit.wardrobe, 'drop-card')).toThrow('not found')
  })

  it('grants never add duplicates, light cards automatically, and exchanges need feathers', () => {
    const coder = KUN_AVATAR_PRESETS.find((preset) => preset.id === 'coder')!
    const granted = grantKunWardrobeItems(createKunWardrobe(0), ['glasses/square', 'outfit/black-hoodie', 'glasses/square', 'prop/unknown'])
    expect(granted.items).toEqual({ 'glasses/square': 1, 'outfit/black-hoodie': 1 })
    expect(granted.roles).toEqual(['coder'])
    expect(kunWardrobeMissingParts(granted, coder.parts)).toEqual([])
    expect(kunWardrobeProgress(granted)).toMatchObject({ ownedItems: 2, totalItems: 57, litCards: 1, totalCards: 30, pending: 0 })
    expect(() => exchangeKunWardrobeItem(granted, 'headwear/beret')).toThrow('feathers')
    const rich = exchangeKunWardrobeItem({ ...granted, feathers: 100 }, 'headwear/beret')
    expect(rich.feathers).toBe(100 - KUN_WARDROBE_RULES.exchangeFeathers.rare)
    expect(rich.items['headwear/beret']).toBe(1)
    expect(() => exchangeKunWardrobeItem(rich, 'headwear/beret')).toThrow('already owned')
  })
})

import {
  KUN_AVATAR_CATALOG, KUN_AVATAR_RARITIES, kunWardrobeItems,
  type KunAvatarAccessoryCategory, type KunWardrobe, type KunWardrobeItem
} from '@shared/rooms-api'

type Category = KunAvatarAccessoryCategory | 'all'
export type WardrobeTile = KunWardrobeItem & {
  order: number; copies: number; owned: true; fresh: boolean
  name: { zh: string; en: string }; flavor: { zh: string; en: string }
}
export type WardrobeUnknownSlot = { key: string; category: KunAvatarAccessoryCategory; owned: false; order: number }

export function wardrobeOwns(wardrobe: KunWardrobe | null, unlockAll: boolean, key: string): number {
  if (unlockAll) return Math.max(1, wardrobe?.items[key] ?? 0)
  return wardrobe?.items[key] ?? 0
}

/** Unknown slots carry only a position and category, never a catalog item or rarity. */
export function wardrobeTiles(wardrobe: KunWardrobe | null, unlockAll: boolean, category: Category, ownedOnly: boolean): Array<WardrobeTile | WardrobeUnknownSlot> {
  const items = kunWardrobeItems().filter((item) => category === 'all' || item.category === category)
  const owned: WardrobeTile[] = []
  const missing = new Map<KunAvatarAccessoryCategory, number>()
  items.forEach((item, order) => {
    const copies = wardrobeOwns(wardrobe, unlockAll, item.key)
    if (copies <= 0) { missing.set(item.category, (missing.get(item.category) ?? 0) + 1); return }
    const part = KUN_AVATAR_CATALOG[item.category].find((entry) => entry.id === item.id)!
    owned.push({ ...item, order, copies, owned: true, fresh: !unlockAll && !(wardrobe?.seen ?? []).includes(item.key),
      name: part.label, flavor: part.flavor })
  })
  owned.sort((a, b) => KUN_AVATAR_RARITIES.indexOf(b.rarity) - KUN_AVATAR_RARITIES.indexOf(a.rarity) || a.order - b.order)
  if (ownedOnly) return owned
  const slots: WardrobeUnknownSlot[] = []
  for (const [slot, count] of missing) {
    for (let index = 0; index < count; index++) slots.push({ key: `unknown/${slot}/${index}`, category: slot, owned: false, order: slots.length })
  }
  return [...owned, ...slots]
}

export function wardrobeCategoryCounts(wardrobe: KunWardrobe | null, unlockAll: boolean, category: Category) {
  const items = kunWardrobeItems().filter((item) => category === 'all' || item.category === category)
  return { owned: items.filter((item) => wardrobeOwns(wardrobe, unlockAll, item.key) > 0).length, total: items.length }
}

import {
  KUN_AVATAR_CATALOG, KUN_AVATAR_PRESETS, KUN_AVATAR_RARITIES, kunAvatarRarity, kunWardrobeItems, kunWardrobeMissingParts,
  kunWardrobePartKeys, updateKunAvatarPart,
  type KunAvatarAccessoryCategory, type KunAvatarParts, type KunAvatarRarity, type KunComposedAvatarReference, type KunWardrobe, type KunWardrobeItem, type RoomAvatarReference
} from '@shared/rooms-api'
import { editableKunAvatarParts } from '../rooms/RoomAvatarComposer'

export type WardrobeAvatar = RoomAvatarReference | null
export type WardrobeCategory = KunAvatarAccessoryCategory | 'all'
export type WardrobeCardFilter = 'all' | 'lit' | 'near'
export type WardrobeSelection = { kind: 'item'; key: string } | { kind: 'card'; id: string } | null

export const WARDROBE_SLOTS: readonly KunAvatarAccessoryCategory[] = ['headwear', 'glasses', 'outfit', 'prop']
const rank = (rarity: KunAvatarRarity) => KUN_AVATAR_RARITIES.indexOf(rarity)

/** The look on stage: composed and builtin avatars are dressed parts; a photo or the default greeting is not. */
export function wardrobeLook(avatar: WardrobeAvatar): { parts: KunAvatarParts; dressed: boolean } {
  return { parts: editableKunAvatarParts(avatar, 'user', true), dressed: avatar?.kind === 'composed' || avatar?.kind === 'builtin' }
}

export function composedAvatar(parts: KunAvatarParts): KunComposedAvatarReference {
  return { kind: 'composed', version: 1, parts }
}

/** Wearing toggles: clicking what is already worn takes it off. Conflicting slots come off too. */
export function toggleWardrobeItem(parts: KunAvatarParts, category: KunAvatarAccessoryCategory, id: string, worn: boolean) {
  return updateKunAvatarPart(parts, category, (worn ? undefined : id) as never)
}

export function wardrobeOwns(wardrobe: KunWardrobe | null, unlockAll: boolean, key: string): number {
  if (unlockAll) return Math.max(1, wardrobe?.items[key] ?? 0)
  return wardrobe?.items[key] ?? 0
}

export type WardrobeTile = KunWardrobeItem & { order: number; copies: number; owned: boolean; fresh: boolean; name: { zh: string; en: string }; flavor: { zh: string; en: string } }

/** Owned first (rarest first), then the unknown ones in catalog order, so the secrets sit at the end. */
export function wardrobeTiles(wardrobe: KunWardrobe | null, unlockAll: boolean, category: WardrobeCategory, ownedOnly: boolean): WardrobeTile[] {
  return kunWardrobeItems()
    .filter((item) => category === 'all' || item.category === category)
    .map((item, order) => {
      const part = KUN_AVATAR_CATALOG[item.category].find((entry) => entry.id === item.id)!
      const copies = wardrobeOwns(wardrobe, unlockAll, item.key)
      return { ...item, order, copies, owned: copies > 0, fresh: copies > 0 && !unlockAll && !(wardrobe?.seen ?? []).includes(item.key),
        name: part.label, flavor: part.flavor }
    })
    .filter((tile) => !ownedOnly || tile.owned)
    .sort((a, b) => Number(b.owned) - Number(a.owned) || (a.owned ? rank(b.rarity) - rank(a.rarity) : 0) || a.order - b.order)
}

export function wardrobeCategoryCounts(wardrobe: KunWardrobe | null, unlockAll: boolean, category: WardrobeCategory) {
  const items = kunWardrobeItems().filter((item) => category === 'all' || item.category === category)
  return { owned: items.filter((item) => wardrobeOwns(wardrobe, unlockAll, item.key) > 0).length, total: items.length }
}

export type WardrobeRoleCard = { preset: (typeof KUN_AVATAR_PRESETS)[number]; lit: boolean; have: number; total: number; rarity: KunAvatarRarity; number: number }

/** Lit cards first, then the closest to complete. */
export function wardrobeRoleCards(wardrobe: KunWardrobe | null, unlockAll: boolean, filter: WardrobeCardFilter = 'all'): WardrobeRoleCard[] {
  return KUN_AVATAR_PRESETS.map((preset, index) => {
    const total = kunWardrobePartKeys(preset.parts).length
    const have = unlockAll || !wardrobe ? total : total - kunWardrobeMissingParts(wardrobe, preset.parts).length
    return { preset, lit: unlockAll || Boolean(wardrobe?.roles.includes(preset.id)), have, total, rarity: kunAvatarRarity(preset.parts), number: index + 1 }
  })
    .filter((card) => filter === 'all' || (filter === 'lit' ? card.lit : !card.lit && card.total - card.have === 1))
    .sort((a, b) => Number(b.lit) - Number(a.lit) || b.have / b.total - a.have / a.total || a.number - b.number)
}

/** Unseen owned items and lit cards, as the keys the wardrobe marks seen. */
export function wardrobeUnseen(wardrobe: KunWardrobe | null, tab: 'items' | 'cards'): string[] {
  if (!wardrobe) return []
  const keys = tab === 'items' ? Object.keys(wardrobe.items).filter((key) => (wardrobe.items[key] ?? 0) > 0)
    : wardrobe.roles.map((role) => `card/${role}`)
  return keys.filter((key) => !wardrobe.seen.includes(key))
}

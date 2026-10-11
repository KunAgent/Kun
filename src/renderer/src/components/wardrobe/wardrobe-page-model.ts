import {
  KUN_AVATAR_PRESETS, kunAvatarRarity, kunWardrobeMissingParts,
  kunWardrobePartKeys, updateKunAvatarPart,
  type KunAvatarAccessoryCategory, type KunAvatarParts, type KunAvatarRarity, type KunComposedAvatarReference, type KunWardrobe, type RoomAvatarReference
} from '@shared/rooms-api'
import { editableKunAvatarParts } from '../rooms/RoomAvatarComposer'

export type WardrobeAvatar = RoomAvatarReference | null
export type WardrobeCategory = KunAvatarAccessoryCategory | 'all'
export type WardrobeCardFilter = 'all' | 'lit' | 'near'
export type WardrobeSelection = { kind: 'item'; key: string } | { kind: 'unknown'; key: string } | { kind: 'card'; id: string } | null

export const WARDROBE_SLOTS: readonly KunAvatarAccessoryCategory[] = ['headwear', 'glasses', 'outfit', 'prop']

/**
 * The look on stage: composed and builtin avatars are dressed parts; a photo or the default greeting is not.
 * `isDefault` marks the restored little Kun, whose body is the sky-blue, default-expression look the free
 * pickers should show as chosen even though nothing is worn.
 */
export function wardrobeLook(avatar: WardrobeAvatar): { parts: KunAvatarParts; dressed: boolean; isDefault: boolean } {
  return {
    parts: editableKunAvatarParts(avatar, 'user', true),
    dressed: avatar?.kind === 'composed' || avatar?.kind === 'builtin',
    isDefault: !avatar
  }
}

export function composedAvatar(parts: KunAvatarParts): KunComposedAvatarReference {
  return { kind: 'composed', version: 1, parts }
}

/** Wearing toggles: clicking what is already worn takes it off. Conflicting slots come off too. */
export function toggleWardrobeItem(parts: KunAvatarParts, category: KunAvatarAccessoryCategory, id: string, worn: boolean) {
  return updateKunAvatarPart(parts, category, (worn ? undefined : id) as never)
}

export { wardrobeOwns, wardrobeTiles, wardrobeCategoryCounts } from '../rooms/room-wardrobe-items'
export type { WardrobeTile } from '../rooms/room-wardrobe-items'

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

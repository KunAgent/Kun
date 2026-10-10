import { KUN_WARDROBE_RULES,kunWardrobeRandom,relightKunWardrobe } from './wardrobe-simulator.js'
/**
 * Opening bottles from the shelf, one at a time or as a ten-pull. A bottle's
 * content was fixed when it dropped; only two things are decided at opening:
 * whether it is a duplicate by now, and the ten-pull guarantee.
 */
import { KUN_AVATAR_PRESETS } from '../contracts/kun-avatar-presets.js'
import {
  KUN_WARDROBE_HISTORY_LIMIT, kunWardrobeItemKey, kunWardrobeItems, kunWardrobeMissingParts,
  type KunWardrobe, type KunWardrobeDrop, type KunWardrobeItemKey
} from '../contracts/kun-wardrobe.js'

export type KunWardrobeOpenResult = {
  wardrobe: KunWardrobe
  /** In the order they were opened. */
  drops: KunWardrobeDrop[]
  granted: KunWardrobeItemKey[]
  /** Feathers gained from duplicates in this opening. */
  feathers: number
  /** The ten-pull guarantee raised the last bottle to rare. */
  guaranteed: boolean
}

/** Bottles waiting on the shelf, oldest first. */
export function kunWardrobeShelf(wardrobe: KunWardrobe): KunWardrobeDrop[] {
  return [...wardrobe.pending].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
}

/** Ten opened together never come out all common: the last becomes a rare item, preferring one not owned yet. */
function applyTenPullGuarantee(wardrobe: KunWardrobe, picked: KunWardrobeDrop[]) {
  if (picked.length !== KUN_WARDROBE_RULES.tenPull || picked.some((drop) => drop.rarity !== 'common')) {
    return { picked, rngState: wardrobe.rngState, guaranteed: false }
  }
  const random = kunWardrobeRandom(wardrobe.rngState)
  const inBatch = new Set(picked.flatMap((drop) => drop.item ? [kunWardrobeItemKey(drop.item.category, drop.item.id)] : []))
  const rares = kunWardrobeItems().filter((item) => item.rarity === 'rare')
  const fresh = rares.filter((item) => !(wardrobe.items[item.key] ?? 0) && !inBatch.has(item.key))
  const pool = fresh.length ? fresh : rares
  const item = pool[Math.min(pool.length - 1, Math.floor(random.next() * pool.length))]!
  const last = picked[picked.length - 1]!
  const { cardId: _cardId, ...rest } = last
  const upgraded: KunWardrobeDrop = { ...rest, kind: 'item', rarity: 'rare', item: { category: item.category, id: item.id }, upgraded: true }
  return { picked: [...picked.slice(0, -1), upgraded], rngState: random.state(), guaranteed: true }
}

export function openKunWardrobeDrops(wardrobe: KunWardrobe, dropIds: readonly string[], now = new Date()): KunWardrobeOpenResult {
  const ids = [...new Set(dropIds)]
  if (!ids.length || ids.length > KUN_WARDROBE_RULES.tenPull) throw new Error('open 1 to 10 bottles at a time')
  const chosen = ids.map((id) => {
    const drop = wardrobe.pending.find((entry) => entry.id === id)
    if (!drop) throw new Error('wardrobe drop not found')
    return drop
  })
  const { picked, rngState, guaranteed } = applyTenPullGuarantee(wardrobe, chosen)
  const items = { ...wardrobe.items }
  const seen = new Set(wardrobe.seen)
  const roles = [...wardrobe.roles]
  const granted: KunWardrobeItemKey[] = []
  const openedAt = now.toISOString()
  let gained = 0
  const pay = (drop: KunWardrobeDrop) => {
    const value = KUN_WARDROBE_RULES.duplicateFeathers[drop.rarity]
    gained += value
    return { ...drop, duplicate: true, feathers: value, openedAt }
  }
  const opened = picked.map((drop): KunWardrobeDrop => {
    if (drop.kind === 'item' && drop.item) {
      const key = kunWardrobeItemKey(drop.item.category, drop.item.id)
      // Duplicates are judged now: two bottles may hold the same item, or it was traded for meanwhile.
      const owned = (items[key] ?? 0) > 0
      items[key] = (items[key] ?? 0) + 1
      if (owned) return pay(drop)
      granted.push(key); seen.delete(key)
      return { ...drop, duplicate: false, feathers: 0, openedAt }
    }
    if (drop.kind === 'card' && drop.cardId) {
      if (roles.includes(drop.cardId)) return pay(drop)
      const preset = KUN_AVATAR_PRESETS.find((entry) => entry.id === drop.cardId)
      for (const key of preset ? kunWardrobeMissingParts({ ...wardrobe, items }, preset.parts) : []) {
        items[key] = 1; granted.push(key); seen.delete(key)
      }
      roles.push(drop.cardId)
      seen.delete('card/' + drop.cardId)
      return { ...drop, duplicate: false, feathers: 0, openedAt }
    }
    return { ...drop, openedAt }
  })
  const openedIds = new Set(ids)
  const history = [...opened].reverse().concat((wardrobe.history ?? []).filter((entry) => !openedIds.has(entry.id)))
    .slice(0, KUN_WARDROBE_HISTORY_LIMIT)
  return { drops: opened, granted, feathers: gained, guaranteed, wardrobe: relightKunWardrobe({ ...wardrobe, items, roles,
    feathers: wardrobe.feathers + gained, seen: [...seen], history, rngState,
    pending: wardrobe.pending.filter((entry) => !openedIds.has(entry.id)) }) }
}

/** Opening a single bottle; kept for callers that open one at a time. */
export function openKunWardrobeDrop(wardrobe: KunWardrobe, dropId: string, now = new Date()):
  { wardrobe: KunWardrobe; drop: KunWardrobeDrop; granted: KunWardrobeItemKey[] } {
  const result = openKunWardrobeDrops(wardrobe, [dropId], now)
  return { wardrobe: result.wardrobe, drop: result.drops[0]!, granted: result.granted }
}

/** Puts bottles on the shelf from the chat card, so the card stops asking. */
export function stashKunWardrobeDrops(wardrobe: KunWardrobe, dropIds: readonly string[], now = new Date()): KunWardrobe {
  const ids = new Set(dropIds)
  let changed = false
  const pending = wardrobe.pending.map((drop) => {
    if (!ids.has(drop.id) || drop.stashedAt) return drop
    changed = true
    return { ...drop, stashedAt: now.toISOString() }
  })
  return changed ? { ...wardrobe, pending } : wardrobe
}

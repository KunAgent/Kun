/** Test fixture only. Never imported by production runtime or renderer. */
import { KUN_AVATAR_RARITIES, kunAvatarRarity, type KunAvatarRarity } from '../contracts/kun-avatar-catalog.js'
import { KUN_AVATAR_PRESETS } from '../contracts/kun-avatar-presets.js'
import { kunWardrobeLocalDate,kunWardrobeItems,kunWardrobeLitCards,kunWardrobeItemRarity,type KunWardrobe,type KunWardrobeDrop,type KunWardrobeItemKey } from '../contracts/kun-wardrobe.js'
export const KUN_WARDROBE_RULES = {
  /** Chance that a counted Agent turn drops a bottle. */
  dropRate: 0.12,
  /** Counted turns without a drop before the next one must drop. */
  pity: 12,
  /** Bottles per local day; the pity counter pauses once it is reached. */
  dailyCap: 5,
  /** Chance that a bottle holds a whole role card instead of one item. */
  cardRate: 0.08,
  /** Bottles without an epic or legendary before one is forced. */
  epicPity: 10,
  /** Turns closer together than this are not counted. */
  minIntervalMs: 60_000,
  rarityWeights: { common: 55, rare: 30, epic: 12, legendary: 3 } as Record<KunAvatarRarity, number>,
  /** Items the user does not own yet weigh this much more than duplicates. */
  unownedWeight: 3,
  duplicateFeathers: { common: 5, rare: 15, epic: 40, legendary: 100 } as Record<KunAvatarRarity, number>,
  /** Unopened bottles the shelf holds; a full shelf pauses counting. */
  shelfLimit: 99,
  /** Bottles opened together in one ten-pull. */
  tenPull: 10,
  exchangeFeathers: { common: 30, rare: 80, epic: 200, legendary: 500 } as Record<KunAvatarRarity, number>
} as const

export function relightKunWardrobe(wardrobe: KunWardrobe): KunWardrobe {
  const lit = kunWardrobeLitCards(wardrobe)
  const roles = [...new Set([...wardrobe.roles, ...lit])]
  return roles.length === wardrobe.roles.length ? wardrobe : { ...wardrobe, roles }
}
/** Grants ensure at least one copy; they never add duplicates. Seen grants carry no "new" mark, nor do the cards they light. */
export function grantKunWardrobeItems(wardrobe: KunWardrobe, keys: Iterable<string>, seen = true): KunWardrobe {
  const items = { ...wardrobe.items }
  const seenKeys = new Set(wardrobe.seen)
  for (const key of keys) {
    if (!kunWardrobeItems().some((item) => item.key === key)) continue
    if (!items[key]) items[key] = 1
    if (seen) seenKeys.add(key)
  }
  const granted = relightKunWardrobe({ ...wardrobe, items, seen: [...seenKeys] })
  if (seen) for (const role of granted.roles) if (!wardrobe.roles.includes(role)) seenKeys.add('card/' + role)
  return { ...granted, seen: [...seenKeys] }
}

/** Mulberry32: tiny, deterministic, and its state survives as one integer. */
export function kunWardrobeRandom(state: number) {
  let a = state >>> 0
  return {
    next(): number {
      a = (a + 0x6d2b79f5) >>> 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
    state: () => a
  }
}

function weighted<T>(choices: Array<{ value: T; weight: number }>, roll: number): T {
  const total = choices.reduce((sum, choice) => sum + choice.weight, 0)
  let cursor = roll * total
  for (const choice of choices) {
    cursor -= choice.weight
    if (cursor < 0) return choice.value
  }
  return choices[choices.length - 1]!.value
}

export type KunWardrobeRollContext = {
  runId: string; now: Date; messageId?: string
  source?: 'room' | 'code'; roomId?: string; threadId?: string; sourceLabel?: string
}
export type KunWardrobeRoll = { wardrobe: KunWardrobe; drop: KunWardrobeDrop | null; counted: boolean }

/**
 * One finished Agent turn. The result is final once persisted: the bottle's
 * content is decided here, never when it is opened.
 */
export function rollKunWardrobeDrop(wardrobe: KunWardrobe, context: KunWardrobeRollContext): KunWardrobeRoll {
  const rules = KUN_WARDROBE_RULES
  const date = kunWardrobeLocalDate(context.now)
  const daily = wardrobe.daily.date === date ? wardrobe.daily : { date, drops: 0 }
  const last = wardrobe.pity.lastCountedAt ? Date.parse(wardrobe.pity.lastCountedAt) : null
  if (last !== null && context.now.getTime() - last < rules.minIntervalMs) return { wardrobe, drop: null, counted: false }
  if (daily.drops >= rules.dailyCap) return { wardrobe: { ...wardrobe, daily }, drop: null, counted: false }
  if (wardrobe.pending.length >= rules.shelfLimit) return { wardrobe: { ...wardrobe, daily }, drop: null, counted: false }
  const random = kunWardrobeRandom(wardrobe.rngState)
  const first = wardrobe.totalDrops === 0
  // The first counted turn of every local day always drops.
  const dailyFirst = daily.drops === 0
  const dropped = first || dailyFirst || wardrobe.pity.sinceDrop + 1 >= rules.pity || random.next() < rules.dropRate
  const counted: KunWardrobe = { ...wardrobe, daily, pity: { ...wardrobe.pity, lastCountedAt: context.now.toISOString(),
    sinceDrop: dropped ? 0 : wardrobe.pity.sinceDrop + 1 } }
  if (!dropped) return { wardrobe: { ...counted, rngState: random.state() }, drop: null, counted: true }
  const label = context.sourceLabel?.trim().slice(0, 120)
  const base = { id: 'drop-' + context.runId, duplicate: false, feathers: 0, runId: context.runId,
    source: context.source ?? (context.threadId && !context.roomId ? 'code' as const : 'room' as const),
    ...(context.roomId ? { roomId: context.roomId } : {}), ...(context.threadId ? { threadId: context.threadId } : {}),
    ...(label ? { sourceLabel: label } : {}),
    ...(context.messageId ? { messageId: context.messageId } : {}), createdAt: context.now.toISOString() }
  const unlit = KUN_AVATAR_PRESETS.filter((preset) => !wardrobe.roles.includes(preset.id))
  let drop: KunWardrobeDrop
  if (!first && unlit.length && random.next() < rules.cardRate) {
    const card = unlit[Math.min(unlit.length - 1, Math.floor(random.next() * unlit.length))]!
    drop = { ...base, kind: 'card', cardId: card.id, rarity: kunAvatarRarity(card.parts) }
  } else {
    const forceEpic = !first && wardrobe.pity.sinceEpic + 1 >= rules.epicPity
    const rarities = KUN_AVATAR_RARITIES.filter((rarity) => first ? rarity === 'common' || rarity === 'rare'
      : forceEpic ? rarity === 'epic' || rarity === 'legendary' : true)
    const rarity = weighted(rarities.map((value) => ({ value, weight: rules.rarityWeights[value] })), random.next())
    const pool = kunWardrobeItems().filter((item) => item.rarity === rarity)
    const item = weighted(pool.map((value) => ({ value, weight: (wardrobe.items[value.key] ?? 0) > 0 ? 1 : rules.unownedWeight })), random.next())
    const duplicate = (wardrobe.items[item.key] ?? 0) > 0
    drop = { ...base, kind: 'item', item: { category: item.category, id: item.id }, rarity, duplicate,
      feathers: duplicate ? rules.duplicateFeathers[rarity] : 0 }
  }
  const epic = drop.rarity === 'epic' || drop.rarity === 'legendary'
  return { counted: true, drop, wardrobe: { ...counted, rngState: random.state(), pending: [...wardrobe.pending, drop],
    daily: { date, drops: daily.drops + 1 }, totalDrops: wardrobe.totalDrops + 1, firstDropAt: wardrobe.firstDropAt ?? drop.createdAt,
    pity: { ...counted.pity, sinceEpic: epic ? 0 : wardrobe.pity.sinceEpic + 1 } } }
}

/** Spend feathers on an item the user does not own yet. */
export function exchangeKunWardrobeItem(wardrobe: KunWardrobe, key: KunWardrobeItemKey): KunWardrobe {
  if (!kunWardrobeItems().some((item) => item.key === key)) throw new Error('wardrobe item unknown')
  if ((wardrobe.items[key] ?? 0) > 0) throw new Error('wardrobe item already owned')
  const price = KUN_WARDROBE_RULES.exchangeFeathers[kunWardrobeItemRarity(key)]
  if (wardrobe.feathers < price) throw new Error('not enough feathers')
  return relightKunWardrobe({ ...wardrobe, feathers: wardrobe.feathers - price, items: { ...wardrobe.items, [key]: 1 },
    seen: wardrobe.seen.filter((entry) => entry !== key) })
}

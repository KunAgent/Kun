/**
 * The user's wardrobe: which avatar items they own, which bottles are waiting
 * to be opened, and the pure drop rules. Shared by the runtime and renderer.
 */
import { z } from 'zod'
import {
  KUN_AVATAR_ACCESSORY_CATEGORIES, KUN_AVATAR_CATALOG, KUN_AVATAR_RARITIES, kunAvatarRarity, normalizeKunAvatarParts,
  type KunAvatarAccessoryCategory, type KunAvatarParts, type KunAvatarRarity
} from './kun-avatar-catalog.js'
import { KUN_AVATAR_PRESETS, type KunAvatarPresetId } from './kun-avatar-presets.js'

export type KunWardrobeItemKey = `${KunAvatarAccessoryCategory}/${string}`
export const kunWardrobeItemKey = (category: KunAvatarAccessoryCategory, id: string): KunWardrobeItemKey => `${category}/${id}`

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

/** Every new wardrobe starts with these, so the editor is never empty. */
export const KUN_WARDROBE_STARTER_PACK: readonly KunWardrobeItemKey[] =
  ['headwear/headset', 'glasses/square', 'outfit/blue-scarf', 'prop/notebook']

const Rarity = z.enum(['common', 'rare', 'epic', 'legendary'])
export const KunWardrobeDropSchema = z.object({
  id: z.string().min(1).max(128),
  kind: z.enum(['item', 'card']),
  rarity: Rarity,
  item: z.object({ category: z.enum(KUN_AVATAR_ACCESSORY_CATEGORIES), id: z.string().min(1).max(64) }).strict().optional(),
  cardId: z.string().min(1).max(64).optional(),
  /** Already owned when it dropped; opening it pays feathers instead. */
  duplicate: z.boolean(),
  feathers: z.number().int().nonnegative(),
  /** Where the turn ran: an Agent conversation (roomId) or a Code task (threadId). */
  source: z.enum(['room', 'code']).optional(),
  roomId: z.string().min(1).max(256).optional(),
  threadId: z.string().min(1).max(256).optional(),
  /** The conversation or task title when it dropped, for the drop log. */
  sourceLabel: z.string().max(120).optional(),
  runId: z.string().min(1).max(256),
  messageId: z.string().min(1).max(256).optional(),
  createdAt: z.string(),
  /** Put on the shelf from the chat card; it no longer asks to be opened there. */
  stashedAt: z.string().optional(),
  /** Raised to rare by the ten-pull guarantee when it was opened. */
  upgraded: z.boolean().optional(),
  openedAt: z.string().optional()
}).strict()
export type KunWardrobeDrop = z.infer<typeof KunWardrobeDropSchema>

export const KunWardrobeSettingsSchema = z.object({
  /** Drops from Agent conversations; on by default. */
  drops: z.boolean().default(true),
  /** Drops from Code tasks as well; on by default, and only while drops are on. */
  code: z.boolean().default(true),
  /** card: a bottle card under the reply; quiet: only the sidebar and wardrobe count. */
  notice: z.enum(['card', 'quiet']).default('card')
}).strict()
export type KunWardrobeSettings = z.infer<typeof KunWardrobeSettingsSchema>
/** Opened bottles kept for the drop log, newest first. */
export const KUN_WARDROBE_HISTORY_LIMIT = 50

export const KunWardrobeSchema = z.object({
  version: z.literal(1),
  /** 'headwear/beret' -> copies owned; duplicates count so the wardrobe can show x3. */
  items: z.record(z.string(), z.number().int().nonnegative()),
  /** Item keys and card ids whose "new" mark the user has looked at. */
  seen: z.array(z.string()),
  /** Lit role cards (preset ids). */
  roles: z.array(z.string()),
  feathers: z.number().int().nonnegative(),
  /** Bottles waiting to be opened; their contents were decided when they dropped. */
  pending: z.array(KunWardrobeDropSchema),
  pity: z.object({
    sinceDrop: z.number().int().nonnegative(),
    sinceEpic: z.number().int().nonnegative(),
    lastCountedAt: z.string().nullable()
  }).strict(),
  daily: z.object({ date: z.string(), drops: z.number().int().nonnegative() }).strict(),
  rngState: z.number().int().nonnegative(),
  totalDrops: z.number().int().nonnegative(),
  firstDropAt: z.string().nullable(),
  settings: KunWardrobeSettingsSchema.default({ drops: true, code: true, notice: 'card' }),
  history: z.array(KunWardrobeDropSchema).max(KUN_WARDROBE_HISTORY_LIMIT).default([])
}).strict()
export type KunWardrobe = z.infer<typeof KunWardrobeSchema>
export type KunWardrobeDetail = { wardrobe: KunWardrobe; revision: number | null }

export type KunWardrobeItem = { key: KunWardrobeItemKey; category: KunAvatarAccessoryCategory; id: string; rarity: KunAvatarRarity }
export function kunWardrobeItems(): KunWardrobeItem[] {
  return KUN_AVATAR_ACCESSORY_CATEGORIES.flatMap((category) =>
    KUN_AVATAR_CATALOG[category].map((part) => ({ key: kunWardrobeItemKey(category, part.id), category, id: part.id, rarity: part.rarity })))
}
export function kunWardrobeItemRarity(key: string): KunAvatarRarity {
  const [category, id] = key.split('/') as [KunAvatarAccessoryCategory, string]
  return KUN_AVATAR_CATALOG[category]?.find((part) => part.id === id)?.rarity ?? 'common'
}

export function createKunWardrobe(seed: number, now = new Date()): KunWardrobe {
  return KunWardrobeSchema.parse({ version: 1, items: {}, seen: [], roles: [], feathers: 0, pending: [],
    pity: { sinceDrop: 0, sinceEpic: 0, lastCountedAt: null }, daily: { date: kunWardrobeLocalDate(now), drops: 0 },
    rngState: Math.floor(Math.abs(seed)) % 0x1_0000_0000, totalDrops: 0, firstDropAt: null })
}

export function kunWardrobeOwns(wardrobe: KunWardrobe, category: KunAvatarAccessoryCategory, id: string): boolean {
  return (wardrobe.items[kunWardrobeItemKey(category, id)] ?? 0) > 0
}
/** Accessory keys a look needs that the wardrobe does not hold. */
export function kunWardrobeMissingParts(wardrobe: KunWardrobe, parts: Partial<KunAvatarParts>): KunWardrobeItemKey[] {
  const normalized = normalizeKunAvatarParts(parts)
  return KUN_AVATAR_ACCESSORY_CATEGORIES.flatMap((category) => {
    const id = normalized[category]
    return id && !kunWardrobeOwns(wardrobe, category, id) ? [kunWardrobeItemKey(category, id)] : []
  })
}
export function kunWardrobePartKeys(parts: Partial<KunAvatarParts>): KunWardrobeItemKey[] {
  const normalized = normalizeKunAvatarParts(parts)
  return KUN_AVATAR_ACCESSORY_CATEGORIES.flatMap((category) =>
    normalized[category] ? [kunWardrobeItemKey(category, normalized[category]!)] : [])
}
/** A role card lights up once every accessory on it is owned; colors and faces never gate it. */
export function kunWardrobeLitCards(wardrobe: KunWardrobe): KunAvatarPresetId[] {
  return KUN_AVATAR_PRESETS.filter((preset) => !kunWardrobeMissingParts(wardrobe, preset.parts).length).map((preset) => preset.id)
}
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

export function kunWardrobeProgress(wardrobe: KunWardrobe) {
  const all = kunWardrobeItems()
  return {
    ownedItems: all.filter((item) => (wardrobe.items[item.key] ?? 0) > 0).length, totalItems: all.length,
    litCards: wardrobe.roles.length, totalCards: KUN_AVATAR_PRESETS.length, pending: wardrobe.pending.length,
    untilPity: Math.max(1, KUN_WARDROBE_RULES.pity - wardrobe.pity.sinceDrop), feathers: wardrobe.feathers,
    dailyLeft: Math.max(0, KUN_WARDROBE_RULES.dailyCap - wardrobe.daily.drops)
  }
}

export function kunWardrobeLocalDate(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
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

export function markKunWardrobeSeen(wardrobe: KunWardrobe, keys: readonly string[]): KunWardrobe {
  const seen = new Set(wardrobe.seen)
  for (const key of keys) seen.add(key)
  return seen.size === wardrobe.seen.length ? wardrobe : { ...wardrobe, seen: [...seen] }
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

export function updateKunWardrobeSettings(wardrobe: KunWardrobe, patch: Partial<KunWardrobeSettings>): KunWardrobe {
  return { ...wardrobe, settings: KunWardrobeSettingsSchema.parse({ ...wardrobe.settings, ...patch }) }
}
/** Whether a finished turn from this source may roll at all. */
export function kunWardrobeAcceptsSource(wardrobe: KunWardrobe, source: 'room' | 'code'): boolean {
  const settings = wardrobe.settings ?? { drops: true, code: true, notice: 'card' }
  return settings.drops && (source === 'room' || settings.code)
}

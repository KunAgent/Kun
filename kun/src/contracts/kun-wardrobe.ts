import { KunEngagementProgressSchema } from './kun-engagement.js'
/**
 * The user's wardrobe: which avatar items they own, which bottles are waiting
 * to be opened, and the pure drop rules. Shared by the runtime and renderer.
 */
import { z } from 'zod'
import {
  KUN_AVATAR_ACCESSORY_CATEGORIES, KUN_AVATAR_CATALOG, normalizeKunAvatarParts,
  type KunAvatarAccessoryCategory, type KunAvatarRarity, type KunAvatarParts
} from './kun-avatar-catalog.js'
import { KUN_AVATAR_PRESETS, type KunAvatarPresetId } from './kun-avatar-presets.js'

export type KunWardrobeItemKey = `${KunAvatarAccessoryCategory}/${string}`
export const kunWardrobeItemKey = (category: KunAvatarAccessoryCategory, id: string): KunWardrobeItemKey => `${category}/${id}`

/** Every new wardrobe starts with these, so the editor is never empty. */
export const KUN_WARDROBE_STARTER_PACK: readonly KunWardrobeItemKey[] =
  ['headwear/headset', 'glasses/square', 'outfit/blue-scarf', 'prop/notebook']

const Rarity = z.enum(['common', 'rare', 'epic', 'legendary'])
export const KUN_WARDROBE_DROP_SOURCES = ['room', 'code', 'welcome', 'invite', 'shop', 'campaign'] as const
export type KunWardrobeDropSource = typeof KUN_WARDROBE_DROP_SOURCES[number]
export const KunWardrobeDropSchema = z.object({
  id: z.string().min(1).max(128),
  kind: z.enum(['item', 'card']),
  rarity: Rarity,
  item: z.object({ category: z.enum(KUN_AVATAR_ACCESSORY_CATEGORIES), id: z.string().min(1).max(64) }).strict().optional(),
  cardId: z.string().min(1).max(64).optional(),
  /** Already owned when it dropped; opening it pays feathers instead. */
  duplicate: z.boolean(),
  feathers: z.number().int().nonnegative(),
  /**
   * Where the bottle came from: an Agent conversation (roomId), a Code task (threadId), or, for a
   * Kun account, the welcome gift, an invitation, the feather shop or a campaign.
   */
  source: z.enum(KUN_WARDROBE_DROP_SOURCES).optional(),
  roomId: z.string().min(1).max(256).optional(),
  threadId: z.string().min(1).max(256).optional(),
  /** The conversation or task title when it dropped, for the drop log. */
  sourceLabel: z.string().max(120).optional(),
  runId: z.string().min(1).max(256),
  messageId: z.string().min(1).max(256).optional(),
  createdAt: z.string(),
  /** Local presentation metadata from the immutable server receipt. */
  activityReceipt: z.object({ reason:z.string(),resetAt:z.string() }).strict().optional(),
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
  progress: KunEngagementProgressSchema.optional(),
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
export function kunWardrobeProgress(wardrobe: KunWardrobe) {
  const all = kunWardrobeItems()
  return {
    ownedItems: all.filter((item) => (wardrobe.items[item.key] ?? 0) > 0).length, totalItems: all.length,
    litCards: wardrobe.roles.length, totalCards: KUN_AVATAR_PRESETS.length, pending: wardrobe.pending.length,
    untilPity: wardrobe.progress?.untilDrop ?? 0, feathers: wardrobe.feathers,
    dailyLeft: wardrobe.progress?.dailyRemaining ?? 0
  }
}

export function kunWardrobeLocalDate(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function markKunWardrobeSeen(wardrobe: KunWardrobe, keys: readonly string[]): KunWardrobe {
  const seen = new Set(wardrobe.seen)
  for (const key of keys) seen.add(key)
  return seen.size === wardrobe.seen.length ? wardrobe : { ...wardrobe, seen: [...seen] }
}

export function updateKunWardrobeSettings(wardrobe: KunWardrobe, patch: Partial<KunWardrobeSettings>): KunWardrobe {
  return { ...wardrobe, settings: KunWardrobeSettingsSchema.parse({ ...wardrobe.settings, ...patch }) }
}
/** Whether a finished turn from this source may roll at all. */
export function kunWardrobeAcceptsSource(wardrobe: KunWardrobe, source: 'room' | 'code'): boolean {
  const settings = wardrobe.settings ?? { drops: true, code: true, notice: 'card' }
  return settings.drops && (source === 'room' || settings.code)
}

/** Missing policy means loading/offline without a server snapshot; it never supplies playable defaults. */
export function kunWardrobeRules(wardrobe: KunWardrobe | null | undefined) {
  return wardrobe?.progress ?? { enabled:false,dropRate:0,pity:0,dailyCap:0,cardRate:0,epicPity:0,minIntervalMs:0,shelfLimit:0,tenPull:0,
    exchangeFeathers:{common:0,rare:0,epic:0,legendary:0},duplicateFeathers:{common:0,rare:0,epic:0,legendary:0} }
}

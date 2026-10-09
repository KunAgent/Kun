/**
 * Persists the user's wardrobe in the room store. Signed in, it is the mirror of the Kun account's
 * wardrobe and finished turns are queued for the account to roll; signed out, only the starter pack
 * is available and nothing drops; debug runs keep the local drop rules. Every write is a single
 * commit, so SSE consumers see a change only after it exists on disk.
 */
import { randomInt } from 'node:crypto'
import type { AgentIdentity } from '../contracts/agent-identities.js'
import type { RoomAvatarReference } from '../contracts/room-content.js'
import type { RoomUserProfile } from '../contracts/room-onboarding.js'
import type { Room } from '../contracts/rooms.js'
import { KUN_AVATAR_PRESETS } from '../contracts/kun-avatar-presets.js'
import type { KunAvatarAccessoryCategory } from '../contracts/kun-avatar-catalog.js'
import {
  KUN_WARDROBE_STARTER_PACK, KunWardrobeSchema, createKunWardrobe, exchangeKunWardrobeItem, grantKunWardrobeItems,
  KUN_WARDROBE_RULES, kunWardrobeAcceptsSource, kunWardrobeLocalDate, kunWardrobeMissingParts, kunWardrobePartKeys,
  markKunWardrobeSeen, rollKunWardrobeDrop, updateKunWardrobeSettings,
  type KunWardrobe, type KunWardrobeDetail, type KunWardrobeDrop, type KunWardrobeItemKey, type KunWardrobeSettings
} from '../contracts/kun-wardrobe.js'
import { openKunWardrobeDrops, stashKunWardrobeDrops } from '../contracts/kun-wardrobe-open.js'
import { DEFAULT_AGENT_TEMPLATES, DIAGNOSTICIAN_AGENT_TEMPLATE } from '../agents/agent-defaults.js'
import { RoomStoreConflictError, type RoomStore } from './room-store.js'
import {
  WARDROBE_ACCOUNT_ID, WARDROBE_ACCOUNT_KIND, readWardrobeAccountState, wardrobeLocalDebug, wardrobeSeedBottles, wardrobeUnlockAll,
  type WardrobeMode
} from './room-wardrobe-mode.js'
import { queueWardrobeActivity } from './room-wardrobe-activity.js'

export { wardrobeSeedBottles, wardrobeUnlockAll } from './room-wardrobe-mode.js'
export const WARDROBE_KIND: 'room_wardrobe' = 'room_wardrobe', WARDROBE_ID = 'self', WARDROBE_DIRECTORY = 'agent-directory'
const KIND = WARDROBE_KIND, ID = WARDROBE_ID, DIRECTORY = WARDROBE_DIRECTORY

/** Debug only: rolls guaranteed bottles onto the shelf, then leaves today's counters untouched. */
export function seedWardrobeBottles(wardrobe: KunWardrobe, count: number, now = new Date()): KunWardrobe {
  let next = wardrobe
  for (let index = 0; index < count; index++) {
    const forced = { ...next, daily: { date: 'seed', drops: 0 }, pity: { ...next.pity, sinceDrop: KUN_WARDROBE_RULES.pity, lastCountedAt: null } }
    const rolled = rollKunWardrobeDrop(forced, { runId: `seed-${index + 1}`, source: 'code', sourceLabel: 'Debug shelf',
      now: new Date(now.getTime() - (count - index) * 60_000) })
    next = rolled.wardrobe
  }
  return { ...next, pending: next.pending.map((drop) => ({ ...drop, stashedAt: now.toISOString() })),
    daily: { date: kunWardrobeLocalDate(now), drops: 0 }, pity: { sinceDrop: 0, sinceEpic: 0, lastCountedAt: null } }
}

export class RoomWardrobeError extends Error {
  constructor(message: string, readonly keys: KunWardrobeItemKey[] = []) { super(message) }
}

export function avatarKeys(avatar: RoomAvatarReference | null | undefined): KunWardrobeItemKey[] {
  if (avatar?.kind === 'composed') return kunWardrobePartKeys(avatar.parts)
  if (avatar?.kind === 'builtin') {
    const preset = KUN_AVATAR_PRESETS.find((entry) => entry.id === avatar.id)
    return preset ? kunWardrobePartKeys(preset.parts) : []
  }
  return []
}

/** Everything already worn when the wardrobe first appears stays owned; nobody loses a saved look. */
async function initialGrants(store: RoomStore): Promise<Set<KunWardrobeItemKey>> {
  const keys = new Set<KunWardrobeItemKey>(KUN_WARDROBE_STARTER_PACK)
  const profile = await store.get<RoomUserProfile>('room_user_profile', ID)
  for (const key of avatarKeys(profile?.value.avatar)) keys.add(key)
  for (const template of [...DEFAULT_AGENT_TEMPLATES, DIAGNOSTICIAN_AGENT_TEMPLATE]) {
    for (const key of avatarKeys(template.avatar as RoomAvatarReference | undefined)) keys.add(key)
  }
  for (const row of await store.list<AgentIdentity>('agent_identity', { limit: 1000 })) for (const key of avatarKeys(row.value.avatar)) keys.add(key)
  for (const row of await store.list<Room>('room', { limit: 1000, includeArchived: true })) {
    for (const member of row.value.members ?? []) for (const key of avatarKeys(member.avatar)) keys.add(key)
  }
  return keys
}

/** Signed out: the starter pack only. Settings and "seen" marks survive a reset. */
export function guestWardrobe(previous?: KunWardrobe | null): KunWardrobe {
  const fresh = grantKunWardrobeItems(createKunWardrobe(randomInt(0, 0x7fff_ffff)), KUN_WARDROBE_STARTER_PACK)
  return previous ? { ...fresh, settings: previous.settings, seen: [...new Set([...fresh.seen, ...previous.seen])] } : fresh
}

/** Takes off what this wardrobe does not own, keeping color, face and backdrop; null when nothing changes. */
export function strippedLook(avatar: RoomAvatarReference | null | undefined, wardrobe: KunWardrobe): RoomAvatarReference | null {
  if (avatar?.kind !== 'composed') return null
  const missing = kunWardrobeMissingParts(wardrobe, avatar.parts)
  if (!missing.length) return null
  const parts = { ...avatar.parts }
  for (const key of missing) delete parts[key.split('/')[0] as KunAvatarAccessoryCategory]
  return { ...avatar, parts }
}

/**
 * The first run after accounts existed turns a locally collected wardrobe into the signed-out one:
 * collected items, bottles and feathers now belong to accounts only.
 */
async function prepareWardrobeMode(store: RoomStore): Promise<WardrobeMode> {
  if (wardrobeLocalDebug()) return 'local'
  for (let attempt = 0; attempt < 3; attempt++) {
    const { state } = await readWardrobeAccountState(store)
    if (state) return state.mode
    const row = await store.get(KIND, ID)
    const profile = await store.get<RoomUserProfile>('room_user_profile', ID)
    const wardrobe = guestWardrobe(row ? KunWardrobeSchema.parse(row.value) : null)
    const avatar = strippedLook(profile?.value.avatar, wardrobe)
    try {
      await store.commit({ requestId: 'room-wardrobe:guest-migration', checks: [
        { kind: WARDROBE_ACCOUNT_KIND, id: WARDROBE_ACCOUNT_ID, expectedRevision: null },
        { kind: KIND, id: ID, expectedRevision: row?.revision ?? null },
        ...(avatar ? [{ kind: 'room_user_profile' as const, id: ID, expectedRevision: profile!.revision }] : [])
      ], puts: [
        { kind: WARDROBE_ACCOUNT_KIND, id: WARDROBE_ACCOUNT_ID, value: { mode: 'guest', activity: [] } },
        ...(row ? [{ kind: KIND, id: ID, value: wardrobe }] : []),
        ...(avatar ? [{ kind: 'room_user_profile' as const, id: ID, value: { ...profile!.value, avatar } }] : [])
      ], events: row ? [{ roomId: DIRECTORY, kind: 'wardrobe.updated', payload: {} }] : [] })
      return 'guest'
    } catch (error) { if (!(error instanceof RoomStoreConflictError)) throw error }
  }
  throw new Error('wardrobe unavailable')
}

export async function readRoomWardrobe(store: RoomStore): Promise<KunWardrobeDetail & { revision: number; mode: WardrobeMode }> {
  const mode = await prepareWardrobeMode(store)
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await store.get(KIND, ID)
    if (row) return { wardrobe: KunWardrobeSchema.parse(row.value), revision: row.revision, mode }
    let wardrobe = guestWardrobe()
    if (mode === 'local') {
      const granted = grantKunWardrobeItems(createKunWardrobe(randomInt(0, 0x7fff_ffff)), await initialGrants(store))
      wardrobe = wardrobeSeedBottles() ? seedWardrobeBottles(granted, wardrobeSeedBottles()) : granted
    }
    try {
      // Lazy creation is silent: nothing changed from the user's point of view.
      await store.commit({ requestId: 'room-wardrobe:create', checks: [{ kind: KIND, id: ID, expectedRevision: null }],
        puts: [{ kind: KIND, id: ID, value: wardrobe }] })
    } catch (error) { if (!(error instanceof RoomStoreConflictError)) throw error }
  }
  throw new Error('wardrobe unavailable')
}

async function write(store: RoomStore, requestId: string, detail: KunWardrobeDetail & { revision: number }, next: KunWardrobe,
  events: Array<{ roomId: string; kind: string; payload: unknown }>, result?: unknown, fingerprint?: string) {
  return store.commit({ requestId, ...(fingerprint ? { fingerprint } : {}), checks: [{ kind: KIND, id: ID, expectedRevision: detail.revision }],
    puts: [{ kind: KIND, id: ID, value: KunWardrobeSchema.parse(next) }], events, result })
}

export type WardrobeTurnContext = {
  runId: string; messageId?: string; finishedAt?: string; now?: Date
  /** An Agent conversation turn carries its roomId; a Code task turn carries its threadId. */
  source?: 'room' | 'code'; roomId?: string; threadId?: string; sourceLabel?: string
}
/**
 * Counts a finished Agent or Code turn once; stale reconciliations of old turns never drop anything.
 * Signed out nothing drops; signed in the turn is queued for the account, which decides the drop.
 */
export async function countRoomWardrobeTurn(store: RoomStore, context: WardrobeTurnContext): Promise<KunWardrobeDrop | null> {
  const requestId = 'wardrobe-turn:' + context.runId
  if (await store.getRequest(requestId)) return null
  const now = context.now ?? new Date()
  if (context.finishedAt && now.getTime() - Date.parse(context.finishedAt) > 10 * 60_000) return null
  for (let attempt = 0; ; attempt++) {
    const detail = await readRoomWardrobe(store)
    if (detail.mode === 'guest') return null
    const source = context.source ?? (context.roomId ? 'room' : 'code')
    // Switched off in the wardrobe settings: the turn is not counted at all.
    if (!kunWardrobeAcceptsSource(detail.wardrobe, source)) return null
    if (detail.mode === 'account') {
      await queueWardrobeActivity(store, requestId, { ...context, source, now })
      return null
    }
    const rolled = rollKunWardrobeDrop(detail.wardrobe, { ...context, source, now })
    try {
      // Code drops have no conversation; they reach every window through the directory namespace.
      await write(store, requestId, detail, rolled.wardrobe, rolled.drop
        ? [{ roomId: context.roomId ?? DIRECTORY, kind: 'wardrobe.dropped', payload: { dropId: rolled.drop.id, runId: context.runId,
          ...(context.messageId ? { messageId: context.messageId } : {}), ...(context.threadId ? { threadId: context.threadId } : {}) } }]
        : [], { dropId: rolled.drop?.id ?? null })
      return rolled.drop
    } catch (error) {
      if (!(error instanceof RoomStoreConflictError) || attempt >= 4) throw error
    }
  }
}

type Mutation = { clientRequestId: string; expectedRevision: number | null }
async function mutate(store: RoomStore, prefix: string, input: Mutation, fingerprint: string,
  apply: (wardrobe: KunWardrobe) => { wardrobe: KunWardrobe; result?: unknown }) {
  const requestId = prefix + input.clientRequestId
  const previous = await store.getRequest(requestId)
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new RoomStoreConflictError('wardrobe request changed')
    return { ...await readRoomWardrobe(store), ...(previous.result as object) }
  }
  const detail = await readRoomWardrobe(store)
  // A signed-in wardrobe changes on the server; the mirror is replaced from there.
  if (detail.mode === 'account') throw new RoomWardrobeError('wardrobe_account_mode')
  if (input.expectedRevision !== null && input.expectedRevision !== detail.revision) {
    throw new RoomStoreConflictError('wardrobe changed', detail.revision)
  }
  const applied = apply(detail.wardrobe)
  await write(store, requestId, detail, applied.wardrobe, [{ roomId: DIRECTORY, kind: 'wardrobe.updated', payload: {} }], applied.result ?? {}, fingerprint)
  return { ...await readRoomWardrobe(store), ...(applied.result as object ?? {}) }
}

/** Opens one bottle or a ten-pull; the response lists every opened bottle in order. */
export function openRoomWardrobeDrops(store: RoomStore, input: Mutation & { dropIds: string[] }, fingerprint: string) {
  return mutate(store, 'wardrobe-open:', input, fingerprint, (wardrobe) => {
    const opened = openKunWardrobeDrops(wardrobe, input.dropIds)
    return { wardrobe: opened.wardrobe, result: { drops: opened.drops, drop: opened.drops[0], granted: opened.granted,
      feathers: opened.feathers, guaranteed: opened.guaranteed } }
  })
}
export function stashRoomWardrobeDrops(store: RoomStore, input: Mutation & { dropIds: string[] }, fingerprint: string) {
  return mutate(store, 'wardrobe-stash:', input, fingerprint, (wardrobe) => ({ wardrobe: stashKunWardrobeDrops(wardrobe, input.dropIds) }))
}
export function markRoomWardrobeSeen(store: RoomStore, input: Mutation & { keys: string[] }, fingerprint: string) {
  return mutate(store, 'wardrobe-seen:', input, fingerprint, (wardrobe) => ({ wardrobe: markKunWardrobeSeen(wardrobe, input.keys) }))
}
export function updateRoomWardrobeSettings(store: RoomStore, input: Mutation & { settings: Partial<KunWardrobeSettings> }, fingerprint: string) {
  return mutate(store, 'wardrobe-settings:', input, fingerprint, (wardrobe) => ({ wardrobe: updateKunWardrobeSettings(wardrobe, input.settings) }))
}
export function exchangeRoomWardrobeItem(store: RoomStore, input: Mutation & { key: KunWardrobeItemKey }, fingerprint: string) {
  return mutate(store, 'wardrobe-exchange:', input, fingerprint, (wardrobe) => ({ wardrobe: exchangeKunWardrobeItem(wardrobe, input.key) }))
}

/** What the default Agents wear; editing one of them never needs a collected item. */
export function defaultAgentWardrobeKeys(): Set<KunWardrobeItemKey> {
  return new Set([...DEFAULT_AGENT_TEMPLATES, DIAGNOSTICIAN_AGENT_TEMPLATE]
    .flatMap((template) => avatarKeys(template.avatar as RoomAvatarReference | undefined)))
}

/**
 * Saving a composed look may only wear owned items. The user's own look (`self`) is the account
 * avatar and must match the wardrobe exactly; Agents may also keep what the default Agents wear.
 */
export async function assertRoomWardrobeAllows(store: RoomStore, avatars: Array<RoomAvatarReference | null | undefined>,
  options: { self?: boolean } = {}): Promise<void> {
  const composed = avatars.filter((avatar) => avatar?.kind === 'composed')
  if (!composed.length || wardrobeUnlockAll()) return
  const { wardrobe, mode } = await readRoomWardrobe(store)
  const extra = mode === 'local' || options.self ? new Set<string>() : defaultAgentWardrobeKeys()
  const missing = [...new Set(composed.flatMap((avatar) => avatar?.kind === 'composed' ? kunWardrobeMissingParts(wardrobe, avatar.parts) : []))]
    .filter((key) => !extra.has(key))
  if (missing.length) throw new RoomWardrobeError('avatar_item_locked: ' + missing.join(', '), missing)
}

import { finishActivity } from './engagement/queue.js'
/**
 * Persists the user's wardrobe in the room store. Signed in, it is the mirror of the Kun account's
 * wardrobe and finished turns are queued for the account to roll; signed out, only the default look
 * is available and drops are login invitations; debug runs keep the local drop rules. Every write is a single
 * commit, so SSE consumers see a change only after it exists on disk.
 */
import { randomInt } from 'node:crypto'
import type { RoomAvatarReference } from '../contracts/room-content.js'
import type { RoomUserProfile } from '../contracts/room-onboarding.js'
import { KUN_AVATAR_PRESETS } from '../contracts/kun-avatar-presets.js'
import { canonicalKunAvatarKey, type KunAvatarAccessoryCategory } from '../contracts/kun-avatar-catalog.js'
import {
  KunWardrobeSchema, createKunWardrobe,
  kunWardrobeMissingParts, kunWardrobePartKeys,
  markKunWardrobeSeen, updateKunWardrobeSettings,
  type KunWardrobe, type KunWardrobeDetail, type KunWardrobeDrop, type KunWardrobeItemKey, type KunWardrobeSettings
} from '../contracts/kun-wardrobe.js'
import { DEFAULT_AGENT_TEMPLATES, DIAGNOSTICIAN_AGENT_TEMPLATE } from '../agents/agent-defaults.js'
import { RoomStoreConflictError, type RoomStore } from './room-store.js'
import {
  WARDROBE_ACCOUNT_ID, WARDROBE_ACCOUNT_KIND, readWardrobeAccountState, wardrobeLocalDebug, wardrobeUnlockAll,
  type WardrobeMode
} from './room-wardrobe-mode.js'

export { wardrobeSeedBottles, wardrobeUnlockAll } from './room-wardrobe-mode.js'
export const WARDROBE_KIND: 'room_wardrobe' = 'room_wardrobe', WARDROBE_ID = 'self', WARDROBE_DIRECTORY = 'agent-directory'
const KIND = WARDROBE_KIND, ID = WARDROBE_ID, DIRECTORY = WARDROBE_DIRECTORY

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

/** Signed out: no collectible ownership. Settings and "seen" marks survive a reset. */
export function guestWardrobe(previous?: KunWardrobe | null): KunWardrobe {
  const fresh = createKunWardrobe(randomInt(0, 0x7fff_ffff))
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

export async function readRoomWardrobe(store: RoomStore): Promise<KunWardrobeDetail & { revision: number; mode: WardrobeMode; guestHints: { id: string; createdAt: string; roomId?: string; threadId?: string }[] }> {
  const mode = await prepareWardrobeMode(store)
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await store.get(KIND, ID)
    if (row) {
      const stored = KunWardrobeSchema.parse(row.value)
      const wardrobe = mode === 'guest' ? { ...stored, items: {}, roles: [], pending: [], feathers: 0, history: [] } : stored
      const guestHints = mode === 'guest' ? (await readWardrobeAccountState(store)).state?.guestHints ?? [] : []
      return { wardrobe, revision: row.revision, mode, guestHints }
    }
    const wardrobe = guestWardrobe()
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
 * Signed out only login hints drop; signed in the turn is queued for the account, which decides the drop.
 */
export async function countRoomWardrobeTurn(store: RoomStore, context: WardrobeTurnContext): Promise<KunWardrobeDrop | null> {
  await finishActivity(store, context.runId, 'completed', context.messageId)
  return null
}

type Mutation = { clientRequestId: string; expectedRevision: number | null }
async function mutate(store: RoomStore, prefix: string, input: Mutation, fingerprint: string,
  apply: (wardrobe: KunWardrobe) => { wardrobe: KunWardrobe; result?: unknown }) {
  const requestId = prefix + input.clientRequestId
  const detail = await readRoomWardrobe(store)
  // Authenticate before idempotency replay as well as before a new mutation.
  if (detail.mode === 'guest' && !['wardrobe-seen:', 'wardrobe-settings:'].includes(prefix)) throw new RoomWardrobeError('wardrobe_login_required')
  if (detail.mode === 'account') throw new RoomWardrobeError('wardrobe_account_mode')
  const previous = await store.getRequest(requestId)
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new RoomStoreConflictError('wardrobe request changed')
    return { ...await readRoomWardrobe(store), ...(previous.result as object) }
  }
  if (input.expectedRevision !== null && input.expectedRevision !== detail.revision) {
    throw new RoomStoreConflictError('wardrobe changed', detail.revision)
  }
  const applied = apply(detail.wardrobe)
  await write(store, requestId, detail, applied.wardrobe, [{ roomId: DIRECTORY, kind: 'wardrobe.updated', payload: {} }], applied.result ?? {}, fingerprint)
  return { ...await readRoomWardrobe(store), ...(applied.result as object ?? {}) }
}

/** Assets are changed by Kunserve only, even when debug environment variables are set. */
async function rejectAssetMutation(store: RoomStore): Promise<never> {
  const detail=await readRoomWardrobe(store)
  throw new RoomWardrobeError(detail.mode==='guest'?'wardrobe_login_required':'wardrobe_account_mode')
}
export function openRoomWardrobeDrops(store:RoomStore,_input:Mutation & {dropIds:string[]},_fingerprint:string) { return rejectAssetMutation(store) }
export function stashRoomWardrobeDrops(store:RoomStore,_input:Mutation & {dropIds:string[]},_fingerprint:string) { return rejectAssetMutation(store) }
export function markRoomWardrobeSeen(store: RoomStore, input: Mutation & { keys: string[] }, fingerprint: string) {
  return mutate(store, 'wardrobe-seen:', input, fingerprint, (wardrobe) => ({ wardrobe: markKunWardrobeSeen(wardrobe, input.keys) }))
}
export function updateRoomWardrobeSettings(store: RoomStore, input: Mutation & { settings: Partial<KunWardrobeSettings> }, fingerprint: string) {
  return mutate(store, 'wardrobe-settings:', input, fingerprint, (wardrobe) => ({ wardrobe: updateKunWardrobeSettings(wardrobe, input.settings) }))
}
export function exchangeRoomWardrobeItem(store: RoomStore, input: Mutation & { key: KunWardrobeItemKey }, fingerprint: string) {
  return rejectAssetMutation(store)
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
  if (wardrobeUnlockAll()) return
  const { wardrobe, mode } = await readRoomWardrobe(store)
  if (mode === 'guest') {
    const defaults = [...DEFAULT_AGENT_TEMPLATES, DIAGNOSTICIAN_AGENT_TEMPLATE].flatMap(template => {
      const avatar = template.avatar as RoomAvatarReference | undefined
      return avatar?.kind === 'composed' ? [canonicalKunAvatarKey(avatar.parts)] : []
    })
    if (options.self || composed.some(avatar => avatar?.kind === 'composed' && !defaults.includes(canonicalKunAvatarKey(avatar.parts)))) {
      throw new RoomWardrobeError('wardrobe_login_required')
    }
  }
  if (!composed.length) return
  const extra = mode === 'local' || options.self ? new Set<string>() : defaultAgentWardrobeKeys()
  const missing = [...new Set(composed.flatMap((avatar) => avatar?.kind === 'composed' ? kunWardrobeMissingParts(wardrobe, avatar.parts) : []))]
    .filter((key) => !extra.has(key))
  if (missing.length) throw new RoomWardrobeError('avatar_item_locked: ' + missing.join(', '), missing)
}

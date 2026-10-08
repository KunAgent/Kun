/**
 * Persists the user's wardrobe in the room store and runs the drop rules at
 * the end of Agent turns. Every write is a single commit, so SSE consumers see
 * a bottle only after it exists on disk.
 */
import { randomInt } from 'node:crypto'
import type { AgentIdentity } from '../contracts/agent-identities.js'
import type { RoomAvatarReference } from '../contracts/room-content.js'
import type { RoomUserProfile } from '../contracts/room-onboarding.js'
import type { Room } from '../contracts/rooms.js'
import { KUN_AVATAR_PRESETS } from '../contracts/kun-avatar-presets.js'
import {
  KUN_WARDROBE_STARTER_PACK, KunWardrobeSchema, createKunWardrobe, exchangeKunWardrobeItem, grantKunWardrobeItems,
  kunWardrobeMissingParts, kunWardrobePartKeys, markKunWardrobeSeen, openKunWardrobeDrop, rollKunWardrobeDrop,
  type KunWardrobe, type KunWardrobeDetail, type KunWardrobeDrop, type KunWardrobeItemKey
} from '../contracts/kun-wardrobe.js'
import { DEFAULT_AGENT_TEMPLATES, DIAGNOSTICIAN_AGENT_TEMPLATE } from '../agents/agent-defaults.js'
import { RoomStoreConflictError, type RoomStore } from './room-store.js'

const KIND = 'room_wardrobe', ID = 'self', DIRECTORY = 'agent-directory'
/** Local debugging and smoke runs may treat everything as owned. */
export const wardrobeUnlockAll = (): boolean => process.env.KUN_WARDROBE_UNLOCK_ALL === '1'

export class RoomWardrobeError extends Error {
  constructor(message: string, readonly keys: KunWardrobeItemKey[] = []) { super(message) }
}

function avatarKeys(avatar: RoomAvatarReference | null | undefined): KunWardrobeItemKey[] {
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

export async function readRoomWardrobe(store: RoomStore): Promise<KunWardrobeDetail & { revision: number }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await store.get(KIND, ID)
    if (row) return { wardrobe: KunWardrobeSchema.parse(row.value), revision: row.revision }
    const wardrobe = grantKunWardrobeItems(createKunWardrobe(randomInt(0, 0x7fff_ffff)), await initialGrants(store))
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

export type WardrobeTurnContext = { roomId: string; runId: string; messageId?: string; finishedAt?: string; now?: Date }
/** Counts a finished Agent turn once; stale reconciliations of old turns never drop anything. */
export async function countRoomWardrobeTurn(store: RoomStore, context: WardrobeTurnContext): Promise<KunWardrobeDrop | null> {
  const requestId = 'wardrobe-turn:' + context.runId
  if (await store.getRequest(requestId)) return null
  const now = context.now ?? new Date()
  if (context.finishedAt && now.getTime() - Date.parse(context.finishedAt) > 10 * 60_000) return null
  for (let attempt = 0; ; attempt++) {
    const detail = await readRoomWardrobe(store)
    const rolled = rollKunWardrobeDrop(detail.wardrobe, { roomId: context.roomId, runId: context.runId, messageId: context.messageId, now })
    try {
      await write(store, requestId, detail, rolled.wardrobe, rolled.drop
        ? [{ roomId: context.roomId, kind: 'wardrobe.dropped', payload: { dropId: rolled.drop.id, runId: context.runId, messageId: context.messageId } }]
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
  if (input.expectedRevision !== null && input.expectedRevision !== detail.revision) {
    throw new RoomStoreConflictError('wardrobe changed', detail.revision)
  }
  const applied = apply(detail.wardrobe)
  await write(store, requestId, detail, applied.wardrobe, [{ roomId: DIRECTORY, kind: 'wardrobe.updated', payload: {} }], applied.result ?? {}, fingerprint)
  return { ...await readRoomWardrobe(store), ...(applied.result as object ?? {}) }
}

export function openRoomWardrobeDrop(store: RoomStore, input: Mutation & { dropId: string }, fingerprint: string) {
  return mutate(store, 'wardrobe-open:', input, fingerprint, (wardrobe) => {
    const opened = openKunWardrobeDrop(wardrobe, input.dropId)
    return { wardrobe: opened.wardrobe, result: { drop: opened.drop, granted: opened.granted } }
  })
}
export function markRoomWardrobeSeen(store: RoomStore, input: Mutation & { keys: string[] }, fingerprint: string) {
  return mutate(store, 'wardrobe-seen:', input, fingerprint, (wardrobe) => ({ wardrobe: markKunWardrobeSeen(wardrobe, input.keys) }))
}
export function exchangeRoomWardrobeItem(store: RoomStore, input: Mutation & { key: KunWardrobeItemKey }, fingerprint: string) {
  return mutate(store, 'wardrobe-exchange:', input, fingerprint, (wardrobe) => ({ wardrobe: exchangeKunWardrobeItem(wardrobe, input.key) }))
}

/** Saving a composed look may only wear owned items; looks saved before the wardrobe existed were granted on creation. */
export async function assertRoomWardrobeAllows(store: RoomStore, avatars: Array<RoomAvatarReference | null | undefined>): Promise<void> {
  const composed = avatars.filter((avatar) => avatar?.kind === 'composed')
  if (!composed.length || wardrobeUnlockAll()) return
  const { wardrobe } = await readRoomWardrobe(store)
  const missing = [...new Set(composed.flatMap((avatar) => avatar?.kind === 'composed' ? kunWardrobeMissingParts(wardrobe, avatar.parts) : []))]
  if (missing.length) throw new RoomWardrobeError('avatar_item_locked: ' + missing.join(', '), missing)
}

import { readQueue } from './engagement/queue.js'
/**
 * The main process keeps the local wardrobe in step with the Kun account: attach replaces it with
 * the account's snapshot (and wears the account look), detach returns to the signed-out wardrobe,
 * and queued turns are acknowledged together with the snapshot that reports their drops.
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { KunComposedAvatarReferenceSchema } from '../contracts/kun-avatar-schema.js'
import { KUN_WARDROBE_HISTORY_LIMIT, KunWardrobeSchema, type KunWardrobe } from '../contracts/kun-wardrobe.js'
import type { RoomAvatarReference } from '../contracts/room-content.js'
import type { RoomUserProfile } from '../contracts/room-onboarding.js'
import { RoomStoreConflictError, type RoomStore } from './room-store.js'
import {
  WARDROBE_ACCOUNT_ID, WARDROBE_ACCOUNT_KIND, readWardrobeAccountState, wardrobeLocalDebug, type WardrobeAccountState
} from './room-wardrobe-mode.js'
import { WARDROBE_DIRECTORY, WARDROBE_ID, WARDROBE_KIND, guestWardrobe, readRoomWardrobe, strippedLook } from './room-wardrobe-service.js'

export class RoomWardrobeAccountError extends Error {}

const UserId = z.string().min(1).max(64)
export const AttachWardrobeRequest = z.object({
  userId: UserId, serverRevision: z.number().optional(), wardrobe: z.record(z.string(), z.unknown()), look: z.record(z.string(), z.unknown()).nullable().optional()
}).strict()
const trimDrop = (drop: unknown): unknown => {
  if (!drop || typeof drop !== 'object') return drop
  const value = drop as Record<string, unknown>
  return typeof value.sourceLabel === 'string' ? { ...value, sourceLabel: value.sourceLabel.slice(0, 120) } : value
}
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : []

/** The account snapshot as a local wardrobe: labels and history are cut to local limits; the server rolls, so no seed. */
export function mirrorWardrobe(snapshot: Record<string, unknown>): KunWardrobe {
  return KunWardrobeSchema.parse({ ...snapshot, rngState: 0, pending: list(snapshot.pending).map(trimDrop),
    history: list(snapshot.history).slice(0, KUN_WARDROBE_HISTORY_LIMIT).map(trimDrop) })
}

/** The account look as a composed avatar; empty slots arrive as null and an unreadable look is ignored. */
export function accountAvatar(look: Record<string, unknown> | null | undefined): RoomAvatarReference | null {
  if (!look) return null
  const parts = Object.fromEntries(Object.entries(look).filter(([, value]) => value !== null && value !== undefined))
  const parsed = KunComposedAvatarReferenceSchema.safeParse({ kind: 'composed', version: 1, parts })
  return parsed.success ? parsed.data : null
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

type Event = { roomId: string; kind: string; payload: unknown }
/** One commit for the mirror, the account state (built from the state current at commit time) and the look. */
async function replace(store: RoomStore, input: {
  wardrobe: KunWardrobe; avatar?: RoomAvatarReference | null
  build(current: WardrobeAccountState | null): { state: WardrobeAccountState; events?: Event[]; skip?:boolean }
}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const [wardrobeRow, accountRow, profile] = await Promise.all([store.get(WARDROBE_KIND, WARDROBE_ID),
      readWardrobeAccountState(store), store.get<RoomUserProfile>('room_user_profile', WARDROBE_ID)])
    const avatar = input.avatar && !same(profile?.value.avatar, input.avatar) ? input.avatar : null
    const built = input.build(accountRow.state)
    if (built.skip) return readRoomWardrobe(store)
    try {
      await store.commit({ requestId: 'wardrobe-account:' + randomUUID(), checks: [
        { kind: WARDROBE_KIND, id: WARDROBE_ID, expectedRevision: wardrobeRow?.revision ?? null },
        { kind: WARDROBE_ACCOUNT_KIND, id: WARDROBE_ACCOUNT_ID, expectedRevision: accountRow.revision },
        ...(avatar ? [{ kind: 'room_user_profile' as const, id: WARDROBE_ID, expectedRevision: profile?.revision ?? null }] : [])
      ], puts: [
        { kind: WARDROBE_KIND, id: WARDROBE_ID, value: input.wardrobe },
        { kind: WARDROBE_ACCOUNT_KIND, id: WARDROBE_ACCOUNT_ID, value: built.state },
        ...(avatar ? [{ kind: 'room_user_profile' as const, id: WARDROBE_ID, value: { ...profile?.value, avatar } }] : [])
      ], events: [
        { roomId: WARDROBE_DIRECTORY, kind: 'wardrobe.updated', payload: {} },
        ...(avatar ? [{ roomId: WARDROBE_DIRECTORY, kind: 'presentation.user-profile.updated', payload: {} }] : []),
        ...(built.events ?? [])
      ] })
      return readRoomWardrobe(store)
    } catch (error) { if (!(error instanceof RoomStoreConflictError) || attempt >= 4) throw error }
  }
  throw new Error('wardrobe unavailable')
}

function assertAccountMirror(): void {
  if (wardrobeLocalDebug()) throw new RoomWardrobeAccountError('wardrobe_local_debug')
}

/** Signs this machine's wardrobe in: the account snapshot replaces it and the account look is worn. */
export async function attachAccountWardrobe(store: RoomStore, input: z.infer<typeof AttachWardrobeRequest>) {
  assertAccountMirror()
  await readRoomWardrobe(store)
  const snapshot = mirrorWardrobe(input.wardrobe)
  const entries=(await readQueue(store)).state.entries.filter(e=>e.actor==='u:'+input.userId)
  for(const drop of [...snapshot.pending,...snapshot.history]) {
    const entry=entries.find(e=>e.serverRunId===drop.runId)
    if(entry?.receiptReason && entry.receiptResetAt) drop.activityReceipt={reason:entry.receiptReason,resetAt:entry.receiptResetAt}
    if(entry) for(const key of ['roomId','threadId','messageId','sourceLabel'] as const) if(entry[key]) drop[key]=entry[key]
  }
  return replace(store, {
    wardrobe: snapshot, avatar: accountAvatar(input.look),
    build: (current) => {
      const sameUser = current?.mode === 'account' && current.userId === input.userId
      if (sameUser && (current.serverRevision??0)>(input.serverRevision??0)) return {state:current,skip:true}
      return { state: { mode: 'account', userId: input.userId, serverRevision:input.serverRevision,
        attachedAt: sameUser && current.attachedAt ? current.attachedAt : new Date().toISOString(), activity: [] } }
    }
  })
}

/** Signs out: the starter wardrobe returns and anything the look no longer owns is taken off. */
export async function detachAccountWardrobe(store: RoomStore) {
  assertAccountMirror()
  const detail = await readRoomWardrobe(store)
  if (detail.mode !== 'account') return detail
  const wardrobe = guestWardrobe(detail.wardrobe)
  const profile = await store.get<RoomUserProfile>('room_user_profile', WARDROBE_ID)
  return replace(store, { wardrobe, avatar: strippedLook(profile?.value.avatar, wardrobe), build: () => ({ state: { mode: 'guest', activity: [] } }) })
}

/**
 * Who owns the wardrobe on this machine. A signed-in Kun account owns it on the server and the
 * local row is only its mirror; without an account only the default look is available and turns
 * can produce login invitations. Debug runs keep the original local game.
 */
import { z } from 'zod'
import type { RoomStore } from './room-store.js'

export const WARDROBE_ACCOUNT_KIND: 'room_wardrobe_account' = 'room_wardrobe_account'
export const WARDROBE_ACCOUNT_ID = 'self'
/** Finished turns waiting for the main process to report them to the account; older ones are dropped. */
export const WARDROBE_ACTIVITY_LIMIT = 50

export const WardrobeActivitySchema = z.object({
  runId: z.string().min(1).max(256),
  source: z.enum(['room', 'code']),
  roomId: z.string().min(1).max(256).optional(),
  threadId: z.string().min(1).max(256).optional(),
  messageId: z.string().min(1).max(256).optional(),
  sourceLabel: z.string().max(120).optional(),
  queuedAt: z.string()
}).strict()
export type WardrobeActivity = z.infer<typeof WardrobeActivitySchema>

export const WardrobeAccountStateSchema = z.object({
  mode: z.enum(['guest', 'account']),
  userId: z.string().min(1).max(64).optional(),
  attachedAt: z.string().optional(),
  serverRevision: z.number().optional(),
  guestHints: z.array(z.object({ id: z.string().max(280), createdAt: z.string(), roomId: z.string().optional(), threadId: z.string().optional() }).strict()).max(20).optional(),
  activity: z.array(WardrobeActivitySchema).max(WARDROBE_ACTIVITY_LIMIT).default([])
}).strict()
export type WardrobeAccountState = z.infer<typeof WardrobeAccountStateSchema>

export type WardrobeMode = 'local' | 'guest' | 'account'

/** Production always uses account authority. Environment flags cannot unlock or mint assets. */
export const wardrobeUnlockAll = (): boolean => false
export const wardrobeSeedBottles = (): number => 0
export const wardrobeLocalDebug = (): boolean => false

export async function readWardrobeAccountState(store: RoomStore): Promise<{ state: WardrobeAccountState | null; revision: number | null }> {
  const row = await store.get(WARDROBE_ACCOUNT_KIND, WARDROBE_ACCOUNT_ID)
  return row ? { state: WardrobeAccountStateSchema.parse(row.value), revision: row.revision } : { state: null, revision: null }
}

export async function readWardrobeMode(store: RoomStore): Promise<WardrobeMode> {
  if (wardrobeLocalDebug()) return 'local'
  const { state } = await readWardrobeAccountState(store)
  return state?.mode ?? 'guest'
}

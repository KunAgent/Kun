import { rollKunWardrobeDrop, type KunWardrobe } from '../contracts/kun-wardrobe.js'
import { RoomStoreConflictError, type RoomStore } from './room-store.js'
import { WARDROBE_ACCOUNT_KIND, WARDROBE_ACCOUNT_ID, readWardrobeAccountState } from './room-wardrobe-mode.js'
import type { WardrobeTurnContext } from './room-wardrobe-service.js'
/** Same cadence as a normal drop, but no bottle, item, card or currency is granted. */
export async function countGuestWardrobeTurn(store: RoomStore, requestId: string,
  detail: { wardrobe: KunWardrobe; revision: number }, context: WardrobeTurnContext, now: Date): Promise<boolean> {
  const { state, revision } = await readWardrobeAccountState(store)
  if (state?.mode !== 'guest') return false
  const source = context.source ?? (context.roomId ? 'room' : 'code')
  const rolled = rollKunWardrobeDrop(detail.wardrobe, { ...context, source, now })
  const hint = rolled.drop ? { id: `guest-${context.runId}`.slice(0, 280), createdAt: now.toISOString(),
    ...(context.roomId ? { roomId: context.roomId } : {}), ...(context.threadId ? { threadId: context.threadId } : {}) } : null
  const guestHints = [...(state.guestHints ?? []), ...(hint ? [hint] : [])].slice(-20)
  const wardrobe = { ...rolled.wardrobe, pending: [], items: {}, roles: [], feathers: 0, history: [] }
  try {
    await store.commit({ requestId, checks: [
      { kind: WARDROBE_ACCOUNT_KIND, id: WARDROBE_ACCOUNT_ID, expectedRevision: revision },
      { kind: 'room_wardrobe', id: 'self', expectedRevision: detail.revision }
    ], puts: [
      { kind: WARDROBE_ACCOUNT_KIND, id: WARDROBE_ACCOUNT_ID, value: { ...state, guestHints } },
      { kind: 'room_wardrobe', id: 'self', value: wardrobe }
    ], events: hint ? [{ roomId: context.roomId ?? 'agent-directory', kind: 'wardrobe.guest_hint', payload: hint }] : [] })
    return true
  } catch (error) { if (error instanceof RoomStoreConflictError) return false; throw error }
}

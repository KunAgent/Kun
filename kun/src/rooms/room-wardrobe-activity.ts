/**
 * Finished turns of a signed-in user wait here until the main process reports them to the Kun
 * account, which decides whether a bottle drops. The queue is bounded and keyed by run id.
 */
import { RoomStoreConflictError, type RoomStore } from './room-store.js'
import {
  WARDROBE_ACCOUNT_ID, WARDROBE_ACCOUNT_KIND, WARDROBE_ACTIVITY_LIMIT, WardrobeActivitySchema, readWardrobeAccountState,
  type WardrobeActivity
} from './room-wardrobe-mode.js'

export type WardrobeActivityInput = {
  runId: string; source: 'room' | 'code'; roomId?: string; threadId?: string; messageId?: string; sourceLabel?: string; now: Date
}

/** Queues one turn under `requestId`, so a reconciliation of the same turn is ignored by the store. */
export async function queueWardrobeActivity(store: RoomStore, requestId: string, input: WardrobeActivityInput): Promise<void> {
  const label = input.sourceLabel?.trim().slice(0, 120)
  const entry: WardrobeActivity = WardrobeActivitySchema.parse({
    runId: input.runId, source: input.source,
    ...(input.roomId ? { roomId: input.roomId } : {}), ...(input.threadId ? { threadId: input.threadId } : {}),
    ...(input.messageId ? { messageId: input.messageId } : {}), ...(label ? { sourceLabel: label } : {}),
    queuedAt: input.now.toISOString()
  })
  for (let attempt = 0; attempt < 5; attempt++) {
    const { state, revision } = await readWardrobeAccountState(store)
    if (state?.mode !== 'account' || state.activity.some((queued) => queued.runId === entry.runId)) return
    const activity = [...state.activity, entry].slice(-WARDROBE_ACTIVITY_LIMIT)
    try {
      await store.commit({ requestId, checks: [{ kind: WARDROBE_ACCOUNT_KIND, id: WARDROBE_ACCOUNT_ID, expectedRevision: revision }],
        puts: [{ kind: WARDROBE_ACCOUNT_KIND, id: WARDROBE_ACCOUNT_ID, value: { ...state, activity } }],
        events: [{ roomId: 'agent-directory', kind: 'wardrobe.activity', payload: { runId: entry.runId } }] })
      return
    } catch (error) { if (!(error instanceof RoomStoreConflictError)) throw error }
  }
}

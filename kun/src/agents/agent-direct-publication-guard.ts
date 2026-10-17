import { contextGeneration, lifecycleRow } from './agent-lifecycle-state.js'
import type { Room } from '../contracts/rooms.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import type { RoomRequestState } from '../rooms/room-runtime-types.js'
import type { RoomStore, RoomStoreCommit } from '../rooms/room-store.js'

/** Fence both chat and saved-file metadata against durable source/root cancellation. */
export async function privatePublicationChecks(store: RoomStore, run: RoomRunRecord) {
  const checks: NonNullable<RoomStoreCommit['checks']> = []
  if (run.phase !== 'conversation' || !run.requestId) return checks
  // A turn may remain locally running after Stop. Check these revisions in the
  // same transaction that makes the publication visible, not just before it.
  const room = await store.get<Room>('room', run.roomId)
  if (!room || room.value.conversationKind === 'user_agent' && room.value.deletedAt)
    throw new Error('Private conversation publication generation changed')
  const state = room.value.conversationKind === 'user_agent' ? await lifecycleRow(store, room.value) : null
  if (state?.value.state === 'restarting') throw new Error('Private conversation is restarting')
  // Source and continuation requests share one room/lifecycle snapshot. A
  // commit must contain each document revision exactly once.
  checks.push({ kind: 'room', id: room.id, expectedRevision: room.revision },
    ...(state ? [{ kind: 'agent_lifecycle' as const, id: state.id, expectedRevision: state.revision }] : []))
  const ids = new Set([run.requestId, run.rootRequestId ?? run.requestId])
  for (const id of ids) {
    const request = await store.get<RoomRequestState>('request', id)
    if (!request || request.roomId !== run.roomId || request.value.cancellationRequested ||
      ['stopping', 'cancelled', 'recovery_required'].includes(request.value.status)) {
      throw new Error('Private conversation publication was cancelled or is unavailable')
    }
    if (room.value.conversationKind === 'user_agent' &&
      contextGeneration(room.value) !== contextGeneration(request.value.roomSnapshot))
      throw new Error('Private conversation publication generation changed')
    checks.push({ kind: 'request', id, expectedRevision: request.revision })
  }
  return checks
}

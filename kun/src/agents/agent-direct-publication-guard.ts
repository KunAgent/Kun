import type { RoomRunRecord } from '../contracts/room-runs.js'
import type { RoomRequestState } from '../rooms/room-runtime-types.js'
import type { RoomStore, RoomStoreCommit } from '../rooms/room-store.js'

/** Fence both chat and saved-file metadata against durable source/root cancellation. */
export async function privatePublicationChecks(store: RoomStore, run: RoomRunRecord) {
  const checks: NonNullable<RoomStoreCommit['checks']> = []
  if (run.phase !== 'conversation' || !run.requestId) return checks
  // A turn may remain locally running after Stop. Check these revisions in the
  // same transaction that makes the publication visible, not just before it.
  const ids = new Set([run.requestId, run.rootRequestId ?? run.requestId])
  for (const id of ids) {
    const request = await store.get<RoomRequestState>('request', id)
    if (!request || request.roomId !== run.roomId || request.value.cancellationRequested ||
      ['stopping', 'cancelled', 'recovery_required'].includes(request.value.status)) {
      throw new Error('Private conversation publication was cancelled or is unavailable')
    }
    checks.push({ kind: 'request', id, expectedRevision: request.revision })
  }
  return checks
}

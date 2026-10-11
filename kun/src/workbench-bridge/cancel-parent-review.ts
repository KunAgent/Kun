import type { WorkbenchLink } from '../contracts/workbench-links.js'
import type { RoomRequestState } from '../rooms/room-runtime-types.js'
import { putRoomDocument } from '../rooms/room-service.js'
import { settleRoomResultInbox } from '../rooms/room-result-inbox.js'
import type { WorkbenchBridge } from './bridge.js'
import { updateWorkbenchLink } from './link-store.js'

/** Cancels only this card's result review, even when newer user turns share its thread. */
export async function cancelWorkbenchParentReview(bridge: WorkbenchBridge, link: WorkbenchLink): Promise<void> {
  if (!link.outcomeRequestId) return
  const row = await bridge.store.get<RoomRequestState>('request', link.outcomeRequestId)
  if (!row || row.roomId !== link.roomId || !row.value.privateContinuation ||
    ['completed', 'failed', 'cancelled'].includes(row.value.status)) return
  const request = { ...row.value, cancellationRequested: true,
    status: row.value.turnId || row.value.admissionAttempted ? 'stopping' as const : 'cancelled' as const }
  await putRoomDocument(bridge.store, 'request', row.id, link.roomId, request, row)
  await settleRoomResultInbox(bridge.store, request)
  const thread = await bridge.deps.threads.getMetadata(request.threadId)
  const identity = `private-${request.id}-${request.stepAttempt ?? 0}`
  const turn = thread?.turns.find((entry) => entry.id === request.turnId || entry.clientRequestId === identity)
  if (turn?.status === 'running') await bridge.deps.turns.interruptTurn({ threadId: request.threadId, turnId: turn.id })
  if (turn?.status === 'queued') await bridge.deps.turns.cancelQueuedTurn({ threadId: request.threadId, turnId: turn.id })
  await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ cancelRequested: true }))
  bridge.wake()
}

import type { RoomRunRecord } from '../contracts/room-runs.js'
import type { RoomRuntimeDeps } from '../rooms/room-runtime-types.js'
import type { RoomService } from '../rooms/room-service.js'
import { observeRoomTurn } from '../rooms/room-execution.js'
import { roomRunSegmentMessageId } from '../rooms/room-run-segments.js'

/**
 * External engines cannot reliably call Kun's publishing tool, so the host
 * posts the turn's final assistant text as the member's message. The message
 * id derives from the run and item, so a retried tick republishes in place.
 */
export async function publishExternalAgentReply(deps: RoomRuntimeDeps, service: RoomService, input: {
  roomId: string; runId: string; threadId: string; turnId: string; memberId: string
}): Promise<void> {
  const run = await deps.store.get<RoomRunRecord>('room_run', input.runId)
  if (!run || run.value.publishedMessageId) return
  const observed = await observeRoomTurn(deps, input.threadId, input.turnId)
  const final = observed.status === 'completed' ? observed.segments?.at(-1) : undefined
  if (!final) return
  await service.publishSegment(input.roomId, { messageId: roomRunSegmentMessageId(input.runId, final.itemId),
    runId: input.runId, itemId: final.itemId, body: final.text, memberId: input.memberId,
    createdAt: final.createdAt, status: 'final' })
}

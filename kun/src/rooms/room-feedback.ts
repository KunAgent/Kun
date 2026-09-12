import type { RoomDelivery, RoomReview } from '../contracts/room-deliveries.js'
import type { RoomRuntimeDeps, RoomTaskExecution } from './room-runtime-types.js'

export function roomReviewFeedback(review: RoomReview): string {
  return '\nAddress these findings for the pinned delivery. Report each resolution and validation:\n' + JSON.stringify(review)
}
export async function withLatestRoomReview(deps: RoomRuntimeDeps, execution: RoomTaskExecution): Promise<string> {
  if (!execution.task.latestDeliveryId) return execution.prompt
  const delivery = await deps.store.get<RoomDelivery>('delivery', execution.task.latestDeliveryId)
  if (!delivery || delivery.roomId !== execution.task.roomId || delivery.value.taskId !== execution.task.id) {
    throw new Error('review handoff delivery identity unavailable')
  }
  let beforeSeq: number | undefined
  do {
    const rows = await deps.store.list<RoomReview>('review', { roomId: execution.task.roomId, taskId: execution.task.id, limit: 100, beforeSeq })
    const review = rows.find((row) => row.value.deliveryId === delivery.id && row.value.versionHash === delivery.value.versionHash)?.value
    if (review) return execution.prompt + (review.verdict === 'changes_requested' ? roomReviewFeedback(review) : '')
    if (rows.length < 100) break
    beforeSeq = rows.at(-1)!.seq
  } while (beforeSeq !== undefined)
  return execution.prompt
}

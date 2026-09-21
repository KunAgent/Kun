import type { Turn } from '../contracts/turns.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import type { RoomRuntimeDeps } from '../rooms/room-runtime-types.js'
import { updateRoomRun } from '../rooms/room-run-recording.js'

/**
 * Settle a private conversation run's outcome once its turn is terminal.
 * Visible replies are published mid-turn through `send_im_message`, which only
 * stamps `publishedMessageId` while the run is still live; the terminal read
 * decides between `published`, `skipped`, `failed`, or `cancelled`.
 */
export async function settleConversationRunOutcome(
  deps: RoomRuntimeDeps,
  runId: string | undefined,
  turn: Pick<Turn, 'status'>
): Promise<void> {
  if (!runId) return
  const row = await deps.store.get<RoomRunRecord>('room_run', runId)
  if (!row || row.value.outcome) return
  const outcome = turn.status === 'completed'
    ? (row.value.publishedMessageId ? 'published' : 'skipped')
    : turn.status === 'aborted' ? 'cancelled' : 'failed'
  await updateRoomRun(deps.store, runId, { outcome })
}

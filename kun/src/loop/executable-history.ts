import { isRejectedQueuedTurn } from '../domain/queue-execution-state.js'
import type { TurnItem } from '../contracts/items.js'
import type { ThreadRecord } from '../contracts/threads.js'

/** Queue admission persists user items, but they are not executable history yet. */
export function executableHistory(items: TurnItem[], thread: ThreadRecord | null): TurnItem[] {
  if (!thread) return items
  const hidden = new Set(thread.turns.filter((turn) => turn.status === 'queued' ||
    turn.admissionPending || turn.steeredToTurnId || isRejectedQueuedTurn(turn))
    .map((turn) => turn.id))
  let visible = items.filter((item) => !hidden.has(item.turnId))
  // Only relocate the original queued user input before its execution anchor.
  // All other records retain their relative order, including compaction
  // boundaries, inherited history and tool-call/result pairs.
  for (const turn of thread.turns) {
    if (!turn.queueExecutionAnchorItemId || hidden.has(turn.id)) continue
    const anchor = visible.findIndex((item) => item.id === turn.queueExecutionAnchorItemId)
    if (anchor < 0) continue // A later compaction has already materialized the projection.
    const before = visible.slice(0, anchor + 1)
    const admissionUser = visible.find((item) => item.turnId === turn.id && item.kind === 'user_message')
    const moved = before.filter((item) => item === admissionUser)
    if (moved.length === 0) continue
    visible = [...before.filter((item) => item !== admissionUser), ...moved, ...visible.slice(anchor + 1)]
  }
  return visible
}

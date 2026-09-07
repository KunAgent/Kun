import type { TurnItem } from '../contracts/items.js'
import type { ThreadRecord } from '../contracts/threads.js'

/** Queue admission persists user items, but they are not executable history yet. */
export function executableHistory(items: TurnItem[], thread: ThreadRecord | null): TurnItem[] {
  if (!thread) return items
  const hidden = new Set(thread.turns.filter((turn) => turn.status === 'queued' ||
    turn.admissionPending || turn.steeredToTurnId || turn.terminalCode === 'queue_cancelled')
    .map((turn) => turn.id))
  return items.filter((item) => !hidden.has(item.turnId))
}

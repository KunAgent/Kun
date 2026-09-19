import type { NormalizedThread } from '../../agent/types'
import { isSourceHistoryTurn } from '../../history-reference/history-reference-api'
import type { Turn } from './message-timeline-turns'

/** Position before a rendered turn (or after the final turn) in the full local list. */
export function timelineForkPointIndex(
  turns: readonly Turn[],
  thread: NormalizedThread | null | undefined,
  hasEarlierHistory: boolean
): number | undefined {
  if (!thread?.forkedFromThreadId) return undefined
  // The runtime retains native IDs on fork. Identity survives both source
  // prefixes and remote pagination, where local counts are not absolute.
  if (thread.forkedFromTurnId) {
    const index = turns.findIndex((turn) => !isSourceHistoryTurn(turn) &&
      turn.turnId === thread.forkedFromTurnId)
    return index < 0 ? undefined : index + 1
  }
  if (typeof thread.forkedFromTurnCount !== 'number') return undefined
  const count = Math.max(0, thread.forkedFromTurnCount)
  // Preserve the old behavior for ordinary legacy conversations.
  if (!thread.historyRefId) return count
  // Older reference forks only have a native count. Do not guess an absolute
  // index from a partial page; show the boundary once that prefix is loaded.
  if (hasEarlierHistory) return undefined
  const nativeIndices = turns.flatMap((turn, index) => isSourceHistoryTurn(turn) ? [] : [index])
  if (count < nativeIndices.length) return nativeIndices[count]
  return count === nativeIndices.length ? turns.length : undefined
}

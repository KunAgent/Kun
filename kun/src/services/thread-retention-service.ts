import type { ThreadRecord } from '../contracts/threads.js'
import type { ThreadRetentionPolicy } from '../contracts/thread-retention.js'

/** Select the last completed turn eligible for pruning; retention rules form a union. */
export function selectRetentionCutoff(
  thread: ThreadRecord,
  policy: ThreadRetentionPolicy,
  nowIso: string
): string | undefined {
  const completed = thread.turns.filter((turn) => turn.status === 'completed')
  if (completed.length === 0) return undefined
  if (policy.throughTurnId) {
    // An explicit boundary must identify a completed turn; the cutoff is
    // exactly that turn (its items are archived along with everything older).
    const boundary = completed.find((turn) => turn.id === policy.throughTurnId)
    return boundary?.id
  }
  const retained = new Set<string>()
  if (policy.keepLastTurns !== undefined) {
    for (const turn of completed.slice(-policy.keepLastTurns)) retained.add(turn.id)
  }
  if (policy.keepDays !== undefined) {
    const now = Date.parse(nowIso)
    const cutoff = Number.isFinite(now) ? now - policy.keepDays * 86_400_000 : Number.NEGATIVE_INFINITY
    for (const turn of completed) {
      const at = Date.parse(turn.finishedAt ?? turn.createdAt)
      if (Number.isFinite(at) && at >= cutoff) retained.add(turn.id)
    }
  }
  const pruneable = completed.filter((turn) => !retained.has(turn.id))
  return pruneable.at(-1)?.id
}

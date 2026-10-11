import type { RoomRunRecord } from '@shared/rooms-api'

/**
 * One private conversation is one Agent session: every turn, oldest first,
 * the way the Code timeline shows a thread. Turns steered into another run
 * render with that run, and a context reset is marked where the thread changes.
 */
export function sessionRuns(runs: RoomRunRecord[]): RoomRunRecord[] {
  const seenTurns = new Set<string>()
  return [...new Map(runs.map((run) => [run.id, run])).values()]
    .filter((run) => run.phase === 'conversation' && !run.mergedIntoRunId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .filter((run) => {
      if (!run.turnId) return true
      const key = (run.threadId ?? '') + ':' + run.turnId
      if (seenTurns.has(key)) return false
      seenTurns.add(key)
      return true
    })
}

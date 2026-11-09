import type { DispatchRecord } from '../contracts/ade.js'
import type { Turn } from '../contracts/turns.js'
import type { FileDispatchStore } from './dispatch-store.js'

/** Copy only proven boundaries of this dispatch's turn, never child-run or review times. */
export function dispatchTurnTimingPatch(current: DispatchRecord, turn: Turn): Partial<DispatchRecord> | null {
  if (current.workerId !== turn.threadId ||
      (current.turnId && current.turnId !== turn.id) ||
      (turn.clientRequestId && turn.clientRequestId !== current.dispatchId) ||
      (!current.turnId && turn.clientRequestId !== current.dispatchId)) return null
  const patch: Partial<DispatchRecord> = {}
  if (!current.turnId) patch.turnId = turn.id
  if (!current.startedAt && turn.startedAt) patch.startedAt = turn.startedAt
  if (!current.finishedAt && turn.finishedAt) patch.finishedAt = turn.finishedAt
  return Object.keys(patch).length ? patch : null
}

export async function backfillDispatchTiming(
  dispatches: Pick<FileDispatchStore, 'mutate'>,
  teamId: string,
  dispatchId: string,
  turn: Turn
): Promise<void> {
  await dispatches.mutate(teamId, dispatchId, (current) => dispatchTurnTimingPatch(current, turn))
}

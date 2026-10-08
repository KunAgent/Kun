import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'
import { isQueueExecutionBlocked } from '../domain/queue-execution-state.js'
import type { RoomRuntimeDeps } from '../rooms/room-runtime-types.js'

/** Restart recovery gets this long to resume its own source turn before a private message takes over. */
export const PRIVATE_RESTART_RECOVERY_GRACE_MS = 30_000

/**
 * A private conversation has no queue controls: each message the user sends is
 * the explicit instruction to continue. Stop and restart recovery pause the
 * thread queue, so a message that was queued behind a stopped or orphaned turn
 * would otherwise wait forever. Resume it once nothing else is executing.
 */
export async function resumeStalledPrivateQueue(deps: Pick<RoomRuntimeDeps, 'turns'>, thread: ThreadRecord,
  turn: Turn, now = Date.now()): Promise<boolean> {
  if (turn.status !== 'queued' || turn.admissionPending || thread.status === 'archived') return false
  if (thread.turns.some((item) => item.status === 'running')) return false
  if (!isQueueExecutionBlocked(thread)) return false
  const control = thread.queueControl
  if (control?.reason === 'restart_recovery' && now - Date.parse(control.pausedAt) < PRIVATE_RESTART_RECOVERY_GRACE_MS) return false
  await deps.turns.resumeQueuedTurns(thread.id)
  deps.turns.notifyTurnQueued(thread.id)
  return true
}

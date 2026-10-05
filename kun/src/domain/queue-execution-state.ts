import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'

/** Queue inputs (including cancelled/rejected ones) are not executed attempts. */
export function latestExecutedTurn(thread: Pick<ThreadRecord, 'turns'> | null | undefined): Turn | undefined {
  return thread?.turns.slice().reverse().find((turn) => turn.status !== 'queued' && !isRejectedQueuedTurn(turn))
}

export function hasRunningTurn(thread: Pick<ThreadRecord, 'turns'> | null | undefined): boolean {
  return Boolean(thread?.turns.some((turn) => turn.status === 'running'))
}

/** Recheck at launch time: explicit queue resume cancels a deferred recovery. */
export function restartSourceIsCurrent(thread: ThreadRecord | null, sourceTurnId: string): boolean {
  if (!thread || thread.queueControl?.reason === 'user_stop' || thread.queueResumeSourceTurnId === sourceTurnId) return false
  const latest = latestExecutedTurn(thread)
  if (latest?.id !== sourceTurnId || latest.status !== 'failed') return false
  return !thread.turns.some((turn) => turn.status === 'queued') ||
    (thread.queueControl?.reason === 'restart_recovery' && thread.queueControl.sourceTurnId === sourceTurnId)
}

/** Recovery executes ahead of existing queued inputs; preserve execution chronology. */
export function insertRecoveryTurn(turns: Turn[], recovery: Turn): Turn[] {
  const firstQueued = turns.findIndex((turn) => turn.status === 'queued')
  return firstQueued < 0 ? [...turns, recovery]
    : [...turns.slice(0, firstQueued), recovery, ...turns.slice(firstQueued)]
}

export function isRejectedQueuedTurn(turn: Turn): boolean {
  return !turn.startedAt && ['queue_cancelled', 'queue_admission_failed', 'write_context_stale'].includes(turn.terminalCode ?? '')
}

/** Legacy terminal records remain a stop/recovery barrier until explicit resume. */
export function isQueueExecutionBlocked(thread: ThreadRecord): boolean {
  if (thread.queueControl) return true
  const latest = latestExecutedTurn(thread)
  if (!latest || thread.queueResumeSourceTurnId === latest.id) return false
  return latest.status === 'aborted' || (latest.status === 'failed' &&
    ['orphaned_after_restart', 'owner_lease_expired'].includes(latest.terminalCode ?? ''))
}

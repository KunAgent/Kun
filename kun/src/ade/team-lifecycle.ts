import type { ThreadRecord } from '../contracts/threads.js'
import type { FileTeamStore } from './team-store.js'

/**
 * ADE delete cascade (09 §3.2):
 * - deleting a manager thread removes its team directory and revokes every
 *   worker harness grant;
 * - deleting a worker thread marks its team record `released`.
 *
 * Runs inside the thread `onDeleting` path while the record is still
 * readable; failures are logged, never fatal to the delete itself.
 */
export async function handleAdeThreadDeleted(options: {
  thread: Pick<ThreadRecord, 'id' | 'executionUnit'> | null
  teams: FileTeamStore
  revokeThreadGrants: (threadId: string) => unknown
  nowIso: () => string
  /** Drop coordinator state (holds, timers) for the deleted manager. */
  onManagerDeleted?: (managerThreadId: string) => void
}): Promise<void> {
  const { thread, teams, revokeThreadGrants, nowIso } = options
  if (!thread) return
  try {
    const unit = thread.executionUnit
    if (unit?.kind === 'worker') {
      await teams.updateWorker(unit.teamId, thread.id, {
        state: 'released',
        releasedAt: nowIso()
      })
      return
    }
    const team = await teams.byManager(thread.id)
    if (!team) return
    options.onManagerDeleted?.(thread.id)
    for (const worker of team.workers) {
      try {
        revokeThreadGrants(worker.workerId)
      } catch (error) {
        console.warn(`[kun] ade worker grant revoke failed worker=${worker.workerId}:`, error)
      }
    }
    await teams.removeTeam(thread.id)
  } catch (error) {
    console.warn(`[kun] ade team cleanup failed for thread=${thread?.id ?? 'unknown'}:`, error)
  }
}

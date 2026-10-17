import type { DispatchRecord, TeamRecord, WorkerRecord } from '../contracts/ade.js'
import type { ChildRunRecord } from '../delegation/delegation-runtime-contracts.js'
import type { ManagerRuntimeDeps } from './manager-runtime-deps.js'

export type StrandedDispatchSettlement = {
  team: TeamRecord
  worker: WorkerRecord
  dispatches: DispatchRecord[]
}

const SETTLED_CHILD_STATUSES: ReadonlySet<ChildRunRecord['status']> = new Set([
  'completed',
  'failed',
  'aborted'
])

/**
 * A detached worker child can settle before its dispatch turn ever exists:
 * a queue timeout, a stop while waiting for a slot, or the startup orphan
 * sweep after a runtime restart. No worker turn-terminal event will follow,
 * so without this the dispatch stays `accepted` forever and the manager keeps
 * reporting it as running. Settles every such dispatch from the child record.
 */
export async function settleStrandedWorkerDispatches(
  deps: Pick<ManagerRuntimeDeps, 'childRuns' | 'teams' | 'threads' | 'dispatches'>,
  managerThreadId: string,
  workerId: string
): Promise<StrandedDispatchSettlement | null> {
  const run = await deps.childRuns.get(workerId).catch(() => null)
  if (!run || !SETTLED_CHILD_STATUSES.has(run.status)) return null
  const team = await deps.teams.get(managerThreadId) ?? await deps.teams.byManager(managerThreadId)
  const worker = team?.workers.find((entry) => entry.workerId === workerId)
  if (!team || !worker) return null
  const thread = await deps.threads.get(workerId).catch(() => null)
  const candidates = (await deps.dispatches.listByWorker(team.teamId, workerId)).filter((dispatch) =>
    dispatch.state === 'accepted' &&
    !dispatch.turnId &&
    !thread?.turns.some((turn) => turn.clientRequestId === dispatch.dispatchId) &&
    // The settled record must belong to this dispatch's run, not an earlier one.
    Date.parse(run.updatedAt) >= Date.parse(dispatch.createdAt))
  const cancelled = run.status === 'aborted' && run.terminationReason !== 'runtime_restart'
  const failureReason = strandedDispatchReason(run).slice(0, 4_000)
  const settled: DispatchRecord[] = []
  for (const dispatch of candidates) {
    const updated = await deps.dispatches.update(team.teamId, dispatch.dispatchId, {
      state: cancelled ? 'cancelled' : 'failed',
      outcome: cancelled ? 'aborted' : 'failed',
      failureReason
    }, { expect: ['accepted'] }).catch(() => null)
    if (updated) settled.push(updated)
  }
  return settled.length ? { team, worker, dispatches: settled } : null
}

export function strandedDispatchReason(run: Pick<ChildRunRecord, 'status' | 'terminationReason' | 'error'>): string {
  const detail = run.error?.trim()
  if (run.terminationReason === 'runtime_restart') {
    return 'Interrupted by a Kun runtime restart before the worker started this assignment; no work was done. ' +
      'Dispatch it again if it is still needed.'
  }
  if (run.status === 'aborted') {
    return `The worker run was stopped before this assignment started${detail ? `: ${detail}` : '.'}`
  }
  if (run.status === 'completed') {
    return 'The worker run ended without starting this assignment; dispatch it again if it is still needed.'
  }
  return `The worker failed before this assignment started: ${detail || 'unknown error'}`
}

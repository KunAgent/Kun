import type { DispatchRecord } from '../contracts/ade.js'
import type { ActivityReviewStatus } from '../contracts/activity.js'
import type { ActivityStore } from '../services/activity-store.js'
import type { FileDispatchStore } from './dispatch-store.js'
import type { FileTeamStore } from './team-store.js'
import type { TaskWorkspaceService } from '../workspace-tasks/task-workspace-service.js'
import { captureReviewRevision } from '../workspace-tasks/review-revision.js'
import { reviewRevisionValidity } from '../contracts/review-revision.js'

type ReviewProjection = { reviewRequired: boolean; reviewStatus?: ActivityReviewStatus }

/** Project quality facts independently from execution and read acknowledgement. */
export function workerReviewProjection(dispatches: readonly DispatchRecord[]): ReviewProjection {
  const reviewable = dispatches.filter((dispatch) =>
    dispatch.state === 'completed' ||
    (dispatch.capture?.changedFiles ?? 0) > 0
  )
  if (reviewable.length === 0) return { reviewRequired: false }
  if (reviewable.some((dispatch) => dispatch.verdict?.status === 'needs_changes')) {
    return { reviewRequired: true, reviewStatus: 'needs_changes' }
  }
  if (reviewable.some((dispatch) => !dispatch.verdict || dispatch.verdict.status === 'pending')) {
    return { reviewRequired: true, reviewStatus: 'pending' }
  }
  const latest = [...reviewable].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  return {
    reviewRequired: true,
    reviewStatus: latest.verdict?.status ?? 'unknown'
  }
}

async function revisionAwareProjection(
  dispatches: readonly DispatchRecord[],
  workspace?: { workspaceId: string; path: string }
): Promise<ReviewProjection> {
  const projection = workerReviewProjection(dispatches)
  if (!workspace || !projection.reviewRequired ||
      projection.reviewStatus === 'pending' || projection.reviewStatus === 'needs_changes') return projection
  const latest = dispatches
    .filter((entry) => entry.state === 'completed' || (entry.capture?.changedFiles ?? 0) > 0)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  if (!latest) return projection
  const current = await captureReviewRevision(workspace.workspaceId, workspace.path)
  const validity = reviewRevisionValidity(latest.verdict?.revision, current)
  return validity === 'current' ? projection
    : { reviewRequired: true, reviewStatus: validity }
}

export async function refreshWorkerReviewActivity(
  dispatches: Pick<FileDispatchStore, 'listByWorker'>,
  activity: Pick<ActivityStore, 'apply'> | undefined,
  teamId: string,
  workerId: string,
  workspace?: { workspaceId: string; path: string }
): Promise<void> {
  if (!activity) return
  const projection = await revisionAwareProjection(
    await dispatches.listByWorker(teamId, workerId), workspace
  )
  activity.apply(workerId, projection, 'runtime')
}

/** Reconcile persisted verdicts after ActivityStore reconstructs worker rows. */
export async function reconcileWorkerReviewActivity(
  dispatches: Pick<FileDispatchStore, 'list'>,
  activity: Pick<ActivityStore, 'list' | 'apply'>,
  teams?: Pick<FileTeamStore, 'get'>,
  taskWorkspaces?: Pick<TaskWorkspaceService, 'get'>
): Promise<void> {
  const workers = activity.list().filter((row) => row.kind === 'worker' && row.teamId)
  const byTeam = new Map<string, string[]>()
  for (const worker of workers) {
    const ids = byTeam.get(worker.teamId!) ?? []
    ids.push(worker.unitId)
    byTeam.set(worker.teamId!, ids)
  }
  for (const [teamId, workerIds] of byTeam) {
    const all = await dispatches.list(teamId).catch(() => [] as DispatchRecord[])
    const team = await teams?.get(teamId).catch(() => null)
    for (const workerId of workerIds) {
      if (team?.workers.some((worker) => worker.workerId === workerId && worker.reviewOf)) {
        activity.apply(workerId, { reviewRequired: false, reviewStatus: undefined }, 'runtime')
        continue
      }
      const worker = team?.workers.find((entry) => entry.workerId === workerId)
      const workspace = worker?.taskWorkspaceId ? taskWorkspaces?.get(worker.taskWorkspaceId) : undefined
      activity.apply(workerId, await revisionAwareProjection(
        all.filter((entry) => entry.workerId === workerId), workspace
      ), 'runtime')
    }
  }
}

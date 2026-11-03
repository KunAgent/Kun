import type { DispatchRecord } from '../contracts/ade.js'
import type { ActivityState } from '../contracts/activity.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { ActivityStore } from '../services/activity-store.js'
import type { TaskWorkspaceService } from '../workspace-tasks/task-workspace-service.js'
import type { FileDispatchStore } from './dispatch-store.js'
import type { FileTeamStore } from './team-store.js'

/** Same window ActivityStore.hydrate applies to ordinary threads. */
const RESTORE_WINDOW_MS = 7 * 24 * 60 * 60_000

type RestoredState = { mainState: ActivityState; lastOutcome?: 'completed' | 'failed' | 'cancelled' }

/**
 * Rebuild Workers rows after a restart. Worker threads are side threads, which
 * the generic activity hydrate never lists, and a worker whose first run never
 * started has no thread at all; without this the Workers panel and composer
 * pill disappear for teams that still exist on disk.
 */
export async function restoreWorkerActivityRows(deps: {
  teams: Pick<FileTeamStore, 'list'>
  dispatches: Pick<FileDispatchStore, 'listByWorker'>
  threads: Pick<ThreadStore, 'get'> & Partial<Pick<ThreadStore, 'getMetadata'>>
  activity: Pick<ActivityStore, 'get' | 'register'>
  taskWorkspaces?: Pick<TaskWorkspaceService, 'get'>
  nowMs?: () => number
}): Promise<number> {
  const cutoff = (deps.nowMs?.() ?? Date.now()) - RESTORE_WINDOW_MS
  let restored = 0
  for (const team of await deps.teams.list().catch(() => [])) {
    if (team.status !== 'active') continue
    for (const worker of team.workers) {
      if (worker.state !== 'active' || deps.activity.get(worker.workerId)) continue
      const thread = await (deps.threads.getMetadata ?? deps.threads.get)
        .call(deps.threads, worker.workerId).catch(() => null)
      if (thread?.status === 'archived' || thread?.status === 'deleted') continue
      const touchedAt = Date.parse(thread?.updatedAt ?? worker.createdAt)
      if (!Number.isFinite(touchedAt) || touchedAt < cutoff) continue
      const lastTurn = thread?.turns.at(-1)
      const state = lastTurn
        ? turnState(lastTurn.status)
        : dispatchState(await deps.dispatches.listByWorker(team.teamId, worker.workerId).catch(() => []))
      const workspace = worker.taskWorkspaceId ? deps.taskWorkspaces?.get(worker.taskWorkspaceId) : undefined
      deps.activity.register({
        unitId: worker.workerId,
        kind: 'worker',
        threadId: worker.workerId,
        parentThreadId: team.managerThreadId,
        teamId: team.teamId,
        harnessId: worker.route.harnessId,
        title: worker.label.slice(0, 200),
        workspace: {
          path: workspace?.path ?? worker.securitySnapshot.sandboxRoot,
          kind: workspace?.isolation === 'worktree' ? 'worktree'
            : workspace?.isolation === 'directory' ? 'directory' : 'local'
        },
        mainState: state.mainState,
        ...(state.lastOutcome ? { lastOutcome: state.lastOutcome } : {}),
        ...(lastTurn ? { turnId: lastTurn.id } : {}),
        reviewRequired: !worker.reviewOf,
        ...(!worker.reviewOf ? { reviewStatus: 'pending' as const } : {}),
        provenance: 'restored'
      })
      restored += 1
    }
  }
  return restored
}

function turnState(status: string): RestoredState {
  switch (status) {
    case 'queued':
      return { mainState: 'initializing' }
    case 'running':
      return { mainState: 'working' }
    case 'completed':
      return { mainState: 'done', lastOutcome: 'completed' }
    case 'failed':
      return { mainState: 'failed', lastOutcome: 'failed' }
    default:
      return { mainState: 'idle', lastOutcome: 'cancelled' }
  }
}

function dispatchState(dispatches: readonly DispatchRecord[]): RestoredState {
  const latest = [...dispatches].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  switch (latest?.state) {
    case 'completed':
      return { mainState: 'done', lastOutcome: 'completed' }
    case 'failed':
      return { mainState: 'failed', lastOutcome: 'failed' }
    case 'cancelled':
      return { mainState: 'idle', lastOutcome: 'cancelled' }
    default:
      return { mainState: 'initializing' }
  }
}

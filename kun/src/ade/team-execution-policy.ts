import { TeamLimitsSchema, type WorkerCapacity } from '../contracts/ade.js'
import type { ManagerRuntimeDeps } from './manager-runtime-deps.js'
import type { TeamRecord } from '../contracts/ade.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { FileTeamStore } from './team-store.js'

/** New dispatches use the latest task admission limits without changing running work. */
export async function refreshTeamExecutionPolicy(
  deps: { threads: Pick<ThreadStore, 'get'>; teams: Pick<FileTeamStore, 'updatePolicy'> },
  team: TeamRecord
): Promise<TeamRecord> {
  const thread = await deps.threads.get(team.managerThreadId)
  const snapshot = thread?.pendingExecutionConfig ?? thread?.executionConfig
  if (!snapshot) return team
  const limits = { ...team.limits, ...snapshot.limits }
  if (JSON.stringify([team.limits, team.budget]) === JSON.stringify([limits, snapshot.budget])) return team
  return await deps.teams.updatePolicy(team.teamId, limits, snapshot.budget) ?? team
}

/** Read-only snapshot; pending task policy takes precedence over a persisted team. */
export async function workerCapacity(
  deps: Pick<ManagerRuntimeDeps, 'threads' | 'teams' | 'teamLimits'>,
  threadId: string
): Promise<WorkerCapacity> {
  const [thread, team] = await Promise.all([deps.threads.get(threadId), deps.teams.get(threadId)])
  const execution = thread?.pendingExecutionConfig ?? thread?.executionConfig
  const limits = TeamLimitsSchema.parse({ ...TeamLimitsSchema.parse(deps.teamLimits?.() ?? {}),
    ...team?.limits, ...execution?.limits })
  return capacityForTeam(team, limits.hardWorkers)
}

export function capacityForTeam(team: TeamRecord | null, limit = team?.limits.hardWorkers ?? TeamLimitsSchema.parse({}).hardWorkers): WorkerCapacity {
  const active = team?.workers.filter(worker => worker.state === 'active').length ?? 0
  return { limit, active, available: Math.max(0, limit - active) }
}

export function workerLimitReport(capacity: WorkerCapacity, language?: string): string {
  return language?.toLowerCase().startsWith('zh')
    ? `团队 worker 名额已满（${capacity.active}/${capacity.limit}），未创建 worker。可复用已有 worker，或确认不再需要后释放。`
    : `Team worker capacity limit is full (${capacity.active}/${capacity.limit}); no worker was created. Reuse an existing worker, or release one after confirming it is no longer needed.`
}

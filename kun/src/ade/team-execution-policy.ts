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

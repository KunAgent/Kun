import type { GraphPlanningIssueV1 } from '../../contracts/graph.js'
import { rosterRefusal, type AgentRoster } from '../../delegation/agent-roster.js'
import type { GraphRosterRole } from '../../graph/index.js'

export type GraphPlanRoster = Pick<AgentRoster, 'resolve'>

const REPAIR_HINT =
  'Use an id returned by list_subagent_profiles whose graph lane is ok, or omit profile to let Kun route the task.'

/**
 * Resolve every task `profile` through the agent roster for the graph lane
 * before compilation. A task that pins its own harnessId keeps that engine and
 * only borrows the role. Failures become structured planning issues at the
 * task's `profile` path so the Lead fixes them in its next call.
 */
export async function resolveGraphPlanRoles(input: {
  tasks: ReadonlyArray<{ profile?: string; harnessId?: string; writeScopes: readonly string[] }>
  roster: GraphPlanRoster | undefined
  workspace: string
  surface?: 'code' | 'write' | 'design'
  /** Issue path to the task array, e.g. ['plan', 'tasks']. */
  tasksPath: readonly string[]
}): Promise<{ roles: Map<string, GraphRosterRole>; issues: GraphPlanningIssueV1[] }> {
  const roles = new Map<string, GraphRosterRole>()
  const issues: GraphPlanningIssueV1[] = []
  for (const [index, task] of input.tasks.entries()) {
    const id = task.profile?.trim()
    if (!id) continue
    const path = [...input.tasksPath, index, 'profile']
    if (!input.roster) {
      issues.push({ code: 'profile_unavailable', path, message: 'The agent roster is unavailable in this runtime.', repairHint: 'Omit profile.' })
      continue
    }
    const resolution = await input.roster.resolve(id, {
      lane: 'graph',
      workspace: input.workspace,
      ...(input.surface ? { surface: input.surface } : {}),
      engineOverridden: Boolean(task.harnessId)
    })
    if (!resolution.ok) {
      issues.push({
        code: `profile_${resolution.code}`,
        path,
        message: rosterRefusal(id, 'graph', resolution).slice(0, 2_048),
        repairHint: REPAIR_HINT
      })
      continue
    }
    if (resolution.profile.toolPolicy === 'readOnly' && task.writeScopes.length > 0) {
      issues.push({
        code: 'profile_read_only',
        path,
        message: `profile ${id} is read-only, but this task declares writeScopes.`,
        repairHint: 'Give this task an empty writeScopes array, or choose a role that may write.'
      })
      continue
    }
    const existing = roles.get(id)
    // A role bound to an engine resolves to the same route for every task;
    // keep the first resolution so an engine-pinning task cannot drop it.
    if (!existing || (!existing.route && resolution.route)) {
      roles.set(id, {
        id: resolution.id,
        profile: resolution.profile,
        ...(resolution.route ? { route: resolution.route } : {})
      })
    }
  }
  return { roles, issues }
}

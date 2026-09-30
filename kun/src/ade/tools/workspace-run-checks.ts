import {
  RunChecksInputSchema,
  type QualityCheck
} from '../../contracts/ade.js'
import type { ManagerToolContext } from '../manager-runtime.js'
import {
  runWorkspaceChecks,
  type WorkspaceCheckRunnerDeps
} from '../check-runner.js'
import { reportLanguage } from '../user-report.js'

/**
 * `workspace_run_checks` (10 §4.2): the host runs the repo's approved
 * `worktree.checks` commands inside the worker's task workspace and merges
 * results into the dispatch verdict as `source: 'host'`.
 */
export async function workspaceRunChecks(
  deps: WorkspaceCheckRunnerDeps,
  ctx: ManagerToolContext,
  rawInput: unknown
): Promise<{ ok: boolean; refusal?: string; checks?: QualityCheck[]; userReport: string }> {
  const language = reportLanguage(deps.language?.())
  const parsed = RunChecksInputSchema.safeParse(rawInput)
  if (!parsed.success || !parsed.data.workerId) {
    return {
      ok: false,
      refusal: 'invalid_input',
      userReport: language === 'zh' ? '参数无效：需要 workerId。' : 'Invalid input: workerId is required.'
    }
  }
  return runWorkspaceChecks(deps, {
    teamId: ctx.threadId,
    workerId: parsed.data.workerId,
    ...(parsed.data.names ? { names: parsed.data.names } : {}),
    signal: ctx.signal
  })
}

import { PLAN_WORKTREE_MIN_FREE_BYTES, planWorktreeLowDiskMessage } from '@shared/plan-worktree-disk'
import type { PlanBuildOrchestration } from './plan-build'
import { buildPlanBuildPrompt, type PromptPlanTodo } from './plan-prompts'
import type { PlanTaskWorktreeContext } from '@shared/plan-build-prompt'
import type { GuiPlanArtifact } from './plan-store'

export type PreparedPlanBuild = {
  prompt: string
  title: string
  displayText: string
  workspaceRoot: string
  orchestration: PlanBuildOrchestration
  planId: string
}

export async function preparePlanBuild(input: {
  plan: GuiPlanArtifact
  content: string
  orchestration: PlanBuildOrchestration
  graphEnabled: boolean
  usePromptWorktree: boolean
  usePromptWorktreeExplicit?: boolean
  workspaceAlreadyIsolated?: boolean
  branchPrefix: string
  activeThreadId: string | null
  getPlanTodos?: () => PromptPlanTodo[]
  save: (plan: GuiPlanArtifact, content: string) => Promise<boolean>
  currentPlanId: () => string | undefined
  currentThreadId: () => string | null
  getGitBranches: typeof window.kunGui.getGitBranches
  /** External Agent started in a host-managed task worktree. */
  taskWorktreeAgentName?: string
}): Promise<PreparedPlanBuild> {
  if (input.orchestration === 'graph' && !input.graphEnabled) {
    throw new Error('Graph build is disabled.')
  }
  if (!(await input.save(input.plan, input.content))) {
    throw new Error('Failed to save the latest plan.')
  }
  if (input.currentPlanId() !== input.plan.id || input.currentThreadId() !== input.activeThreadId) {
    throw new Error('The active plan or conversation changed while preparing the build.')
  }

  const taskWorktree = input.taskWorktreeAgentName
    ? await taskWorktreeContext(input.taskWorktreeAgentName, input.plan.workspaceRoot, input.getGitBranches)
    : undefined
  let prompt = buildPlanBuildPrompt(
    input.plan.relativePath,
    input.content,
    input.orchestration,
    undefined,
    input.getPlanTodos?.(),
    taskWorktree
  )
  let displayText = `${input.orchestration === 'graph' ? 'Graph build' : 'Direct build'}: ${input.plan.relativePath}`
  if (!taskWorktree && input.orchestration === 'direct' && input.usePromptWorktree &&
    (!input.workspaceAlreadyIsolated || input.usePromptWorktreeExplicit)) {
    const branch = await input.getGitBranches(input.plan.workspaceRoot)
    if (!branch.ok) throw new Error(branch.message)
    const targetBranch = branch.currentBranch?.trim()
    if (!targetBranch) throw new Error('Prompt Worktree requires a checked-out Git branch.')
    if (typeof branch.worktreeFreeBytes === 'number' && branch.worktreeFreeBytes < PLAN_WORKTREE_MIN_FREE_BYTES) {
      throw new Error(planWorktreeLowDiskMessage(branch.worktreeFreeBytes))
    }
    if (input.currentPlanId() !== input.plan.id || input.currentThreadId() !== input.activeThreadId) {
      throw new Error('The active plan or conversation changed while preparing the build.')
    }
    prompt = buildPlanBuildPrompt(input.plan.relativePath, input.content, input.orchestration, {
      repositoryRoot: branch.repositoryRoot,
      targetBranch,
      branchPrefix: input.branchPrefix,
      dirtyCount: branch.dirtyCount,
      planTitle: input.plan.featureName
    }, input.getPlanTodos?.())
    displayText = `${input.plan.featureName} (${targetBranch})`
  }

  return {
    prompt,
    title: input.plan.featureName || input.plan.relativePath,
    displayText,
    workspaceRoot: input.plan.workspaceRoot,
    orchestration: input.orchestration,
    planId: input.plan.id
  }
}

/** Branch facts are best effort: the isolation rule holds without them. */
async function taskWorktreeContext(
  agentName: string,
  workspaceRoot: string,
  getGitBranches: typeof window.kunGui.getGitBranches
): Promise<PlanTaskWorktreeContext> {
  let branch: Awaited<ReturnType<typeof getGitBranches>> | null = null
  try {
    branch = await getGitBranches(workspaceRoot)
  } catch {
    branch = null
  }
  const baseBranch = branch?.ok ? branch.currentBranch?.trim() : ''
  return {
    agentName,
    sourceRepositoryRoot: branch?.ok && branch.repositoryRoot ? branch.repositoryRoot : workspaceRoot,
    ...(baseBranch ? { baseBranch } : {})
  }
}

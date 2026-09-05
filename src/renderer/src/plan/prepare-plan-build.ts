import type { PlanBuildOrchestration } from './plan-build'
import { buildPlanBuildPrompt, type PromptPlanTodo } from './plan-prompts'
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
  branchPrefix: string
  activeThreadId: string | null
  getPlanTodos?: () => PromptPlanTodo[]
  save: (plan: GuiPlanArtifact, content: string) => Promise<boolean>
  currentPlanId: () => string | undefined
  currentThreadId: () => string | null
  getGitBranches: typeof window.kunGui.getGitBranches
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

  let prompt = buildPlanBuildPrompt(
    input.plan.relativePath,
    input.content,
    input.orchestration,
    undefined,
    input.getPlanTodos?.()
  )
  let displayText = `${input.orchestration === 'graph' ? 'Graph build' : 'Direct build'}: ${input.plan.relativePath}`
  if (input.orchestration === 'direct' && input.usePromptWorktree) {
    const branch = await input.getGitBranches(input.plan.workspaceRoot)
    if (!branch.ok) throw new Error(branch.message)
    const targetBranch = branch.currentBranch?.trim()
    if (!targetBranch) throw new Error('Prompt Worktree requires a checked-out Git branch.')
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

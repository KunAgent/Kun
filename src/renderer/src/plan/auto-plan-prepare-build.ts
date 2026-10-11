import { DEFAULT_GIT_BRANCH_PREFIX } from '@shared/app-settings'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { useChatStore } from '../store/chat-store'
import { threadHasIsolatedWorkspace } from '../lib/thread-workspace-owner'
import { createGuiPlanArtifact, type GuiPlanArtifact } from './plan-store'
import type { GuiPlanToolMeta } from './plan-tool'
import type { AutoPlanBuildIntentV1 } from './auto-plan-build-intents'
import { preparePlanBuild } from './prepare-plan-build'
import { usePlanWorktreePreferenceStore } from './plan-worktree-preference-store'

async function loadPlan(meta: GuiPlanToolMeta, threadId: string): Promise<{
  plan: GuiPlanArtifact
  content: string
}> {
  const result = await window.kunGui.readWorkspaceFile({
    workspaceRoot: meta.workspaceRoot,
    path: meta.relativePath
  })
  if (!result.ok) throw new Error(result.message)
  const base = createGuiPlanArtifact({
    workspaceRoot: meta.workspaceRoot,
    threadId,
    relativePath: meta.relativePath,
    absolutePath: meta.absolutePath ?? result.path,
    sourceRequest: meta.sourceRequest ?? ''
  })
  return {
    plan: meta.title?.trim() ? { ...base, featureName: meta.title.trim() } : base,
    content: result.content
  }
}


export async function prepareIntentBuild(
  intent: AutoPlanBuildIntentV1,
  meta: GuiPlanToolMeta
): Promise<{ plan: GuiPlanArtifact; prompt: string; title: string; displayText: string }> {
  const loaded = await loadPlan(meta, intent.threadId)
  const preference = usePlanWorktreePreferenceStore.getState()
  preference.initializePlan(intent.planId, intent.useWorktree, DEFAULT_GIT_BRANCH_PREFIX)
  preference.setUsePromptWorktree(intent.planId, intent.useWorktree)
  const settings = await rendererRuntimeClient.getSettings()
  const prepared = await preparePlanBuild({
    plan: loaded.plan,
    content: loaded.content,
    orchestration: 'direct',
    graphEnabled: false,
    usePromptWorktree: intent.useWorktree,
    usePromptWorktreeExplicit: intent.useWorktreeExplicit,
    workspaceAlreadyIsolated: threadHasIsolatedWorkspace(useChatStore.getState(), intent.threadId),
    branchPrefix: settings.gitBranchPrefix || DEFAULT_GIT_BRANCH_PREFIX,
    activeThreadId: intent.threadId,
    save: async () => true,
    currentPlanId: () => loaded.plan.id,
    currentThreadId: () => intent.threadId,
    getGitBranches: window.kunGui.getGitBranches
  })
  return {
    plan: loaded.plan,
    prompt: prepared.prompt,
    title: prepared.title,
    displayText: prepared.prompt.includes('<prompt_managed_worktree_protocol>')
      ? `${loaded.plan.featureName} (${prepared.displayText.match(/\((.+)\)$/)?.[1] ?? ''})`
      : `Direct build: ${loaded.plan.relativePath}`
  }
}

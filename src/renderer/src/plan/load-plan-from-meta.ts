import { useChatStore } from '../store/chat-store'
import {
  createGuiPlanArtifact,
  useGuiPlanStore,
  type GuiPlanArtifact
} from './plan-store'
import { guiPlanMetaMatchesArtifact, type GuiPlanToolMeta } from './plan-tool'

/**
 * Make the plan referenced by a `create_plan` tool result the active GUI
 * plan, loading it from disk when the plan store is empty or holds a
 * different plan (app restart, thread switch, cleared registry). Card
 * actions (open / build / schedule) call this so they keep working even
 * when the store lost track of the plan; without it they silently no-op.
 * Returns the active plan, or null when the file could not be read.
 */
export async function ensureGuiPlanLoadedFromMeta(
  meta: GuiPlanToolMeta,
  options?: { forceReload?: boolean }
): Promise<GuiPlanArtifact | null> {
  const current = useGuiPlanStore.getState().activePlan
  if (!options?.forceReload && current && guiPlanMetaMatchesArtifact(meta, current)) {
    return current
  }
  const result = await window.kunGui.readWorkspaceFile({
    workspaceRoot: meta.workspaceRoot,
    path: meta.relativePath
  })
  if (!result.ok) {
    useGuiPlanStore.getState().setOperationStatus('error', result.message)
    return null
  }
  const base = createGuiPlanArtifact({
    workspaceRoot: meta.workspaceRoot,
    threadId: useChatStore.getState().activeThreadId,
    relativePath: meta.relativePath,
    absolutePath: meta.absolutePath ?? result.path,
    sourceRequest: meta.sourceRequest ?? ''
  })
  const plan = meta.title?.trim() ? { ...base, featureName: meta.title.trim() } : base
  useGuiPlanStore.getState().setActivePlan(plan, result.content)
  return plan
}

import type { ArtifactStore } from '../artifacts/artifact-store.js'
import type { PptWorkflowScope, ToolHostContext } from '../ports/tool-host.js'
import type { ToolDispatchInput } from './turn-execution-types.js'
import type { InteractiveToolBridge } from './interactive-tool-bridge.js'

export type ToolExecutionContextFactoryDeps = {
  memoryEnabled: boolean
  allowedModelProviderIds?: readonly string[]
  allowedModelIds?: readonly string[]
  allowedProviderIds?: readonly string[]
  allowedSkillIds?: readonly string[]
  allowedReadPaths?: readonly string[]
  allowedWritePaths?: readonly string[]
  allowedArtifactIds?: readonly string[]
  pptWorkflowScope?: PptWorkflowScope
  blockedProviderIds?: readonly string[]
  blockedToolNames?: readonly string[]
  blockedSkillIds?: readonly string[]
  runtimeDataDir?: string
  artifactStore?: ArtifactStore
  fastContext?: boolean
  fastContextScopeId?: string
  fastContextTaskCount?: number
  interactiveToolBridge: Pick<InteractiveToolBridge, 'awaitApproval' | 'awaitUserInput'>
}

/**
 * Build the execution-only context for a persisted tool call. Discovery keeps
 * its own context because it deliberately has no real approval side effect.
 */
export function createToolExecutionContext(
  input: ToolDispatchInput,
  deps: ToolExecutionContextFactoryDeps
): ToolHostContext {
  return {
    threadId: input.threadId,
    turnId: input.turnId,
    workspace: input.workspace,
    ...(input.workspaceCheckpointRequestId
      ? { workspaceCheckpointRequestId: input.workspaceCheckpointRequestId }
      : {}),
    ...(input.orchestration ? { orchestration: input.orchestration } : {}),
    ...(input.messageSource && input.messageSource !== 'design_continuation'
      ? { messageSource: input.messageSource }
      : {}),
    ...(input.subagentResume ? { subagentResume: input.subagentResume } : {}),
    ...(input.additionalWorkspaces?.length ? { additionalWorkspaces: input.additionalWorkspaces } : {}),
    ...(input.knowledgeBases?.length ? { knowledgeBases: input.knowledgeBases } : {}),
    clientSurface: input.clientSurface,
    threadMode: input.threadMode,
    ...(input.activePlanContext ? { guiPlan: input.activePlanContext } : {}),
    ...(input.guiDesignCanvas ? { guiDesignCanvas: true } : {}),
    ...(input.guiDesignMode ? { guiDesignMode: true } : {}),
    agentSurface: input.agentSurface ?? 'code',
    ...(input.guiDesignArtifact ? { guiDesignArtifact: input.guiDesignArtifact } : {}),
    ...(input.imContext ? { imContext: true } : {}),
    model: input.modelCapabilities,
    ...(input.sourceResultBudgetTokens !== undefined
      ? { sourceResultBudgetTokens: input.sourceResultBudgetTokens }
      : {}),
    ...(input.modelProviderId ? { modelProviderId: input.modelProviderId } : {}),
    actingModelRoute: input.actingModelRoute,
    ...(input.approvalIntent ? { approvalIntent: input.approvalIntent } : {}),
    ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
    ...(input.serviceTier ? { serviceTier: input.serviceTier } : {}),
    activeSkillIds: input.activeSkillIds,
    memoryPolicy: { enabled: deps.memoryEnabled },
    delegationPolicy: { enabled: false },
    ...(input.allowedToolNames ? { allowedToolNames: input.allowedToolNames } : {}),
    ...(input.extensionToolCatalogEpoch
      ? { extensionToolCatalogEpoch: input.extensionToolCatalogEpoch }
      : {}),
    ...(deps.allowedModelProviderIds
      ? { allowedModelProviderIds: deps.allowedModelProviderIds }
      : {}),
    ...(deps.allowedModelIds ? { allowedModelIds: deps.allowedModelIds } : {}),
    ...(deps.allowedProviderIds ? { allowedProviderIds: deps.allowedProviderIds } : {}),
    ...(deps.allowedSkillIds ? { allowedSkillIds: deps.allowedSkillIds } : {}),
    ...(deps.allowedReadPaths ? { allowedReadPaths: deps.allowedReadPaths } : {}),
    ...(deps.allowedWritePaths ? { allowedWritePaths: deps.allowedWritePaths } : {}),
    ...(deps.allowedArtifactIds ? { allowedArtifactIds: deps.allowedArtifactIds } : {}),
    ...(deps.pptWorkflowScope ? { pptWorkflowScope: deps.pptWorkflowScope } : {}),
    ...(deps.blockedProviderIds ? { blockedProviderIds: deps.blockedProviderIds } : {}),
    ...(deps.blockedToolNames ? { blockedToolNames: deps.blockedToolNames } : {}),
    ...(deps.blockedSkillIds ? { blockedSkillIds: deps.blockedSkillIds } : {}),
    approvalPolicy: input.approvalPolicy,
    approvalReviewer: input.approvalReviewer,
    sandboxMode: input.sandboxMode,
    ...(deps.runtimeDataDir ? { runtimeDataDir: deps.runtimeDataDir } : {}),
    ...(deps.artifactStore ? { artifactStore: deps.artifactStore } : {}),
    ...(deps.fastContext ? { fastContext: true } : {}),
    ...(deps.fastContextScopeId ? { fastContextScopeId: deps.fastContextScopeId } : {}),
    ...(deps.fastContextTaskCount ? { fastContextTaskCount: deps.fastContextTaskCount } : {}),
    abortSignal: input.signal,
    awaitApproval: (approval) => deps.interactiveToolBridge.awaitApproval({
      approval,
      approvalPolicy: input.approvalPolicy,
      approvalReviewer: input.approvalReviewer,
      actingModelRoute: input.actingModelRoute,
      intent: input.approvalIntent,
      sandboxMode: input.sandboxMode,
      signal: input.signal
    }),
    ...(input.userInputDisabled
      ? {}
      : {
          awaitUserInput: (request) => deps.interactiveToolBridge.awaitUserInput({
            threadId: input.threadId,
            turnId: input.turnId,
            input: request,
            signal: input.signal
          })
        })
  }
}

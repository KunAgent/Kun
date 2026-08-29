import type { PptWorkflowScope, ToolHostContext } from '../ports/tool-host.js'
import type { ToolTurnContextInput } from './turn-execution-types.js'
import type { InteractiveToolBridge } from './interactive-tool-bridge.js'

export type ToolDiscoveryContextFactoryDeps = {
  memoryEnabled: boolean
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
  fastContext?: boolean
  fastContextScopeId?: string
  fastContextTaskCount?: number
  interactiveToolBridge: Pick<InteractiveToolBridge, 'awaitUserInput'>
}

/**
 * Build the context used only to advertise a turn's available tool schema.
 *
 * Discovery must never register an approval gate: listTools may inspect the
 * callback but must not make an approval observable. The execution context is
 * intentionally built by a separate factory, where approval side effects are
 * explicit and persisted.
 */
export function createToolDiscoveryContext(
  input: ToolTurnContextInput,
  deps: ToolDiscoveryContextFactoryDeps
): ToolHostContext {
  return {
    threadId: input.threadId,
    turnId: input.turnId,
    workspace: input.workspace,
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
    actingModelRoute: input.actingModelRoute,
    activeSkillIds: input.activeSkillIds,
    memoryPolicy: { enabled: deps.memoryEnabled },
    delegationPolicy: { enabled: false },
    ...(input.allowedToolNames ? { allowedToolNames: input.allowedToolNames } : {}),
    ...(input.extensionToolCatalogEpoch
      ? { extensionToolCatalogEpoch: input.extensionToolCatalogEpoch }
      : {}),
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
    ...(deps.fastContext ? { fastContext: true } : {}),
    ...(deps.fastContextScopeId ? { fastContextScopeId: deps.fastContextScopeId } : {}),
    ...(deps.fastContextTaskCount ? { fastContextTaskCount: deps.fastContextTaskCount } : {}),
    abortSignal: input.signal,
    // A tool schema lookup is not tool execution. Retain the existing inert
    // approval callback so a provider cannot create a real approval request
    // merely by enumerating its schemas.
    awaitApproval: async () => 'allow',
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

/**
 * Normal Code and Design turns share one model-visible workbench catalog so
 * switching the next-turn intent does not invalidate the provider's cached
 * prefix. Execution still uses the original turn context and therefore keeps
 * every tool's `shouldAdvertise` predicate as an enforcement backstop.
 *
 * Plan, Graph, Work, and dedicated SVG turns retain their narrower catalogs
 * because those are real capability phases rather than presentation modes.
 */
export function modelToolDiscoveryContexts(context: ToolHostContext): ToolHostContext[] {
  const surface = context.agentSurface ?? 'code'
  if (
    context.clientSurface !== 'gui' ||
    context.threadMode !== 'agent' ||
    context.orchestration === 'graph' ||
    context.guiPlan ||
    context.guiDesignArtifact?.kind === 'svg' ||
    (surface !== 'code' && surface !== 'design')
  ) {
    return [context]
  }

  const {
    agentSurface: _agentSurface,
    guiDesignArtifact: _guiDesignArtifact,
    guiDesignCanvas: _guiDesignCanvas,
    guiDesignMode: _guiDesignMode,
    ...stableContext
  } = context
  return [
    { ...stableContext, agentSurface: 'code', guiDesignCanvas: true },
    {
      ...stableContext,
      agentSurface: 'design',
      guiDesignCanvas: true,
      guiDesignMode: true
    }
  ]
}

import {
  join,
  CapabilityRegistry,
  createAgentSdkRuntime,
  AntigravityCliRuntime,
  createCursorSdkRuntime,
  composeDelegatedTurnRuntimes,
  buildGoalLocalTools,
  buildTodoLocalTools,
  buildDelegationToolProviders,
  buildComponentDesignToolProviders,
  buildConversationVisualizationToolProvider,
  protocolSupportsImageEdit,
  buildRuntimeCapabilityManifest,
  DEFAULT_APPROVAL_REVIEWER,
  mergeBuiltinSubagentProfiles,
  buildFastContextToolProvider,
  buildPptAgentToolProvider,
  DelegationRuntime,
  FileDelegationStore,
  createChildAgentExecutor,
  type ChildDelegatedRuntimeFactory,
  resolveAntigravityCliCommand
} from './runtime-factory-dependencies.js'
import type { createRuntimeServices } from './runtime-composition-services.js'

export function createRuntimeRegistry(
  services: Awaited<ReturnType<typeof createRuntimeServices>>
) {
  const { model } = services
  const { core } = model
  const {
    eventBus,
    stores,
    sessionStore,
    threadStore,
    approvalGate,
    usageService,
    profilesForProvider,
    ids,
    nowIso,
    llmDebug,
    events,
    prefix,
    delegatedSessions,
    threadService,
    artifactStore,
    modelCapabilities,
    delegatedContextProfile
  } = core
  const {
    agentSdkProviderIds,
    antigravityProviderIds,
    cursorSdkProviderIds,
    approvalReviewService,
    timedModelClient,
    subagentRouter
  } = model
  const {
    turnService,
    taskGraphTool,
    childToolHost,
    defaultIsAgentSdk,
    defaultIsAntigravity,
    defaultIsCursorSdk
  } = services
  const createChildDelegatedRuntime: ChildDelegatedRuntimeFactory = (child) =>
    composeDelegatedTurnRuntimes([
    ...(agentSdkProviderIds.size > 0 || defaultIsAgentSdk
      ? [createAgentSdkRuntime({
          registry: services.childRegistry,
          toolHost: childToolHost,
          turns: child.turns,
          sessionStore: child.sessionStore,
          threadStore: child.threadStore,
          events: child.events,
          ...(llmDebug ? { debugSink: llmDebug } : {}),
          ids: child.ids,
          prefix: child.prefix,
          providerConfigs: core.activeOptions.providers ?? {},
          agentSdkProviderIds,
          defaultApprovalPolicy: core.activeOptions.approvalPolicy,
          defaultSandboxMode: core.activeOptions.sandboxMode,
          defaultApprovalReviewer: core.activeOptions.approvalReviewer ?? DEFAULT_APPROVAL_REVIEWER,
          defaultModel: core.activeOptions.model,
          defaultIsAgentSdk,
          defaultToken: core.activeOptions.apiKey,
          turnLimits: core.activeOptions.runtime?.turnLimits,
          approvalGate,
          approvalReview: approvalReviewService,
          ...(child.instructionsEnabled
            ? { instructionRuntime: services.instructionRuntime }
            : {}),
          allowSdkBuiltins: false,
          toolContextBoundary: {
            ...(child.allowedProviderIds ? { allowedProviderIds: child.allowedProviderIds } : {}),
            ...(child.allowedToolNames ? { allowedToolNames: child.allowedToolNames } : {}),
            ...(child.allowedSkillIds ? { allowedSkillIds: child.allowedSkillIds } : {}),
            ...(child.allowedReadPaths ? { allowedReadPaths: child.allowedReadPaths } : {}),
            ...(child.allowedWritePaths ? { allowedWritePaths: child.allowedWritePaths } : {}),
            ...(child.allowedArtifactIds ? { allowedArtifactIds: child.allowedArtifactIds } : {}),
            ...(child.pptWorkflowScope ? { pptWorkflowScope: child.pptWorkflowScope } : {}),
            ...(child.blockedProviderIds ? { blockedProviderIds: child.blockedProviderIds } : {}),
            ...(child.blockedToolNames ? { blockedToolNames: child.blockedToolNames } : {}),
            ...(child.blockedSkillIds ? { blockedSkillIds: child.blockedSkillIds } : {})
          },
          ...(child.skillsEnabled ? { skillRuntime: services.skillRuntime } : {}),
          ...(child.memoryEnabled && services.memoryStore
            ? { memoryStore: services.memoryStore }
            : {}),
          ...(services.attachmentStore
            ? { attachmentStore: services.attachmentStore }
            : {}),
          ...(process.env.KUN_CLAUDE_BINARY
            ? { pathToClaudeCodeExecutable: process.env.KUN_CLAUDE_BINARY }
            : {}),
          nowIso,
          sessionCoordinator: delegatedSessions,
          contextProfile: delegatedContextProfile
        })]
      : []),
    ...((antigravityProviderIds.size > 0 || defaultIsAntigravity) &&
      !child.allowedReadPaths &&
      !child.allowedWritePaths
      ? [new AntigravityCliRuntime({
          providerConfigs: core.activeOptions.providers ?? {},
          providerIds: antigravityProviderIds,
          defaultIsAntigravity,
          defaultModel: core.activeOptions.model,
          systemPrompt: child.prefix.systemPrompt,
          binaryPath:
            process.env.KUN_ANTIGRAVITY_BINARY ??
            resolveAntigravityCliCommand(core.activeOptions.dataDir)?.command,
          threadStore: child.threadStore,
          sessionStore: child.sessionStore,
          turns: child.turns,
          events: child.events,
          ids: child.ids,
          ...(llmDebug ? { debugSink: llmDebug } : {}),
          turnLimits: core.activeOptions.runtime?.turnLimits,
          enforceReadOnly: child.toolPolicy === 'readOnly',
          sessionCoordinator: delegatedSessions,
          contextProfile: delegatedContextProfile
        })]
      : []),
    ...(cursorSdkProviderIds.size > 0 || defaultIsCursorSdk
      ? [createCursorSdkRuntime({
          registry: services.childRegistry,
          toolHost: childToolHost,
          providerConfigs: core.activeOptions.providers ?? {},
          providerIds: cursorSdkProviderIds,
          defaultIsCursor: defaultIsCursorSdk,
          defaultApiKey: core.activeOptions.apiKey,
          defaultModel: core.activeOptions.model,
          defaultApprovalPolicy: core.activeOptions.approvalPolicy,
          defaultSandboxMode: core.activeOptions.sandboxMode,
          defaultApprovalReviewer: core.activeOptions.approvalReviewer ?? DEFAULT_APPROVAL_REVIEWER,
          systemPrompt: child.prefix.systemPrompt,
          threadStore: child.threadStore,
          sessionStore: child.sessionStore,
          turns: child.turns,
          events: child.events,
          ids: child.ids,
          setThreadTodos: (threadId, request) =>
            child.threads.setTodosFromTool(threadId, request),
          ...(llmDebug ? { debugSink: llmDebug } : {}),
          ...(services.attachmentStore
            ? { attachmentStore: services.attachmentStore }
            : {}),
          turnLimits: core.activeOptions.runtime?.turnLimits,
          enforceReadOnly: child.toolPolicy === 'readOnly',
          approvalGate,
          approvalReview: approvalReviewService,
          ...(child.instructionsEnabled
            ? { instructionRuntime: services.instructionRuntime }
            : {}),
          toolContextBoundary: {
            ...(child.allowedProviderIds ? { allowedProviderIds: child.allowedProviderIds } : {}),
            ...(child.allowedToolNames ? { allowedToolNames: child.allowedToolNames } : {}),
            ...(child.allowedSkillIds ? { allowedSkillIds: child.allowedSkillIds } : {}),
            ...(child.allowedReadPaths ? { allowedReadPaths: child.allowedReadPaths } : {}),
            ...(child.allowedWritePaths ? { allowedWritePaths: child.allowedWritePaths } : {}),
            ...(child.allowedArtifactIds ? { allowedArtifactIds: child.allowedArtifactIds } : {}),
            ...(child.pptWorkflowScope ? { pptWorkflowScope: child.pptWorkflowScope } : {}),
            ...(child.blockedProviderIds ? { blockedProviderIds: child.blockedProviderIds } : {}),
            ...(child.blockedToolNames ? { blockedToolNames: child.blockedToolNames } : {}),
            ...(child.blockedSkillIds ? { blockedSkillIds: child.blockedSkillIds } : {})
          },
          ...(child.skillsEnabled ? { skillRuntime: services.skillRuntime } : {}),
          ...(child.memoryEnabled && services.memoryStore
            ? { memoryStore: services.memoryStore }
            : {}),
          nowIso,
          sessionCoordinator: delegatedSessions,
          contextProfile: delegatedContextProfile
        })]
      : [])
    ])
	  let delegationRuntime = core.activeOptions.capabilities?.subagents.enabled
	    ? new DelegationRuntime({
	        config: mergeBuiltinSubagentProfiles(core.activeOptions.capabilities.subagents),
	        store: new FileDelegationStore(join(core.activeOptions.dataDir, 'child-runs')),
	        events,
	        eventBus,
	        threadStore,
	        turns: turnService,
	        artifactStore,
	        nowIso,
	        executor: createChildAgentExecutor({
	          model: timedModelClient,
	          toolHost: childToolHost,
	          prefix,
	          defaultModel: core.activeOptions.model,
	          models: core.activeOptions.models,
		          contextCompaction: core.activeOptions.contextCompaction,
		          approvalPolicy: core.activeOptions.approvalPolicy,
		          sandboxMode: core.activeOptions.sandboxMode,
		          approvalReviewer:
		            core.activeOptions.approvalReviewer ?? DEFAULT_APPROVAL_REVIEWER,
		          modelCapabilities,
	          profilesForProvider,
		          skillRuntime: services.skillRuntime,
		          instructionRuntime: services.instructionRuntime,
		          tokenEconomy: core.tokenEconomy,
	          approvalGate,
	          approvalReview: approvalReviewService,
          createDelegatedRuntime: createChildDelegatedRuntime,
          // Persist the child as a hidden `side` thread on the shared stores +
          // event bus so its session is loadable and streams live in the GUI.
          sessionStore,
          threadStore,
          events,
          // Share the runtime ledger so child usage stays live-queryable under
          // the child thread id without folding onto the parent.
          usage: usageService,
	          ...(core.activeOptions.runtime ? { runtime: core.activeOptions.runtime } : {}),
	          ...(services.memoryStore ? { memoryStore: services.memoryStore } : {}),
          attachmentStore: () => services.attachmentStore,
          artifactStore,
          nowIso
        }),
        recordExternalUsage: (threadId, usage) => {
          usageService.record(threadId, usage)
        }
      })
    : undefined
	  let capabilities = buildRuntimeCapabilityManifest({
	    config: core.activeOptions.capabilities,
	    model: modelCapabilities(core.activeOptions.model),
	    mcp: {
	      configuredServers: Object.keys(core.activeOptions.capabilities?.mcp.servers ?? {}).length,
      connectedServers: services.mcpProviders.connectedServers,
      toolCount: services.mcpProviders.toolCount,
      lastError: services.mcpProviders.diagnostics.find((diagnostic) => diagnostic.lastError)?.lastError,
      search: {
        active: services.mcpProviders.search.active,
        indexedToolCount: services.mcpProviders.search.indexedToolCount,
        advertisedToolCount: services.mcpProviders.search.advertisedToolCount
      }
    },
    web: {
      fetchAvailable: services.webProviders.fetchAvailable,
      searchAvailable: services.webProviders.searchAvailable,
      provider: services.webProviders.provider,
      reason: services.webProviders.diagnostics.find((diagnostic) => diagnostic.reason)?.reason
	    },
	    skills: {
	      configuredRoots: core.activeOptions.capabilities?.skills.roots.length,
      discoveredSkills: services.skillRuntime.count(),
      reason: services.skillRuntime.diagnostics().validationErrors[0]?.message
    },
    instructions: {
      available: services.instructionRuntime.enabled(),
      lastSourceCount: services.instructionRuntime.diagnostics().lastInjection?.sources.length ?? 0,
      lastInjectedBytes: services.instructionRuntime.diagnostics().lastInjection?.injectedBytes ?? 0
    },
    attachments: {
      available: Boolean(services.attachmentStore)
    },
    memory: {
      available: Boolean(services.memoryStore)
    },
    subagents: {
      available: Boolean(delegationRuntime)
    },
    imageGen: {
      available: services.imageGenProviders.available,
      reason: services.imageGenProviders.diagnostics.find((diagnostic) => diagnostic.reason)?.reason,
      supportsReferenceEdit: protocolSupportsImageEdit(core.activeOptions.capabilities?.imageGen?.protocol)
    },
    speechGen: {
      available: services.speechGenProviders.available,
      reason: services.speechGenProviders.diagnostics.find((diagnostic) => diagnostic.reason)?.reason
    },
    musicGen: {
      available: services.musicGenProviders.available,
      reason: services.musicGenProviders.diagnostics.find((diagnostic) => diagnostic.reason)?.reason
    },
    videoGen: {
      available: services.videoGenProviders.available,
      reason: services.videoGenProviders.diagnostics.find((diagnostic) => diagnostic.reason)?.reason
    },
    computerUse: {
      available: services.computerUseProviders.available,
      reason: services.computerUseProviders.diagnostics.find((diagnostic) => diagnostic.reason)?.reason
    },
    browserUse: {
      available: services.browserUseProviders.available,
      interactionRequired: services.browserUseProviders.interactionRequired,
      reason: services.browserUseProviders.reason
    }
  })
	  let registry = new CapabilityRegistry([
    ...services.baseToolProviders,
    // Host control is available to the top-level agent only, never to
    // delegated subagents (which use childRegistry/baseToolProviders).
    ...services.computerUseProviders.providers,
    ...services.browserUseProviders.providers,
    {
      id: 'goal',
      kind: 'built-in' as const,
      enabled: true,
      available: true,
      tools: buildGoalLocalTools(threadService)
    },
    {
      id: 'todo',
      kind: 'built-in' as const,
      enabled: true,
      available: true,
      tools: buildTodoLocalTools(threadService)
    },
    {
      id: 'planning',
      kind: 'built-in' as const,
      enabled: true,
      available: true,
      tools: [taskGraphTool]
    },
    ...buildDelegationToolProviders(delegationRuntime, subagentRouter),
    ...buildFastContextToolProvider(
      delegationRuntime,
      () => core.activeOptions.lab?.fastContext
    ),
    ...buildPptAgentToolProvider(
      delegationRuntime,
      () => ({
        ...core.activeOptions.lab?.pptAgent,
        imageGenAvailable: services.imageGenProviders.available,
        imageGenReason: services.imageGenProviders.diagnostics.find((diagnostic) => diagnostic.reason)?.reason,
        imageGenSupportsReferenceEdit: protocolSupportsImageEdit(core.activeOptions.capabilities?.imageGen?.protocol),
        toolIncompatibleProviderIds: [
          ...new Set([...antigravityProviderIds, ...cursorSdkProviderIds])
        ],
        defaultProviderLacksManagedTools: defaultIsAntigravity || defaultIsCursorSdk
      }),
      turnService
    ),
    ...buildComponentDesignToolProviders(delegationRuntime),
    ...buildConversationVisualizationToolProvider(
      () => core.activeOptions.lab?.conversationVisualization
    )
  ])
  return {
    services,
    createChildDelegatedRuntime,
    delegationRuntime,
    get capabilities() { return capabilities },
    set capabilities(value: typeof capabilities) { capabilities = value },
    get registry() { return registry },
    set registry(value: typeof registry) { registry = value }
  }
}

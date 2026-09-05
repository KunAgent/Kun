import { QueuedTurnDispatcher } from './queued-turn-dispatcher.js'
import {
  type AttachmentStore,
  CapabilityRegistry,
  createAgentSdkRuntime,
  type AgentSdkRuntimeFactoryDeps,
  AntigravityCliRuntime,
  type AntigravityCliRuntimeDeps,
  createCursorSdkRuntime,
  type CursorSdkRuntimeFactoryDeps,
  composeDelegatedTurnRuntimes,
  ReplaceableDelegatedTurnRuntime,
  LocalToolHost,
  ExtensionToolRegistry,
  DEFAULT_APPROVAL_REVIEWER,
  AgentLoop,
  type AgentLoopOptions,
  type TurnRunOutcome,
  type ToolHostContext,
  createGraphRuntimeStartOptions,
  waitForWorkspaceCheckpoint,
  SkillRuntime,
  InstructionRuntime,
  type MemoryStore,
  ExtensionAgentProfileRegistry,
  ExtensionAgentService,
  resolveAntigravityCliCommand
} from './runtime-factory-dependencies.js'
import type { KunServeRuntimeOptions } from './runtime-factory-types.js'
import type { createRuntimeRegistry } from './runtime-composition-registry.js'
import {
  agentSdkProviderIdsForOptions,
  antigravityProviderIdsForOptions,
  cursorSdkProviderIdsForOptions,
  extensionAgentRunOptionsForOptions
} from './runtime-factory-model.js'
import { resumeInterruptedGraphPlanning } from './runtime-graph-lifecycle.js'
import { CanvasReceiptRegistry } from '../services/canvas-receipt-registry.js'

export async function createRuntimeAgentComposition(
  registryComposition: ReturnType<typeof createRuntimeRegistry>
) {
  const { services } = registryComposition
  const { model } = services
  const { core } = model
  const {
    eventBus,
    sessionStore,
    threadStore,
    approvalGate,
    userInputGate,
    usageService,
    inflight,
    toolCancellation,
    steering,
    compactor,
    ids,
    nowIso,
    llmDebug,
    events,
    prefix,
    delegatedSessions,
    threadService,
    artifactStore,
    graphConfig,
    graphRuntime,
    modelCapabilities,
    delegatedContextProfile
  } = core
  const {
    agentSdkProviderIds,
    resolveLegacyRequestCredentials,
    approvalReviewService,
    timedModelClient
  } = model
  const {
    turnService,
    backgroundShellRuntime,
    reviewService,
    defaultIsAgentSdk,
    defaultIsAntigravity,
    defaultIsCursorSdk
  } = services
  const { delegationRuntime } = registryComposition
  let prepareExtensionContributions: ((context?: ToolHostContext) => Promise<void>) | undefined
  const toolHost = new LocalToolHost({
    registry: registryComposition.registry,
    readTracker: true,
    prepare: (context) => prepareExtensionContributions?.(context),
    ...(services.executionLeases ? { leaseAuthority: services.executionLeases } : {}),
    ...(services.resolvedHooks.length ? { hooks: services.resolvedHooks } : {})
  })
  const extensionTools = new ExtensionToolRegistry({ registry: registryComposition.registry })
  // Keep retrying MCP servers that lost the fast startup connect race so a slow
  // npx cold start eventually shows up as connected instead of staying "error"
  // until the next runtime restart (issue #342). Both registries advertise the
  // MCP providers, so a late connection must be registered into each.
  void services.mcpProviders.startBackgroundReconnect({
    register: (provider) => {
      try {
        registryComposition.registry.registerProvider(provider)
      } catch {
        // ignore duplicate/colliding registration
      }
      try {
        services.childRegistry.registerProvider(provider)
      } catch {
        // ignore duplicate/colliding registration
      }
    },
    unregister: (providerId) => {
      try {
        registryComposition.registry.unregisterProvider(providerId)
      } catch {
        // ignore missing/colliding removal
      }
      try {
        services.childRegistry.unregisterProvider(providerId)
      } catch {
        // ignore missing/colliding removal
      }
    },
    replace: (provider) => {
      try {
        registryComposition.registry.replaceProvider(provider)
      } catch {
        // ignore missing/colliding replacement
      }
      try {
        services.childRegistry.replaceProvider(provider)
      } catch {
        // ignore missing/colliding replacement
      }
    }
  })
  // Provider-native subscription engines own whole turns and share the same
  // narrow delegated runtime boundary. Keep the runtime objects alive even
  // with an initially empty provider set so /connect can add an account
  // without requiring the standalone TUI runtime to restart.
  const buildMainDelegatedRuntime = (input: {
    options: KunServeRuntimeOptions
    registry: CapabilityRegistry
    skillRuntime: SkillRuntime
    instructionRuntime: InstructionRuntime
    attachmentStore?: AttachmentStore
    memoryStore?: MemoryStore
  }) => {
    const providerConfigs = Object.fromEntries(
      Object.entries(input.options.providers ?? {}).map(([id, provider]) => [id, { ...provider }])
    )
    const sdkRuntimeDeps: AgentSdkRuntimeFactoryDeps = {
      registry: input.registry,
      toolHost,
      turns: turnService,
      sessionStore,
      threadStore,
      events,
      ids,
      prefix,
      providerConfigs,
      agentSdkProviderIds: new Set(agentSdkProviderIdsForOptions(input.options)),
      defaultApprovalPolicy: input.options.approvalPolicy,
      defaultSandboxMode: input.options.sandboxMode,
      defaultApprovalReviewer: input.options.approvalReviewer ?? DEFAULT_APPROVAL_REVIEWER,
      defaultModel: input.options.model,
      defaultIsAgentSdk,
      defaultToken: input.options.apiKey,
      defaultCredentialSourceId: input.options.credentialSourceId,
      resolveCredentialSource: async (sourceId) => {
        const resolved = await resolveLegacyRequestCredentials(sourceId)
        return resolved.apiKey.trim() ? { apiKey: resolved.apiKey } : null
      },
      turnLimits: input.options.runtime?.turnLimits,
      approvalGate,
      approvalReview: approvalReviewService,
      skillRuntime: input.skillRuntime,
      instructionRuntime: input.instructionRuntime,
      userInputGate,
      nowIso,
      ...(input.attachmentStore ? { attachmentStore: input.attachmentStore } : {}),
      ...(input.memoryStore ? { memoryStore: input.memoryStore } : {}),
      ...(process.env.KUN_CLAUDE_BINARY
        ? { pathToClaudeCodeExecutable: process.env.KUN_CLAUDE_BINARY }
        : {}),
      sessionCoordinator: delegatedSessions,
      contextProfile: delegatedContextProfile
    }
    const antigravityRuntimeDeps: AntigravityCliRuntimeDeps = {
      providerConfigs,
      providerIds: new Set(antigravityProviderIdsForOptions(input.options)),
      defaultIsAntigravity,
      defaultModel: input.options.model,
      systemPrompt: prefix.systemPrompt,
      binaryPath:
        process.env.KUN_ANTIGRAVITY_BINARY ??
        resolveAntigravityCliCommand(core.activeOptions.dataDir)?.command,
      threadStore,
      sessionStore,
      turns: turnService,
      events,
      ids,
      ...(llmDebug ? { debugSink: llmDebug } : {}),
      turnLimits: input.options.runtime?.turnLimits,
      sessionCoordinator: delegatedSessions,
      contextProfile: delegatedContextProfile
    }
    const cursorRuntimeDeps: CursorSdkRuntimeFactoryDeps = {
      registry: input.registry,
      toolHost,
      providerConfigs,
      providerIds: new Set(cursorSdkProviderIdsForOptions(input.options)),
      defaultIsCursor: defaultIsCursorSdk,
      defaultApiKey: input.options.apiKey,
      defaultCredentialSourceId: input.options.credentialSourceId,
      resolveCredentialSource: async (sourceId) => {
        const resolved = await resolveLegacyRequestCredentials(sourceId)
        return resolved.apiKey.trim() ? { apiKey: resolved.apiKey } : null
      },
      defaultModel: input.options.model,
      defaultApprovalPolicy: input.options.approvalPolicy,
      defaultSandboxMode: input.options.sandboxMode,
      defaultApprovalReviewer: input.options.approvalReviewer ?? DEFAULT_APPROVAL_REVIEWER,
      systemPrompt: prefix.systemPrompt,
      threadStore,
      sessionStore,
      turns: turnService,
      events,
      ids,
      setThreadTodos: (threadId, request) =>
        threadService.setTodosFromTool(threadId, request),
      ...(llmDebug ? { debugSink: llmDebug } : {}),
      approvalGate,
      approvalReview: approvalReviewService,
      userInputGate,
      skillRuntime: input.skillRuntime,
      instructionRuntime: input.instructionRuntime,
      nowIso,
      ...(input.memoryStore ? { memoryStore: input.memoryStore } : {}),
      ...(input.attachmentStore ? { attachmentStore: input.attachmentStore } : {}),
      turnLimits: input.options.runtime?.turnLimits,
      sessionCoordinator: delegatedSessions,
      contextProfile: delegatedContextProfile
    }
    return composeDelegatedTurnRuntimes([
      createAgentSdkRuntime(sdkRuntimeDeps),
      new AntigravityCliRuntime(antigravityRuntimeDeps),
      createCursorSdkRuntime(cursorRuntimeDeps)
    ])
  }

  // The main turn abort signal already reaches foreground children. Detached
  // children and background shells intentionally have independent lifetimes,
  // so a destructive thread delete must cancel them explicitly before the
  // lifecycle fence drains and removes the thread directory.
  core.stopThreadAuxiliaryWork = async (threadId) => {
    await graphRuntime.cancelThreadRuns(threadId)
    await Promise.allSettled([
      backgroundShellRuntime.stopThread(threadId),
      Promise.resolve(delegationRuntime?.abortDetachedChildrenForThread(threadId) ?? 0)
    ])
    await delegationRuntime?.cleanupThreadDeletion(
      threadId,
      (childId) => threadService.delete(childId)
    )
  }
  const sdkRuntime = new ReplaceableDelegatedTurnRuntime(buildMainDelegatedRuntime({
    options: core.activeOptions,
    registry: registryComposition.registry,
    skillRuntime: services.skillRuntime,
    instructionRuntime: services.instructionRuntime,
    attachmentStore: services.attachmentStore,
    memoryStore: services.memoryStore
  }))
  model.refreshModelConnectionDelegatedDeps = () => {
    sdkRuntime.replace(buildMainDelegatedRuntime({
      options: core.activeOptions,
      registry: registryComposition.registry,
      skillRuntime: services.skillRuntime,
      instructionRuntime: services.instructionRuntime,
      attachmentStore: services.attachmentStore,
      memoryStore: services.memoryStore
    }))
  }
	  const canvasReceipts = new CanvasReceiptRegistry({
	    turns: turnService,
	    events,
	    nowIso
	  })
	  const activeRuntimeRuns = new Set<Promise<TurnRunOutcome>>()
	  let shuttingDown = false
	  let loop!: AgentLoop
	  const trackRuntimeRun = <T extends TurnRunOutcome>(run: Promise<T>): Promise<T> => {
	    activeRuntimeRuns.add(run)
	    void run.then(
	      () => activeRuntimeRuns.delete(run),
	      () => activeRuntimeRuns.delete(run)
	    )
	    return run
	  }
	  const runAgentTurn = (threadId: string, turnId: string): Promise<TurnRunOutcome> => {
	    if (shuttingDown) {
	      return trackRuntimeRun(
	        turnService.suspendTurnForHostShutdown({ threadId, turnId })
	          .then(() => 'suspended' as const)
	      )
	    }
	    return trackRuntimeRun(loop.runTurn(threadId, turnId).then(async (outcome) => {
	      if (
	        outcome !== 'suspended' &&
	        outcome !== 'suspended_pending_supervision' &&
	        !shuttingDown
	      ) {
	        await graphRuntime.handleSourceTurnTerminal(threadId, turnId, outcome)
	      }
	      return outcome
	    }))
	  }
	  let loopOptions: AgentLoopOptions = {
	    threadStore,
	    sessionStore,
	    approvalGate,
      approvalReview: approvalReviewService,
    userInputGate,
    model: timedModelClient,
    toolHost,
    sdkRuntime,
    usage: usageService,
    events,
    turns: turnService,
    inflight,
    toolCancellation,
    steering,
    compactor,
    prefix,
    ids,
	    nowIso,
	    runContinuationTurn: runAgentTurn,
	    receipts: canvasReceipts,
	    modelCapabilities,
		    skillRuntime: services.skillRuntime,
		    instructionRuntime: services.instructionRuntime,
		    tokenEconomy: core.tokenEconomy,
	    contextCompaction: core.activeOptions.contextCompaction,
	    ...(core.activeOptions.roles ? { roles: core.activeOptions.roles } : {}),
	    ...(core.activeOptions.runtime?.toolStorm ? { toolStorm: core.activeOptions.runtime.toolStorm } : {}),
	    ...(core.activeOptions.runtime?.turnLimits ? { turnLimits: core.activeOptions.runtime.turnLimits } : {}),
	    ...(core.activeOptions.runtime?.toolArgumentRepair ? { toolArgumentRepair: core.activeOptions.runtime.toolArgumentRepair } : {}),
	    ...(core.activeOptions.runtime?.interruptedTurnResume
	      ? { interruptedResume: core.activeOptions.runtime.interruptedTurnResume }
	      : {}),
	    ...(services.resolvedHooks.length ? { hooks: services.resolvedHooks } : {}),
		    ...(services.attachmentStore ? { attachmentStore: services.attachmentStore } : {}),
	    artifactStore,
		    ...(services.memoryStore ? { memoryStore: services.memoryStore } : {}),
	    runtimeDataDir: core.activeOptions.dataDir,
	    awaitWorkspaceCheckpoint: (checkpointRequestId, signal) =>
	      waitForWorkspaceCheckpoint(core.activeOptions.dataDir, checkpointRequestId, signal),
	    onPlanWritten: async ({ threadId, planId, relativePath, markdown }) => {
	      await threadService.syncTodosFromPlan(threadId, {
	        planId,
        relativePath,
        markdown,
	        mode: 'plan_write'
	      })
	    }
	  }
	  loop = new AgentLoop(loopOptions)
	  const runReview = (input: Parameters<typeof reviewService.runReview>[0]) => {
	    if (shuttingDown) {
	      return trackRuntimeRun(
	        turnService.suspendTurnForHostShutdown({
	          threadId: input.threadId,
	          turnId: input.turnId
	        }).then(() => 'aborted' as const)
	      )
	    }
	    return trackRuntimeRun(reviewService.runReview(input))
	  }
	  await graphRuntime.start(createGraphRuntimeStartOptions({
	    delegation: () => delegationRuntime,
	    threads: threadStore,
	    resumeTurn: (input) => turnService.resumeGraphLeadTurn(input),
	    isTurnExecutionActive: (turnId) => turnService.isTurnExecutionActive(turnId),
	    isShuttingDown: () => shuttingDown,
	    steerTurn: (input) => turnService.steerTurn(input),
	    runAgentTurn,
	    defaults: () => ({
	      model: core.activeOptions.model,
	      workerModel: graphConfig().workerModel,
	      approvalPolicy: core.activeOptions.approvalPolicy,
	      sandboxMode: core.activeOptions.sandboxMode,
	      approvalReviewer:
	        core.activeOptions.approvalReviewer ?? DEFAULT_APPROVAL_REVIEWER,
	      allowedMcpServers: Object.entries(core.activeOptions.capabilities?.mcp.servers ?? {})
	        .filter(([, server]) => server.enabled !== false)
	        .map(([serverId]) => serverId),
	      disabledSkillIds: [...(core.activeOptions.capabilities?.skills.disabledIds ?? [])],
	      networkAllowed:
	        core.activeOptions.capabilities?.web.fetchEnabled === true ||
	        core.activeOptions.capabilities?.web.searchEnabled === true
	    }),
	    tools: () => registryComposition.registry.listTools(),
	    skillIds: () => services.skillRuntime.diagnostics().skills.map((skill) => skill.id)
	  }))
	  await resumeInterruptedGraphPlanning({
	    graphRuntime,
	    turnService,
	    runTurn: runAgentTurn
	  })
	  const queuedTurnDispatcher = new QueuedTurnDispatcher({
	    turns: turnService,
	    threadStore,
	    runTurn: runAgentTurn
	  })
	  turnService.setTurnSettledHook((threadId, status) =>
	    queuedTurnDispatcher.onTurnSettled(threadId, status)
	  )
	  // A queue commit may race the running turn's settlement; this trigger
	  // covers the window where settle fired before the record was durable.
	  turnService.setTurnQueuedHook((threadId) => queuedTurnDispatcher.requestDrain(threadId))
	  const extensionProfiles = new ExtensionAgentProfileRegistry()
	  const extensionAgent = new ExtensionAgentService({
	    threads: threadService,
	    turns: turnService,
	    sessions: sessionStore,
	    eventBus,
	    profiles: extensionProfiles,
	    runTurn: runAgentTurn,
	    defaultBinding: { providerId: 'default', modelId: core.activeOptions.model },
	    resolveRunOptions: () => extensionAgentRunOptionsForOptions(core.activeOptions),
	    headless: true,
	    resolveToolCatalogEpoch: async ({ principal, workspace, allowedTools }) => {
	      const owned = extensionTools.list(principal.extensionId, workspace)
	      const allowed = new Set(allowedTools)
	      const eligibleCanonicalToolIds = owned
	        .filter((entry) => allowed.size === 0 ||
	          allowed.has(entry.canonicalToolId) ||
	          allowed.has(entry.modelAlias) ||
	          allowed.has(entry.declaration.name))
	        .map((entry) => entry.canonicalToolId)
	      return extensionTools.createCatalogEpoch({ eligibleCanonicalToolIds, workspace })
	    }
	  })
  return {
    registryComposition,
    toolHost,
    extensionTools,
    canvasReceipts,
    buildMainDelegatedRuntime,
    sdkRuntime,
    activeRuntimeRuns,
    trackRuntimeRun,
    runAgentTurn,
    runReview,
    queuedTurnDispatcher,
    extensionProfiles,
    extensionAgent,
    get prepareExtensionContributions() { return prepareExtensionContributions },
    set prepareExtensionContributions(value: typeof prepareExtensionContributions) {
      prepareExtensionContributions = value
    },
    get loopOptions() { return loopOptions },
    set loopOptions(value: typeof loopOptions) { loopOptions = value },
    get loop() { return loop },
    set loop(value: typeof loop) { loop = value },
    get shuttingDown() { return shuttingDown },
    set shuttingDown(value: boolean) { shuttingDown = value }
  }
}

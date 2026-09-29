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
  type AcpRuntimeDeps,
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
  type MemoryFeedbackRuntime,
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
import type { TaskWorkspaceService } from '../workspace-tasks/task-workspace-service.js'
import { buildHarnessRuntimes } from '../harness/build-harness-runtimes.js'
import { HarnessRouter, HarnessRuntimeMap } from '../harness/harness-router.js'
import { createKunToolBridgeHost } from '../harness/kun-tool-bridge-host.js'
import { FileTeamStore } from '../ade/team-store.js'
import { handleAdeThreadDeleted } from '../ade/team-lifecycle.js'
import { DispatchDeliverer } from '../ade/dispatch-deliverer.js'
import { WorkerNoticeCoordinator } from '../ade/worker-notice-coordinator.js'
import {
  createActivityHibernation,
  createCapabilitiesForRoute,
  createManagerRuntime,
  createProviderPoolAccess,
  registerAdeManagerTooling
} from './runtime-composition-manager.js'
import { createGraphHarnessSummary } from '../ade/graph-harness-summary.js'
import { createAdeManagerContext } from '../ade/manager-context.js'
import { createQuotaSnapshot } from '../ade/quota-snapshot.js'
import { providerModelIds } from './routes/model-gateway-core.js'
import { FileDelegationStore } from './runtime-factory-dependencies.js'
import { join } from 'node:path'

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
    timedModelClient,
    modelConnections
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
  // narrow delegated runtime boundary; keep them alive even with an empty
  // provider set so /connect can add an account without a TUI runtime restart.
  const canvasReceipts = new CanvasReceiptRegistry({ turns: turnService, events, nowIso })
  // Provider pool access shared by gateway env, worker-route validation, and
  // harness_list (P3-05/P3-06): kind + advertised models per connection.
  const providerPool = createProviderPoolAccess(modelConnections)
  // Route-level bridge host for the Kun Tools MCP server (docs/ade/05 §3.3):
  // same execution authority as the SDK adapters with main-scope defaults.
  const kunToolBridge = createKunToolBridgeHost({
    threadStore,
    sessionStore,
    registry: registryComposition.registry,
    toolHost,
    turns: turnService,
    events,
    ids,
    receipts: canvasReceipts,
    userInputGate,
    approvalGate,
    approvalReview: approvalReviewService,
    skillRuntime: services.skillRuntime,
    defaultApprovalPolicy: core.activeOptions.approvalPolicy,
    defaultSandboxMode: core.activeOptions.sandboxMode,
    defaultApprovalReviewer: core.activeOptions.approvalReviewer ?? DEFAULT_APPROVAL_REVIEWER,
    callIdPrefix: 'mcp',
    nowIso
  })
  const buildMainDelegatedRuntime = (input: {
    options: KunServeRuntimeOptions
    registry: CapabilityRegistry
    skillRuntime: SkillRuntime
    instructionRuntime: InstructionRuntime
    attachmentStore?: AttachmentStore
    memoryStore?: MemoryStore
    taskWorkspaces?: TaskWorkspaceService
    memoryFeedback?: MemoryFeedbackRuntime
  }) => {
    const providerConfigs = Object.fromEntries(
      Object.entries(input.options.providers ?? {}).map(([id, provider]) => [id, { ...provider }])
    )
    const sdkRuntimeDeps: AgentSdkRuntimeFactoryDeps = {
      registry: input.registry,
      receipts: canvasReceipts,
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
      ...(input.memoryFeedback ? { memoryFeedback: input.memoryFeedback } : {}),
      ...(process.env.KUN_CLAUDE_BINARY ? { pathToClaudeCodeExecutable: process.env.KUN_CLAUDE_BINARY } : {}),
      sessionCoordinator: delegatedSessions,
      contextProfile: delegatedContextProfile,
      deterministicHandoff: input.options.ade?.deterministicHandoff !== false,
      // `kun-gateway` credential mode (docs/ade/04 §5.5): grant issuance,
      // loopback endpoint, roles, and the catalog's gateway env block.
      harnessTokens: services.harnesses.tokens,
      harnessGatewayBaseUrl: () => services.harnesses.gatewayEndpoint.baseUrl,
      roles: () => core.activeOptions.roles,
      harnessCatalog: services.harnesses.catalog,
      graphHarnessSummary,
      resolveDefaultProviderId: async () => (await modelConnections.snapshot()).defaultProviderId,
      listProviderModels: async (providerId) => (await providerPool.poolEntry(providerId))?.models ?? [],
      ...(input.taskWorkspaces ? { taskWorkspaces: input.taskWorkspaces } : {})
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
      contextProfile: delegatedContextProfile,
      deterministicHandoff: input.options.ade?.deterministicHandoff !== false,
      ...(input.taskWorkspaces ? { taskWorkspaces: input.taskWorkspaces } : {})
    }
    const cursorRuntimeDeps: CursorSdkRuntimeFactoryDeps = {
      registry: input.registry,
      toolHost,
      receipts: canvasReceipts,
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
      setThreadTodos: (t, r) => threadService.setTodosFromTool(t, r),
      ...(llmDebug ? { debugSink: llmDebug } : {}),
      approvalGate,
      approvalReview: approvalReviewService,
      userInputGate,
      skillRuntime: input.skillRuntime,
      instructionRuntime: input.instructionRuntime,
      graphHarnessSummary,
      nowIso,
      ...(input.memoryStore ? { memoryStore: input.memoryStore } : {}),
      ...(input.memoryFeedback ? { memoryFeedback: input.memoryFeedback } : {}),
      ...(input.attachmentStore ? { attachmentStore: input.attachmentStore } : {}),
      turnLimits: input.options.runtime?.turnLimits,
      sessionCoordinator: delegatedSessions,
      contextProfile: delegatedContextProfile,
      deterministicHandoff: input.options.ade?.deterministicHandoff !== false,
      ...(input.taskWorkspaces ? { taskWorkspaces: input.taskWorkspaces } : {})
    }
    const acpRuntimeDeps: AcpRuntimeDeps = {
      catalog: services.harnesses.catalog,
      binaryPath: (harnessId) => core.activeOptions.harnesses?.binaryPaths?.[harnessId],
      threadStore,
      sessionStore,
      turns: turnService,
      events,
      ids,
      systemPrompt: prefix.systemPrompt,
      sessionCoordinator: delegatedSessions,
      connectionPool: core.acpConnectionPool,
      clientHost: core.acpClientHost,
      sessionManager: core.acpSessionManager,
      approvalGate,
      approvalReview: approvalReviewService,
      userInputGate, workerCallbacks: services.workerCallbacks,
      kunToolsMcp: services.kunToolsMcp, credentialEnv: services.acpCredentialEnv,
      ...(input.attachmentStore ? { attachmentStore: input.attachmentStore } : {}),
      deterministicHandoff: input.options.ade?.deterministicHandoff !== false,
      allowUnattendedFullAccess: input.options.ade?.allowUnattendedFullAccess === true,
      defaultApprovalPolicy: input.options.approvalPolicy,
      defaultSandboxMode: input.options.sandboxMode,
      defaultApprovalReviewer: input.options.approvalReviewer ?? DEFAULT_APPROVAL_REVIEWER,
      turnLimits: input.options.runtime?.turnLimits,
      awaitWorkspaceCheckpoint: (id, sig) => waitForWorkspaceCheckpoint(core.activeOptions.dataDir, id, sig),
      // P4-03: a real launch failure outweighs any earlier probe verdict.
      onLaunchFailure: (id, detail) => services.harnesses.detector.recordLaunchFailure(id, detail),
      ...(llmDebug ? { debugSink: llmDebug } : {}),
      nowIso,
      ...(input.taskWorkspaces ? { taskWorkspaces: input.taskWorkspaces } : {})
    }
    return {
      agentSdk: sdkRuntimeDeps,
      antigravity: antigravityRuntimeDeps,
      cursor: cursorRuntimeDeps,
      acp: acpRuntimeDeps
    }
  }

  const adeTeamStore = new FileTeamStore(core.activeOptions.dataDir, nowIso)
  // The main turn abort signal already reaches foreground children; detached
  // children and background shells keep independent lifetimes, so a destructive
  // thread delete cancels them before the lifecycle fence drains the thread dir.
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
    // ADE cascade (09 §3.2): deleting a manager removes its team directory and
    // worker grants; deleting a worker marks its team record released.
    const deleted = await threadService.getMetadata(threadId).catch(() => null)
    await handleAdeThreadDeleted({
      thread: deleted,
      teams: adeTeamStore,
      revokeThreadGrants: (id) => services.harnesses.tokens.revokeThread(id),
      nowIso,
      onManagerDeleted: (id) => workerNoticeCoordinator.clearManager(id)
    })
  }
  // Graph planning harness menu (P1-25): shared by the native loop and the
  // delegated runtimes so the planner sees the same routing menu.
  const graphHarnessSummary = createGraphHarnessSummary({
    catalog: services.harnesses.catalog,
    detector: services.harnesses.detector,
    quota: createQuotaSnapshot({ list: () => model.providerQuotaService.list() })
  })
  // P3-14: manager turns get delegation contract + team state + harness menu.
  const adeManagerContext = createAdeManagerContext({
    ...services.adeStores,
    harnessSummary: graphHarnessSummary
  })
  const harnessRuntimeMap = new HarnessRuntimeMap(
    buildHarnessRuntimes(
      buildMainDelegatedRuntime({
        options: core.activeOptions,
        registry: registryComposition.registry,
        skillRuntime: services.skillRuntime,
        instructionRuntime: services.instructionRuntime,
        attachmentStore: services.attachmentStore,
        memoryStore: services.memoryStore,
        memoryFeedback: services.memoryFeedback,
        taskWorkspaces: core.taskWorkspaces
      })
    )
  )
  // Legacy provider-inference view kept in sync with the router's map so the
  // disabled-router path behaves exactly as before.
  const sdkRuntime = new ReplaceableDelegatedTurnRuntime(
    composeDelegatedTurnRuntimes(Object.values(harnessRuntimeMap.get()))
  )
  const harnessRouter = new HarnessRouter({
    enabled: () => core.activeOptions.ade?.harnessRouter !== false,
    catalog: services.harnesses.catalog,
    runtimes: () => harnessRuntimeMap.get(),
    providerKinds: services.providerKinds,
    defaultModel: () => core.activeOptions.model,
    status: (id) => {
      const cached = services.harnesses.detector.cachedStatus(id)
      if (!cached) void services.harnesses.detector.status(id).catch(() => undefined)
      return cached
    },
    allowUnattendedFullAccess: () => core.activeOptions.ade?.allowUnattendedFullAccess === true,
    taskWorkspaceIsolated: (id) => core.taskWorkspaces.get(id)?.isolation === 'worktree'
  })
  // ADE manager control plane (09 §4-§5): durable dispatch delivery + the
  // worker_* tool surface; AbortControllers outlive the manager turn.
  const childRunStore = new FileDelegationStore(join(core.activeOptions.dataDir, 'child-runs'))
  const dispatchDeliverer = new DispatchDeliverer({
    teams: services.adeStores.teams,
    dispatches: services.adeStores.dispatches,
    taskWorkspaces: core.taskWorkspaces,
    delegation: delegationRuntime ?? undefined,
    childRuns: childRunStore,
    threads: threadStore,
    turns: turnService,
    language: () => Intl.DateTimeFormat().resolvedOptions().locale
  })
  // Worker-notice wake-ups (09 §6.2); runTurn is late-bound to runAgentTurn.
  const workerNoticeCoordinator = new WorkerNoticeCoordinator({
    notices: services.adeStores.notices,
    teams: services.adeStores.teams,
    threads: threadStore,
    turns: turnService,
    runTurn: () => runAgentTurn,
    nowIso,
    language: () => Intl.DateTimeFormat().resolvedOptions().locale,
    managerModel: () => core.activeOptions.ade?.managerModel
  })
  services.workerCallbacks.setNoticeSink(workerNoticeCoordinator)
  const managerRuntime = createManagerRuntime({
    services,
    core,
    delegationRuntime,
    harnessRuntimeMap,
    listQuota: () => model.providerQuotaService.list(),
    notices: workerNoticeCoordinator,
    providerPool: providerPool.poolEntry,
    probedModels: (definition) => services.harnesses.probedModels(definition),
    threads: threadStore,
    turns: turnService,
    sessionStore,
    childRuns: childRunStore,
    deliverer: dispatchDeliverer,
    ids, nowIso, usage: usageService,
    approvalGate, approvalEvents: events
  })
  // Dispatch backfill + worker terminal hooks on the recorder (09 §5, §6.1).
  core.events.addObserver({ record: (event) => managerRuntime.handleRuntimeEvent(event) })
  const activityHibernation = createActivityHibernation({
    core, managerRuntime, catalog: services.harnesses.catalog
  })
  registerAdeManagerTooling({
    registry: registryComposition.registry,
    managerRuntime,
    services,
    harnessRuntimeMap,
    delegationRuntime: delegationRuntime ?? undefined,
    providerPool,
    core
  })
  model.refreshModelConnectionDelegatedDeps = () => {
    const next = buildHarnessRuntimes(
      buildMainDelegatedRuntime({
        options: core.activeOptions,
        registry: registryComposition.registry,
        skillRuntime: services.skillRuntime,
        instructionRuntime: services.instructionRuntime,
        attachmentStore: services.attachmentStore,
        memoryStore: services.memoryStore,
        memoryFeedback: services.memoryFeedback,
        taskWorkspaces: core.taskWorkspaces
      })
    )
    harnessRuntimeMap.replace(next)
    sdkRuntime.replace(composeDelegatedTurnRuntimes(Object.values(next)))
  }
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
	        // 09 §6.1 worker terminal hook; idempotent with the event observer.
	        await managerRuntime.handleWorkerTurnTerminal(threadId, turnId, outcome)
	          .catch((error) => console.warn('[kun] ade worker terminal failed:', error))
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
    harnessRouter,
    graphHarnessSummary, adeManagerContext,
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
	    contextWindowModes: core.contextWindowModes,
	    contextWindowTransition: core.contextWindowTransition,
	    contextCompact: core.contextCompact,
	    contextWindowBudget: core.contextWindowBudget,
	    contextWindowStateRestore: core.contextWindowStateRestore,
	    ...(core.activeOptions.roles ? { roles: core.activeOptions.roles } : {}),
	    ...(core.activeOptions.runtime?.toolStorm ? { toolStorm: core.activeOptions.runtime.toolStorm } : {}),
	    ...(core.activeOptions.runtime?.turnLimits ? { turnLimits: core.activeOptions.runtime.turnLimits } : {}),
	    ...(core.activeOptions.runtime?.toolArgumentRepair ? { toolArgumentRepair: core.activeOptions.runtime.toolArgumentRepair } : {}),
	    ...(core.activeOptions.runtime?.interruptedTurnResume ? { interruptedResume: core.activeOptions.runtime.interruptedTurnResume } : {}),
	    ...(services.resolvedHooks.length ? { hooks: services.resolvedHooks } : {}),
	    ...(services.attachmentStore ? { attachmentStore: services.attachmentStore } : {}),
	    artifactStore,
	    ...(services.memoryStore ? { memoryStore: services.memoryStore } : {}),
	    ...(services.memoryFeedback ? { memoryFeedback: services.memoryFeedback } : {}),
	    memoryDistillation: services.memoryDistillation,
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
	        turnService.suspendTurnForHostShutdown({ threadId: input.threadId, turnId: input.turnId })
	          .then(() => 'aborted' as const)
	      )
	    }
	    return trackRuntimeRun(reviewService.runReview(input))
	  }
	  // Plan-phase admission (P1-25): define_plan validates each task's
	  // harnessId through the same catalog/detector/capability gates the
	  // HarnessRouter applies at dispatch time.
	  graphRuntime.harnessAdmission = {
	    catalog: services.harnesses.catalog,
	    detector: services.harnesses.detector,
	    capabilitiesForRoute: createCapabilitiesForRoute(services.harnesses.catalog, harnessRuntimeMap),
	    allowUnattendedFullAccess: () =>
	      core.activeOptions.ade?.allowUnattendedFullAccess === true
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
	    skillIds: () => services.skillRuntime.diagnostics().skills.map((skill) => skill.id),
	    activity: core.activityStore
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
    kunToolBridge,
    buildMainDelegatedRuntime,
    sdkRuntime,
    harnessRouter,
    harnessRuntimeMap,
    harnesses: services.harnesses,
    activeRuntimeRuns,
    trackRuntimeRun,
    runAgentTurn,
    runReview,
    queuedTurnDispatcher,
    managerRuntime,
    activityHibernation,
    dispatchDeliverer,
    workerNoticeCoordinator,
    raceDeps: managerRuntime.raceServiceDeps,
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

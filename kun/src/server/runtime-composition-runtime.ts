import { RoomNotificationObserver } from '../rooms/room-notification-observer.js'
import { bindAgentCommitmentService } from '../agents/agent-commitment-tools.js'
import { bindAgentArtifactLibrary } from '../agents/agent-artifact-library.js'
import {
  KUN_SERVICE_VERSION,
  KUN_MANAGER_PROTOCOL_VERSION,
  shutdownAllLspSessions,
  DEFAULT_KUN_CAPABILITIES_CONFIG,
  DEFAULT_APPROVAL_REVIEWER,
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  CURRENT_MANIFEST_VERSION,
  SUPPORTED_EXTENSION_API_VERSIONS
} from './runtime-factory-dependencies.js'
import type { createRuntimeExtensionComposition } from './runtime-composition-extensions.js'
import type { createRuntimeConfigController } from './runtime-composition-config.js'
import { bindRoomRuleStore } from '../rooms/room-rule-read-tool.js'
import { bindRoomPeerStore } from '../rooms/room-peer-tools.js'
import { bindImMessageService } from '../rooms/room-im-message-tool.js'
import { bindRoomAppAccess } from '../rooms/room-app-connection-tools.js'
import { bindAgentHandoffService } from '../agents/agent-handoff-tools.js'
import { bindAgentSetupDirectory } from '../agents/agent-setup-tools.js'
import { WorkbenchHarnessService } from '../workbench-bridge/harnesses.js'
import { bindWorkbenchBridge } from '../workbench-bridge/bridge.js'
import {
  persistRuntimeCapabilitySection,
  persistRuntimeMcpConfig,
  persistRuntimeSkillsConfig,
  persistSharedMcpConfig
} from './runtime-factory-config.js'
import { settleCleanupSteps } from './runtime-factory-cleanup.js'
import { shutdownRuntimeExecutionForHost } from './runtime-graph-lifecycle.js'
import { disposeProxyAgents } from '../adapters/model/proxy-fetch.js'
import type { ServerRuntime } from './runtime-factory-dependencies.js'
import { createRuntimeRoomComposition } from './runtime-composition-rooms.js'
import { beginOwnedProcessShutdown, shutdownOwnedProcesses } from '../process/owned-process.js'
import { ownedServiceManagerProcesses } from '../manager/owned-service-manager-session.js'

export function createServerRuntimeComposition(
  extensions: Awaited<ReturnType<typeof createRuntimeExtensionComposition>>,
  config: ReturnType<typeof createRuntimeConfigController>
): ServerRuntime {
  const { agent } = extensions
  const { registryComposition } = agent
  const { services } = registryComposition
  const { model } = services
  const { core } = model
  const {
    eventBus,
    eventStreamRegistry,
    stores,
    sessionStore,
    approvalGate,
    userInputGate,
    workspaceInspector,
    usageService,
    inflight,
    nowIso,
    allocateSeq,
    llmDebug,
    agentObservability,
    events,
    threadActivity,
    activityStore,
    activityFacts,
    taskWorkspaces,
    prefix,
    threadService,
    projectBoardService,
    artifactStore,
    graphConfig,
    graphRuntime
  } = core
  const { dataDirLease } = core
  const {
    extensionProviderAccounts,
    extensionCredentials,
    extensionAccountAudit,
    extensionAccounts,
    extensionModelProviders,
    modelConnections,
    routeHealth,
    directModelClient,
    modelClient,
    routePoolTests,
    providerQuotaService,
    modelConnectionOAuth,
    officialProviderCli,
    officialProviderAuth,
    gatewayCredentials,
    gatewayUsage,
    stopExtensionModelListener
  } = model
  const {
    executionLeases,
    turnService,
    forwardThreadControl,
    forwardControlById,
    backgroundShellRuntime,
    toolCancellationService,
    supplyChainTrust,
    reviewService,
    backgroundMaintenance,
    prepareUsageCarryover,
    migrationService,
    migrationImportService,
    knowledgeBaseService
  } = services
  const { delegationRuntime } = registryComposition
  const {
    toolHost,
    extensionTools,
    canvasReceipts,
    kunToolBridge,
    activeRuntimeRuns,
    runAgentTurn,
    runReview,
    extensionAgent
  } = agent
  const {
    extensionPaths,
    extensionRegistry,
    extensionValidation,
    extensionPackageManager,
    extensionState,
    extensionConfiguration,
    extensionMediaHandles,
    extensionArtifacts,
    extensionJobDiagnostics,
    extensionJobs,
    extensionMediaJobs,
    extensionAudioAnalysisJobs,
    extensionMediaArchiveJobs,
    extensionViewSessions,
    extensionSecretReveals,
    extensionBroker,
    extensionManager,
    bundledSeedResults,
    extensionIndexClient
  } = extensions
  const { startedAt, rebuildCapabilities, applyConfig } = config
  const roomComposition = createRuntimeRoomComposition({
    options: () => config.activeOptions,
    services: { threads: threadService, threadStore: stores.threadStore, eventBus,
      artifacts: artifactStore, modelCapabilities: core.modelCapabilities,
      memoryStore: services.memoryStore, memoryEnabled: () => config.activeOptions.capabilities?.memory?.enabled !== false,
      turns: turnService, sessions: sessionStore, approvals: approvalGate, inputs: userInputGate,
      runTurn: runAgentTurn,
      peerModels: { client: modelClient, roles: () => config.activeOptions.roles },
      backgroundExecutionActive: (threadId) => backgroundShellRuntime.listSessions(threadId).some((item) => item.status === 'running'),
      stopBackgroundExecution: async (threadId) => { await backgroundShellRuntime.stopThread(threadId) },
      proveStopped: async (threadId, turnId) => {
        if (turnId && turnService.isTurnExecutionActive(turnId)) return false
        if (backgroundShellRuntime.listSessions(threadId).some((item) => item.status === 'running')) return false
        if (executionLeases && await executionLeases.owner(threadId)) return false
        const thread = await threadService.getMetadata(threadId)
        if (thread?.turns.some((turn) => turn.status === 'queued' || turn.status === 'running')) return false
        if (!turnId) return true
        if (thread?.turns.some((turn) => turn.id === turnId && ['completed', 'failed', 'aborted'].includes(turn.status))) return true
        // Lease absence alone does not prove a missing executor finished.
        const highest = await sessionStore.highestSeq(threadId)
        const tail = await sessionStore.loadEventsSince(threadId, Math.max(0, highest - 1000))
        return tail.some((event) => event.turnId === turnId &&
          ['turn_completed', 'turn_failed', 'turn_aborted'].includes(event.kind))
      } }
  })
  events.addObserver(new RoomNotificationObserver({ threadStore: stores.threadStore, store: roomComposition.rooms.deps.store }))
  bindAgentCommitmentService(core.threadStore, roomComposition.rooms.commitments)
  bindAgentArtifactLibrary(core.threadStore, roomComposition.rooms.artifactLibrary)
  bindRoomRuleStore(core.threadStore, roomComposition.rooms.service.store)
  // Tool providers bind to the lifecycle-fenced facade, while room admission
  // retains the backing store. Bind both identities to the same room scope.
  bindRoomPeerStore(core.threadStore, roomComposition.rooms.deps.store)
  bindImMessageService(core.threadStore, roomComposition.rooms.service)
  bindRoomAppAccess(core.threadStore, () => ({
    servers: (config.activeOptions.capabilities ?? DEFAULT_KUN_CAPABILITIES_CONFIG).mcp.servers,
    statuses: Object.fromEntries(services.mcpProviders.diagnostics.map((item) => [item.id, item.status]))
  }))
  bindAgentHandoffService(core.threadStore, roomComposition.rooms.handoffs)
  bindAgentSetupDirectory(core.threadStore, roomComposition.rooms.agents)
  // The tool registry holds the lifecycle-fenced facade, which is a different identity from the room runtime's store.
  bindWorkbenchBridge(core.threadStore, roomComposition.rooms.workbench)
  roomComposition.rooms.workbench.attach({ taskWorkspaces, projectBoard: projectBoardService,
    harnesses: new WorkbenchHarnessService({ catalog: services.harnesses.catalog, detector: services.harnesses.detector, readiness: services.harnesses.readiness,
      runtimes: agent.harnessRuntimeMap, router: agent.harnessRouter,
      probedModels: (definition) => services.harnesses.probedModels(definition),
      probeModels: (definition) => definition.transport === 'acp' ? services.harnesses.acpModels.probe(definition)
        : definition.transport === 'agent-sdk' ? services.harnesses.agentSdkModels.probe(definition)
          : definition.transport === 'codex-app-server' ? services.harnesses.codexModels.probe(definition)
            : definition.transport === 'pi-rpc' ? services.harnesses.piModels.probe(definition) : Promise.resolve([]),
      snapshot: () => modelConnections.snapshot(), defaultModel: () => roomComposition.rooms.deps.model() }) })
  return {
    threadService,
    historyReferences: core.historyReferences,
    rooms: roomComposition.rooms,
    projectBoardService,
    turnService,
    threadStore: stores.threadStore,
    toolCancellationService,
    reviewService,
    usageService,
    eventBus,
    sessionStore,
    events,
    threadActivity,
    activityStore,
    activityFacts,
    activityHibernation: agent.activityHibernation,
    taskWorkspaces,
    googleWorkspace: services.googleWorkspace,
    attribution: services.attribution,
    changeRequests: services.changeRequests,
    eventStreamRegistry,
    llmDebug,
    canvasReceipts,
    kunToolBridge,
    harnessTokens: services.harnesses.tokens,
    ade: {
      stores: services.adeStores,
      workerCallbacks: services.workerCallbacks,
      terminalAgents: services.terminalAgents,
      hookWriter: services.hookWriter,
      manager: agent.managerRuntime,
      deliverer: agent.dispatchDeliverer,
      noticeCoordinator: agent.workerNoticeCoordinator,
      races: agent.raceDeps
    },
    liveCounters: () => ({
      inflight: inflight.size(),
      activeCaptures: llmDebug?.activeCaptureCount ?? 0
    }),
    startBackgroundMaintenance: () => {
      backgroundMaintenance.start()
      roomComposition.start()
    },
    prepareForRequests: async () => {
      await prepareUsageCarryover()
      // Interrupted ask_manager waiters can never resolve after a restart;
      // mark their persisted questions timed out before serving requests.
      await services.workerCallbacks.reconcileAllTeams().catch(() => undefined)
      // Terminal-agent units whose exit reports were lost with the last
      // session come back as restoredUnconfirmed rows (05 §6.1).
      await services.terminalAgents.restore().catch(() => undefined)
      // Re-resolve dispatches stuck in delivering/uncertain before the crash
      // (09 §5): found turns are adopted; missing ones redeliver idempotently.
      await agent.managerRuntime.reconcileOnStartup().catch((error) => {
        console.warn('[kun] ade dispatch reconciliation failed:', error)
      })
      // Restart replay (09 §6.2): notices still unacknowledged after the last
      // run get one merged wake-up per manager thread.
      await agent.workerNoticeCoordinator.replayPending().catch((error) => {
        console.warn('[kun] ade worker-notice replay failed:', error)
      })
    },
    inspectThreadStore: () => services.threadStoreGuardian.run(),
    sessionGuardian: services.sessionGuardian,
    threadSnapshots: services.threadSnapshots,
    approvalGate,
	    userInputGate,
	    workspaceInspector,
	    toolHost,
	    get attachmentStore() {
	      return services.attachmentStore
	    },
	    get memoryStore() {
	      return services.memoryStore
	    },
	    get memoryFeedback() {
	      return services.memoryFeedback
	    },
	    memoryDistillation: services.memoryDistillation,
	    migrationService,
	    migrationImportService,
	    knowledgeBaseService,
	    get delegationRuntime() {
	      return delegationRuntime
	    },
	    graph: {
	      control: graphRuntime.control,
	      store: graphRuntime.store,
	      drafts: graphRuntime.drafts,
	      config: graphConfig,
	      scheduler: graphRuntime.scheduler,
	      supervisor: graphRuntime.supervisor,
	      mailbox: graphRuntime.mailbox,
	      writes: graphRuntime.writes,
	      recovery: graphRuntime.recovery,
	      registry: graphRuntime.registry,
	      learning: graphRuntime.learning,
	      references: graphRuntime.references,
	      artifacts: artifactStore
	    },
	    backgroundShellRuntime,
	    supplyChainTrust,
	    extensionPlatform: {
	      paths: extensionPaths,
	      registry: extensionRegistry,
	      packageManager: extensionPackageManager,
	      manager: extensionManager,
	      indexClient: extensionIndexClient,
	      validation: extensionValidation,
	      broker: extensionBroker,
	      agent: extensionAgent,
	      tools: extensionTools,
	      modelProviders: extensionModelProviders,
	      providerAccounts: extensionProviderAccounts,
	      accounts: extensionAccounts,
	      credentials: extensionCredentials,
	      state: extensionState,
	      configuration: extensionConfiguration,
	      mediaHandles: extensionMediaHandles,
	      artifacts: extensionArtifacts,
	      viewSessions: extensionViewSessions,
	      secretReveals: extensionSecretReveals,
	      jobs: extensionJobs,
	      bundledSeedResults
	    },
	    harnesses: services.harnesses,
	    providerConfigs: () => config.activeOptions.providers ?? {},
	    modelClient,
	    directModelClient,
	    modelGateway: {
	      enabled: () => config.activeOptions.localModelGateway?.enabled === true && gatewayCredentials.hasActiveCredentials(),
      exposeProviderModels: () => config.activeOptions.localModelGateway?.exposeProviderModels === true,
	      pools: () => modelClient.routePools(),
	      configuredPools: () => modelClient.configuredPools(),
	      health: routeHealth,
	      tests: routePoolTests,
	      credentials: gatewayCredentials,
	      usage: gatewayUsage,
	      modelCapabilities: core.modelCapabilities
	    },
	    modelConnections,
	    modelConnectionOAuth,
	    officialProviderCli,
	    officialProviderAuth,
	    providerQuotaService,
	    get defaultModel() {
	      return config.activeOptions.model
	    },
	    get roles() {
	      return config.activeOptions.roles
	    },
	    immutablePrefix: prefix,
    runTurn(threadId, turnId) {
      return runAgentTurn(threadId, turnId)
    },
    queuedTurnDispatcher: agent.queuedTurnDispatcher,
    resumeInterruptedGoals(sources) {
      return agent.loop.resumeInterruptedGoals(sources)
    },
    resumeInterruptedTurns(sources, childRecoveryCandidates) {
      return agent.loop.resumeInterruptedTurns(sources, childRecoveryCandidates)
    },
    runReview(input) {
      return runReview(input)
	    },
	    runtimeToken: config.activeOptions.runtimeToken,
	    insecure: config.activeOptions.insecure,
	    ...(core.options.serviceManager
	      ? { managerProtocolVersion: KUN_MANAGER_PROTOCOL_VERSION }
	      : {}),
	    ...(forwardThreadControl ? { forwardThreadControl } : {}),
	    ...(forwardControlById ? { forwardControlById } : {}),
	    allocateSeq,
	    nowIso,
	    applyConfig,
	    activeTurnCount: () => activeRuntimeRuns.size,
	    info: () => {
	      const memory = process.memoryUsage()
	      const peakRssBytes = Math.max(memory.rss, process.resourceUsage().maxRSS * 1024)
	      return {
	        instanceId: config.activeOptions.instanceId ?? 'embedded',
	        serviceVersion: KUN_SERVICE_VERSION,
	        ...(config.activeOptions.buildId ? { buildId: config.activeOptions.buildId } : {}),
	        launchMode: config.activeOptions.launchMode ?? 'foreground',
	        host: config.activeOptions.host,
	        port: config.activeOptions.port,
	        configPath: config.activeOptions.configPath,
	        dataDir: config.activeOptions.dataDir,
	        model: config.activeOptions.model,
	        endpointFormat: config.activeOptions.endpointFormat ?? DEFAULT_MODEL_ENDPOINT_FORMAT,
	        approvalPolicy: config.activeOptions.approvalPolicy,
	        sandboxMode: config.activeOptions.sandboxMode,
	        approvalReviewer:
	          config.activeOptions.approvalReviewer ?? DEFAULT_APPROVAL_REVIEWER,
	        tokenEconomyMode: config.activeOptions.tokenEconomyMode,
	        insecure: config.activeOptions.insecure,
        startedAt,
        pid: process.pid,
        memoryUsage: {
          rssBytes: memory.rss,
          peakRssBytes,
          heapUsedBytes: memory.heapUsed,
          heapTotalBytes: memory.heapTotal,
          externalBytes: memory.external
        },
        integrations: { googleWorkspace: { experimental: true, version: '0.22.5', driveReadOnly: true, authControl: 'settings' } },
        capabilities: rebuildCapabilities(),
	        extensions: {
	          enabled: true,
	          apiVersions: [...SUPPORTED_EXTENSION_API_VERSIONS],
	          manifestVersions: [CURRENT_MANIFEST_VERSION],
	          packageRoot: extensionPaths.packageRoot,
	          dataRoot: extensionPaths.dataRoot
	        }
      }
    },
	    toolDiagnostics: async () => ({
	      providers: config.registry.diagnostics(),
	      mcpServers: services.mcpProviders.diagnostics,
      mcpOAuth: services.mcpProviders.oauth,
      mcpSearch: services.mcpProviders.search,
	      webProviders: services.webProviders.diagnostics,
      skills: services.skillRuntime.diagnostics(),
      instructions: services.instructionRuntime.diagnostics(),
      attachments: services.attachmentStore
        ? await services.attachmentStore.diagnostics()
        : { enabled: false, rootDir: '', count: 0, totalBytes: 0 },
      memory: services.memoryStore
        ? await services.memoryStore.diagnostics()
        : { enabled: false, rootDir: '', activeCount: 0, tombstoneCount: 0, lastInjectedIds: [] },
      imageGen: services.imageGenProviders.diagnostics,
      speechGen: services.speechGenProviders.diagnostics,
      musicGen: services.musicGenProviders.diagnostics,
	      videoGen: services.videoGenProviders.diagnostics,
	      extensions: {
	        tools: extensionTools.list(),
	        providers: [...extensionModelProviders.clientMap().keys()].sort(),
	        providerDiagnostics: extensionModelProviders.diagnostics(),
	        hosts: await extensionManager.listDiagnostics(),
	        jobs: {
	          activeCount: extensionJobs.activeCount,
	          subscriptionCount: extensionJobs.subscriptionCount,
	          recent: extensionJobDiagnostics.map((diagnostic) => ({ ...diagnostic }))
	        }
	      }
	    }),
    mcpOAuth: async () => services.mcpProviders.oauth,
    clearMcpOAuth: async (serverId) => services.mcpProviders.clearOAuthCredentials(serverId),
    authorizeMcpOAuth: async (serverId) => services.mcpProviders.authorizeOAuth(serverId),
    mcpConfig: () => structuredClone(
      (config.activeOptions.capabilities ?? DEFAULT_KUN_CAPABILITIES_CONFIG).mcp
    ),
    setMcpServer: async (serverId, server) => {
      const capabilities = config.activeOptions.capabilities ?? DEFAULT_KUN_CAPABILITIES_CONFIG
      const mcp = capabilities.mcp
      const servers = { ...mcp.servers }
      if (server) {
        servers[serverId] = {
          ...server,
          planModeReadOnlyTools: server.planModeReadOnlyTools ?? []
        }
      }
      else delete servers[serverId]
      const result = await applyConfig({
        capabilities: {
          ...capabilities,
          mcp: { ...mcp, enabled: Object.keys(servers).length > 0, servers }
        }
      })
      if (result.ok) {
        const updatedMcp = (config.activeOptions.capabilities ?? DEFAULT_KUN_CAPABILITIES_CONFIG).mcp
        await Promise.all([
          persistRuntimeMcpConfig(config.activeOptions.dataDir, updatedMcp),
          ...(config.activeOptions.sharedMcpConfigPath
            ? [persistSharedMcpConfig(config.activeOptions.sharedMcpConfigPath, updatedMcp)]
            : [])
        ])
      }
      return result
    },
    skills: (workspace) => workspace
      ? services.skillRuntime.diagnosticsForWorkspace(workspace)
      : services.skillRuntime.diagnostics(),
    refreshSkills: async () => services.skillRuntime.refresh(),
    setSkillsEnabled: async (enabled) => {
      const capabilities = config.activeOptions.capabilities ?? DEFAULT_KUN_CAPABILITIES_CONFIG
      const result = await applyConfig({
        capabilities: {
          ...capabilities,
          skills: { ...capabilities.skills, enabled }
        }
      })
      if (result.ok) {
        await persistRuntimeSkillsConfig(
          config.activeOptions.dataDir,
          (config.activeOptions.capabilities ?? DEFAULT_KUN_CAPABILITIES_CONFIG).skills
        )
      }
      return result
    },
    setLocalCapabilityEnabled: async (id, enabled) => {
      const capabilities = config.activeOptions.capabilities ?? DEFAULT_KUN_CAPABILITIES_CONFIG
      const result = await applyConfig({
        capabilities: {
          ...capabilities,
          [id]: { ...capabilities[id], enabled }
        }
      })
      if (result.ok) {
        await persistRuntimeCapabilitySection(
          config.activeOptions.dataDir,
          id,
          (config.activeOptions.capabilities ?? DEFAULT_KUN_CAPABILITIES_CONFIG)[id]
        )
      }
      return result
    },
    shutdown: async () => {
      beginOwnedProcessShutdown()
      await settleCleanupSteps([
        async () => {
          await shutdownRuntimeExecutionForHost({
            prepare: async () => {
              eventStreamRegistry.closeAll()
              await roomComposition.close()
              agent.shuttingDown = true
              await agent.queuedTurnDispatcher.dispose()
              backgroundMaintenance.stop()
              modelConnectionOAuth.close()
              eventStreamRegistry.closeAll()
              agent.loop.shutdownGoalResume()
              agent.loop.shutdownInterruptedResume()
              await turnService.closeAdmissionForShutdown()
            },
            graphRuntime,
            turnService,
            activeRuntimeRuns,
            shutdownLeases: async () => { await executionLeases?.shutdown() }
          })
        },
        () => { agent.activityHibernation.stop() },
        async () => { await services.memoryDistillation.shutdown() },
        () => services.googleWorkspace.shutdown(),
        () => backgroundShellRuntime.shutdown(),
        () => extensionJobs.handleRuntimeShutdown(),
        () => { extensionMediaJobs.dispose() },
        () => { extensionAudioAnalysisJobs.dispose() },
        () => { extensionMediaArchiveJobs.dispose() },
        () => { stopExtensionModelListener() },
        () => { extensionViewSessions.disposeAll() },
        () => extensionManager.shutdown(),
        () => extensionBroker.dispose(),
        () => { extensionSecretReveals.dispose() },
        () => extensionAccountAudit.flush(),
        () => { extensionTools.disposeAll() },
        () => extensionModelProviders.disposeAll(),
        () => shutdownAllLspSessions(),
        () => services.mcpProviders.close(),
        () => migrationService.shutdown(),
        () => migrationImportService.shutdown(),
        () => routeHealth.flush(),
        () => shutdownOwnedProcesses({ graceMs: 500, timeoutMs: 3000, exclude: ownedServiceManagerProcesses() }),
        async () => { await llmDebug?.shutdown() },
        async () => { await agentObservability?.shutdown() },
        async () => { await stores.shutdown?.() },
        async () => { await dataDirLease?.release() },
        () => { disposeProxyAgents() }
      ])
    }
  }
}

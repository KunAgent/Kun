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
    modelClient,
    routePoolTests,
    providerQuotaService,
    modelConnectionOAuth,
    officialProviderCli,
    officialProviderAuth,
    gatewayCredentials,
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
  return {
    threadService,
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
    eventStreamRegistry,
    llmDebug,
    canvasReceipts,
    liveCounters: () => ({
      inflight: inflight.size(),
      activeCaptures: llmDebug?.activeCaptureCount ?? 0
    }),
    startBackgroundMaintenance: () => backgroundMaintenance.start(),
    prepareForRequests: prepareUsageCarryover,
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
	    modelClient,
	    modelGateway: {
	      enabled: () => config.activeOptions.localModelGateway?.enabled === true && gatewayCredentials.hasKey(),
	      pools: () => modelClient.routePools(),
	      configuredPools: () => modelClient.configuredPools(),
	      health: routeHealth,
	      tests: routePoolTests,
	      credentials: gatewayCredentials
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
      await settleCleanupSteps([
        async () => {
          await shutdownRuntimeExecutionForHost({
            prepare: async () => {
              agent.shuttingDown = true
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
        async () => {
          try {
            await backgroundShellRuntime.shutdown()
            await extensionJobs.handleRuntimeShutdown()
            extensionMediaJobs.dispose()
            extensionAudioAnalysisJobs.dispose()
            extensionMediaArchiveJobs.dispose()
            stopExtensionModelListener()
            extensionViewSessions.disposeAll()
            await extensionManager.shutdown()
            await extensionBroker.dispose()
            extensionSecretReveals.dispose()
            await extensionAccountAudit.flush()
            extensionTools.disposeAll()
            await extensionModelProviders.disposeAll()
            shutdownAllLspSessions()
            await services.mcpProviders.close()
            await migrationService.shutdown()
            await migrationImportService.shutdown()
            await routeHealth.flush()
          } finally {
            try {
              await llmDebug?.shutdown()
              await agentObservability?.shutdown()
            } finally {
              await stores.shutdown?.()
            }
          }
        },
        async () => { await dataDirLease?.release() },
        () => { disposeProxyAgents() }
      ])
    }
  }
}

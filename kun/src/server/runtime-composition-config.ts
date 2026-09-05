import {
  join,
  isDeepStrictEqual,
  isLoopbackHost,
  CapabilityRegistry,
  buildGoalLocalTools,
  buildTodoLocalTools,
  buildPptAgentLocalTools,
  PPT_AGENT_LOCAL_PROVIDER_ID,
  buildDefaultLocalTools,
  createReadArtifactTool,
  buildMcpToolProviders,
  buildMemoryToolProviders,
  buildKnowledgeToolProvider,
  buildSkillToolProviders,
  buildDelegationToolProviders,
  buildComponentDesignToolProviders,
  buildDiagramVisualizationToolProvider,
  buildConversationVisualizationToolProvider,
  buildChartToolProvider,
  buildWebToolProviders,
  buildImageGenToolProviders,
  protocolSupportsImageEdit,
  buildComputerUseToolProviders,
  buildBrowserUseToolProviders,
  buildOfficeCliToolProviders,
  createConfiguredOfficeCliRunner,
  buildMusicGenToolProviders,
  buildSpeechGenToolProviders,
  buildVideoGenToolProviders,
  buildRuntimeCapabilityManifest,
  DEFAULT_APPROVAL_REVIEWER,
  AgentLoop,
  type AgentLoopOptions,
  modelCapabilitiesForModel,
  modelContextProfilesFromConfig,
  DEFAULT_QUALITY_CONFIG,
  buildBuiltinHooks,
  mergeBuiltinSubagentProfiles,
  buildFastContextToolProvider,
  buildPptAgentToolProvider,
  type RuntimeConfigApplyRequest,
  type RuntimeConfigApplyResponse,
  SkillRuntime,
  InstructionRuntime,
  resolveConfiguredHooks
} from './runtime-factory-dependencies.js'
import type { createRuntimeExtensionComposition } from './runtime-composition-extensions.js'
import {
  builtinToolOptionsForOptions,
  llmDebugCaptureEnabled,
  mergeRuntimeConfigApplyOptions,
  modelRequestCaptureDefaultEnabled,
  skillsConfigForRuntime,
  tokenEconomyConfigForOptions
} from './runtime-factory-config.js'
import { stageBrowserUseHostBinding } from './runtime-browser-use-binding.js'
import { buildModelClientRouterInput, hydrateLegacyCredentialOptions, modelContextProfilesByProvider } from './runtime-factory-model.js'
import { createPersistentAttachmentStore, createPersistentMemoryStore } from './runtime-factory-storage.js'
import { delegationRuntimeConfigView } from './runtime-delegation-config-view.js'

export function createRuntimeConfigController(
  extensions: Awaited<ReturnType<typeof createRuntimeExtensionComposition>>
) {
  const { agent } = extensions
  const { registryComposition } = agent
  const { services } = registryComposition
  const { model } = services
  const { core } = model
  const {
    nowIso,
    llmDebug,
    threadService,
    graphRuntime,
    graphToolsProvider,
    modelCapabilities
  } = core
  const {
    refreshDelegatedProviderIds,
    extensionCredentialKeyProvider,
    extensionModelProviders,
    legacyCredentialMigration,
    modelConnections,
    resolveLegacyRequestCredentials,
    migrateLegacyProviderCredentials,
    buildApprovalReviewClients,
    directModelClient,
    approvalReviewModelClient,
    modelClient,
    timedModelClient,
    subagentRouter,
    antigravityProviderIds,
    cursorSdkProviderIds,
    resolveCapabilityProviderCredential,
    gatewayCredentials,
    oauthEncryptor
  } = model
  const {
    turnService,
    withBackgroundShellTools,
    reviewService,
    pruneUnsentAttachments,
    designCanvasProvider,
    taskGraphTool,
    childToolHost,
    defaultIsAntigravity,
    defaultIsCursorSdk
  } = services
  const { delegationRuntime } = registryComposition
  const {
    toolHost,
    extensionTools,
    buildMainDelegatedRuntime,
    sdkRuntime,
    extensionAgent
  } = agent
  const { extensionPreparations } = extensions
  let activeOptions = core.activeOptions
  let modelProfiles = core.modelProfiles
  let providerModelProfiles = core.providerModelProfiles
  let tokenEconomy = core.tokenEconomy
  let mcpProviders = services.mcpProviders
  let skillRuntime = services.skillRuntime
  let instructionRuntime = services.instructionRuntime
  let attachmentStore = services.attachmentStore
  let memoryStore = services.memoryStore
  let webProviders = services.webProviders
  let imageGenProviders = services.imageGenProviders
  let speechGenProviders = services.speechGenProviders
  let musicGenProviders = services.musicGenProviders
  let videoGenProviders = services.videoGenProviders
  let computerUseProviders = services.computerUseProviders
  let browserUseProviders = services.browserUseProviders
  let baseToolProviders = services.baseToolProviders
  let resolvedHooks = services.resolvedHooks
  let childRegistry = services.childRegistry
  let registry = registryComposition.registry
  let capabilities = registryComposition.capabilities
  let loopOptions = agent.loopOptions
  let loop = agent.loop
	  const capabilitySnapshot = () => ({
	    options: activeOptions,
	    mcp: mcpProviders,
	    web: webProviders,
	    skills: skillRuntime,
	    instructions: instructionRuntime,
	    attachments: attachmentStore,
	    memory: memoryStore,
	    subagentsAvailable: Boolean(delegationRuntime?.enabled()),
	    imageGen: imageGenProviders,
	    speechGen: speechGenProviders,
	    musicGen: musicGenProviders,
	    videoGen: videoGenProviders,
	    computerUse: computerUseProviders,
	    browserUse: browserUseProviders
	  })
	  const buildCapabilities = (snapshot: ReturnType<typeof capabilitySnapshot>): typeof capabilities => buildRuntimeCapabilityManifest({
	    config: snapshot.options.capabilities,
	    model: modelCapabilities(snapshot.options.model),
	    mcp: {
	      configuredServers: Object.keys(snapshot.options.capabilities?.mcp.servers ?? {}).length,
	      connectedServers: snapshot.mcp.connectedServers,
	      toolCount: snapshot.mcp.toolCount,
	      lastError: snapshot.mcp.diagnostics.find((diagnostic) => diagnostic.lastError)?.lastError,
	      search: {
	        active: snapshot.mcp.search.active,
	        indexedToolCount: snapshot.mcp.search.indexedToolCount,
	        advertisedToolCount: snapshot.mcp.search.advertisedToolCount
	      }
	    },
	    web: {
	      fetchAvailable: snapshot.web.fetchAvailable,
	      searchAvailable: snapshot.web.searchAvailable,
	      provider: snapshot.web.provider,
	      reason: snapshot.web.diagnostics.find((diagnostic) => diagnostic.reason)?.reason
	    },
	    skills: {
	      configuredRoots: snapshot.options.capabilities?.skills.roots.length,
	      discoveredSkills: snapshot.skills.count(),
	      reason: snapshot.skills.diagnostics().validationErrors[0]?.message
	    },
	    instructions: {
	      available: snapshot.instructions.enabled(),
	      lastSourceCount: snapshot.instructions.diagnostics().lastInjection?.sources.length ?? 0,
	      lastInjectedBytes: snapshot.instructions.diagnostics().lastInjection?.injectedBytes ?? 0
	    },
	    attachments: {
	      available: Boolean(snapshot.attachments)
	    },
	    memory: {
	      available: Boolean(snapshot.memory)
	    },
	    subagents: {
	      available: snapshot.subagentsAvailable
	    },
	    imageGen: {
	      available: snapshot.imageGen.available,
	      reason: snapshot.imageGen.diagnostics.find((diagnostic) => diagnostic.reason)?.reason,
	      supportsReferenceEdit: protocolSupportsImageEdit(snapshot.options.capabilities?.imageGen?.protocol)
	    },
	    speechGen: {
	      available: snapshot.speechGen.available,
	      reason: snapshot.speechGen.diagnostics.find((diagnostic) => diagnostic.reason)?.reason
	    },
	    musicGen: {
	      available: snapshot.musicGen.available,
	      reason: snapshot.musicGen.diagnostics.find((diagnostic) => diagnostic.reason)?.reason
	    },
	    videoGen: {
	      available: snapshot.videoGen.available,
	      reason: snapshot.videoGen.diagnostics.find((diagnostic) => diagnostic.reason)?.reason
	    },
	    computerUse: {
	      available: snapshot.computerUse.available,
	      reason: snapshot.computerUse.diagnostics.find((diagnostic) => diagnostic.reason)?.reason
	    },
	    browserUse: {
	      available: snapshot.browserUse.available,
	      interactionRequired: snapshot.browserUse.interactionRequired,
	      reason: snapshot.browserUse.reason
	    }
	  })
	  const startedAt = activeOptions.startedAt ?? nowIso()
	  const rebuildCapabilities = (): typeof capabilities => buildCapabilities(capabilitySnapshot())
	  let applyConfigQueue: Promise<RuntimeConfigApplyResponse> = Promise.resolve({ ok: true })
	  const applyConfig = (request: RuntimeConfigApplyRequest): Promise<RuntimeConfigApplyResponse> => {
	    const task = applyConfigQueue
	      .catch(() => ({ ok: true }) as RuntimeConfigApplyResponse)
	      .then(() => applyConfigOnce(request))
	    applyConfigQueue = task
	    return task
	  }
	  const applyConfigOnce = async (
	    request: RuntimeConfigApplyRequest
	  ): Promise<RuntimeConfigApplyResponse> => {
	    if (
	      request.serve?.observability !== undefined &&
	      !isDeepStrictEqual(request.serve.observability, activeOptions.observability ?? {})
	    ) {
	      return {
	        ok: false,
	        code: 'restart_required',
	        message: 'observability exporter changes require a runtime restart'
	      }
	    }
	    const mergedOptions = mergeRuntimeConfigApplyOptions(activeOptions, request)
	    if (llmDebugCaptureEnabled(mergedOptions) !== llmDebugCaptureEnabled(activeOptions)) {
	      return {
	        ok: false,
	        code: 'restart_required',
	        message: 'Agent Perspective capture changes require a runtime restart'
	      }
	    }
	    let nextOptions = await hydrateLegacyCredentialOptions(
	      mergedOptions,
	      legacyCredentialMigration
	    )
	    if (nextOptions.localModelGateway?.enabled && !gatewayCredentials.hasKey()) {
	      return {
	        ok: false,
	        code: 'invalid_config',
	        message: 'local model gateway requires an independent API key; ensure a key before enabling it'
	      }
	    }
	    if (nextOptions.localModelGateway?.enabled && !isLoopbackHost(nextOptions.host)) {
	      return {
	        ok: false,
	        code: 'invalid_config',
	        message: 'local model gateway requires a loopback serve host'
	      }
	    }
	    const nextSubagentsEnabled = nextOptions.capabilities?.subagents.enabled === true
	    if (nextSubagentsEnabled && !delegationRuntime) {
	      return {
	        ok: false,
	        code: 'restart_required',
	        message: 'enabling subagents requires a runtime restart'
	      }
	    }

	    const nextModelProfiles = modelContextProfilesFromConfig({
	      contextCompaction: nextOptions.contextCompaction,
	      models: nextOptions.models
	    })
	    const nextProviderModelProfiles = modelContextProfilesByProvider(nextOptions.providers)
	    const nextTokenEconomy = tokenEconomyConfigForOptions(nextOptions)
	    const nextMcpHasOAuth = Object.values(nextOptions.capabilities?.mcp?.servers ?? {}).some((server) =>
	      server.oauth?.enabled !== false && Boolean(server.oauth) && server.transport !== 'stdio'
	    )
	    const nextOAuthEncryptor = nextMcpHasOAuth
	      ? extensionCredentialKeyProvider.encryptor
	      : undefined
	    const [nextMcpProviders, nextSkillRuntime] = await Promise.all([
	      buildMcpToolProviders(nextOptions.capabilities?.mcp, {
	        oauthStorageDir: join(activeOptions.dataDir, 'mcp-oauth'),
	        ...(nextOAuthEncryptor ? { oauthEncryptor: nextOAuthEncryptor } : {})
	      }),
      SkillRuntime.create(skillsConfigForRuntime(nextOptions))
	    ])
	    const stagedBrowserUseBinding = stageBrowserUseHostBinding(request)
	    let stagedGenerationCommitted = false
	    try {
	    const nextInstructionRuntime = new InstructionRuntime(
	      nextOptions.capabilities?.instructions
	    )
	    const nextAttachmentStore = createPersistentAttachmentStore(nextOptions, nowIso)
	    await pruneUnsentAttachments(nextAttachmentStore)
	    const nextMemoryStore = createPersistentMemoryStore(nextOptions, nowIso)
	    const nextWebProviders = buildWebToolProviders(nextOptions.capabilities?.web)
	    const nextImageGenProviders = buildImageGenToolProviders(nextOptions.capabilities?.imageGen, {
	      attachmentStore: nextAttachmentStore,
	      nowIso,
	      resolveCredential: resolveCapabilityProviderCredential, proxyUrl: nextOptions.modelProxyUrl
	    })
	    const nextSpeechGenProviders = buildSpeechGenToolProviders(nextOptions.capabilities?.speechGen, {
	      nowIso,
	      resolveCredential: resolveCapabilityProviderCredential, proxyUrl: nextOptions.modelProxyUrl
	    })
	    const nextMusicGenProviders = buildMusicGenToolProviders(nextOptions.capabilities?.musicGen, {
	      nowIso,
	      resolveCredential: resolveCapabilityProviderCredential, proxyUrl: nextOptions.modelProxyUrl
	    })
	    const nextVideoGenProviders = buildVideoGenToolProviders(nextOptions.capabilities?.videoGen, {
	      nowIso,
	      resolveCredential: resolveCapabilityProviderCredential, proxyUrl: nextOptions.modelProxyUrl
	    })
	    const nextComputerUseProviders = await buildComputerUseToolProviders(nextOptions.capabilities?.computerUse)
	    const nextBrowserUseProviders = buildBrowserUseToolProviders(nextOptions.capabilities?.browserUse)
    const nextPptAgentProvider = {
      id: PPT_AGENT_LOCAL_PROVIDER_ID,
      kind: 'built-in' as const,
	      enabled: true,
      available: true,
      tools: [
        ...buildPptAgentLocalTools({
	          enabled: () => nextOptions.lab?.pptAgent?.enabled !== false,
	          toolchainDirectory: () => process.env.KUN_PPT_TOOLCHAIN_DIR,
	          governanceDirectory: () => join(nextOptions.dataDir, 'ppt-governance'),
	          resolveSourceRequest: async (context) =>
	            (await turnService.getTurn(context.threadId, context.turnId))?.prompt
	        })
	      ]
	    }
	    const nextResolvedHooks = [
	      ...buildBuiltinHooks({ quality: nextOptions.quality ?? DEFAULT_QUALITY_CONFIG }),
	      ...resolveConfiguredHooks(nextOptions.hooks)
	    ]
	    const nextOfficeCliRunner = createConfiguredOfficeCliRunner({
	      binaryPath: process.env.KUN_OFFICECLI_BINARY,
	      profileDir: join(nextOptions.dataDir, 'officecli-profile')
	    })
	    const nextOfficeCliProviders = buildOfficeCliToolProviders({
	      binaryPath: process.env.KUN_OFFICECLI_BINARY,
	      profileDir: join(nextOptions.dataDir, 'officecli-profile'),
	      ...(nextOfficeCliRunner ? { runner: nextOfficeCliRunner } : {})
	    })
	    const nextSubagentConfig = nextOptions.capabilities?.subagents
	      ? mergeBuiltinSubagentProfiles(nextOptions.capabilities.subagents)
	      : undefined
	    const nextDelegationRuntime = delegationRuntimeConfigView(
	      delegationRuntime,
	      nextSubagentConfig
	    )
	    const nextBaseToolProviders = [
	      {
	        id: 'builtin',
	        kind: 'built-in' as const,
	        enabled: true,
	        available: true,
	        tools: withBackgroundShellTools(
	          buildDefaultLocalTools({}, builtinToolOptionsForOptions(nextOptions)),
	          nextOptions
	        )
	      },
	      {
	        id: 'artifacts',
	        kind: 'built-in' as const,
	        enabled: true,
	        available: true,
	        tools: [createReadArtifactTool()]
	      },
	      graphToolsProvider,
	      ...nextMcpProviders.providers,
	      ...nextWebProviders.providers,
	      ...buildMemoryToolProviders(nextMemoryStore),
	      buildKnowledgeToolProvider(services.knowledgeBaseService),
	      ...buildSkillToolProviders(nextSkillRuntime),
	      ...nextImageGenProviders.providers,
	      ...nextSpeechGenProviders.providers,
	      ...nextMusicGenProviders.providers,
	      ...nextVideoGenProviders.providers,
	      ...nextOfficeCliProviders,
      nextPptAgentProvider,
	      designCanvasProvider
	    ]
	    const nextChildRegistry = new CapabilityRegistry(nextBaseToolProviders)
	    const nextRegistry = new CapabilityRegistry([
	      ...nextBaseToolProviders,
	      ...nextComputerUseProviders.providers,
	      ...nextBrowserUseProviders.providers,
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
	      ...buildDelegationToolProviders(nextDelegationRuntime, subagentRouter),
	      ...buildFastContextToolProvider(
	        nextDelegationRuntime,
	        () => activeOptions.fastContext
	      ),
	      ...buildPptAgentToolProvider(
	        nextDelegationRuntime,
	        () => ({
	          ...nextOptions.lab?.pptAgent,
	          imageGenAvailable: nextImageGenProviders.available,
	          imageGenReason: nextImageGenProviders.diagnostics.find((diagnostic) => diagnostic.reason)?.reason,
	          imageGenSupportsReferenceEdit: protocolSupportsImageEdit(nextOptions.capabilities?.imageGen?.protocol),
	          toolIncompatibleProviderIds: [
	            ...new Set([...antigravityProviderIds, ...cursorSdkProviderIds])
	          ],
	          defaultProviderLacksManagedTools: defaultIsAntigravity || defaultIsCursorSdk
	        }),
	        turnService
	      ),
	      ...buildComponentDesignToolProviders(delegationRuntime),
	      ...buildDiagramVisualizationToolProvider(
	        () => activeOptions.lab?.conversationVisualization,
	        delegationRuntime
	      ),
	      ...buildConversationVisualizationToolProvider(
	        () => activeOptions.lab?.conversationVisualization
	      ),
	      ...buildChartToolProvider(() => activeOptions.lab?.conversationVisualization)
	    ])

	    // GUI/TUI own the live Registry through revisioned writes. Hot apply is
	    // a read-only Registry consumer: startup composition or explicit
	    // model-connection APIs perform initialization and selection mutations.
	    // Keeping this path read-only guarantees failed preflight cannot leave a
	    // partially applied provider catalog/default behind.
	    const materializedConnections = await modelConnections.materializeReadOnly()
	    if (materializedConnections.providers.size > 0) {
	      const selected = materializedConnections.selected
	      nextOptions = {
	        ...nextOptions,
	        activeProviderId: selected?.profile.id,
	        ...(selected
	          ? {
	              model: selected.model,
	              apiKey: selected.config.apiKey,
	              credentialSourceId: selected.config.credentialSourceId,
	              baseUrl: selected.config.baseUrl ?? nextOptions.baseUrl,
	              endpointFormat: selected.config.endpointFormat ?? nextOptions.endpointFormat,
	              modelProxyUrl: selected.config.modelProxyUrl,
	              headers: selected.config.headers,
	              geminiAuth: selected.config.geminiAuth
	            }
	          : {}),
	        providers: Object.fromEntries(materializedConnections.providers.entries()),
	        modelProxyUrl: selected?.config.modelProxyUrl,
	        routePools: materializedConnections.routePools,
	        localModelGateway: materializedConnections.localModelGateway
	      }
	    }
	    await migrateLegacyProviderCredentials(nextOptions)

	    const nextModelClients = buildModelClientRouterInput(
	      nextOptions,
	      (model) => modelCapabilitiesForModel(model, nextModelProfiles),
	      llmDebug,
	      resolveLegacyRequestCredentials
	    )
	    for (const [providerId, client] of extensionModelProviders.clientMap()) {
	      nextModelClients.providers.set(providerId, client)
	    }
	    const nextDelegatedRuntime = buildMainDelegatedRuntime({
	      options: nextOptions,
	      registry: nextRegistry,
	      skillRuntime: nextSkillRuntime,
	      instructionRuntime: nextInstructionRuntime,
	      attachmentStore: nextAttachmentStore,
	      memoryStore: nextMemoryStore
	    })
	    const nextLoopOptions: AgentLoopOptions = {
	      ...loopOptions,
	      skillRuntime: nextSkillRuntime,
	      instructionRuntime: nextInstructionRuntime,
	      tokenEconomy: nextTokenEconomy,
	      contextCompaction: nextOptions.contextCompaction,
	      roles: nextOptions.roles,
	      toolStorm: nextOptions.runtime?.toolStorm,
	      turnLimits: nextOptions.runtime?.turnLimits,
	      toolArgumentRepair: nextOptions.runtime?.toolArgumentRepair,
	      hooks: nextResolvedHooks,
	      attachmentStore: nextAttachmentStore,
	      memoryStore: nextMemoryStore
	    }
	    const nextLoop = new AgentLoop(nextLoopOptions)
	    const previousLoop = loop
	    const previousMcpProviders = mcpProviders
	    const graphChanged = !isDeepStrictEqual(activeOptions.graph, nextOptions.graph)
	    const nextApprovalReviewClients = buildApprovalReviewClients(nextOptions, nextModelClients)
	    const nextExtensionAgentConfig = extensionAgent.stageRuntimeConfig({
	      defaultBinding: { providerId: 'default', modelId: nextOptions.model }
	    })
	    const nextCapabilities = buildCapabilities({
	      options: nextOptions,
	      mcp: nextMcpProviders,
	      web: nextWebProviders,
	      skills: nextSkillRuntime,
	      instructions: nextInstructionRuntime,
	      attachments: nextAttachmentStore,
	      memory: nextMemoryStore,
	      subagentsAvailable: nextSubagentConfig?.enabled === true,
	      imageGen: nextImageGenProviders,
	      speechGen: nextSpeechGenProviders,
	      musicGen: nextMusicGenProviders,
	      videoGen: nextVideoGenProviders,
	      computerUse: nextComputerUseProviders,
	      browserUse: nextBrowserUseProviders
	    })
	    // This is the final throwing preflight. No await occurs between this
	    // snapshot and publication, so live extension registrations cannot drift.
	    const stagedExtensionRegistry = extensionTools.stageRegistry(nextRegistry)
	    activeOptions = nextOptions
    core.activeOptions = activeOptions
	    modelProfiles = nextModelProfiles
	    providerModelProfiles = nextProviderModelProfiles
	    tokenEconomy = nextTokenEconomy
    core.modelProfiles = modelProfiles
    core.providerModelProfiles = providerModelProfiles
    core.tokenEconomy = tokenEconomy
	    refreshDelegatedProviderIds()
	    directModelClient.replace(nextModelClients)
	    approvalReviewModelClient.replace(nextApprovalReviewClients)
	    modelClient.replacePools(activeOptions.routePools ?? [])
	    if (delegationRuntime && nextSubagentConfig) {
	      delegationRuntime.replaceConfig(nextSubagentConfig)
	    }
	    skillRuntime = nextSkillRuntime
	    instructionRuntime = nextInstructionRuntime
	    mcpProviders = nextMcpProviders
	    webProviders = nextWebProviders
	    attachmentStore = nextAttachmentStore
	    memoryStore = nextMemoryStore
	    imageGenProviders = nextImageGenProviders
	    speechGenProviders = nextSpeechGenProviders
	    musicGenProviders = nextMusicGenProviders
	    videoGenProviders = nextVideoGenProviders
	    computerUseProviders = nextComputerUseProviders
	    browserUseProviders = nextBrowserUseProviders
	    services.knowledgeBaseService.setOfficeExtractorDependencies({
	      ...(nextOfficeCliRunner ? { officeCli: nextOfficeCliRunner } : {})
	    })
	    resolvedHooks = nextResolvedHooks
	    baseToolProviders = nextBaseToolProviders
	    childRegistry = nextChildRegistry
	    registry = nextRegistry
	    extensionTools.publishStagedRegistry(stagedExtensionRegistry)
	    childToolHost.replaceRuntimeComponents({ registry: childRegistry, hooks: resolvedHooks })
	    toolHost.replaceRuntimeComponents({ registry, hooks: resolvedHooks })
	    sdkRuntime.replace(nextDelegatedRuntime)
	    turnService.updateRuntimeConfig({
	      defaultModel: activeOptions.model,
	      contextCompaction: activeOptions.contextCompaction,
	      model: timedModelClient,
	      maxConcurrentTurns: activeOptions.runtime?.turnLimits?.maxConcurrentTurns
	    })
	    extensionAgent.publishRuntimeConfig(nextExtensionAgentConfig)
	    extensionPreparations.clear()
	    threadService.updateRuntimeDefaults({
	      approvalPolicy: activeOptions.approvalPolicy,
	      sandboxMode: activeOptions.sandboxMode,
	      approvalReviewer: activeOptions.approvalReviewer ?? DEFAULT_APPROVAL_REVIEWER,
	      modelRequestCaptureEnabled: modelRequestCaptureDefaultEnabled(activeOptions)
	    })
	    reviewService.updateRuntimeConfig({
	      defaultModel: activeOptions.model,
	      models: activeOptions.models,
	      contextCompaction: activeOptions.contextCompaction,
	      tokenEconomy,
	      runtime: activeOptions.runtime,
	      reasoningEffort: activeOptions.roles?.codeReviewReasoningEffort,
	      roleModel: activeOptions.roles?.codeReviewModel,
	      roleProviderId: activeOptions.roles?.codeReviewProviderId,
	      roleAccountId: activeOptions.roles?.codeReviewAccountId
	    })
	    loopOptions = nextLoopOptions
	    loop = nextLoop
	    capabilities = nextCapabilities
    services.instructionRuntime = instructionRuntime
    services.mcpProviders = mcpProviders
    services.skillRuntime = skillRuntime
    services.attachmentStore = attachmentStore
    services.memoryStore = memoryStore
    services.webProviders = webProviders
    services.imageGenProviders = imageGenProviders
    services.speechGenProviders = speechGenProviders
    services.musicGenProviders = musicGenProviders
    services.videoGenProviders = videoGenProviders
    services.computerUseProviders = computerUseProviders
    services.browserUseProviders = browserUseProviders
    services.resolvedHooks = resolvedHooks
    services.baseToolProviders = baseToolProviders
    services.childRegistry = childRegistry
    registryComposition.registry = registry
    registryComposition.capabilities = capabilities
    agent.loopOptions = loopOptions
    agent.loop = loop
	    previousLoop.shutdownGoalResume()
	    previousLoop.shutdownInterruptedResume()
	    stagedGenerationCommitted = true
	    stagedBrowserUseBinding.commit()
	    if (graphChanged) {
	      await graphRuntime.reconfigureBackgroundServices().catch((error) => {
	        console.warn('[kun] Graph background-service reconcile failed after config apply:', error)
	      })
	    }
	    void mcpProviders.startBackgroundReconnect({
	      register: (provider) => {
	        try {
	          registry.registerProvider(provider)
	        } catch {
	          // ignore duplicate/colliding registration
	        }
	        try {
	          childRegistry.registerProvider(provider)
	        } catch {
	          // ignore duplicate/colliding registration
	        }
	      },
	      unregister: (providerId) => {
	        try {
	          registry.unregisterProvider(providerId)
	        } catch {
	          // ignore missing/colliding removal
	        }
	        try {
	          childRegistry.unregisterProvider(providerId)
	        } catch {
	          // ignore missing/colliding removal
	        }
	      },
	      replace: (provider) => {
	        try { registry.replaceProvider(provider) } catch { /* ignore missing/colliding replacement */ }
	        try { childRegistry.replaceProvider(provider) } catch { /* ignore missing/colliding replacement */ }
	      }
	    }).catch((error) => {
	      console.warn('[kun] MCP background reconnect failed after config apply:', error)
	    })
	    void previousMcpProviders.close().catch(() => undefined)
	    return { ok: true }
	    } catch (error) {
	      if (stagedGenerationCommitted) {
	        console.warn('[kun] Runtime config post-commit reconciliation failed:', error)
	        return { ok: true }
	      }
	      return {
	        ok: false,
	        code: 'invalid_config',
	        message: error instanceof Error ? error.message : String(error)
	      }
	    } finally {
	      stagedBrowserUseBinding.rollback()
	      if (!stagedGenerationCommitted) {
	        await nextMcpProviders.close().catch(() => undefined)
	      }
	    }
	  }
  return {
    applyConfig,
    rebuildCapabilities,
    startedAt,
    get activeOptions() { return activeOptions },
    get capabilities() { return capabilities },
    get registry() { return registry },
    get loopOptions() { return loopOptions },
    get loop() { return loop }
  }
}

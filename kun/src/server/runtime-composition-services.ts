import {
  join,
  type AttachmentStore,
  ManagerThreadExecutionLeaseClient,
  forwardRequestToExecutionOwner,
  CapabilityRegistry,
  buildDesignCanvasLocalTools,
  buildPptBoardLocalTools,
  buildDesignMotionLocalTools,
  buildDesignSvgLocalTools,
  buildPptAgentLocalTools,
  PPT_AGENT_LOCAL_PROVIDER_ID,
  LocalToolHost,
  buildDefaultLocalTools,
  createReadArtifactTool,
  createTaskGraphTool,
  buildMcpToolProviders,
  buildMemoryToolProviders,
  KnowledgeBaseService,
  buildKnowledgeToolProvider,
  buildSkillToolProviders,
  buildWebToolProviders,
  buildImageGenToolProviders,
  buildComputerUseToolProviders,
  buildBrowserUseToolProviders,
  buildOfficeCliToolProviders,
  createConfiguredOfficeCliRunner,
  buildMusicGenToolProviders,
  buildSpeechGenToolProviders,
  buildVideoGenToolProviders,
  DEFAULT_QUALITY_CONFIG,
  buildBuiltinHooks,
  ScopedMigrationMaintenanceLock,
  ToolCancellationService,
  TurnService,
  ReviewService,
  SkillRuntime,
  InstructionRuntime,
  resolveConfiguredHooks,
  BackgroundShellRuntime,
  stopBashSessionById,
  createBashLocalTool,
  createBackgroundShellTool,
  type LocalTool,
  InMemoryPublisherTrustStore,
  RuntimeMigrationService,
  RuntimeMigrationImportService
} from './runtime-factory-dependencies.js'
import type { createRuntimeModelComposition } from './runtime-composition-model.js'
import type { KunServeRuntimeOptions } from './runtime-factory-types.js'
import {
  builtinToolOptionsForOptions,
  skillsConfigForRuntime,
  toolOutputLimitsForOptions
} from './runtime-factory-config.js'
import {
  createPersistentAttachmentStore,
  createPersistentMemoryStore,
  seedUsageCarryover
} from './runtime-factory-storage.js'
import { createRuntimeBackgroundMaintenance } from './runtime-background-maintenance.js'
import { ThreadStoreGuardian } from '../services/thread-store-guardian.js'
import { ThreadSnapshotStore } from '../services/thread-snapshot-store.js'
import { SessionGuardian } from '../services/session-guardian.js'

export async function createRuntimeServices(
  model: Awaited<ReturnType<typeof createRuntimeModelComposition>>
) {
  const { core } = model
  const { options } = core
  const {
    stores,
    rawSessionStore,
    rawThreadStore,
    lifecycleFence,
    sessionStore,
    threadStore,
    approvalGate,
    userInputGate,
    usageService,
    inflight,
    toolCancellation,
    steering,
    profilesForProvider,
    compactor,
    ids,
    nowIso,
    events,
    prefix,
    delegatedSessions,
    threadService,
    artifactStore,
    graphRuntime,
    resolveGraphLeadRun,
    graphToolsProvider,
    modelCapabilities
  } = core
  const {
    timedModelClient,
    resolveCapabilityProviderCredential,
    oauthEncryptor
  } = model
  let [mcpProviders, skillRuntime] = await Promise.all([
    buildMcpToolProviders(core.activeOptions.capabilities?.mcp, {
      oauthStorageDir: join(core.activeOptions.dataDir, 'mcp-oauth'),
      ...(oauthEncryptor ? { oauthEncryptor } : {})
    }),
    SkillRuntime.create(skillsConfigForRuntime(core.activeOptions))
  ])
  let instructionRuntime = new InstructionRuntime(core.activeOptions.capabilities?.instructions)
  const migrationMaintenance = new ScopedMigrationMaintenanceLock()
  let attachmentStore: AttachmentStore | undefined
  const executionLeases = options.serviceManager
    ? new ManagerThreadExecutionLeaseClient(
        options.serviceManager,
        options.runtimeFlavor ?? 'production',
        options.instanceId ?? 'embedded'
      )
    : undefined
  const threadStoreGuardian = new ThreadStoreGuardian({
    dataDir: core.activeOptions.dataDir,
    threadStore: rawThreadStore,
    nowIso
  })
  const threadSnapshots = new ThreadSnapshotStore({
    dataDir: core.activeOptions.dataDir,
    nowIso
  })
  const sessionGuardian = new SessionGuardian({
    dataDir: core.activeOptions.dataDir,
    nowIso
  })
  const turnService = new TurnService({
    threadStore,
    sessionStore,
    events,
    inflight,
    steering,
    compactor,
    model: timedModelClient,
    usage: usageService,
    prefix,
    attachmentStore: () => attachmentStore,
    defaultModel: options.model,
    contextCompaction: options.contextCompaction,
    maxConcurrentTurns: core.activeOptions.runtime?.turnLimits?.maxConcurrentTurns,
    lifecycleFence,
    executionLeases,
    dataDir: core.activeOptions.dataDir,
    snapshots: threadSnapshots,
    onCompacted: (threadId) => delegatedSessions.invalidate(threadId),
    resolveGraphLeadRun,
    createGraphPlanningDraft: (input) => graphRuntime.createPlanningDraft(input),
	    resolveGraphPlanningDraft: (input) => graphRuntime.resolvePlanningDraft(input),
	    transitionGraphPlanningDraft: (input) =>
	      graphRuntime.transitionPlanningDraft(input),
	    cancelGraphSourceRuns: ({ threadId, sourceTurnId }) =>
	      graphRuntime.cancelSourceTurnRunsExplicitly(threadId, sourceTurnId),
	    migrationMaintenance,
	    ids,
	    nowIso
  })
  executionLeases?.setLeaseLostHandler((lease) => {
    turnService.abortTurnExecution(lease.turnId)
  })
  const forwardThreadControl = options.serviceManager
    ? (request: Request, threadId: string) => forwardRequestToExecutionOwner({
        manager: options.serviceManager!,
        currentInstanceId: options.instanceId ?? 'embedded',
        request,
        threadId
      })
    : undefined
  const forwardControlById = options.serviceManager
    ? (request: Request, kind: 'approval' | 'user-input', id: string) =>
        forwardRequestToExecutionOwner({
          manager: options.serviceManager!,
          currentInstanceId: options.instanceId ?? 'embedded',
          request,
          control: { kind, id }
        })
    : undefined
  core.abortThreadExecution = (threadId) => turnService.abortThreadExecution(threadId)
  const backgroundShellRuntime = new BackgroundShellRuntime({
    events,
    threadStore,
    turns: turnService,
    nowIso
  })
  const toolCancellationService = new ToolCancellationService(
    turnService,
    toolCancellation,
    nowIso
  )
  const supplyChainTrust = new InMemoryPublisherTrustStore()
  backgroundShellRuntime.bindStopHandler(stopBashSessionById)
  const backgroundShellTool = createBackgroundShellTool({
    listBackgroundSessions: (threadId) => backgroundShellRuntime.listSessions(threadId)
  })
  const withBackgroundShellTools = (
    tools: LocalTool[],
    optionsForTools: KunServeRuntimeOptions = core.activeOptions
  ): LocalTool[] => {
    const outputLimits = toolOutputLimitsForOptions(optionsForTools)
    const mapped = tools.map((tool) =>
      tool.name === 'bash'
        ? createBashLocalTool({
            ...outputLimits,
            backgroundShell: backgroundShellRuntime.bashHooks(),
            backgroundShellDataDir: optionsForTools.dataDir
          })
        : tool
    )
    const withoutBackgroundShell = mapped.filter((tool) => tool.name !== 'background_shell')
    return [...withoutBackgroundShell, backgroundShellTool]
  }
  const reviewDeps = {
    threadStore,
    turns: turnService,
    model: timedModelClient,
    defaultModel: core.activeOptions.model,
    nowIso,
    modelCapabilities,
    profilesForProvider,
	    ...(core.activeOptions.models ? { models: core.activeOptions.models } : {}),
	    ...(core.activeOptions.contextCompaction ? { contextCompaction: core.activeOptions.contextCompaction } : {}),
		    ...(core.tokenEconomy ? { tokenEconomy: core.tokenEconomy } : {}),
	    ...(core.activeOptions.runtime ? { runtime: core.activeOptions.runtime } : {}),
	    ...(core.activeOptions.roles?.codeReviewReasoningEffort
	      ? { reasoningEffort: core.activeOptions.roles.codeReviewReasoningEffort }
	      : {}),
	    ...(core.activeOptions.roles?.codeReviewModel ? { roleModel: core.activeOptions.roles.codeReviewModel } : {}),
	    ...(core.activeOptions.roles?.codeReviewProviderId ? { roleProviderId: core.activeOptions.roles.codeReviewProviderId } : {}),
	    ...(core.activeOptions.roles?.codeReviewAccountId ? { roleAccountId: core.activeOptions.roles.codeReviewAccountId } : {})
	  }
	  const reviewService = new ReviewService(reviewDeps)
	  let webProviders = buildWebToolProviders(core.activeOptions.capabilities?.web)
	  attachmentStore = createPersistentAttachmentStore(core.activeOptions, nowIso)
	  const pruneUnsentAttachments = async (store: AttachmentStore | undefined): Promise<void> => {
	    if (!store?.pruneExpiredLeases) return
	    const now = Date.parse(nowIso())
	    if (!Number.isFinite(now)) return
	    const summaries = await threadService.list({ includeArchived: true, includeSide: true })
	    const threads = []
	    // Manager-backed stores serialize access to the physical data files.
	    // Avoid enqueueing every historical thread at once: on large profiles
	    // that made later requests hit their client timeout, disconnect, and
	    // trigger a crash in older stable Managers while writing the response.
	    for (let offset = 0; offset < summaries.length; offset += 8) {
	      threads.push(...await Promise.all(
	        summaries.slice(offset, offset + 8).map((thread) => threadService.get(thread.id))
	      ))
	    }
	    const referencedIds = new Set(
	      threads.flatMap((thread) =>
	        thread?.turns.flatMap((turn) => turn.attachmentIds) ?? []
	      )
	    )
	    await store.pruneExpiredLeases(
	      referencedIds,
	      new Date(now - 24 * 60 * 60 * 1_000).toISOString()
	    )
	  }
  const backgroundMaintenance = createRuntimeBackgroundMaintenance({
    seedUsage: () => seedUsageCarryover({ threadStore, sessionStore, usageService }),
    pruneAttachments: () => pruneUnsentAttachments(attachmentStore),
    inspectThreads: async () => {
      const result = await threadStoreGuardian.run()
      if (result.remainingIssues.length > 0) {
        console.warn('[kun] thread guardian found unresolved storage issues', {
          issueCount: result.remainingIssues.length,
          repairedThreads: result.repairedThreads
        })
      }
      const reports = await sessionGuardian.scanAll()
      const flagged = reports.filter((report) => report.warnings.length > 0)
      if (flagged.length > 0) {
        console.warn('[kun] session guardian warnings', {
          threads: flagged.length,
          details: flagged.map((report) => ({
            threadId: report.threadId,
            warnings: report.warnings
          }))
        })
      }
    },
    onError: (task, error) => {
      console.warn(`[kun] background ${task} failed:`, error)
    }
  })
  let memoryStore = createPersistentMemoryStore(core.activeOptions, nowIso)
  const officeCliRunner = createConfiguredOfficeCliRunner({
    binaryPath: process.env.KUN_OFFICECLI_BINARY,
    profileDir: join(core.activeOptions.dataDir, 'officecli-profile')
  })
  const knowledgeBaseService = new KnowledgeBaseService({
    dataDir: core.activeOptions.dataDir,
    threadStore,
    nowIso
  })
  knowledgeBaseService.setOfficeExtractorDependencies({
    ...(officeCliRunner ? { officeCli: officeCliRunner } : {})
  })
	  const migrationService = new RuntimeMigrationService({
	    rootDir: join(core.activeOptions.dataDir, 'migrations', 'exports'),
	    threads: threadService,
	    turns: turnService,
	    sessions: sessionStore,
	    approvals: approvalGate,
	    userInputs: userInputGate,
	    artifactStore,
	    attachmentStore: () => attachmentStore,
	    memoryStore: () => memoryStore,
	    nowIso
	  })
	  const migrationImportService = new RuntimeMigrationImportService({
	    rootDir: join(core.activeOptions.dataDir, 'migrations', 'imports'),
	    threadStore: rawThreadStore,
	    sessionStore: rawSessionStore,
	    maintenance: migrationMaintenance,
	    attachmentStore: () => attachmentStore,
	    artifactStore,
	    memoryStore: () => memoryStore,
	    onThreadImported: (threadId) => delegatedSessions.invalidate(threadId)
	  })
	  let imageGenProviders = buildImageGenToolProviders(core.activeOptions.capabilities?.imageGen, {
	    attachmentStore,
	    nowIso,
	    resolveCredential: resolveCapabilityProviderCredential
	  })
	  let speechGenProviders = buildSpeechGenToolProviders(core.activeOptions.capabilities?.speechGen, {
	    nowIso,
	    resolveCredential: resolveCapabilityProviderCredential
	  })
	  let musicGenProviders = buildMusicGenToolProviders(core.activeOptions.capabilities?.musicGen, {
	    nowIso,
	    resolveCredential: resolveCapabilityProviderCredential
	  })
	  let videoGenProviders = buildVideoGenToolProviders(core.activeOptions.capabilities?.videoGen, {
	    nowIso,
	    resolveCredential: resolveCapabilityProviderCredential
	  })
	  let computerUseProviders = await buildComputerUseToolProviders(core.activeOptions.capabilities?.computerUse)
	  let browserUseProviders = buildBrowserUseToolProviders(core.activeOptions.capabilities?.browserUse)
  const designCanvasProvider = {
    id: 'design-canvas',
    kind: 'gui' as const,
    enabled: true,
    available: true,
    effects: {
      network: false,
      externalWrite: false,
      processExecution: false,
      guiAutomation: true
    },
    // Safe to include in child runs: the tool is still gated per turn by
    // `context.guiDesignCanvas`, so only design-canvas child turns see it.
    tools: [
      ...buildDesignCanvasLocalTools(),
      ...buildDesignMotionLocalTools(),
      ...buildDesignSvgLocalTools(),
      // PPTD → whiteboard conversion; same guiDesignCanvas gating as the
      // design tools, and also available on Design whiteboard turns.
      ...buildPptBoardLocalTools()
    ]
  }
  const pptAgentProvider = {
    id: PPT_AGENT_LOCAL_PROVIDER_ID,
    kind: 'built-in' as const,
    enabled: true,
    available: true,
    effects: {
      network: false,
      externalWrite: false,
      processExecution: true,
      guiAutomation: false
    },
    tools: [
      ...buildPptAgentLocalTools({
        enabled: () => core.activeOptions.lab?.pptAgent?.enabled !== false,
        toolchainDirectory: () => process.env.KUN_PPT_TOOLCHAIN_DIR,
        governanceDirectory: () => join(core.activeOptions.dataDir, 'ppt-governance'),
        resolveSourceRequest: async (context) =>
          (await turnService.getTurn(context.threadId, context.turnId))?.prompt
      })
    ]
  }
  const officeCliProviders = buildOfficeCliToolProviders({
    binaryPath: process.env.KUN_OFFICECLI_BINARY,
    profileDir: join(core.activeOptions.dataDir, 'officecli-profile'),
    ...(officeCliRunner ? { runner: officeCliRunner } : {})
  })
	  const taskGraphTool = createTaskGraphTool({ rootDir: join(core.activeOptions.dataDir, 'task-graphs') })
	  let baseToolProviders = [
    {
      id: 'builtin',
      kind: 'built-in' as const,
      enabled: true,
      available: true,
      effects: {
        network: false,
        externalWrite: false,
        processExecution: false,
        guiAutomation: false
      },
      tools: withBackgroundShellTools(
        buildDefaultLocalTools({}, builtinToolOptionsForOptions(core.activeOptions)),
        core.activeOptions
      )
    },
    {
      id: 'artifacts',
      kind: 'built-in' as const,
      enabled: true,
      available: true,
      effects: {
        network: false,
        externalWrite: false,
        processExecution: false,
        guiAutomation: false
      },
      tools: [createReadArtifactTool()]
    },
    graphToolsProvider,
    ...mcpProviders.providers,
    ...webProviders.providers,
    ...buildMemoryToolProviders(memoryStore),
    buildKnowledgeToolProvider(knowledgeBaseService),
    ...buildSkillToolProviders(skillRuntime),
    ...imageGenProviders.providers,
    ...speechGenProviders.providers,
    ...musicGenProviders.providers,
    ...videoGenProviders.providers,
    ...officeCliProviders,
    pptAgentProvider,
    designCanvasProvider,
    // NOTE: computer_use is intentionally NOT in baseToolProviders — host
    // control must not be delegable to subagents. browser_use follows the
    // same primary-only rule and is added to the main registry below.
  ]
  // Builtin hooks are first-party and always assembled before config hooks.
  // The design-quality linter folds findings into write/edit results so the
  // model self-corrects; config-loaded command hooks run after it.
	  let resolvedHooks = [
	    ...buildBuiltinHooks({ quality: core.activeOptions.quality ?? DEFAULT_QUALITY_CONFIG }),
	    ...resolveConfiguredHooks(core.activeOptions.hooks)
	  ]
	  let childRegistry = new CapabilityRegistry(baseToolProviders)
  const childToolHost = new LocalToolHost({
    registry: childRegistry,
    readTracker: true,
    ...(resolvedHooks.length ? { hooks: resolvedHooks } : {})
  })
  const defaultIsAgentSdk = process.env.KUN_RUNTIME_PROVIDER_KIND === 'agent-sdk'
  const defaultIsAntigravity = process.env.KUN_RUNTIME_PROVIDER_KIND === 'antigravity-cli'
  const defaultIsCursorSdk = process.env.KUN_RUNTIME_PROVIDER_KIND === 'cursor-sdk'
  return {
    model,
    migrationMaintenance,
    executionLeases,
    turnService,
    forwardThreadControl,
    forwardControlById,
    backgroundShellRuntime,
    toolCancellationService,
    supplyChainTrust,
    backgroundShellTool,
    withBackgroundShellTools,
    reviewService,
    pruneUnsentAttachments,
    backgroundMaintenance,
    threadStoreGuardian,
    threadSnapshots,
    sessionGuardian,
    migrationService,
    migrationImportService,
    knowledgeBaseService,
    designCanvasProvider,
    officeCliProviders,
    taskGraphTool,
    childToolHost,
    defaultIsAgentSdk,
    defaultIsAntigravity,
    defaultIsCursorSdk,
    get mcpProviders() { return mcpProviders },
    set mcpProviders(value: typeof mcpProviders) { mcpProviders = value },
    get skillRuntime() { return skillRuntime },
    set skillRuntime(value: typeof skillRuntime) { skillRuntime = value },
    get instructionRuntime() { return instructionRuntime },
    set instructionRuntime(value: typeof instructionRuntime) { instructionRuntime = value },
    get attachmentStore() { return attachmentStore },
    set attachmentStore(value: typeof attachmentStore) { attachmentStore = value },
    get memoryStore() { return memoryStore },
    set memoryStore(value: typeof memoryStore) { memoryStore = value },
    get webProviders() { return webProviders },
    set webProviders(value: typeof webProviders) { webProviders = value },
    get imageGenProviders() { return imageGenProviders },
    set imageGenProviders(value: typeof imageGenProviders) { imageGenProviders = value },
    get speechGenProviders() { return speechGenProviders },
    set speechGenProviders(value: typeof speechGenProviders) { speechGenProviders = value },
    get musicGenProviders() { return musicGenProviders },
    set musicGenProviders(value: typeof musicGenProviders) { musicGenProviders = value },
    get videoGenProviders() { return videoGenProviders },
    set videoGenProviders(value: typeof videoGenProviders) { videoGenProviders = value },
    get computerUseProviders() { return computerUseProviders },
    set computerUseProviders(value: typeof computerUseProviders) {
      computerUseProviders = value
    },
    get browserUseProviders() { return browserUseProviders },
    set browserUseProviders(value: typeof browserUseProviders) { browserUseProviders = value },
    get baseToolProviders() { return baseToolProviders },
    set baseToolProviders(value: typeof baseToolProviders) { baseToolProviders = value },
    get resolvedHooks() { return resolvedHooks },
    set resolvedHooks(value: typeof resolvedHooks) { resolvedHooks = value },
    get childRegistry() { return childRegistry },
    set childRegistry(value: typeof childRegistry) { childRegistry = value }
  }
}

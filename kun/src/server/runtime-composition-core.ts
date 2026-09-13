import {
  mkdir,
  join,
  ThreadEventStreamRegistry,
  InMemoryApprovalGate,
  InMemoryUserInputGate,
  InMemoryEventBus,
  ManagerRemoteArtifactStore,
  DelegatedSessionCoordinator,
  FileDelegatedSessionBindingStore,
  delegatedSessionRoot,
  FileArtifactStore,
  type ArtifactStore,
  LocalWorkspaceInspector,
  createImmutablePrefix,
  DEFAULT_APPROVAL_REVIEWER,
  ContextCompactor,
  DEFAULT_CONTEXT_THRESHOLDS,
  modelCapabilitiesForModel,
  modelCapabilitiesForProviderModel,
  modelContextProfilesFromConfig,
  contextThresholdsForModel,
  DEFAULT_GRAPH_RUNTIME_CONFIG,
  type GraphRuntimeConfig,
  createAgentObservabilityRecorder,
  InflightTracker,
  ToolCancellationRegistry,
  SteeringQueue,
  RandomIdGenerator,
  type SessionStore,
  type ThreadStore,
  KUN_SYSTEM_PROMPT,
  RuntimeEventRecorder,
  ThreadActivityRegistry,
  GraphRuntimeComposition,
  LifecycleFencedSessionStore,
  LifecycleFencedThreadStore,
  ThreadLifecycleFence,
  LlmDebugRecorder,
  ThreadService,
  ContextWindowService,
  ContextWindowNotes,
  ContextWindowTurnModes,
  ContextWindowTransitionCoordinator,
  ContextWindowBudget,
  ContextWindowStateRestore,
  FileContextWindowStateStore,
  countOrdinaryWorkItems,
  FileContextWindowStore,
  CONTEXT_WINDOWS_NOTE_FILE_MAX_BYTES,
  CONTEXT_WINDOWS_NOTE_MAX_FILES_PER_THREAD,
  CONTEXT_WINDOWS_NOTE_TOTAL_MAX_BYTES,
  FileProjectBoardStore,
  ProjectBoardService,
  UsageService,
  ModelConnectionRegistry,
  type RuntimeDataDirLease
} from './runtime-factory-dependencies.js'
import {
  liveContextWindowMode,
  llmDebugCaptureEnabled,
  modelRequestCaptureDefaultEnabled,
  tokenEconomyConfigForOptions
} from './runtime-factory-config.js'
import { modelContextProfilesByProvider } from './runtime-factory-model.js'
import { createPersistentStores } from './runtime-factory-storage.js'
import type { KunServeRuntimeOptions } from './runtime-factory-types.js'
import { HistoryReferenceService } from '../history/history-reference-service.js'

export async function createRuntimeCore(
  options: KunServeRuntimeOptions,
  dataDirLease: RuntimeDataDirLease | undefined
) {
  await mkdir(options.dataDir, { recursive: true, mode: 0o700 })
  let activeOptions: KunServeRuntimeOptions = { ...options }
  // Production replay reads the durable session store; nothing calls
  // snapshotSince on the live bus, so skip retaining a serialized tail.
  const eventBus = new InMemoryEventBus({
    retainTail: options.eventBusRetainTail === true
  })
  const eventStreamRegistry = new ThreadEventStreamRegistry()
  const stores = await createPersistentStores({
    dataDir: options.dataDir,
    storage: options.storage,
    nowIso: () => new Date().toISOString(),
    serviceManager: options.serviceManager
  })
  // Persisted thread/session files are shared by several asynchronous loops.
  // Put a lifecycle fence in front of every non-destructive write so a deleted
  // thread cannot be recreated by an old turn that finishes late.
  const rawSessionStore = stores.sessionStore
  const rawThreadStore = stores.threadStore
  const lifecycleFence = new ThreadLifecycleFence()
  const sessionStore: SessionStore = new LifecycleFencedSessionStore(rawSessionStore, lifecycleFence)
  const threadStore: ThreadStore = new LifecycleFencedThreadStore(rawThreadStore, lifecycleFence)
  const approvalGate = new InMemoryApprovalGate()
  const userInputGate = new InMemoryUserInputGate()
  const workspaceInspector = new LocalWorkspaceInspector()
  const usageService = new UsageService()
  const inflight = new InflightTracker()
  const toolCancellation = new ToolCancellationRegistry()
  const steering = new SteeringQueue()
  let modelProfiles = modelContextProfilesFromConfig({
    contextCompaction: activeOptions.contextCompaction,
    models: activeOptions.models
  })
  let providerModelProfiles = modelContextProfilesByProvider(activeOptions.providers)
  const profilesForProvider = (providerId?: string) => providerId
    ? providerModelProfiles.get(providerId.trim().toLowerCase()) ?? modelProfiles
    : modelProfiles
  const compactor = new ContextCompactor({
    contextCompaction: activeOptions.contextCompaction,
    models: activeOptions.models,
    profilesForProvider
  })
  let tokenEconomy = tokenEconomyConfigForOptions(activeOptions)
  const ids = new RandomIdGenerator()
  const nowIso = () => new Date().toISOString()
  const allocateSeq = (threadId: string) =>
    sessionStore.allocateEventSeq?.(threadId) ?? eventBus.allocateSeq(threadId)
  // Compact lifecycle metadata is always available. The legacy llmDebug
  // facility flag and per-thread switch now gate optional prompt/wire content.
  const llmDebug = new LlmDebugRecorder({
    dataDir: activeOptions.dataDir,
    shouldCapture: async (threadId) =>
      llmDebugCaptureEnabled(activeOptions) &&
      (await threadStore.get(threadId))?.modelRequestCaptureEnabled === true
  })
  const agentObservability = createAgentObservabilityRecorder({
    config: activeOptions.observability,
    dataDir: activeOptions.dataDir
  })
  const threadActivity = new ThreadActivityRegistry()
  const contextWindowModes = new ContextWindowTurnModes(
    liveContextWindowMode(() => activeOptions)
  )
  const contextWindowBudget = new ContextWindowBudget({
    profiles: modelProfiles,
    nowIso
  })
  const contextWindowNotes: ContextWindowNotes = new ContextWindowNotes({
    store: new FileContextWindowStore({
      dataDir: activeOptions.dataDir,
      limits: {
        maxFileBytes: CONTEXT_WINDOWS_NOTE_FILE_MAX_BYTES,
        maxFilesPerThread: CONTEXT_WINDOWS_NOTE_MAX_FILES_PER_THREAD,
        maxTotalBytes: CONTEXT_WINDOWS_NOTE_TOTAL_MAX_BYTES
      }
    }),
    // Version stamps need the thread's public history position at commit
    // time so a fork can copy only the revisions available at the fork
    // point; the closure resolves once `contextWindows` is assigned below.
    commitPosition: (threadId): Promise<number> => contextWindows.historyPosition(threadId)
  })
  const contextWindows: ContextWindowService = new ContextWindowService({
    sessionStore,
    notes: contextWindowNotes,
    ids,
    nowIso
  })
  const observers = [
    threadActivity,
    ...(agentObservability ? [agentObservability] : [])
  ]
  const events = new RuntimeEventRecorder({
    eventBus,
    sessionStore,
    allocateSeq,
    nowIso,
    lifecycleFence,
    observers
  })
  const contextWindowState = new FileContextWindowStateStore({ dataDir: activeOptions.dataDir })
  const contextWindowStateRestore = new ContextWindowStateRestore({
    store: contextWindowState,
    modes: contextWindowModes,
    budget: contextWindowBudget,
    sessionStore,
    nowIso
  })
  const contextWindowTransition = new ContextWindowTransitionCoordinator({
    contextWindows,
    events,
    modes: contextWindowModes,
    budget: contextWindowBudget,
    ids,
    sessionStore,
    stateRestore: contextWindowStateRestore,
    hasPendingInteractions: (threadId, excludedCallId) =>
      approvalGate.pending(threadId).length > 0 ||
      userInputGate.pending(threadId).length > 0 ||
      inflight.list().some((record) =>
        record.threadId === threadId && record.kind === 'tool' && record.callId !== excludedCallId),
    requestItemCount: async (threadId) =>
      countOrdinaryWorkItems(await sessionStore.loadItems(threadId)),
    committedOperation: (threadId, operationId) => contextWindows.hasWindowOperation(threadId, operationId)
  })
  // Late binding: restart restore completes the durable window initialization
  // for the restored checkpoint before any model request is served.
  contextWindowStateRestore.ensureInitialization = (checkpoint) =>
    contextWindowTransition.ensureInitialization(checkpoint)
  let prefix = createImmutablePrefix({
    systemPrompt: KUN_SYSTEM_PROMPT,
    pinnedConstraints: [
      'system: preserve user intent across compaction',
      'system: keep the HTTP/SSE contract stable for every Kun client',
      'system: keep the stable Kun prefix byte-stable for prompt-cache reuse'
    ]
  })
  let abortThreadExecution: ((threadId: string) => number) | undefined
  let stopThreadAuxiliaryWork: ((threadId: string) => Promise<void>) | undefined
  let handleGraphThreadStatus:
    ((threadId: string, status: import('../contracts/threads.js').ThreadStatus) => Promise<void>) |
    undefined
  let handleGraphThreadFork:
    ((sourceThreadId: string, targetThreadId: string) => Promise<void>) |
    undefined
  const delegatedSessions = new DelegatedSessionCoordinator(
    new FileDelegatedSessionBindingStore(delegatedSessionRoot(activeOptions.dataDir)),
    nowIso
  )
  const threadService = new ThreadService({
    threadStore,
    deleteThreadStore: rawThreadStore,
    sessionStore,
    events,
    ids,
    nowIso,
    defaultApprovalPolicy: activeOptions.approvalPolicy,
    defaultSandboxMode: activeOptions.sandboxMode,
    defaultApprovalReviewer: activeOptions.approvalReviewer ?? DEFAULT_APPROVAL_REVIEWER,
    defaultModelRequestCaptureEnabled: modelRequestCaptureDefaultEnabled(activeOptions),
    lifecycleFence,
    onDeleting: async (threadId) => {
      abortThreadExecution?.(threadId)
      await stopThreadAuxiliaryWork?.(threadId)
    },
    onDeleted: async (threadId) => {
      eventStreamRegistry.closeThread(threadId)
      usageService.reset(threadId)
      events.clearThread(threadId)
      eventBus.clearThread(threadId)
      await Promise.all([
        ...(llmDebug ? [llmDebug.deleteThread(threadId)] : []),
        delegatedSessions.invalidate(threadId),
        contextWindows.deleteThreadData(threadId),
        contextWindowState.deleteThreadData(threadId)
      ])
    },
    onStatusChanged: (threadId, status) => handleGraphThreadStatus?.(threadId, status),
    onForked: (sourceThreadId, targetThreadId) =>
      Promise.all([
        handleGraphThreadFork?.(sourceThreadId, targetThreadId),
        contextWindows.forkThreadData(sourceThreadId, targetThreadId)
      ]).then(() => undefined)
  })
  const historyReferences = new HistoryReferenceService({
    dataDir: options.dataDir,
    threadService,
    enabled: () => activeOptions.lab?.codexReferenceBranches?.enabled === true,
    defaultModel: () => ({ model: activeOptions.model, providerId: activeOptions.activeProviderId })
  })
  const projectBoardStore = new FileProjectBoardStore({
    dataDir: options.dataDir,
    nowIso
  })
  const projectBoardService = new ProjectBoardService({
    store: projectBoardStore,
    threadStore,
    threadService,
    ids,
    nowIso
  })
  const artifactStore: ArtifactStore = activeOptions.serviceManager
    ? new ManagerRemoteArtifactStore(activeOptions.serviceManager)
    : new FileArtifactStore(join(activeOptions.dataDir, 'artifacts'), nowIso)
  const graphConfig = (): GraphRuntimeConfig =>
    activeOptions.graph ?? DEFAULT_GRAPH_RUNTIME_CONFIG
  const graphRuntime = new GraphRuntimeComposition({
    dataDir: activeOptions.dataDir,
    config: graphConfig,
    artifactStore,
    runtimeEvents: events,
    threadStore,
    sessionStore,
    ids,
    nowIso,
    ...(activeOptions.serviceManager ? { serviceManager: activeOptions.serviceManager } : {})
  })
  const resolveGraphLeadRun = async (input: {
    threadId: string
    turnId: string
  }): Promise<{
    runId: string
    lastEventSeq: number
    terminal: boolean
    supervisionPending: boolean
  } | null> => {
    const runs = await graphRuntime.store.list({ threadId: input.threadId })
    const run = runs
      .filter((candidate) => candidate.sourceTurnId === input.turnId)
      .sort((left, right) => right.lastEventSeq - left.lastEventSeq)[0]
    return run
      ? {
          runId: run.id,
          lastEventSeq: run.lastEventSeq,
	          terminal:
	            run.status === 'completed' ||
	            run.status === 'failed' ||
	            run.status === 'cancelled',
	          supervisionPending:
	            run.status === 'awaiting_supervision' ||
	            run.supervisionObligations.some((obligation) =>
	              obligation.state === 'pending' ||
	              obligation.state === 'delivering' ||
	              obligation.state === 'awaiting_action' ||
	              obligation.state === 'retry_scheduled') ||
	            Object.values(run.nodes).some((node) =>
	              node.status === 'submitted' || node.status === 'reviewing')
	        }
	      : null
  }
  handleGraphThreadFork = (sourceThreadId, targetThreadId) =>
    graphRuntime.handleThreadFork(sourceThreadId, targetThreadId)
  handleGraphThreadStatus = (threadId, status) =>
    graphRuntime.handleThreadStatus(threadId, status)
  const graphToolsProvider = graphRuntime.toolsProvider
  const modelCapabilities = (model: string, providerId?: string) => modelCapabilitiesForModel(
    model,
    profilesForProvider(providerId)
  )
  const registryModelCapabilities: ConstructorParameters<typeof ModelConnectionRegistry>[0]['modelCapabilities'] =
    (model, profile) => modelCapabilitiesForProviderModel({
      providerId: profile?.id,
      presetSource: profile?.presetSource,
      baseUrl: profile?.baseUrl,
      kind: profile?.kind,
      model
    }, modelProfiles)
  const delegatedContextProfile = (model: string) => {
    const thresholds = contextThresholdsForModel(model, {
      softThreshold:
        activeOptions.contextCompaction?.defaultSoftThreshold ??
        DEFAULT_CONTEXT_THRESHOLDS.softThreshold,
      hardThreshold:
        activeOptions.contextCompaction?.defaultHardThreshold ??
        DEFAULT_CONTEXT_THRESHOLDS.hardThreshold
    }, modelProfiles)
    return {
      contextWindowTokens: modelCapabilities(model).contextWindowTokens ??
        Math.max(thresholds.softThreshold, thresholds.hardThreshold),
      softThresholdTokens: thresholds.softThreshold,
      hardThresholdTokens: thresholds.hardThreshold
    }
  }
  return {
    options,
    dataDirLease,
    eventBus,
    eventStreamRegistry,
    stores,
    rawSessionStore,
    rawThreadStore,
    lifecycleFence,
    sessionStore,
    threadStore,
    approvalGate,
    userInputGate,
    workspaceInspector,
    usageService,
    inflight,
    toolCancellation,
    steering,
    profilesForProvider,
    compactor,
    ids,
    nowIso,
    allocateSeq,
    llmDebug,
    agentObservability,
    contextWindows,
    contextWindowModes,
    contextWindowTransition,
    contextWindowBudget,
    contextWindowStateRestore,
    events,
    threadActivity,
    prefix,
    delegatedSessions,
    threadService,
    projectBoardStore,
    historyReferences,
    projectBoardService,
    artifactStore,
    graphConfig,
    graphRuntime,
    resolveGraphLeadRun,
    graphToolsProvider,
    modelCapabilities,
    registryModelCapabilities,
    delegatedContextProfile,
    get activeOptions() { return activeOptions },
    set activeOptions(value: KunServeRuntimeOptions) { activeOptions = value },
    get modelProfiles() { return modelProfiles },
    set modelProfiles(value: typeof modelProfiles) { modelProfiles = value },
    get providerModelProfiles() { return providerModelProfiles },
    set providerModelProfiles(value: typeof providerModelProfiles) { providerModelProfiles = value },
    get tokenEconomy() { return tokenEconomy },
    set tokenEconomy(value: typeof tokenEconomy) { tokenEconomy = value },
    get abortThreadExecution() { return abortThreadExecution },
    set abortThreadExecution(value: typeof abortThreadExecution) { abortThreadExecution = value },
    get stopThreadAuxiliaryWork() { return stopThreadAuxiliaryWork },
    set stopThreadAuxiliaryWork(value: typeof stopThreadAuxiliaryWork) {
      stopThreadAuxiliaryWork = value
    },
    get handleGraphThreadStatus() { return handleGraphThreadStatus },
    set handleGraphThreadStatus(value: typeof handleGraphThreadStatus) {
      handleGraphThreadStatus = value
    },
    get handleGraphThreadFork() { return handleGraphThreadFork },
    set handleGraphThreadFork(value: typeof handleGraphThreadFork) {
      handleGraphThreadFork = value
    }
  }
}

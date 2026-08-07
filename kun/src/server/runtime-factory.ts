import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { buildRouter } from './routes/index.js'
import type { ServerRuntime } from './routes/server-runtime.js'
import { startNodeHttpServer, type NodeHttpServerHandle } from './node-http-server.js'
import { isLoopbackHost } from './loopback-host.js'
import { acquireRuntimeDataDirLease, type RuntimeDataDirLease } from './runtime-data-dir-lease.js'
import {
  KUN_SERVICE_VERSION,
  publishRuntimeDiscovery,
  removeRuntimeDiscovery
} from './runtime-discovery.js'
import { KUN_VERSION } from '../version.js'
import { ThreadEventStreamRegistry } from './thread-event-stream-registry.js'
import { FileAttachmentStore, type AttachmentStore } from '../attachments/attachment-store.js'
import { InMemoryApprovalGate } from '../adapters/in-memory-approval-gate.js'
import { InMemoryUserInputGate } from '../adapters/in-memory-user-input-gate.js'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { FileSessionStore, FileThreadStore } from '../adapters/file/index.js'
import { HybridSessionStore, HybridThreadStore } from '../adapters/hybrid/index.js'
import {
  createManagerRemoteStores,
  ManagerRemoteAttachmentStore,
  ManagerRemoteArtifactStore,
  ManagerRemoteMemoryStore
} from '../manager/remote-data-stores.js'
import {
  ManagerThreadExecutionLeaseClient,
  registerRuntimeWithManager,
  forwardRequestToExecutionOwner,
  unregisterRuntimeWithManager,
  type ServiceManagerConnection
} from '../manager/manager-client.js'
import { KUN_MANAGER_PROTOCOL_VERSION } from '../manager/manager-discovery.js'
import { CompatModelClient } from '../adapters/model/compat-model-client.js'
import { GeminiCliApiModelClient } from '../adapters/model/gemini-cli-api-model-client.js'
import { GeminiCodeAssistModelClient } from '../adapters/model/gemini-code-assist-model-client.js'
import { ExtensionModelProviderRegistry } from '../adapters/model/extension-model-provider.js'
import { MultiProviderModelClient } from '../adapters/model/multi-provider-model-client.js'
import { RoutePoolHealthStore, RoutePoolModelClient } from '../adapters/model/route-pool-model-client.js'
import { CapabilityRegistry } from '../adapters/tool/capability-registry.js'
import {
  createAgentSdkRuntime,
  type AgentSdkRuntimeFactoryDeps
} from '../runtime/agent-sdk/agent-sdk-runtime-factory.js'
import {
  AntigravityCliRuntime,
  type AntigravityCliRuntimeDeps
} from '../runtime/antigravity/antigravity-cli-runtime.js'
import {
  createCursorSdkRuntime,
  type CursorSdkRuntimeFactoryDeps
} from '../runtime/cursor/cursor-sdk-runtime-factory.js'
import {
  composeDelegatedTurnRuntimes,
  ReplaceableDelegatedTurnRuntime
} from '../runtime/delegated-turn-runtime.js'
import {
  DelegatedSessionCoordinator,
  FileDelegatedSessionBindingStore,
  delegatedSessionRoot
} from '../runtime/delegated-session-binding.js'
import { buildGoalLocalTools } from '../adapters/tool/goal-tools.js'
import { buildTodoLocalTools } from '../adapters/tool/todo-tools.js'
import { buildDesignCanvasLocalTools } from '../adapters/tool/design-canvas-tool.js'
import { buildDesignMotionLocalTools } from '../adapters/tool/design-motion-tool.js'
import { buildDesignSvgLocalTools } from '../adapters/tool/design-svg-tool.js'
import { buildPptMasterLocalTools } from '../adapters/tool/ppt-master-tool.js'
import { LocalToolHost, buildDefaultLocalTools } from '../adapters/tool/local-tool-host.js'
import { ExtensionToolRegistry } from '../adapters/tool/extension-tool-provider.js'
import { shutdownAllLspSessions } from '../adapters/tool/lsp-client.js'
import { createReadArtifactTool } from '../adapters/tool/artifact-tool.js'
import { FileArtifactStore, type ArtifactStore } from '../artifacts/artifact-store.js'
import { createTaskGraphTool } from '../adapters/tool/task-graph-tool.js'
import { buildMcpToolProviders } from '../adapters/tool/mcp-tool-provider.js'
import { buildMemoryToolProviders } from '../adapters/tool/memory-tool-provider.js'
import { buildSkillToolProviders } from '../adapters/tool/skill-tool-provider.js'
import { buildDelegationToolProviders } from '../adapters/tool/delegation-tool-provider.js'
import { buildComponentDesignToolProviders } from '../adapters/tool/component-design-tool-provider.js'
import { buildWebToolProviders } from '../adapters/tool/web-tool-provider.js'
import { buildImageGenToolProviders } from '../adapters/tool/image-gen-tool-provider.js'
import { buildComputerUseToolProviders } from '../adapters/tool/computer-use-tool-provider.js'
import { buildBrowserUseToolProviders } from '../adapters/tool/browser-use-tool-provider.js'
import { buildOfficeCliToolProviders } from '../adapters/tool/office-cli-tool-provider.js'
import {
  buildMusicGenToolProviders,
  buildSpeechGenToolProviders,
  buildVideoGenToolProviders
} from '../adapters/tool/media-gen-tool-provider.js'
import { LocalWorkspaceInspector } from '../adapters/workspace/local-workspace-inspector.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import {
  buildRuntimeCapabilityManifest,
  DEFAULT_KUN_CAPABILITIES_CONFIG,
  type KunCapabilitiesConfig
} from '../contracts/capabilities.js'
import {
  DEFAULT_APPROVAL_REVIEWER,
  type ApprovalPolicy,
  type ApprovalReviewer,
  type SandboxMode
} from '../contracts/policy.js'
import { AgentLoop, type AgentLoopOptions } from '../loop/agent-loop.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { withModelTiming } from '../loop/model-timing-decorator.js'
import type { TokenEconomyConfig } from '../loop/token-economy.js'
import {
  DEFAULT_CONTEXT_THRESHOLDS,
  modelCapabilitiesForModel,
  modelCapabilitiesForProviderModel,
  modelContextProfilesFromConfig,
  contextThresholdsForModel,
  type ContextCompactionConfig,
  type ModelConfig
} from '../loop/model-context-profile.js'
import {
  DEFAULT_GRAPH_RUNTIME_CONFIG,
  DEFAULT_QUALITY_CONFIG,
  DEFAULT_STORAGE_CONFIG,
  DEFAULT_TOOL_OUTPUT_LIMITS_CONFIG,
  expandHomePath,
  type GraphRuntimeConfig,
  type ObservabilityConfig,
  type QualityConfig,
  type RolesConfig,
  type RuntimeTuningConfig,
  type ModelRequestRetryConfig,
  type ServeProviderConfig,
  type StorageConfig,
  type ToolOutputLimitsConfig,
  type LabConfig
} from '../config/kun-config.js'
import { createAgentObservabilityRecorder } from '../telemetry/agent-observability.js'
import { ApprovalReviewService } from '../services/approval-review-service.js'
import { buildApprovalReviewModelRouterInput } from '../services/approval-review-model-router.js'
import { buildBuiltinHooks } from '../hooks/builtins/index.js'
import { mergeBuiltinSubagentProfiles } from '../delegation/builtin-profiles.js'
import { buildExploreAgentToolProvider } from '../adapters/tool/explore-agent-tool-provider.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { ToolCancellationRegistry } from '../loop/tool-cancellation-registry.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import type { TurnRunOutcome } from '../loop/turn-execution-types.js'
import { RandomIdGenerator } from '../ports/id-generator.js'
import type { ModelClient } from '../ports/model-client.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import { ScopedMigrationMaintenanceLock } from '../ports/migration-maintenance-lock.js'
import { KUN_SYSTEM_PROMPT } from '../prompt/kun-system-prompt.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { ToolCancellationService } from '../services/tool-cancellation-service.js'
import { GraphRuntimeComposition } from './graph-runtime-factory.js'
import { createGraphRuntimeStartOptions } from './graph-runtime-bootstrap.js'
import {
  LifecycleFencedSessionStore,
  LifecycleFencedThreadStore,
  ThreadLifecycleFence
} from '../services/thread-lifecycle-fence.js'
import { LlmDebugRecorder } from '../services/llm-debug-recorder.js'
import { waitForWorkspaceCheckpoint } from '../services/workspace-checkpoint-gate.js'
import { ThreadService } from '../services/thread-service.js'
import { TurnService } from '../services/turn-service.js'
import { ReviewService } from '../services/review-service.js'
import { UsageService } from '../services/usage-service.js'
import { ProviderQuotaService } from '../services/provider-quota-service.js'
import {
  resolveDefaultCodexQuotaCredential,
  resolveDefaultGrokQuotaCredential,
  resolveOpenCodeGoCookie
} from '../services/provider-subscription-quota.js'
import { fetchOpenCodeGoWebQuota } from '../services/opencode-go-web-quota.js'
import { RoutePoolTestService } from '../services/route-pool-test-service.js'
import type { UsageEvent } from '../contracts/events.js'
import type {
  RuntimeConfigApplyRequest,
  RuntimeConfigApplyResponse
} from '../contracts/runtime-config.js'
import type { ModelConnectionConnectRequest } from '../contracts/model-connections.js'
import {
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  type ModelEndpointFormat
} from '../contracts/model-endpoint-format.js'
import { SkillRuntime } from '../skills/skill-runtime.js'
import { InstructionRuntime } from '../instructions/instruction-runtime.js'
import { resolveConfiguredHooks, type HooksConfig } from '../hooks/hook-config.js'
import { FileMemoryStore, type MemoryStore } from '../memory/memory-store.js'
import { AtomicJsonFile } from '../extensions/atomic-json.js'
import { DelegationRuntime, FileDelegationStore } from '../delegation/delegation-runtime.js'
import {
  createChildAgentExecutor,
  type ChildDelegatedRuntimeFactory
} from '../delegation/child-agent-executor.js'
import { SubagentRouter } from '../delegation/subagent-router.js'
import { BackgroundShellRuntime } from '../services/background-shell-runtime.js'
import { stopBashSessionById, createBashLocalTool } from '../adapters/tool/builtin-bash-tool.js'
import { createBackgroundShellTool } from '../adapters/tool/background-shell-tool.js'
import {
  createSecretEncryptor,
  defaultSecretCommandRunner,
  hasPersistedSecretKeyMaterial
} from '../security/secret-store.js'
import type { LocalTool } from '../adapters/tool/local-tool-host.js'
import type { FaultInjectionController } from '../services/fault-injection-controller.js'
import type { RuntimeFlavor } from '../contracts/runtime-flavor.js'
import { InMemoryPublisherTrustStore } from '../supplychain/publisher-trust-store.js'
import {
  CURRENT_MANIFEST_VERSION,
  SUPPORTED_EXTENSION_API_VERSIONS,
  type ExtensionManifest
} from '@kun/extension-api'
import {
  ExtensionIndexClient,
  ExtensionLogWriter,
  ExtensionManager,
  ExtensionPackageManager,
  ExtensionPaths,
  ExtensionRegistry,
  ExtensionStateMigrationCoordinator,
  ExtensionStateStore,
  seedBundledExtensions,
  type BundledExtensionSeedResult
} from '../extensions/index.js'
import { ExtensionAgentProfileRegistry } from '../services/extension-agent-profile-registry.js'
import { ExtensionAgentService } from '../services/extension-agent-service.js'
import { ExtensionCredentialStore } from '../services/extension-credential-store.js'
import { ExtensionProviderAccountStore } from '../services/extension-provider-account-store.js'
import { ExtensionAccountBroker } from '../services/extension-account-broker.js'
import {
  ExtensionHostBroker,
  requiredExtensionBrokerPermission
} from '../services/extension-host-broker.js'
import {
  LegacyProviderCredentialMigrationService,
  materializeLegacyProviderCredential
} from '../services/legacy-provider-credential-migration.js'
import { CodexOAuthCredentialRefresher } from '../services/codex-oauth-credential-refresher.js'
import { GrokOAuthCredentialRefresher } from '../services/grok-oauth-credential-refresher.js'
import { ExtensionViewSessionService } from '../services/extension-view-session-service.js'
import { ExtensionViewHostGenerationTracker } from '../extensions/view-host-generation-tracker.js'
import { ExtensionSecretRevealConsentService } from '../services/extension-secret-reveal-consent.js'
import { ExtensionConfigurationService } from '../services/extension-configuration-service.js'
import { ExtensionJobStore } from '../services/extension-job-store.js'
import { ExtensionJobService, type ExtensionJobDiagnostic } from '../services/extension-job-service.js'
import { ExtensionMediaHandleService } from '../services/extension-media-handle-service.js'
import { ExtensionMediaProcessService } from '../services/extension-media-process-service.js'
import { ExtensionMediaFfmpegService } from '../services/extension-media-ffmpeg-service.js'
import { ExtensionArtifactService } from '../services/extension-artifact-service.js'
import { ExtensionMediaJobService } from '../services/extension-media-job-service.js'
import { ExtensionAudioAnalysisJobService } from '../services/extension-audio-analysis-job-service.js'
import { ExtensionMediaArchiveService } from '../services/extension-media-archive-service.js'
import { ExtensionMediaArchiveJobService } from '../services/extension-media-archive-job-service.js'
import { ExtensionVisualAnalysisService } from '../services/extension-visual-analysis-service.js'
import { RuntimeMigrationService } from '../services/runtime-migration-service.js'
import { RuntimeMigrationImportService } from '../services/runtime-migration-import-service.js'
import {
  isModelConnectionCredentialSourceId,
  ModelConnectionRegistry,
  providerIdFromCredentialSource,
  type ModelConnectionSeed
} from '../services/model-connection-registry.js'
import { ModelConnectionOAuthService } from '../services/model-connection-oauth.js'
import { ClaudeConnectionService } from '../services/claude-connection-service.js'
import {
  OfficialProviderAuthService,
  resolveAntigravityCliCommand
} from '../services/official-provider-cli.js'
import type { LocalModelGatewayConfig, ModelRoutePoolConfig } from '../contracts/model-route-pool.js'
import type { GeminiCodeAssistCredential } from '../contracts/gemini-code-assist.js'

export type KunServeRuntimeOptions = {
  host: string
  port: number
  configPath?: string
  dataDir: string
  /** Canonical GUI/TUI-shared MCP file; omitted by embedded/test runtimes. */
  sharedMcpConfigPath?: string
  /** Product-owned catalog of default local .kunx packages. */
  bundledExtensionsDir?: string
  runtimeToken: string
  apiKey: string
  credentialSourceId?: string
  /** Decrypted runtime-only OAuth material; never persisted in config.json. */
  geminiAuth?: GeminiCodeAssistCredential
  baseUrl: string
  modelProxyUrl?: string
  endpointFormat?: ModelEndpointFormat
  retry?: ModelRequestRetryConfig
  /**
   * Extra HTTP headers merged into every default-client request (last, so
   * they win). For providers that need more than a Bearer key — e.g. Codex
   * sends `ChatGPT-Account-Id` + a Codex-CLI `User-Agent` with its OAuth
   * access token.
   */
  headers?: Record<string, string>
  /**
   * Extra providers the runtime can route to per request. Keyed by
   * provider id (matched against `ModelRequest.providerId`); each entry
   * supplies its own HTTP credentials. Threads created with a
   * `providerId` matching a key here route their turns to that client;
   * any unrecognized id falls back to the default credentials above.
   * Empty/absent → runtime stays single-provider (current behavior).
   */
  providers?: Record<string, ServeProviderConfig>
  routePools?: ModelRoutePoolConfig[]
  localModelGateway?: LocalModelGatewayConfig
  model: string
  approvalPolicy: ApprovalPolicy
  sandboxMode: SandboxMode
  approvalReviewer?: ApprovalReviewer
  tokenEconomyMode: boolean
  tokenEconomy?: TokenEconomyConfig
  toolOutputLimits?: ToolOutputLimitsConfig
  insecure: boolean
  models?: ModelConfig
  contextCompaction?: ContextCompactionConfig
  runtime?: RuntimeTuningConfig
  /** Internal-LLM role model routing (small-model slot + title/summary/codeReview overrides). */
  roles?: RolesConfig
  storage?: StorageConfig
  observability?: ObservabilityConfig
  graph?: GraphRuntimeConfig
  capabilities?: KunCapabilitiesConfig
  /** Command hooks from config.json; resolved and wired into tool hosts and the loop. */
  hooks?: HooksConfig
  /** Design-quality linter config; drives the builtin PostToolUse hook. */
  quality?: QualityConfig
  /** Experimental Lab features (explore_agent toggle + model overrides). */
  lab?: LabConfig
  startedAt?: string
  instanceId?: string
  buildId?: string
  launchMode?: 'foreground' | 'shared' | 'gui'
  runtimeFlavor?: RuntimeFlavor
  /** Discovery can live outside canonical data (the DV slot uses ~/.kun/control). */
  discoveryDir?: string
  /** Stable manager connection that exclusively owns canonical persistent stores. */
  serviceManager?: ServiceManagerConnection
  logPath?: string
  /** Test-only fault injection; absent in normal production startup. */
  faultInjection?: FaultInjectionController
  /** Test/embedding override; production uses the bundled Host runner. */
  extensionHostRunnerPath?: string
}

export type KunServeHandle = NodeHttpServerHandle & {
  runtime: ServerRuntime
  instanceId: string
  shutdownRequested: Promise<void>
}

async function settleCleanupSteps(
  steps: readonly (() => void | Promise<void>)[]
): Promise<void> {
  let firstError: unknown
  for (const step of steps) {
    try {
      await step()
    } catch (error) {
      if (firstError === undefined) firstError = error
    }
  }
  if (firstError !== undefined) throw firstError
}

/**
 * Composition root for serve mode. This is intentionally the only
 * place that wires concrete adapters to ports; domain, services, loop,
 * and HTTP handlers stay constructor-injected and testable.
 */
export async function createKunServeRuntime(
  options: KunServeRuntimeOptions
): Promise<ServerRuntime> {
  // Every composition that owns local persistent stores must publish its
  // writer claim before constructing any store. This includes direct CLI
  // run/chat/exec runtimes that never pass through startKunServe(). Managed
  // runtimes use Manager-owned remote stores, so the Manager owns the lease.
  const dataDirLease = options.serviceManager
    ? undefined
    : await acquireRuntimeDataDirLease(options.dataDir)
  try {
    return await createKunServeRuntimeComposition(options, dataDirLease)
  } catch (error) {
    await dataDirLease?.release().catch(() => undefined)
    throw error
  }
}

async function createKunServeRuntimeComposition(
  options: KunServeRuntimeOptions,
  dataDirLease: RuntimeDataDirLease | undefined
): Promise<ServerRuntime> {
  await mkdir(options.dataDir, { recursive: true, mode: 0o700 })
  let activeOptions: KunServeRuntimeOptions = { ...options }
  const eventBus = new InMemoryEventBus()
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
  // Agent Perspective is a visible runtime capability, so capture is available
  // by default. Advanced configurations can explicitly opt out when local
  // sensitive-content retention or request-path overhead is undesirable.
  const llmDebug = llmDebugCaptureEnabled(activeOptions)
    ? new LlmDebugRecorder({
        dataDir: activeOptions.dataDir,
        shouldCapture: async (threadId) =>
          (await threadStore.get(threadId))?.modelRequestCaptureEnabled === true
      })
    : undefined
  const agentObservability = createAgentObservabilityRecorder({
    config: activeOptions.observability,
    dataDir: activeOptions.dataDir
  })
  const events = new RuntimeEventRecorder({
    eventBus,
    sessionStore,
    allocateSeq,
    nowIso,
    lifecycleFence,
    ...(agentObservability ? { observers: [agentObservability] } : {})
  })
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
        delegatedSessions.invalidate(threadId)
      ])
    },
    onStatusChanged: (threadId, status) => handleGraphThreadStatus?.(threadId, status),
    onForked: (sourceThreadId, targetThreadId) =>
      handleGraphThreadFork?.(sourceThreadId, targetThreadId)
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
  // Provider-native subscription transports don't get an HTTP client.
  const agentSdkProviderIds = agentSdkProviderIdsForOptions(activeOptions)
  const antigravityProviderIds = antigravityProviderIdsForOptions(activeOptions)
  const cursorSdkProviderIds = cursorSdkProviderIdsForOptions(activeOptions)
  const refreshDelegatedProviderIds = (): void => {
    agentSdkProviderIds.clear()
    for (const providerId of agentSdkProviderIdsForOptions(activeOptions)) {
      agentSdkProviderIds.add(providerId)
    }
    antigravityProviderIds.clear()
    for (const providerId of antigravityProviderIdsForOptions(activeOptions)) {
      antigravityProviderIds.add(providerId)
    }
    cursorSdkProviderIds.clear()
    for (const providerId of cursorSdkProviderIdsForOptions(activeOptions)) {
      cursorSdkProviderIds.add(providerId)
    }
  }
  let refreshModelConnectionDelegatedDeps = (): void => undefined
  const extensionProviderAccounts = new ExtensionProviderAccountStore({
    dataDir: activeOptions.dataDir,
    nowIso
  })
  const extensionCredentialKeyProvider = await createSecretEncryptor({
    keyFilePath: join(activeOptions.dataDir, 'secret.key'),
    run: defaultSecretCommandRunner,
    canBootstrapKeyFileFallback: async () => !(await hasPersistedSecretKeyMaterial(activeOptions.dataDir))
  })
  const extensionCredentials = new ExtensionCredentialStore({
    dataDir: activeOptions.dataDir,
    profileId: 'default',
    keyProvider: extensionCredentialKeyProvider,
    nowIso
  })
  const extensionAccountAudit = new ExtensionLogWriter(
    join(activeOptions.dataDir, 'extensions', 'account-audit.log'),
    { maxBytes: 5 * 1024 * 1024, retention: 3 }
  )
  const extensionAccounts = new ExtensionAccountBroker({
    store: extensionProviderAccounts,
    credentials: extensionCredentials,
    audit: (event) => extensionAccountAudit.write('lifecycle', JSON.stringify(event))
  })
  const extensionModelProviders = new ExtensionModelProviderRegistry({
    accounts: extensionProviderAccounts
  })
  const legacyCredentialMigration = new LegacyProviderCredentialMigrationService({
    dataDir: activeOptions.dataDir,
    accounts: extensionProviderAccounts,
    credentials: extensionCredentials,
    nowIso
  })
  let modelConnections!: ModelConnectionRegistry
  const safeCredentialUnavailableMessage = 'protected model credential is unavailable'
  const requestCredentialStore = {
    resolveApiKey: async (sourceId: string) => {
      try {
        return isModelConnectionCredentialSourceId(sourceId)
          ? await modelConnections.resolveApiKey(sourceId)
          : await legacyCredentialMigration.resolveApiKey(sourceId)
      } catch {
        // Request errors may cross HTTP/SSE boundaries. Never expose protected
        // source identifiers or keychain/decryption details to those clients.
        throw new Error(safeCredentialUnavailableMessage)
      }
    },
    updateResolvedApiKey: async (sourceId: string, expectedApiKey: string, apiKey: string) => {
      try {
        return isModelConnectionCredentialSourceId(sourceId)
          ? await modelConnections.updateResolvedApiKey(sourceId, expectedApiKey, apiKey)
          : await legacyCredentialMigration.updateResolvedApiKey(sourceId, expectedApiKey, apiKey)
      } catch {
        throw new Error(safeCredentialUnavailableMessage)
      }
    }
  }
  const grokCredentialRefresher = new GrokOAuthCredentialRefresher(
    requestCredentialStore
  )
  const codexCredentialRefresher = new CodexOAuthCredentialRefresher(
    requestCredentialStore
  )
  const resolveLegacyRequestCredentials = async (
    sourceId: string,
    rejectedAccessToken?: string
  ): Promise<{
    apiKey: string
    headers?: Record<string, string>
    geminiAuth?: GeminiCodeAssistCredential
    refreshable: boolean
  }> => {
    try {
      let resolved = await codexCredentialRefresher.resolve(sourceId, rejectedAccessToken)
      if (!resolved.refreshable) {
        resolved = await grokCredentialRefresher.resolve(sourceId, rejectedAccessToken)
      }
      const material = materializeLegacyProviderCredential(resolved.rawApiKey)
      return {
        ...material,
        refreshable: resolved.refreshable
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (
        message === safeCredentialUnavailableMessage ||
        message.startsWith('protected credential source is unavailable')
      ) {
        throw new Error(safeCredentialUnavailableMessage)
      }
      throw error
    }
  }
  const migrateLegacyProviderCredentials = async (
    options: KunServeRuntimeOptions = activeOptions
  ): Promise<void> => {
    const sources = [
      ...(options.apiKey.trim() && !options.credentialSourceId ? [{
        sourceId: 'runtime:default',
        providerId: 'default',
        providerName: 'Kun default provider',
        label: 'Migrated runtime credential',
        apiKey: options.apiKey
      }] : []),
      ...Object.entries(options.providers ?? {})
        .filter(([, provider]) => provider.apiKey.trim() && !provider.credentialSourceId)
        .map(([providerId, provider]) => ({
          sourceId: `runtime:provider:${providerId}`,
          providerId,
          providerName: providerId,
          label: 'Migrated provider credential',
          apiKey: provider.apiKey
        }))
    ]
    try {
      await legacyCredentialMigration.migrate(sources)
    } catch {
      // Compatibility reads remain authoritative until a secure migration
      // commits; a credential-backend outage must not break the live runtime.
    }
  }
  await migrateLegacyProviderCredentials()
  activeOptions = await hydrateLegacyCredentialOptions(activeOptions, legacyCredentialMigration)
  await mkdir(join(activeOptions.dataDir, 'approval-review'), {
    recursive: true,
    mode: 0o700
  })
  const buildApprovalReviewClients = (
    options: KunServeRuntimeOptions,
    direct: ReturnType<typeof buildModelClientRouterInput>
  ) => buildApprovalReviewModelRouterInput({
    direct,
    providers: options.providers,
    defaultProviderKind: approvalReviewNativeProviderKind(
      process.env.KUN_RUNTIME_PROVIDER_KIND
    ),
    defaultApiKey: options.apiKey,
    defaultModel: options.model,
    reviewCwd: join(options.dataDir, 'approval-review'),
    ...(process.env.KUN_CLAUDE_BINARY
      ? { pathToClaudeCodeExecutable: process.env.KUN_CLAUDE_BINARY }
      : {})
  })
  const initialModelClients = buildModelClientRouterInput(
    activeOptions,
    modelCapabilities,
    llmDebug,
    resolveLegacyRequestCredentials
  )
  const directModelClient = new MultiProviderModelClient(initialModelClients)
  const approvalReviewModelClient = new MultiProviderModelClient(
    buildApprovalReviewClients(activeOptions, initialModelClients)
  )
  const approvalReviewService = new ApprovalReviewService({
    // Automatic review must not route through a model pool because pool
    // failover would silently substitute the acting turn's selected route.
    model: approvalReviewModelClient,
    events,
    usage: usageService,
    nowIso
  })
  const routeHealth = new RoutePoolHealthStore(join(activeOptions.dataDir, 'model-routing', 'health.json'))
  await routeHealth.load()
  const modelClient = new RoutePoolModelClient(
    directModelClient,
    activeOptions.routePools ?? [],
    modelCapabilities,
    routeHealth
  )
  /**
   * Timing-instrumented entry point shared by the chat loop, child agents,
   * review, and compaction so every model response reports TTFT and
   * generation duration on its usage chunk.
   */
  const timedModelClient = withModelTiming(modelClient)
  const routePoolTests = new RoutePoolTestService(
    modelClient,
    () => modelClient.routePools(),
    routeHealth
  )
  const subagentRouter = new SubagentRouter({
    modelClient: timedModelClient,
    roles: () => activeOptions.roles,
    defaultModel: () => activeOptions.model,
    recordUsage: async ({ threadId, turnId, model, usage }) => {
      const cumulative = usageService.record(threadId, usage, undefined, turnId)
      await events.record({
        kind: 'usage',
        threadId,
        turnId,
        model,
        usage: cumulative
      })
    }
  })
  const replaceRoutedModelClients = (): void => {
    const next = buildModelClientRouterInput(
      activeOptions,
      modelCapabilities,
      llmDebug,
      resolveLegacyRequestCredentials
    )
    for (const [providerId, client] of extensionModelProviders.clientMap()) {
      next.providers.set(providerId, client)
    }
    directModelClient.replace(next)
    approvalReviewModelClient.replace(buildApprovalReviewClients(activeOptions, next))
    modelClient.replacePools(activeOptions.routePools ?? [])
  }
  modelConnections = new ModelConnectionRegistry({
    dataDir: activeOptions.dataDir,
    credentials: extensionCredentials,
    modelCapabilities: registryModelCapabilities,
    retireLegacyCredentialSource: async (sourceId) => {
      await legacyCredentialMigration.forgetSources([sourceId])
    },
    inspectCredentialSource: async (sourceId) => {
      try {
        const resolved = await requestCredentialStore.resolveApiKey(sourceId)
        return resolved?.apiKey?.trim() ? 'ready' : 'missing'
      } catch {
        return 'unreadable'
      }
    },
    resolveCredentialSource: resolveLegacyRequestCredentials,
    onChanged: (connections) => {
      const selected = connections.selected
      const providers = Object.fromEntries(connections.providers.entries())
      const nextOptions: KunServeRuntimeOptions = {
        ...activeOptions,
        ...(selected
          ? {
              model: selected.model,
              apiKey: selected.config.apiKey,
              credentialSourceId: selected.config.credentialSourceId,
              baseUrl: selected.config.baseUrl ?? activeOptions.baseUrl,
              endpointFormat: selected.config.endpointFormat ?? activeOptions.endpointFormat,
              headers: selected.config.headers,
              geminiAuth: selected.config.geminiAuth
            }
          : {
              // Disconnecting the last provider must also retire its decrypted
              // credential from the live router. Keep only a harmless model
              // identifier for diagnostics until a new default is selected.
              apiKey: '',
              headers: undefined,
              geminiAuth: undefined
            }),
        providers,
        modelProxyUrl: connections.proxy.enabled ? connections.proxy.url : undefined,
        routePools: connections.routePools,
        localModelGateway: connections.localModelGateway
      }
      const nextClients = buildModelClientRouterInput(
        nextOptions,
        modelCapabilities,
        llmDebug,
        resolveLegacyRequestCredentials
      )
      for (const [providerId, client] of extensionModelProviders.clientMap()) {
        nextClients.providers.set(providerId, client)
      }
      activeOptions = nextOptions
      refreshDelegatedProviderIds()
      directModelClient.replace(nextClients)
      approvalReviewModelClient.replace(buildApprovalReviewClients(activeOptions, nextClients))
      modelClient.replacePools(activeOptions.routePools ?? [])
      refreshModelConnectionDelegatedDeps()
    }
  })
  await modelConnections.initialize(modelConnectionSeedsForOptions(activeOptions), {
    proxy: { enabled: Boolean(activeOptions.modelProxyUrl), url: activeOptions.modelProxyUrl ?? '' },
    routePools: activeOptions.routePools ?? [],
    localModelGateway: activeOptions.localModelGateway ?? { enabled: false }
  })
  const resolveCapabilityProviderCredential = async (providerId: string): Promise<{
    apiKey: string
    headers?: Record<string, string>
  }> => {
    const provider = (await modelConnections.materialize()).providers.get(providerId)
    if (!provider || provider.kind !== 'http') {
      throw new Error(`Model connection ${providerId} is unavailable for media generation`)
    }
    let apiKey = provider.apiKey.trim()
    let headers = provider.headers
    if (provider.credentialSourceId) {
      const resolved = await resolveLegacyRequestCredentials(provider.credentialSourceId)
      apiKey = resolved.apiKey.trim()
      headers = { ...(headers ?? {}), ...(resolved.headers ?? {}) }
    }
    if (!apiKey) {
      throw new Error(`Model connection ${providerId} has no usable credential`)
    }
    return { apiKey, ...(headers ? { headers } : {}) }
  }
  const providerQuotaService = new ProviderQuotaService({
    loadSource: async () => {
      const [snapshot, materialized] = await Promise.all([
        modelConnections.snapshot(),
        modelConnections.materialize()
      ])
      const profiles = await Promise.all(snapshot.providers.map(async (profile) => {
        const config = materialized.providers.get(profile.id)
        let apiKey = config?.apiKey ?? ''
        let headers = (config?.kind ?? 'http') === 'http'
          ? config?.headers
          : undefined
        if (config?.credentialSourceId) {
          try {
            const resolved = await resolveLegacyRequestCredentials(config.credentialSourceId)
            apiKey = resolved.apiKey
            headers = { ...(headers ?? {}), ...(resolved.headers ?? {}) }
          } catch {
            // A missing protected binding becomes a per-provider missing-credential state.
          }
        }
        return {
          id: profile.id,
          name: profile.name,
          ...(profile.presetSource ? { presetId: profile.presetSource } : {}),
          kind: profile.kind,
          ...(profile.baseUrl ? { baseUrl: profile.baseUrl } : {}),
          apiKey,
          ...(headers ? { headers } : {}),
          ...(config?.credentialSourceId
            ? { credentialSourceId: config.credentialSourceId }
            : {})
        }
      }))
      return {
        profiles,
        proxyUrl: snapshot.proxy.enabled ? snapshot.proxy.url : ''
      }
    },
    subscriptionRuntime: {
      resolveCodexCredential: async (provider, rejectedAccessToken) => {
        if (!provider.credentialSourceId) {
          return resolveDefaultCodexQuotaCredential(provider, rejectedAccessToken)
        }
        try {
          const resolved = await resolveLegacyRequestCredentials(
            provider.credentialSourceId,
            rejectedAccessToken
          )
          const accessToken = resolved.apiKey.trim()
          if (!accessToken) return undefined
          const accountId = new Headers(resolved.headers).get('chatgpt-account-id')?.trim()
          return {
            accessToken,
            ...(accountId ? { accountId } : {})
          }
        } catch {
          return undefined
        }
      },
      resolveGrokCredential: async (provider, rejectedAccessToken) => {
        if (!provider.credentialSourceId) {
          return resolveDefaultGrokQuotaCredential(provider, rejectedAccessToken)
        }
        try {
          const resolved = await resolveLegacyRequestCredentials(
            provider.credentialSourceId,
            rejectedAccessToken
          )
          const accessToken = resolved.apiKey.trim()
          if (!accessToken || accessToken === rejectedAccessToken) return undefined
          return { accessToken }
        } catch {
          return undefined
        }
      },
      // OpenCode Go uses the default browser-cookie resolver and the shared
      // proxy-aware fetcher; explicit wiring keeps GUI/TUI quota behavior
      // identical to the standalone runtime defaults.
      resolveOpenCodeGoCookie: async () => resolveOpenCodeGoCookie(),
      fetchOpenCodeGoWebQuota: async (cookieHeader, context) => {
        const fetcher = ((input: string | URL | Request, init?: RequestInit) =>
          context.fetcher(
            typeof input === 'string' || input instanceof URL ? input : input.url,
            init,
            context.proxyUrl
          )) as typeof fetch
        return fetchOpenCodeGoWebQuota({ cookieHeader, fetcher })
      }
    }
  })
  const claudeConnections = new ClaudeConnectionService({ dataDir: activeOptions.dataDir })
  const modelConnectionOAuth = new ModelConnectionOAuthService({
    registry: modelConnections,
    claude: claudeConnections
  })
  const officialProviderAuth = new OfficialProviderAuthService({
    dataDir: activeOptions.dataDir,
    registry: modelConnections
  })
  const stopExtensionModelListener = extensionModelProviders.onDidChange(replaceRoutedModelClients)
  const hasMcpOAuth = Object.values(activeOptions.capabilities?.mcp?.servers ?? {}).some((server) =>
    server.oauth?.enabled !== false && Boolean(server.oauth) && server.transport !== 'stdio'
  )
  const oauthEncryptor = hasMcpOAuth
    ? extensionCredentialKeyProvider.encryptor
    : undefined
  // Independent I/O; all must still finish before the server listens.
  let [mcpProviders, skillRuntime] = await Promise.all([
    buildMcpToolProviders(activeOptions.capabilities?.mcp, {
      oauthStorageDir: join(activeOptions.dataDir, 'mcp-oauth'),
      ...(oauthEncryptor ? { oauthEncryptor } : {})
    }),
    SkillRuntime.create(activeOptions.capabilities?.skills),
    seedUsageCarryover({ threadStore, sessionStore, usageService })
  ])
  let instructionRuntime = new InstructionRuntime(activeOptions.capabilities?.instructions)
  const migrationMaintenance = new ScopedMigrationMaintenanceLock()
  let attachmentStore: AttachmentStore | undefined
  const executionLeases = options.serviceManager
    ? new ManagerThreadExecutionLeaseClient(
        options.serviceManager,
        options.runtimeFlavor ?? 'production',
        options.instanceId ?? 'embedded'
      )
    : undefined
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
    maxConcurrentTurns: activeOptions.runtime?.turnLimits?.maxConcurrentTurns,
    lifecycleFence,
    executionLeases,
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
  abortThreadExecution = (threadId) => turnService.abortThreadExecution(threadId)
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
    optionsForTools: KunServeRuntimeOptions = activeOptions
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
    defaultModel: activeOptions.model,
    nowIso,
    modelCapabilities,
    profilesForProvider,
	    ...(activeOptions.models ? { models: activeOptions.models } : {}),
	    ...(activeOptions.contextCompaction ? { contextCompaction: activeOptions.contextCompaction } : {}),
	    ...(tokenEconomy ? { tokenEconomy } : {}),
	    ...(activeOptions.runtime ? { runtime: activeOptions.runtime } : {}),
	    ...(activeOptions.roles?.codeReviewReasoningEffort
	      ? { reasoningEffort: activeOptions.roles.codeReviewReasoningEffort }
	      : {}),
	    ...(activeOptions.roles?.codeReviewModel ? { roleModel: activeOptions.roles.codeReviewModel } : {}),
	    ...(activeOptions.roles?.codeReviewProviderId ? { roleProviderId: activeOptions.roles.codeReviewProviderId } : {}),
	    ...(activeOptions.roles?.codeReviewAccountId ? { roleAccountId: activeOptions.roles.codeReviewAccountId } : {})
	  }
	  const reviewService = new ReviewService(reviewDeps)
	  let webProviders = buildWebToolProviders(activeOptions.capabilities?.web)
	  attachmentStore = createPersistentAttachmentStore(activeOptions, nowIso)
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
	  await pruneUnsentAttachments(attachmentStore)
	  let attachmentPruneRunning = false
	  const attachmentPruneTimer = setInterval(() => {
	    if (attachmentPruneRunning) return
	    attachmentPruneRunning = true
	    void pruneUnsentAttachments(attachmentStore)
	      .catch((error) => {
	        console.warn('[kun] expired attachment lease pruning failed:', error)
	      })
	      .finally(() => {
	        attachmentPruneRunning = false
	      })
	  }, 60 * 60 * 1_000)
	  attachmentPruneTimer.unref()
	  let memoryStore = createPersistentMemoryStore(activeOptions, nowIso)
	  const migrationService = new RuntimeMigrationService({
	    rootDir: join(activeOptions.dataDir, 'migrations', 'exports'),
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
	    rootDir: join(activeOptions.dataDir, 'migrations', 'imports'),
	    threadStore: rawThreadStore,
	    sessionStore: rawSessionStore,
	    maintenance: migrationMaintenance,
	    attachmentStore: () => attachmentStore,
	    artifactStore,
	    memoryStore: () => memoryStore,
	    onThreadImported: (threadId) => delegatedSessions.invalidate(threadId)
	  })
	  let imageGenProviders = buildImageGenToolProviders(activeOptions.capabilities?.imageGen, {
	    attachmentStore,
	    nowIso,
	    resolveCredential: resolveCapabilityProviderCredential
	  })
	  let speechGenProviders = buildSpeechGenToolProviders(activeOptions.capabilities?.speechGen, {
	    nowIso,
	    resolveCredential: resolveCapabilityProviderCredential
	  })
	  let musicGenProviders = buildMusicGenToolProviders(activeOptions.capabilities?.musicGen, {
	    nowIso,
	    resolveCredential: resolveCapabilityProviderCredential
	  })
	  let videoGenProviders = buildVideoGenToolProviders(activeOptions.capabilities?.videoGen, {
	    nowIso,
	    resolveCredential: resolveCapabilityProviderCredential
	  })
	  let computerUseProviders = await buildComputerUseToolProviders(activeOptions.capabilities?.computerUse)
	  let browserUseProviders = buildBrowserUseToolProviders(activeOptions.capabilities?.browserUse)
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
      ...buildDesignSvgLocalTools()
    ]
  }
  const pptMasterProvider = {
    id: 'ppt-master',
    kind: 'skill' as const,
    enabled: true,
    available: true,
    effects: {
      network: false,
      externalWrite: false,
      processExecution: false,
      guiAutomation: false
    },
    tools: buildPptMasterLocalTools()
  }
  const officeCliProviders = buildOfficeCliToolProviders({
    binaryPath: process.env.KUN_OFFICECLI_BINARY,
    profileDir: join(activeOptions.dataDir, 'officecli-profile')
  })
	  const taskGraphTool = createTaskGraphTool({ rootDir: join(activeOptions.dataDir, 'task-graphs') })
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
        buildDefaultLocalTools({}, builtinToolOptionsForOptions(activeOptions)),
        activeOptions
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
    ...buildSkillToolProviders(skillRuntime),
    ...imageGenProviders.providers,
    ...speechGenProviders.providers,
    ...musicGenProviders.providers,
    ...videoGenProviders.providers,
    ...officeCliProviders,
    pptMasterProvider,
    designCanvasProvider,
    // NOTE: computer_use is intentionally NOT in baseToolProviders — host
    // control must not be delegable to subagents. browser_use follows the
    // same primary-only rule and is added to the main registry below.
  ]
  // Builtin hooks are first-party and always assembled before config hooks.
  // The design-quality linter folds findings into write/edit results so the
  // model self-corrects; config-loaded command hooks run after it.
	  let resolvedHooks = [
	    ...buildBuiltinHooks({ quality: activeOptions.quality ?? DEFAULT_QUALITY_CONFIG }),
	    ...resolveConfiguredHooks(activeOptions.hooks)
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
  const createChildDelegatedRuntime: ChildDelegatedRuntimeFactory = (child) =>
    composeDelegatedTurnRuntimes([
    ...(agentSdkProviderIds.size > 0 || defaultIsAgentSdk
      ? [createAgentSdkRuntime({
          registry: childRegistry,
          toolHost: childToolHost,
          turns: child.turns,
          sessionStore: child.sessionStore,
          threadStore: child.threadStore,
          events: child.events,
          ...(llmDebug ? { debugSink: llmDebug } : {}),
          ids: child.ids,
          prefix: child.prefix,
          providerConfigs: activeOptions.providers ?? {},
          agentSdkProviderIds,
          defaultApprovalPolicy: activeOptions.approvalPolicy,
          defaultSandboxMode: activeOptions.sandboxMode,
          defaultApprovalReviewer: activeOptions.approvalReviewer ?? DEFAULT_APPROVAL_REVIEWER,
          defaultModel: activeOptions.model,
          defaultIsAgentSdk,
          defaultToken: activeOptions.apiKey,
          turnLimits: activeOptions.runtime?.turnLimits,
          approvalGate,
          approvalReview: approvalReviewService,
          instructionRuntime,
          allowSdkBuiltins: false,
          toolContextBoundary: {
            ...(child.allowedProviderIds ? { allowedProviderIds: child.allowedProviderIds } : {}),
            ...(child.allowedToolNames ? { allowedToolNames: child.allowedToolNames } : {}),
            ...(child.allowedSkillIds ? { allowedSkillIds: child.allowedSkillIds } : {}),
            ...(child.allowedReadPaths ? { allowedReadPaths: child.allowedReadPaths } : {}),
            ...(child.allowedWritePaths ? { allowedWritePaths: child.allowedWritePaths } : {}),
            ...(child.allowedArtifactIds ? { allowedArtifactIds: child.allowedArtifactIds } : {}),
            ...(child.blockedProviderIds ? { blockedProviderIds: child.blockedProviderIds } : {}),
            ...(child.blockedToolNames ? { blockedToolNames: child.blockedToolNames } : {}),
            ...(child.blockedSkillIds ? { blockedSkillIds: child.blockedSkillIds } : {})
          },
          ...(child.skillsEnabled ? { skillRuntime } : {}),
          ...(child.memoryEnabled && memoryStore ? { memoryStore } : {}),
          ...(attachmentStore ? { attachmentStore } : {}),
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
          providerConfigs: activeOptions.providers ?? {},
          providerIds: antigravityProviderIds,
          defaultIsAntigravity,
          defaultModel: activeOptions.model,
          systemPrompt: child.prefix.systemPrompt,
          binaryPath:
            process.env.KUN_ANTIGRAVITY_BINARY ??
            resolveAntigravityCliCommand(activeOptions.dataDir)?.command,
          threadStore: child.threadStore,
          sessionStore: child.sessionStore,
          turns: child.turns,
          events: child.events,
          ids: child.ids,
          ...(llmDebug ? { debugSink: llmDebug } : {}),
          turnLimits: activeOptions.runtime?.turnLimits,
          enforceReadOnly: child.toolPolicy === 'readOnly',
          sessionCoordinator: delegatedSessions,
          contextProfile: delegatedContextProfile
        })]
      : []),
    ...(cursorSdkProviderIds.size > 0 || defaultIsCursorSdk
      ? [createCursorSdkRuntime({
          registry: childRegistry,
          toolHost: childToolHost,
          providerConfigs: activeOptions.providers ?? {},
          providerIds: cursorSdkProviderIds,
          defaultIsCursor: defaultIsCursorSdk,
          defaultApiKey: activeOptions.apiKey,
          defaultModel: activeOptions.model,
          defaultApprovalPolicy: activeOptions.approvalPolicy,
          defaultSandboxMode: activeOptions.sandboxMode,
          defaultApprovalReviewer: activeOptions.approvalReviewer ?? DEFAULT_APPROVAL_REVIEWER,
          systemPrompt: child.prefix.systemPrompt,
          threadStore: child.threadStore,
          sessionStore: child.sessionStore,
          turns: child.turns,
          events: child.events,
          ids: child.ids,
          setThreadTodos: (threadId, request) =>
            child.threads.setTodosFromTool(threadId, request),
          ...(llmDebug ? { debugSink: llmDebug } : {}),
          ...(attachmentStore ? { attachmentStore } : {}),
          turnLimits: activeOptions.runtime?.turnLimits,
          enforceReadOnly: child.toolPolicy === 'readOnly',
          approvalGate,
          approvalReview: approvalReviewService,
          instructionRuntime,
          toolContextBoundary: {
            ...(child.allowedProviderIds ? { allowedProviderIds: child.allowedProviderIds } : {}),
            ...(child.allowedToolNames ? { allowedToolNames: child.allowedToolNames } : {}),
            ...(child.allowedSkillIds ? { allowedSkillIds: child.allowedSkillIds } : {}),
            ...(child.allowedReadPaths ? { allowedReadPaths: child.allowedReadPaths } : {}),
            ...(child.allowedWritePaths ? { allowedWritePaths: child.allowedWritePaths } : {}),
            ...(child.allowedArtifactIds ? { allowedArtifactIds: child.allowedArtifactIds } : {}),
            ...(child.blockedProviderIds ? { blockedProviderIds: child.blockedProviderIds } : {}),
            ...(child.blockedToolNames ? { blockedToolNames: child.blockedToolNames } : {}),
            ...(child.blockedSkillIds ? { blockedSkillIds: child.blockedSkillIds } : {})
          },
          ...(child.skillsEnabled ? { skillRuntime } : {}),
          ...(child.memoryEnabled && memoryStore ? { memoryStore } : {}),
          nowIso,
          sessionCoordinator: delegatedSessions,
          contextProfile: delegatedContextProfile
        })]
      : [])
    ])
	  let delegationRuntime = activeOptions.capabilities?.subagents.enabled
	    ? new DelegationRuntime({
	        config: mergeBuiltinSubagentProfiles(activeOptions.capabilities.subagents),
	        store: new FileDelegationStore(join(activeOptions.dataDir, 'child-runs')),
	        events,
	        eventBus,
	        threadStore,
	        turns: turnService,
	        nowIso,
	        executor: createChildAgentExecutor({
	          model: timedModelClient,
	          toolHost: childToolHost,
	          prefix,
	          defaultModel: activeOptions.model,
	          models: activeOptions.models,
		          contextCompaction: activeOptions.contextCompaction,
		          approvalPolicy: activeOptions.approvalPolicy,
		          sandboxMode: activeOptions.sandboxMode,
		          approvalReviewer:
		            activeOptions.approvalReviewer ?? DEFAULT_APPROVAL_REVIEWER,
		          modelCapabilities,
	          profilesForProvider,
	          skillRuntime,
	          instructionRuntime,
	          tokenEconomy,
	          approvalGate,
	          approvalReview: approvalReviewService,
          createDelegatedRuntime: createChildDelegatedRuntime,
          // Persist the child as a hidden `side` thread on the shared stores +
          // event bus so its session is loadable and streams live in the GUI.
          sessionStore,
          threadStore,
          events,
	          ...(activeOptions.runtime ? { runtime: activeOptions.runtime } : {}),
          ...(memoryStore ? { memoryStore } : {}),
          artifactStore,
          nowIso
        }),
        recordExternalUsage: (threadId, usage) => {
          usageService.record(threadId, usage)
        }
      })
    : undefined
	  let capabilities = buildRuntimeCapabilityManifest({
	    config: activeOptions.capabilities,
	    model: modelCapabilities(activeOptions.model),
	    mcp: {
	      configuredServers: Object.keys(activeOptions.capabilities?.mcp.servers ?? {}).length,
      connectedServers: mcpProviders.connectedServers,
      toolCount: mcpProviders.toolCount,
      lastError: mcpProviders.diagnostics.find((diagnostic) => diagnostic.lastError)?.lastError,
      search: {
        active: mcpProviders.search.active,
        indexedToolCount: mcpProviders.search.indexedToolCount,
        advertisedToolCount: mcpProviders.search.advertisedToolCount
      }
    },
    web: {
      fetchAvailable: webProviders.fetchAvailable,
      searchAvailable: webProviders.searchAvailable,
      provider: webProviders.provider,
      reason: webProviders.diagnostics.find((diagnostic) => diagnostic.reason)?.reason
	    },
	    skills: {
	      configuredRoots: activeOptions.capabilities?.skills.roots.length,
      discoveredSkills: skillRuntime.count(),
      reason: skillRuntime.diagnostics().validationErrors[0]?.message
    },
    instructions: {
      available: instructionRuntime.enabled(),
      lastSourceCount: instructionRuntime.diagnostics().lastInjection?.sources.length ?? 0,
      lastInjectedBytes: instructionRuntime.diagnostics().lastInjection?.injectedBytes ?? 0
    },
    attachments: {
      available: Boolean(attachmentStore)
    },
    memory: {
      available: Boolean(memoryStore)
    },
    subagents: {
      available: Boolean(delegationRuntime)
    },
    imageGen: {
      available: imageGenProviders.available,
      reason: imageGenProviders.diagnostics.find((diagnostic) => diagnostic.reason)?.reason
    },
    speechGen: {
      available: speechGenProviders.available,
      reason: speechGenProviders.diagnostics.find((diagnostic) => diagnostic.reason)?.reason
    },
    musicGen: {
      available: musicGenProviders.available,
      reason: musicGenProviders.diagnostics.find((diagnostic) => diagnostic.reason)?.reason
    },
    videoGen: {
      available: videoGenProviders.available,
      reason: videoGenProviders.diagnostics.find((diagnostic) => diagnostic.reason)?.reason
    },
    computerUse: {
      available: computerUseProviders.available,
      reason: computerUseProviders.diagnostics.find((diagnostic) => diagnostic.reason)?.reason
    },
    browserUse: {
      available: browserUseProviders.available,
      interactionRequired: browserUseProviders.interactionRequired,
      reason: browserUseProviders.reason
    }
  })
	  let registry = new CapabilityRegistry([
    ...baseToolProviders,
    // Host control is available to the top-level agent only, never to
    // delegated subagents (which use childRegistry/baseToolProviders).
    ...computerUseProviders.providers,
    ...browserUseProviders.providers,
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
    ...buildExploreAgentToolProvider(
      delegationRuntime,
      () => activeOptions.lab?.exploreAgent
    ),
    ...buildComponentDesignToolProviders(delegationRuntime)
  ])
  let prepareExtensionContributions: ((context?: ToolHostContext) => Promise<void>) | undefined
  const toolHost = new LocalToolHost({
    registry,
    readTracker: true,
    prepare: (context) => prepareExtensionContributions?.(context),
    ...(resolvedHooks.length ? { hooks: resolvedHooks } : {})
  })
  const extensionTools = new ExtensionToolRegistry({ registry })
  // Keep retrying MCP servers that lost the fast startup connect race so a slow
  // npx cold start eventually shows up as connected instead of staying "error"
  // until the next runtime restart (issue #342). Both registries advertise the
  // MCP providers, so a late connection must be registered into each.
  void mcpProviders.startBackgroundReconnect((provider) => {
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
        resolveAntigravityCliCommand(activeOptions.dataDir)?.command,
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
  stopThreadAuxiliaryWork = async (threadId) => {
    await graphRuntime.cancelThreadRuns(threadId)
    await Promise.allSettled([
      backgroundShellRuntime.stopThread(threadId),
      Promise.resolve(delegationRuntime?.abortDetachedChildrenForThread(threadId) ?? 0)
    ])
  }
  const sdkRuntime = new ReplaceableDelegatedTurnRuntime(buildMainDelegatedRuntime({
    options: activeOptions,
    registry,
    skillRuntime,
    instructionRuntime,
    attachmentStore,
    memoryStore
  }))
  refreshModelConnectionDelegatedDeps = () => {
    sdkRuntime.replace(buildMainDelegatedRuntime({
      options: activeOptions,
      registry,
      skillRuntime,
      instructionRuntime,
      attachmentStore,
      memoryStore
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
	    modelCapabilities,
	    skillRuntime,
	    instructionRuntime,
	    tokenEconomy,
	    contextCompaction: activeOptions.contextCompaction,
	    ...(activeOptions.roles ? { roles: activeOptions.roles } : {}),
	    ...(activeOptions.runtime?.toolStorm ? { toolStorm: activeOptions.runtime.toolStorm } : {}),
	    ...(activeOptions.runtime?.turnLimits ? { turnLimits: activeOptions.runtime.turnLimits } : {}),
	    ...(activeOptions.runtime?.toolArgumentRepair ? { toolArgumentRepair: activeOptions.runtime.toolArgumentRepair } : {}),
	    ...(resolvedHooks.length ? { hooks: resolvedHooks } : {}),
	    ...(attachmentStore ? { attachmentStore } : {}),
	    artifactStore,
	    ...(memoryStore ? { memoryStore } : {}),
	    runtimeDataDir: activeOptions.dataDir,
	    awaitWorkspaceCheckpoint: (checkpointRequestId, signal) =>
	      waitForWorkspaceCheckpoint(activeOptions.dataDir, checkpointRequestId, signal),
	    onPlanWritten: async ({ threadId, planId, relativePath, markdown }) => {
	      await threadService.syncTodosFromPlan(threadId, {
	        planId,
        relativePath,
        markdown,
	        preserveCompleted: true
	      })
	    }
	  }
	  let loop = new AgentLoop(loopOptions)
	  const activeRuntimeRuns = new Set<Promise<TurnRunOutcome>>()
	  let shuttingDown = false
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
	      return turnService.suspendTurnForHostShutdown({ threadId, turnId })
	        .then(() => 'suspended' as const)
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
	  const runReview = (input: Parameters<typeof reviewService.runReview>[0]) =>
	    trackRuntimeRun(reviewService.runReview(input))
	  await graphRuntime.start(createGraphRuntimeStartOptions({
	    delegation: () => delegationRuntime,
	    threads: threadStore,
	    resumeTurn: (input) => turnService.resumeGraphLeadTurn(input),
	    isTurnExecutionActive: (turnId) => turnService.isTurnExecutionActive(turnId),
	    isShuttingDown: () => shuttingDown,
	    steerTurn: (input) => turnService.steerTurn(input),
	    runAgentTurn,
	    defaults: () => ({
	      model: activeOptions.model,
	      workerModel: graphConfig().workerModel,
	      approvalPolicy: activeOptions.approvalPolicy,
	      sandboxMode: activeOptions.sandboxMode,
	      approvalReviewer:
	        activeOptions.approvalReviewer ?? DEFAULT_APPROVAL_REVIEWER,
	      allowedMcpServers: Object.entries(activeOptions.capabilities?.mcp.servers ?? {})
	        .filter(([, server]) => server.enabled !== false)
	        .map(([serverId]) => serverId),
	      disabledSkillIds: [...(activeOptions.capabilities?.skills.disabledIds ?? [])],
	      networkAllowed:
	        activeOptions.capabilities?.web.fetchEnabled === true ||
	        activeOptions.capabilities?.web.searchEnabled === true
	    }),
	    tools: () => registry.listTools(),
	    skillIds: () => skillRuntime.diagnostics().skills.map((skill) => skill.id)
	  }))
	  await resumeInterruptedGraphPlanning({
	    graphRuntime,
	    turnService,
	    runTurn: runAgentTurn
	  })
	  const extensionProfiles = new ExtensionAgentProfileRegistry()
	  const extensionAgent = new ExtensionAgentService({
	    threads: threadService,
	    turns: turnService,
	    sessions: sessionStore,
	    eventBus,
	    profiles: extensionProfiles,
	    runTurn: runAgentTurn,
	    defaultBinding: { providerId: 'default', modelId: activeOptions.model },
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
	  const extensionPaths = new ExtensionPaths({
	    packageRoot: join(activeOptions.dataDir, 'extensions'),
	    dataRoot: join(activeOptions.dataDir, 'extension-data')
	  })
	  const extensionRegistry = new ExtensionRegistry(extensionPaths)
	  const extensionApiCapabilities = [
	    'commands', 'storage', 'configuration', 'network', 'ui', 'agent', 'threads', 'tools',
	    'modelProviders', 'authentication', 'workspace', 'media', 'jobs'
	  ]
	  const legacyExtensionApiCapabilities = extensionApiCapabilities.filter((capability) =>
	    capability !== 'media' && capability !== 'jobs')
	  const extensionValidation = {
	    compatibility: {
	      kunVersion: KUN_VERSION,
	      supportedManifestVersions: [CURRENT_MANIFEST_VERSION],
	      supportedApiVersions: SUPPORTED_EXTENSION_API_VERSIONS,
	      capabilitiesByApiVersion: Object.fromEntries(
	        SUPPORTED_EXTENSION_API_VERSIONS.map((version) => [
	          version,
	          version === '1.0.0' ? legacyExtensionApiCapabilities : extensionApiCapabilities
	        ])
	      )
	    }
	  }
	  const extensionPackageManager = new ExtensionPackageManager(
	    extensionPaths,
	    extensionRegistry,
	    extensionValidation
	  )
	  const extensionState = new ExtensionStateStore(extensionPaths)
	  const extensionConfiguration = new ExtensionConfigurationService(extensionState)
	  const extensionMediaHandles = new ExtensionMediaHandleService({ dataDir: activeOptions.dataDir })
	  const extensionMediaProcesses = new ExtensionMediaProcessService({
	    handleService: extensionMediaHandles,
	    ...(process.env.KUN_FFPROBE_PATH ? { ffprobePath: process.env.KUN_FFPROBE_PATH } : {}),
	    ...(process.env.KUN_FFMPEG_PATH ? { ffmpegPath: process.env.KUN_FFMPEG_PATH } : {})
	  })
	  const extensionArtifacts = new ExtensionArtifactService({
	    dataDir: activeOptions.dataDir,
	    handleService: extensionMediaHandles
	  })
	  const extensionJobDiagnostics: ExtensionJobDiagnostic[] = []
	  const extensionJobStore = new ExtensionJobStore({
	    path: join(activeOptions.dataDir, 'extensions', 'jobs.json')
	  })
	  const extensionJobs = new ExtensionJobService({
	    store: extensionJobStore,
	    reauthorize: async (snapshot, workspaceRoot) => {
	      const entry = await extensionRegistry.get(snapshot.ownerExtensionId)
	      if (!entry) return false
	      const manifest = entry.useDevelopment
	        ? entry.development?.manifest
	        : entry.selectedVersion ? entry.versions[entry.selectedVersion]?.manifest : undefined
	      if (!manifest) return false
	      const workspaceKey = extensionPaths.workspaceKey(workspaceRoot)
	      if (workspaceKey !== snapshot.workspaceId) return false
	      return workspaceKey in entry.workspaceEnablement
	        ? entry.workspaceEnablement[workspaceKey] === true
	        : entry.globallyEnabled === true
	    },
	    onDiagnostic: (diagnostic) => {
	      extensionJobDiagnostics.push(diagnostic)
	      if (extensionJobDiagnostics.length > 128) extensionJobDiagnostics.shift()
	    }
	  })
	  const extensionFfmpeg = new ExtensionMediaFfmpegService({
	    handleService: extensionMediaHandles,
	    processService: extensionMediaProcesses
	  })
	  const extensionMediaJobs = new ExtensionMediaJobService({
	    jobs: extensionJobs,
	    ffmpeg: extensionFfmpeg,
	    media: extensionMediaProcesses,
	    artifacts: extensionArtifacts
	  })
	  const extensionAudioAnalysisJobs = new ExtensionAudioAnalysisJobService({
	    jobs: extensionJobs,
	    media: extensionMediaProcesses
	  })
	  const extensionVisualAnalysis = new ExtensionVisualAnalysisService({
	    dataDir: activeOptions.dataDir,
	    media: extensionMediaProcesses
	  })
	  const extensionMediaArchive = new ExtensionMediaArchiveService({
	    handles: extensionMediaHandles
	  })
	  const extensionMediaArchiveJobs = new ExtensionMediaArchiveJobService({
	    jobs: extensionJobs,
	    archive: extensionMediaArchive
	  })
	  const extensionViewSessions = new ExtensionViewSessionService()
	  const extensionViewHostGenerations = new ExtensionViewHostGenerationTracker()
	  const extensionSecretReveals = new ExtensionSecretRevealConsentService()
	  const extensionPreparations = new Map<string, { revision: number; promise: Promise<void> }>()
	  let extensionBroker!: ExtensionHostBroker
	  const extensionManager = new ExtensionManager({
	    packageManager: extensionPackageManager,
	    paths: extensionPaths,
	    ...(activeOptions.extensionHostRunnerPath
	      ? { runnerPath: activeOptions.extensionHostRunnerPath }
	      : {}),
	    capabilitiesForExtension: () => extensionApiCapabilities,
	    broker: (request) => extensionBroker.handle(request),
	    requiredPermission: requiredExtensionBrokerPermission,
	    onNotification: (principal, method, params) =>
	      extensionBroker.notification(principal, method, params),
	    onStream: (principal, requestId, sequence, payload, terminal) =>
	      extensionBroker.stream(principal, requestId, sequence, payload, terminal),
	    onHostActivated: (principal) => {
	      extensionJobs.clearExtensionFence(principal.extensionId)
	      for (const workspaceRoot of principal.workspaceRoots) {
	        extensionJobs.clearWorkspaceFence(
	          principal.extensionId,
	          extensionPaths.workspaceKey(workspaceRoot)
	        )
	      }
	      extensionViewHostGenerations.bindExtension(
	        principal.extensionId,
	        principal.workspaceRoots,
	        principal.lifecycleNonce
	      )
	    },
	    onHostExit: async (exit, principal) => {
	      // Unexpected exits invalidate every guest bound to the crashed Host.
	      // Expected lifecycle stops are already coordinated by disable/version/
	      // shutdown paths. Keeping their sessions here also prevents an idle
	      // teardown from deleting a newly retained View that is waiting for the
	      // old Host cleanup to finish before reactivation.
	      if (!exit.expected) {
	        const workspaceIds = principal.workspaceRoots.map((root) =>
	          extensionPaths.workspaceKey(root))
	        await extensionJobs.handleExtensionHostCrash(
	          exit.extensionId,
	          workspaceIds.length === 0 ? undefined : workspaceIds
	        )
	        for (const sessionId of extensionViewHostGenerations.takeExitedGeneration(
	          exit.extensionId,
	          exit.lifecycleNonce
	        )) {
	          extensionViewSessions.disposeSession(sessionId)
	        }
	      }
	      await extensionBroker.disposeHost(principal)
	      // A crash does not change the registry revision, so explicitly drop
	      // successful lazy-preparation entries and allow clean reactivation.
	      extensionPreparations.clear()
	    }
	  })
	  const resolveExtensionManifest = async (extensionId: string): Promise<ExtensionManifest | undefined> => {
	    const entry = await extensionRegistry.get(extensionId)
	    if (!entry) return undefined
	    if (entry.useDevelopment) return entry.development?.manifest
	    return entry.selectedVersion ? entry.versions[entry.selectedVersion]?.manifest : undefined
	  }
	  extensionBroker = new ExtensionHostBroker({
	    agent: extensionAgent,
	    profiles: extensionProfiles,
	    tools: extensionTools,
	    modelProviders: extensionModelProviders,
	    providerAccounts: extensionProviderAccounts,
	    accounts: extensionAccounts,
	    credentials: extensionCredentials,
	    state: extensionState,
	    configuration: extensionConfiguration,
	    artifacts: extensionArtifacts,
	    mediaHandles: extensionMediaHandles,
	    mediaProcesses: extensionMediaProcesses,
	    mediaJobs: extensionMediaJobs,
	    audioAnalysisJobs: extensionAudioAnalysisJobs,
	    visualAnalysis: extensionVisualAnalysis,
	    archiveJobs: extensionMediaArchiveJobs,
	    jobs: extensionJobs,
	    invokeExtension: (extensionId, activationEvent, method, params, invokeOptions) =>
	      extensionManager.invoke(extensionId, activationEvent, method, params, invokeOptions),
	    notifyExtension: (principal, method, params) =>
	      extensionManager.notify(principal.extensionId, method, params, {
	        workspaceRoots: [...principal.workspaceRoots]
	      }),
	    notifyView: (input) => extensionViewSessions.publishBridgeNotification(input),
	    resolveManifest: resolveExtensionManifest,
	    onUiRequest: extensionViewSessions.onUiRequest,
	    authorizeSecretReveal: (input) => extensionSecretReveals.authorize(input)
	  })
	  extensionViewSessions.onDidDispose((sessionId) => {
	    extensionBroker.disposeViewSession(sessionId)
	  })
	  extensionViewSessions.onDidLifecycle(({ state, session }) => {
	    if (state === 'created') {
	      extensionViewHostGenerations.register(
	        session.sessionId,
	        session.extensionId,
	        session.workspaceRoot,
	        extensionManager.activeHostGeneration(session.extensionId, {
	          ...(session.workspaceRoot ? { workspaceRoot: session.workspaceRoot } : {})
	        })
	      )
	      extensionManager.retainView(session.extensionId, {
	        ...(session.workspaceRoot ? { workspaceRoot: session.workspaceRoot } : {})
	      })
	    } else {
	      extensionViewHostGenerations.unregister(session.sessionId)
	      extensionManager.releaseView(session.extensionId, {
	        ...(session.workspaceRoot ? { workspaceRoot: session.workspaceRoot } : {})
	      })
	    }
	  })
	  extensionConfiguration.onDidChange(async (change) => {
	    const event = {
	      sectionId: change.sectionId,
	      key: change.key,
	      scope: change.scope,
	      value: change.value
	    }
	    const deliveryScope = change.scope === 'workspace'
	      ? { workspaceKey: change.workspaceKey }
	      : undefined
	    await extensionManager.notify(
	      change.extensionId,
	      'configuration.changed',
	      event,
	      deliveryScope
	    ).catch(() => undefined)
	    extensionViewSessions.publish(change.extensionId, 'bridge', {
	      method: 'configuration.changed',
	      params: event
	    }, deliveryScope)
	  })
	  const extensionStateMigrations = new ExtensionStateMigrationCoordinator(
	    extensionState,
	    extensionManager,
	    extensionRegistry
	  )
	  const extensionLifecycle = extensionStateMigrations.lifecycle()
	  extensionPackageManager.setLifecycle({
	    runVersionSwitch: async (context, commitSelection) => {
	      await extensionJobs.handleExtensionRollback(context.extensionId)
	      await extensionMediaHandles.revokeExtension(context.extensionId)
	      extensionViewSessions.disposeExtension(context.extensionId)
	      await extensionBroker.disposeExtension(context.extensionId)
	      if (extensionLifecycle.runVersionSwitch === undefined) {
	        throw new Error('Extension version switch transaction coordinator is unavailable')
	      }
	      await extensionLifecycle.runVersionSwitch(context, commitSelection)
	    },
	    recoverVersionSwitch: (extensionId) =>
	      extensionLifecycle.recoverVersionSwitch?.(extensionId) ?? Promise.resolve(),
	    recoverVersionSwitches: () =>
	      extensionLifecycle.recoverVersionSwitches?.() ?? Promise.resolve(),
	    beforeDisable: async (extensionId, workspaceKey, workspaceRoot) => {
	      if (workspaceKey === undefined) {
	        await extensionJobs.handleExtensionDisabled(extensionId)
	        await extensionMediaHandles.revokeExtension(extensionId)
	      } else {
	        await extensionJobs.handleWorkspaceRevoked(extensionId, workspaceKey)
	        await extensionMediaHandles.revokeExtensionWorkspace(
	          extensionId,
	          workspaceKey,
	          workspaceRoot
	        )
	      }
	      await extensionLifecycle.beforeDisable?.(extensionId, workspaceKey)
	      if (workspaceKey === undefined) {
	        extensionViewSessions.disposeExtension(extensionId)
	        await extensionBroker.disposeExtension(extensionId)
	      } else {
	        extensionViewSessions.disposeExtensionWorkspace(extensionId, workspaceKey)
	        await extensionBroker.disposeExtensionWorkspace(extensionId, workspaceKey)
	      }
	    },
	    beforePermissionChange: async (extensionId, workspaceKey, workspaceRoot) => {
	      await extensionJobs.handleWorkspaceRevoked(extensionId, workspaceKey)
	      await extensionMediaHandles.revokeExtensionWorkspace(
	        extensionId,
	        workspaceKey,
	        workspaceRoot
	      )
	      extensionViewSessions.disposeExtensionWorkspace(extensionId, workspaceKey)
	      await extensionManager.deactivateWorkspace(extensionId, workspaceKey)
	      await extensionBroker.disposeExtensionWorkspace(extensionId, workspaceKey)
	    },
	    beforeUninstall: async (extensionId) => {
	      await extensionJobs.handleExtensionUninstalled(extensionId)
	      await extensionMediaHandles.revokeExtension(extensionId)
	      await extensionLifecycle.beforeUninstall?.(extensionId)
	      extensionViewSessions.disposeExtension(extensionId)
	      await extensionBroker.disposeExtension(extensionId)
	    }
	  })
	  await extensionPackageManager.recover()
	  let bundledSeedResults: BundledExtensionSeedResult[] = []
	  await extensionJobs.initialize()
	  if (activeOptions.bundledExtensionsDir) {
	    try {
	      const bundledResults = await seedBundledExtensions({
	        directory: activeOptions.bundledExtensionsDir,
	        packageManager: extensionPackageManager
	      })
	      bundledSeedResults = bundledResults
	      for (const result of bundledResults) {
	        if (result.outcome === 'unchanged') continue
	        const suffix = result.code ? ` (${result.code})` : ''
	        const message = `[extensions] bundled ${result.extensionId}@${result.version}: ${result.outcome}${suffix}`
	        if (result.outcome === 'failed' || result.outcome.startsWith('skipped-')) {
	          console.warn(message)
	        } else {
	          console.info(message)
	        }
	      }
	    } catch (error) {
	      const message = error instanceof Error ? error.message : 'unknown bundled extension error'
	      console.warn(`[extensions] bundled catalog unavailable: ${message}`)
	    }
	  }
	  const extensionIndexClient = new ExtensionIndexClient()
	  const activateDeclaredHeadlessContributions = async (
	    document: Awaited<ReturnType<ExtensionRegistry['read']>>,
	    context?: ToolHostContext
	  ): Promise<boolean> => {
	    const outcomes = await Promise.allSettled(Object.values(document.extensions).map(async (entry) => {
	      const workspaceRoot = context?.workspace && isAbsolute(context.workspace)
	        ? context.workspace
	        : undefined
	      const workspaceKey = workspaceRoot
	        ? extensionPaths.workspaceKey(workspaceRoot)
	        : undefined
	      const enabled = workspaceKey && workspaceKey in entry.workspaceEnablement
	        ? entry.workspaceEnablement[workspaceKey]
	        : entry.globallyEnabled
	      if (!enabled) return
	      const manifest = entry.useDevelopment
	        ? entry.development?.manifest
	        : entry.selectedVersion ? entry.versions[entry.selectedVersion]?.manifest : undefined
	      if (!manifest?.main) return
	      const declaredHeadlessEvents = [
	        ...manifest.contributes.tools.map(({ id }) => `onTool:${id}`),
	        ...manifest.contributes.modelProviders.map(({ id }) => `onProvider:${id}`),
	        ...manifest.contributes.agentProfiles.map(({ id }) => `onAgentProfile:${id}`)
	      ]
	      const event = declaredHeadlessEvents.find((candidate) =>
	        manifest.activationEvents.includes(candidate)
	      ) ?? (manifest.activationEvents.includes('onStartup') ? 'onStartup' : undefined)
	      if (event) await extensionManager.activate(entry.id, event, {
	        ...(workspaceRoot
	          ? {
	              workspaceRoot,
	              workspaceContext: {
	                id: workspaceKey!,
	                name: basename(workspaceRoot) || workspaceRoot,
	                root: workspaceRoot,
	                trusted: true,
	                active: true
	              }
	            }
	          : {})
	      })
	    }))
	    return outcomes.every((outcome) => outcome.status === 'fulfilled')
	  }
	  prepareExtensionContributions = async (context) => {
	    const key = context?.workspace ?? '__global__'
	    const document = await extensionRegistry.read()
	    const existing = extensionPreparations.get(key)
	    if (existing?.revision === document.revision) return existing.promise
	    let record!: { revision: number; promise: Promise<void> }
	    const promise = activateDeclaredHeadlessContributions(document, context)
	      .then((allSucceeded) => {
	        // A partially failed activation is deliberately not sticky. The
	        // manager's bounded restart backoff controls retries per extension.
	        if (!allSucceeded && extensionPreparations.get(key) === record) {
	          extensionPreparations.delete(key)
	        }
	      })
	      .catch((error) => {
	        if (extensionPreparations.get(key) === record) extensionPreparations.delete(key)
	        throw error
	      })
	    record = { revision: document.revision, promise }
	    extensionPreparations.set(key, record)
	    return promise
	  }
	  backgroundShellRuntime.bindAgentLoop({
	    runTurn: runAgentTurn
	  })
	  delegationRuntime?.bindAgentLoop({
	    runTurn: runAgentTurn
	  })
	  const startedAt = activeOptions.startedAt ?? nowIso()
	  const rebuildCapabilities = (): typeof capabilities => buildRuntimeCapabilityManifest({
	    config: activeOptions.capabilities,
	    model: modelCapabilities(activeOptions.model),
	    mcp: {
	      configuredServers: Object.keys(activeOptions.capabilities?.mcp.servers ?? {}).length,
	      connectedServers: mcpProviders.connectedServers,
	      toolCount: mcpProviders.toolCount,
	      lastError: mcpProviders.diagnostics.find((diagnostic) => diagnostic.lastError)?.lastError,
	      search: {
	        active: mcpProviders.search.active,
	        indexedToolCount: mcpProviders.search.indexedToolCount,
	        advertisedToolCount: mcpProviders.search.advertisedToolCount
	      }
	    },
	    web: {
	      fetchAvailable: webProviders.fetchAvailable,
	      searchAvailable: webProviders.searchAvailable,
	      provider: webProviders.provider,
	      reason: webProviders.diagnostics.find((diagnostic) => diagnostic.reason)?.reason
	    },
	    skills: {
	      configuredRoots: activeOptions.capabilities?.skills.roots.length,
	      discoveredSkills: skillRuntime.count(),
	      reason: skillRuntime.diagnostics().validationErrors[0]?.message
	    },
	    instructions: {
	      available: instructionRuntime.enabled(),
	      lastSourceCount: instructionRuntime.diagnostics().lastInjection?.sources.length ?? 0,
	      lastInjectedBytes: instructionRuntime.diagnostics().lastInjection?.injectedBytes ?? 0
	    },
	    attachments: {
	      available: Boolean(attachmentStore)
	    },
	    memory: {
	      available: Boolean(memoryStore)
	    },
	    subagents: {
	      available: Boolean(delegationRuntime?.enabled())
	    },
	    imageGen: {
	      available: imageGenProviders.available,
	      reason: imageGenProviders.diagnostics.find((diagnostic) => diagnostic.reason)?.reason
	    },
	    speechGen: {
	      available: speechGenProviders.available,
	      reason: speechGenProviders.diagnostics.find((diagnostic) => diagnostic.reason)?.reason
	    },
	    musicGen: {
	      available: musicGenProviders.available,
	      reason: musicGenProviders.diagnostics.find((diagnostic) => diagnostic.reason)?.reason
	    },
	    videoGen: {
	      available: videoGenProviders.available,
	      reason: videoGenProviders.diagnostics.find((diagnostic) => diagnostic.reason)?.reason
	    },
	    computerUse: {
	      available: computerUseProviders.available,
	      reason: computerUseProviders.diagnostics.find((diagnostic) => diagnostic.reason)?.reason
	    },
	    browserUse: {
	      available: browserUseProviders.available,
	      interactionRequired: browserUseProviders.interactionRequired,
	      reason: browserUseProviders.reason
	    }
	  })
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
	    if (nextOptions.localModelGateway?.enabled && !isLoopbackHost(nextOptions.host)) {
	      return {
	        ok: false,
	        code: 'invalid_config',
	        message: 'unauthenticated local model gateway requires a loopback serve host'
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
	      SkillRuntime.create(nextOptions.capabilities?.skills)
	    ])
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
	      resolveCredential: resolveCapabilityProviderCredential
	    })
	    const nextSpeechGenProviders = buildSpeechGenToolProviders(nextOptions.capabilities?.speechGen, {
	      nowIso,
	      resolveCredential: resolveCapabilityProviderCredential
	    })
	    const nextMusicGenProviders = buildMusicGenToolProviders(nextOptions.capabilities?.musicGen, {
	      nowIso,
	      resolveCredential: resolveCapabilityProviderCredential
	    })
	    const nextVideoGenProviders = buildVideoGenToolProviders(nextOptions.capabilities?.videoGen, {
	      nowIso,
	      resolveCredential: resolveCapabilityProviderCredential
	    })
	    const nextComputerUseProviders = await buildComputerUseToolProviders(nextOptions.capabilities?.computerUse)
	    const nextBrowserUseProviders = buildBrowserUseToolProviders(nextOptions.capabilities?.browserUse)
	    const nextPptMasterProvider = {
	      id: 'ppt-master',
	      kind: 'skill' as const,
	      enabled: true,
	      available: true,
	      tools: buildPptMasterLocalTools()
	    }
	    const nextResolvedHooks = [
	      ...buildBuiltinHooks({ quality: nextOptions.quality ?? DEFAULT_QUALITY_CONFIG }),
	      ...resolveConfiguredHooks(nextOptions.hooks)
	    ]
	    const nextOfficeCliProviders = buildOfficeCliToolProviders({
	      binaryPath: process.env.KUN_OFFICECLI_BINARY,
	      profileDir: join(nextOptions.dataDir, 'officecli-profile')
	    })
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
	      ...buildSkillToolProviders(nextSkillRuntime),
	      ...nextImageGenProviders.providers,
	      ...nextSpeechGenProviders.providers,
	      ...nextMusicGenProviders.providers,
	      ...nextVideoGenProviders.providers,
	      ...nextOfficeCliProviders,
	      nextPptMasterProvider,
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
	      ...buildDelegationToolProviders(delegationRuntime, subagentRouter),
	      ...buildComponentDesignToolProviders(delegationRuntime)
	    ])

	    // Import provider catalogs for rolling GUI compatibility, but preserve
	    // the registry-owned default. Current GUI/TUI clients use revisioned
	    // registry writes directly; this path only adds/reconciles catalogs.
	    const registryBeforeApply = await modelConnections.snapshot()
	    await modelConnections.initialize(modelConnectionSeedsForOptions(nextOptions))
	    if (registryBeforeApply.providers.length === 0 && request.modelSelection) {
	      await modelConnections.synchronizeDefaultSelection(request.modelSelection)
	    }
	    const materializedConnections = await modelConnections.materialize()
	    if (materializedConnections.providers.size > 0) {
	      const selected = materializedConnections.selected
	      nextOptions = {
	        ...nextOptions,
	        ...(selected
	          ? {
	              model: selected.model,
	              apiKey: selected.config.apiKey,
	              credentialSourceId: selected.config.credentialSourceId,
	              baseUrl: selected.config.baseUrl ?? nextOptions.baseUrl,
	              endpointFormat: selected.config.endpointFormat ?? nextOptions.endpointFormat,
	              headers: selected.config.headers,
	              geminiAuth: selected.config.geminiAuth
	            }
	          : {}),
	        providers: Object.fromEntries(materializedConnections.providers.entries()),
	        modelProxyUrl: materializedConnections.proxy.enabled
	          ? materializedConnections.proxy.url
	          : undefined,
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
	    const previousMcpProviders = mcpProviders
	    activeOptions = nextOptions
	    await graphRuntime.reconfigureBackgroundServices()
	    modelProfiles = nextModelProfiles
	    providerModelProfiles = nextProviderModelProfiles
	    tokenEconomy = nextTokenEconomy
	    refreshDelegatedProviderIds()
	    directModelClient.replace(nextModelClients)
	    approvalReviewModelClient.replace(
	      buildApprovalReviewClients(activeOptions, nextModelClients)
	    )
	    modelClient.replacePools(activeOptions.routePools ?? [])
	    if (delegationRuntime && activeOptions.capabilities?.subagents) {
	      delegationRuntime.replaceConfig(mergeBuiltinSubagentProfiles(activeOptions.capabilities.subagents))
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
	    resolvedHooks = nextResolvedHooks
	    baseToolProviders = nextBaseToolProviders
	    childRegistry = nextChildRegistry
	    registry = nextRegistry
	    extensionTools.rebindRegistry(registry)
	    childToolHost.replaceRuntimeComponents({ registry: childRegistry, hooks: resolvedHooks })
	    toolHost.replaceRuntimeComponents({ registry, hooks: resolvedHooks })
	    sdkRuntime.replace(nextDelegatedRuntime)
	    turnService.updateRuntimeConfig({
	      defaultModel: activeOptions.model,
	      contextCompaction: activeOptions.contextCompaction,
	      model: timedModelClient,
	      maxConcurrentTurns: activeOptions.runtime?.turnLimits?.maxConcurrentTurns
	    })
	    extensionAgent.updateRuntimeConfig({
	      defaultBinding: { providerId: 'default', modelId: activeOptions.model }
	    })
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
	    capabilities = rebuildCapabilities()
	    void mcpProviders.startBackgroundReconnect((provider) => {
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
	    })
	    void previousMcpProviders.close().catch(() => undefined)
	    stagedGenerationCommitted = true
	    return { ok: true }
	    } catch (error) {
	      return {
	        ok: false,
	        code: 'invalid_config',
	        message: error instanceof Error ? error.message : String(error)
	      }
	    } finally {
	      if (!stagedGenerationCommitted) {
	        await nextMcpProviders.close().catch(() => undefined)
	      }
	    }
	  }
  return {
    threadService,
    turnService,
    toolCancellationService,
    reviewService,
    usageService,
    eventBus,
    sessionStore,
    events,
    eventStreamRegistry,
    llmDebug,
    liveCounters: () => ({
      inflight: inflight.size(),
      activeCaptures: llmDebug?.activeCaptureCount ?? 0
    }),
    approvalGate,
	    userInputGate,
	    workspaceInspector,
	    toolHost,
	    get attachmentStore() {
	      return attachmentStore
	    },
	    get memoryStore() {
	      return memoryStore
	    },
	    migrationService,
	    migrationImportService,
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
	      enabled: () => activeOptions.localModelGateway?.enabled === true,
	      pools: () => modelClient.routePools(),
	      health: routeHealth,
	      tests: routePoolTests
	    },
	    modelConnections,
	    modelConnectionOAuth,
	    officialProviderAuth,
	    providerQuotaService,
	    get defaultModel() {
	      return activeOptions.model
	    },
	    get roles() {
	      return activeOptions.roles
	    },
	    immutablePrefix: prefix,
    runTurn(threadId, turnId) {
      return runAgentTurn(threadId, turnId)
    },
    resumeInterruptedGoals(threadIds) {
      return loop.resumeInterruptedGoals(threadIds)
    },
    runReview(input) {
      return runReview(input)
	    },
	    runtimeToken: activeOptions.runtimeToken,
	    insecure: activeOptions.insecure,
	    ...(options.serviceManager
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
	        instanceId: activeOptions.instanceId ?? 'embedded',
	        serviceVersion: KUN_SERVICE_VERSION,
	        ...(activeOptions.buildId ? { buildId: activeOptions.buildId } : {}),
	        launchMode: activeOptions.launchMode ?? 'foreground',
	        host: activeOptions.host,
	        port: activeOptions.port,
	        configPath: activeOptions.configPath,
	        dataDir: activeOptions.dataDir,
	        model: activeOptions.model,
	        endpointFormat: activeOptions.endpointFormat ?? DEFAULT_MODEL_ENDPOINT_FORMAT,
	        approvalPolicy: activeOptions.approvalPolicy,
	        sandboxMode: activeOptions.sandboxMode,
	        approvalReviewer:
	          activeOptions.approvalReviewer ?? DEFAULT_APPROVAL_REVIEWER,
	        tokenEconomyMode: activeOptions.tokenEconomyMode,
	        insecure: activeOptions.insecure,
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
	      providers: registry.diagnostics(),
	      mcpServers: mcpProviders.diagnostics,
      mcpOAuth: mcpProviders.oauth,
      mcpSearch: mcpProviders.search,
      webProviders: webProviders.diagnostics,
      skills: skillRuntime.diagnostics(),
      instructions: instructionRuntime.diagnostics(),
      attachments: attachmentStore
        ? await attachmentStore.diagnostics()
        : { enabled: false, rootDir: '', count: 0, totalBytes: 0 },
      memory: memoryStore
        ? await memoryStore.diagnostics()
        : { enabled: false, rootDir: '', activeCount: 0, tombstoneCount: 0, lastInjectedIds: [] },
      imageGen: imageGenProviders.diagnostics,
      speechGen: speechGenProviders.diagnostics,
      musicGen: musicGenProviders.diagnostics,
	      videoGen: videoGenProviders.diagnostics,
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
    mcpOAuth: async () => mcpProviders.oauth,
    clearMcpOAuth: async (serverId) => mcpProviders.clearOAuthCredentials(serverId),
    authorizeMcpOAuth: async (serverId) => mcpProviders.authorizeOAuth(serverId),
    mcpConfig: () => structuredClone(
      (activeOptions.capabilities ?? DEFAULT_KUN_CAPABILITIES_CONFIG).mcp
    ),
    setMcpServer: async (serverId, server) => {
      const capabilities = activeOptions.capabilities ?? DEFAULT_KUN_CAPABILITIES_CONFIG
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
        const updatedMcp = (activeOptions.capabilities ?? DEFAULT_KUN_CAPABILITIES_CONFIG).mcp
        await Promise.all([
          persistRuntimeMcpConfig(activeOptions.dataDir, updatedMcp),
          ...(activeOptions.sharedMcpConfigPath
            ? [persistSharedMcpConfig(activeOptions.sharedMcpConfigPath, updatedMcp)]
            : [])
        ])
      }
      return result
    },
    skills: (workspace) => workspace
      ? skillRuntime.diagnosticsForWorkspace(workspace)
      : skillRuntime.diagnostics(),
    refreshSkills: async () => skillRuntime.refresh(),
    setSkillsEnabled: async (enabled) => {
      const capabilities = activeOptions.capabilities ?? DEFAULT_KUN_CAPABILITIES_CONFIG
      const result = await applyConfig({
        capabilities: {
          ...capabilities,
          skills: { ...capabilities.skills, enabled }
        }
      })
      if (result.ok) {
        await persistRuntimeSkillsConfig(
          activeOptions.dataDir,
          (activeOptions.capabilities ?? DEFAULT_KUN_CAPABILITIES_CONFIG).skills
        )
      }
      return result
    },
    setLocalCapabilityEnabled: async (id, enabled) => {
      const capabilities = activeOptions.capabilities ?? DEFAULT_KUN_CAPABILITIES_CONFIG
      const result = await applyConfig({
        capabilities: {
          ...capabilities,
          [id]: { ...capabilities[id], enabled }
        }
      })
      if (result.ok) {
        await persistRuntimeCapabilitySection(
          activeOptions.dataDir,
          id,
          (activeOptions.capabilities ?? DEFAULT_KUN_CAPABILITIES_CONFIG)[id]
        )
      }
      return result
    },
    shutdown: async () => {
      await settleCleanupSteps([
        async () => {
          try {
            shuttingDown = true
            executionLeases?.shutdown()
            clearInterval(attachmentPruneTimer)
	          await shutdownGraphExecutionForHost({
	            graphRuntime,
	            turnService
	          })
            modelConnectionOAuth.close()
            eventStreamRegistry.closeAll()
            loop.shutdownGoalResume()
	          await backgroundShellRuntime.shutdown()
	          await extensionJobs.handleRuntimeShutdown()
	          extensionMediaJobs.dispose()
	          extensionAudioAnalysisJobs.dispose()
	          extensionMediaArchiveJobs.dispose()
            await waitForActiveRuns(activeRuntimeRuns)
	          stopExtensionModelListener()
	          extensionViewSessions.disposeAll()
	          await extensionManager.shutdown()
	          await extensionBroker.dispose()
	          extensionSecretReveals.dispose()
	          await extensionAccountAudit.flush()
	          extensionTools.disposeAll()
	          await extensionModelProviders.disposeAll()
	          shutdownAllLspSessions()
	          await mcpProviders.close()
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
        async () => { await dataDirLease?.release() }
      ])
    }
  }
}

export async function shutdownGraphExecutionForHost(input: {
  graphRuntime: Pick<GraphRuntimeComposition, 'quiesceExecution' | 'stop'>
  turnService: Pick<TurnService, 'suspendActiveTurnsForShutdown'>
}): Promise<void> {
  // Scheduler shutdown owns the special non-consuming worker interruption
  // marker. Park source turns only after every active attempt has recorded it.
  await input.graphRuntime.quiesceExecution()
  await input.turnService.suspendActiveTurnsForShutdown()
  await input.graphRuntime.stop()
}

export async function resumeInterruptedGraphPlanning(input: {
  graphRuntime: Pick<GraphRuntimeComposition, 'drafts'>
  turnService: Pick<
    TurnService,
    'getTurn' | 'resumeGraphPlanningTurn'
  >
  runTurn: (threadId: string, turnId: string) => Promise<unknown> | void
}): Promise<number> {
  const drafts = await input.graphRuntime.drafts.list({
    statuses: ['planning', 'validating', 'repairing']
  })
  let resumed = 0
  for (const draft of drafts) {
    const source = await input.turnService.getTurn(draft.threadId, draft.sourceTurnId)
    if (
      source?.status !== 'running' ||
      source.orchestration !== 'graph'
    ) continue
    try {
      const outcome = await input.turnService.resumeGraphPlanningTurn({
        threadId: draft.threadId,
        turnId: draft.sourceTurnId
      })
      if (outcome !== 'resumed') continue
      resumed += 1
      void Promise.resolve(input.runTurn(draft.threadId, draft.sourceTurnId))
        .catch((error) => {
          console.warn(
            `[kun] restarted Graph planning turn ${draft.sourceTurnId} failed: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
        })
    } catch (error) {
      console.warn(
        `[kun] could not resume Graph planning draft ${draft.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }
  return resumed
}

async function waitForActiveRuns(
  runs: ReadonlySet<Promise<unknown>>,
  timeoutMs = 5_000
): Promise<void> {
  const pending = [...runs]
  if (pending.length === 0) return
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.allSettled(pending),
      new Promise<void>((resolve) => { timeout = setTimeout(resolve, timeoutMs) })
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function hydrateLegacyCredentialOptions(
  options: KunServeRuntimeOptions,
  migration: LegacyProviderCredentialMigrationService
): Promise<KunServeRuntimeOptions> {
  let apiKey = options.apiKey
  let headers = options.headers
  let geminiAuth = options.geminiAuth
  if (options.credentialSourceId) {
    const resolved = await migration.resolveApiKey(options.credentialSourceId).catch(() => null)
    if (resolved) {
      const material = materializeLegacyProviderCredential(resolved.apiKey)
      apiKey = material.apiKey
      geminiAuth = material.geminiAuth ?? geminiAuth
      headers = material.headers
        ? { ...(headers ?? {}), ...material.headers }
        : headers
    }
  }

  const providers: Record<string, ServeProviderConfig> = {}
  for (const [providerId, provider] of Object.entries(options.providers ?? {})) {
    let nextProvider = provider
    if (provider.credentialSourceId) {
      const resolved = await migration.resolveApiKey(provider.credentialSourceId).catch(() => null)
      if (resolved) {
        const material = materializeLegacyProviderCredential(resolved.apiKey)
        nextProvider = {
          ...provider,
          apiKey: material.apiKey,
          ...(material.geminiAuth ? { geminiAuth: material.geminiAuth } : {}),
          ...(material.headers
            ? { headers: { ...(provider.headers ?? {}), ...material.headers } }
            : {})
        }
      }
    }
    providers[providerId] = nextProvider
  }
  return {
    ...options,
    apiKey,
    ...(geminiAuth ? { geminiAuth } : {}),
    ...(headers ? { headers } : {}),
    ...(options.providers ? { providers } : {})
  }
}

function buildModelClientRouterInput(
  options: KunServeRuntimeOptions,
  modelCapabilities: (
    model: string,
    providerId?: string
  ) => ReturnType<typeof modelCapabilitiesForModel>,
  llmDebug?: LlmDebugRecorder,
  credentialResolver?: (
    sourceId: string,
    rejectedAccessToken?: string
  ) => Promise<{
    apiKey: string
    headers?: Record<string, string>
    geminiAuth?: GeminiCodeAssistCredential
    refreshable: boolean
  }>
): { default: ModelClient; providers: Map<string, ModelClient> } {
  const streamIdleOverride =
    options.runtime?.streamIdleTimeoutMs !== undefined
      ? { streamIdleTimeoutMs: options.runtime.streamIdleTimeoutMs }
      : {}
  const activeProviderId = activeModelConnectionProviderId(options)
  const activeProvider = options.providers?.[activeProviderId]
  const defaultModelCapabilities = providerScopedModelCapabilities(
    activeProviderId,
    activeProvider,
    modelCapabilities
  )
  const defaultClient: ModelClient =
    process.env.KUN_RUNTIME_PROVIDER_KIND === 'gemini-code-assist'
      ? new GeminiCodeAssistModelClient({
          baseUrl: options.baseUrl,
          auth: options.geminiAuth,
          ...(options.credentialSourceId && credentialResolver
            ? {
                resolveAuth: async () =>
                  (await credentialResolver(options.credentialSourceId!)).geminiAuth ?? null
              }
            : {}),
          modelProxyUrl: options.modelProxyUrl,
          model: options.model,
          modelCapabilities: defaultModelCapabilities
        })
      : process.env.KUN_RUNTIME_PROVIDER_KIND === 'gemini-cli-api'
      ? new GeminiCliApiModelClient({
          model: options.model,
          modelProxyUrl: options.modelProxyUrl,
          retry: options.retry,
          ...(llmDebug ? { debugSink: llmDebug } : {})
        })
      : new CompatModelClient({
          baseUrl: options.baseUrl,
          apiKey: options.apiKey,
          modelProxyUrl: options.modelProxyUrl,
          endpointFormat: options.endpointFormat ?? DEFAULT_MODEL_ENDPOINT_FORMAT,
          retry: options.retry,
          model: options.model,
          modelCapabilities: defaultModelCapabilities,
          headers: options.headers,
          ...(options.credentialSourceId && credentialResolver
            ? {
                resolveCredentials: (rejectedAccessToken?: string) =>
                  credentialResolver(options.credentialSourceId!, rejectedAccessToken)
              }
            : {}),
          ...(llmDebug ? { debugSink: llmDebug } : {}),
          ...streamIdleOverride
        })
  const providerClients = new Map<string, ModelClient>()
  for (const [providerId, provider] of Object.entries(options.providers ?? {})) {
    const trimmedId = providerId.trim()
    if (!trimmedId) continue
    const kind = provider.kind ?? 'http'
    if (kind !== 'http' && kind !== 'gemini-cli-api' && kind !== 'gemini-code-assist') continue
    const scopedModelCapabilities = providerScopedModelCapabilities(
      trimmedId,
      provider,
      modelCapabilities
    )
    const client: ModelClient = kind === 'gemini-code-assist'
      ? new GeminiCodeAssistModelClient({
          baseUrl: provider.baseUrl ?? options.baseUrl,
          auth: provider.geminiAuth,
          ...(provider.credentialSourceId && credentialResolver
            ? {
                resolveAuth: async () =>
                  (await credentialResolver(provider.credentialSourceId!)).geminiAuth ?? null
              }
            : {}),
          modelProxyUrl: provider.modelProxyUrl ?? options.modelProxyUrl,
          model: options.model,
          modelCapabilities: scopedModelCapabilities
        })
      : kind === 'gemini-cli-api'
      ? new GeminiCliApiModelClient({
          model: options.model,
          modelProxyUrl: provider.modelProxyUrl ?? options.modelProxyUrl,
          retry: provider.retry ?? options.retry,
          ...(llmDebug ? { debugSink: llmDebug } : {})
        })
      : new CompatModelClient({
          baseUrl: provider.baseUrl ?? options.baseUrl ?? '',
          apiKey: provider.apiKey,
          modelProxyUrl: provider.modelProxyUrl ?? options.modelProxyUrl,
          endpointFormat: provider.endpointFormat ?? options.endpointFormat ?? DEFAULT_MODEL_ENDPOINT_FORMAT,
          retry: provider.retry ?? options.retry,
          model: options.model,
          modelCapabilities: scopedModelCapabilities,
          headers: provider.headers,
          ...(provider.credentialSourceId && credentialResolver
            ? {
                resolveCredentials: (rejectedAccessToken?: string) =>
                  credentialResolver(provider.credentialSourceId!, rejectedAccessToken)
              }
            : {}),
          ...(llmDebug ? { debugSink: llmDebug } : {}),
          ...streamIdleOverride
        })
    providerClients.set(trimmedId, client)
  }
  return { default: defaultClient, providers: providerClients }
}

function modelContextProfilesByProvider(
  providers: KunServeRuntimeOptions['providers']
): Map<string, ReturnType<typeof modelContextProfilesFromConfig>> {
  const out = new Map<string, ReturnType<typeof modelContextProfilesFromConfig>>()
  for (const [providerId, provider] of Object.entries(providers ?? {})) {
    const normalized = providerId.trim().toLowerCase()
    if (!normalized) continue
    out.set(normalized, modelContextProfilesFromConfig({
      models: { profiles: provider.modelProfiles ?? {} }
    }))
  }
  return out
}

function providerScopedModelCapabilities(
  providerId: string,
  provider: ServeProviderConfig | undefined,
  fallback: (
    model: string,
    providerId?: string
  ) => ReturnType<typeof modelCapabilitiesForModel>
): (model: string) => ReturnType<typeof modelCapabilitiesForModel> {
  return (model) => {
    const explicit = provider?.modelCapabilities?.[model] ??
      provider?.modelCapabilities?.[model.trim().toLowerCase()]
    const providerFallback = modelCapabilitiesForProviderModel({
      providerId,
      presetSource: provider?.presetSource ?? providerId,
      baseUrl: provider?.baseUrl,
      kind: provider?.kind,
      model
    })
    if (explicit) {
      const reasoning = shouldUpgradeProviderReasoning(
        providerId,
        provider?.endpointFormat,
        model,
        explicit.reasoning,
        providerFallback.reasoning
      )
        ? providerFallback.reasoning
        : explicit.reasoning ?? providerFallback.reasoning
      return {
        ...explicit,
        id: model,
        ...(reasoning ? { reasoning } : {}),
        ...(explicit.serviceTiers ?? providerFallback.serviceTiers
          ? { serviceTiers: [...(explicit.serviceTiers ?? providerFallback.serviceTiers ?? [])] }
          : {})
      }
    }
    const base = fallback(model, providerId)
    return {
      ...base,
      ...(providerFallback.reasoning ? { reasoning: providerFallback.reasoning } : {}),
      ...(providerFallback.serviceTiers
        ? { serviceTiers: [...providerFallback.serviceTiers] }
        : {})
    }
  }
}

function shouldUpgradeProviderReasoning(
  providerId: string,
  endpointFormat: ModelEndpointFormat | undefined,
  model: string,
  configured: ReturnType<typeof modelCapabilitiesForModel>['reasoning'],
  fallback: ReturnType<typeof modelCapabilitiesForModel>['reasoning']
): boolean {
  if (!configured || !fallback) return false
  const placeholder = configured.requestProtocol === 'none' &&
    fallback.requestProtocol !== 'none' &&
    configured.defaultEffort === 'auto' &&
    configured.supportedEfforts.every((effort) => effort === 'auto' || effort === 'off')
  const chatResponsesMismatch =
    endpointFormat === 'chat_completions' &&
    configured.requestProtocol === 'openai-responses' &&
    fallback.requestProtocol === 'openai-chat-completions' &&
    (
      (providerId.toLowerCase().includes('kimi-code') && model.trim().toLowerCase() === 'k3') ||
      (providerId.toLowerCase().includes('opencode-go') &&
        model.trim().toLowerCase().endsWith('grok-4.5'))
    )
  return placeholder || chatResponsesMismatch
}

function agentSdkProviderIdsForOptions(options: KunServeRuntimeOptions): Set<string> {
  const out = new Set<string>()
  for (const [providerId, provider] of Object.entries(options.providers ?? {})) {
    const trimmedId = providerId.trim()
    if (trimmedId && (provider.kind ?? 'http') === 'agent-sdk') out.add(trimmedId)
  }
  return out
}

function antigravityProviderIdsForOptions(options: KunServeRuntimeOptions): Set<string> {
  const out = new Set<string>()
  for (const [providerId, provider] of Object.entries(options.providers ?? {})) {
    const trimmedId = providerId.trim()
    if (trimmedId && (provider.kind ?? 'http') === 'antigravity-cli') out.add(trimmedId)
  }
  return out
}

function cursorSdkProviderIdsForOptions(options: KunServeRuntimeOptions): Set<string> {
  const out = new Set<string>()
  for (const [providerId, provider] of Object.entries(options.providers ?? {})) {
    const trimmedId = providerId.trim()
    if (trimmedId && (provider.kind ?? 'http') === 'cursor-sdk') out.add(trimmedId)
  }
  return out
}

function approvalReviewNativeProviderKind(
  value: string | undefined
): 'agent-sdk' | 'cursor-sdk' | 'antigravity-cli' | undefined {
  return value === 'agent-sdk' || value === 'cursor-sdk' || value === 'antigravity-cli'
    ? value
    : undefined
}

function mergeRuntimeConfigApplyOptions(
  current: KunServeRuntimeOptions,
  request: RuntimeConfigApplyRequest
): KunServeRuntimeOptions {
  const serve = request.serve ?? {}
  return {
    ...current,
    apiKey: serve.apiKey ?? current.apiKey,
    credentialSourceId: serve.credentialSourceId ?? current.credentialSourceId,
    baseUrl: serve.baseUrl ?? current.baseUrl,
    modelProxyUrl: serve.modelProxyUrl ?? current.modelProxyUrl,
    endpointFormat: serve.endpointFormat ?? current.endpointFormat,
    retry: serve.retry ?? current.retry,
    headers: serve.headers ?? current.headers,
    providers: serve.providers ?? current.providers,
    routePools: serve.routePools ?? current.routePools,
    localModelGateway: serve.localModelGateway ?? current.localModelGateway,
    model: serve.model ?? current.model,
    approvalPolicy: serve.approvalPolicy ?? current.approvalPolicy,
    sandboxMode: serve.sandboxMode ?? current.sandboxMode,
    approvalReviewer: serve.approvalReviewer ?? current.approvalReviewer,
    tokenEconomyMode: serve.tokenEconomyMode ?? current.tokenEconomyMode,
    tokenEconomy: serve.tokenEconomy ?? current.tokenEconomy,
    toolOutputLimits: serve.toolOutputLimits ?? current.toolOutputLimits,
    models: request.models ?? current.models,
    contextCompaction: request.contextCompaction ?? current.contextCompaction,
    runtime: request.runtime ?? current.runtime,
    graph: request.graph ?? current.graph,
    roles: request.roles ?? current.roles,
    capabilities: request.capabilities ?? current.capabilities,
    hooks: request.hooks ?? current.hooks,
    quality: request.quality ?? current.quality,
    lab: request.lab ?? current.lab
  }
}

function llmDebugCaptureEnabled(
  options: Pick<KunServeRuntimeOptions, 'runtime'>
): boolean {
  return options.runtime?.llmDebug?.enabled !== false
}

function modelRequestCaptureDefaultEnabled(
  options: Pick<KunServeRuntimeOptions, 'runtime'>
): boolean {
  return options.runtime?.llmDebug?.defaultThreadCaptureEnabled === true
}

async function persistRuntimeMcpConfig(
  dataDir: string,
  mcp: KunCapabilitiesConfig['mcp']
): Promise<void> {
  const target = join(dataDir, 'config.json')
  await updateRuntimeJson(target, (current) => ({
    ...current,
    capabilities: {
      ...objectSection(current.capabilities),
      mcp
    }
  }))
}

async function persistRuntimeSkillsConfig(
  dataDir: string,
  skills: KunCapabilitiesConfig['skills']
): Promise<void> {
  const target = join(dataDir, 'config.json')
  await updateRuntimeJson(target, (current) => ({
    ...current,
    capabilities: { ...objectSection(current.capabilities), skills }
  }))
}

async function persistRuntimeCapabilitySection(
  dataDir: string,
  id: 'attachments' | 'memory',
  value: KunCapabilitiesConfig[typeof id]
): Promise<void> {
  const target = join(dataDir, 'config.json')
  await updateRuntimeJson(target, (current) => ({
    ...current,
    capabilities: { ...objectSection(current.capabilities), [id]: value }
  }))
}

async function persistSharedMcpConfig(
  target: string,
  mcp: KunCapabilitiesConfig['mcp']
): Promise<void> {
  await updateRuntimeJson(target, (current) => ({
    ...current,
    servers: structuredClone(mcp.servers)
  }))
}

async function updateRuntimeJson(
  path: string,
  mutate: (current: Record<string, unknown>) => Record<string, unknown>
): Promise<void> {
  const file = new AtomicJsonFile(path, (value) => objectSection(value))
  await file.update(() => ({}), mutate)
}

function objectSection(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function tokenEconomyConfigForOptions(
  options: Pick<KunServeRuntimeOptions, 'tokenEconomyMode' | 'tokenEconomy'>
): TokenEconomyConfig {
  return {
    ...(options.tokenEconomy ?? {}),
    enabled: options.tokenEconomy?.enabled ?? options.tokenEconomyMode
  }
}

function toolOutputLimitsForOptions(
  options: Pick<KunServeRuntimeOptions, 'toolOutputLimits'>
): Required<ToolOutputLimitsConfig> {
  return {
    maxLines: Math.max(
      1,
      Math.floor(options.toolOutputLimits?.maxLines ?? DEFAULT_TOOL_OUTPUT_LIMITS_CONFIG.maxLines)
    ),
    maxBytes: Math.max(
      1,
      Math.floor(options.toolOutputLimits?.maxBytes ?? DEFAULT_TOOL_OUTPUT_LIMITS_CONFIG.maxBytes)
    )
  }
}

function builtinToolOptionsForOptions(options: KunServeRuntimeOptions) {
  const outputLimits = toolOutputLimitsForOptions(options)
  return {
    read: outputLimits,
    bash: outputLimits
  }
}

async function createPersistentStores(input: {
  dataDir: string
  storage?: StorageConfig
  nowIso: () => string
  serviceManager?: ServiceManagerConnection
}): Promise<{ threadStore: ThreadStore; sessionStore: SessionStore; shutdown?: () => Promise<void> }> {
  if (input.serviceManager) return createManagerRemoteStores(input.serviceManager)
  const storage = input.storage ?? DEFAULT_STORAGE_CONFIG
  if (storage.backend === 'file') {
    return {
      sessionStore: new FileSessionStore({ dataDir: input.dataDir }),
      threadStore: new FileThreadStore({ dataDir: input.dataDir })
    }
  }

  const threadStore = new HybridThreadStore({
    dataDir: input.dataDir,
    sqlitePath: storage.sqlitePath ? expandHomePath(storage.sqlitePath) : undefined,
    nowIso: input.nowIso
  })
  await threadStore.ready()
  return {
    threadStore,
    sessionStore: new HybridSessionStore({
      dataDir: input.dataDir,
      index: threadStore
    }),
    shutdown: async () => {
      await threadStore.shutdown()
    }
  }
}

export async function seedUsageCarryover(input: {
  threadStore: ThreadStore
  sessionStore: SessionStore
  usageService: UsageService
}): Promise<void> {
  if (typeof input.sessionStore.loadLatestUsageSnapshots === 'function') {
    try {
      const latest = await input.sessionStore.loadLatestUsageSnapshots()
      for (const record of latest) {
        input.usageService.seedThread(record.threadId, record.usage)
      }
      return
    } catch {
      // Fall through to JSONL replay when the optional index is unavailable.
    }
  }
  const threadSummaries = await input.threadStore.list()
  await Promise.all(threadSummaries.map(async (thread) => {
    const events = await input.sessionStore.loadEventsSince(thread.id, 0)
    const latestUsage = events.reduce<UsageEvent | null>((latest, event) => {
      if (event.kind !== 'usage') return latest
      if (!latest || event.seq > latest.seq) return event
      return latest
    }, null)
    if (latestUsage) input.usageService.seedThread(thread.id, latestUsage.usage)
  }))
}

export async function startKunServe(
  options: KunServeRuntimeOptions
): Promise<KunServeHandle> {
  if (options.insecure && !isLoopbackHost(options.host)) {
    throw new Error('insecure serve requires a loopback host')
  }
  // Generate this once so the authenticated live-info endpoint and the
  // discovery rendezvous identify the exact same process incarnation.
  const startedAt = options.startedAt ?? new Date().toISOString()
  const instanceId = options.instanceId ?? randomUUID()
  process.env.KUN_RUNTIME_INSTANCE_ID = instanceId
  const serveOptions = { ...options, startedAt, instanceId }
  // The composition owns the writer lease for all local stores. Keeping lease
  // ownership below the HTTP layer also covers direct CLI runtimes and avoids
  // a second claim for serve mode.
  const runtime = await createKunServeRuntime(serveOptions)
  let requestShutdown!: () => void
  const shutdownRequested = new Promise<void>((resolve) => { requestShutdown = resolve })
  runtime.requestShutdown = async (requestedInstanceId) => {
    if (requestedInstanceId !== instanceId) return false
    const timer = setTimeout(requestShutdown, 25)
    timer.unref?.()
    return true
  }
  const router = buildRouter(runtime)
  let server: NodeHttpServerHandle
  try {
    server = await startNodeHttpServer({
      router,
      host: options.host,
      port: options.port,
      ...(options.faultInjection ? { faultInjection: options.faultInjection } : {})
    })
  } catch (error) {
    await runtime.shutdown?.().catch(() => undefined)
    throw error
  }
  let discovery: Awaited<ReturnType<typeof publishRuntimeDiscovery>>
  const runtimeFlavor = options.runtimeFlavor ?? 'production'
  let registeredWithManager = false
  try {
    if (options.serviceManager) {
      await registerRuntimeWithManager({
        manager: options.serviceManager,
        registration: {
          flavor: runtimeFlavor,
          instanceId,
          pid: process.pid,
          startedAt,
          host: server.host,
          port: server.port,
          baseUrl: runtimeBaseUrl(server.host, server.port),
          runtimeToken: options.runtimeToken,
          ...(options.buildId ? { buildId: options.buildId } : {}),
          ...(options.logPath ? { logPath: options.logPath } : {})
        }
      })
      registeredWithManager = true
    }
    discovery = await publishRuntimeDiscovery(options.discoveryDir ?? options.dataDir, {
      pid: process.pid,
      startedAt,
      host: server.host,
      port: server.port,
      baseUrl: runtimeBaseUrl(server.host, server.port),
      runtimeToken: options.runtimeToken,
      insecure: options.insecure,
      serviceVersion: KUN_SERVICE_VERSION,
      ...(runtimeFlavor === 'development' ? { flavor: runtimeFlavor } : {}),
      ...(options.buildId ? { buildId: options.buildId } : {}),
      launchMode: options.launchMode ?? 'foreground',
      ...(options.logPath ? { logPath: options.logPath } : {}),
      instanceId
    })
  } catch (error) {
    await settleCleanupSteps([
      async () => {
        if (!registeredWithManager || !options.serviceManager) return
        try {
          await unregisterRuntimeWithManager({
            manager: options.serviceManager,
            flavor: runtimeFlavor,
            instanceId
          })
        } finally {
          registeredWithManager = false
        }
      },
      () => server.close(),
      async () => { await runtime.shutdown?.() }
    ]).catch(() => undefined)
    throw error
  }
  // Background sweep after listen: settle turns orphaned by a crash so
  // clients stop spinning on them, without delaying readiness. Then resume
  // goals that were interrupted mid-run so an active goal doesn't sit "in
  // progress" forever with nothing running (KunAgent/Kun#370).
  if (!options.serviceManager) void runtime.turnService
    .reconcileOrphanedTurns()
    .then(async (threadIds) => {
      if (threadIds.length > 0) {
        console.warn(`[kun] marked orphaned turn(s) on ${threadIds.length} thread(s) as failed after restart`)
      }
      if (threadIds.length > 0 && runtime.resumeInterruptedGoals) {
        const resumed = await runtime.resumeInterruptedGoals(threadIds)
        if (resumed > 0) {
          console.warn(`[kun] auto-resumed ${resumed} interrupted goal(s) after restart`)
        }
      }
    })
    .catch((error) => {
      console.warn('[kun] orphaned turn reconciliation failed:', error)
    })
  // Settle subagent (child-run) records left 'queued'/'running' by the previous
  // process, so a restart doesn't leave them stuck in-flight forever (#621).
  if (!options.serviceManager) void runtime.delegationRuntime
    ?.reconcileOrphanedChildRuns()
    .then((count) => {
      if (count > 0) {
        console.warn(`[kun] marked ${count} orphaned subagent run(s) as failed after restart`)
      }
    })
    .catch((error) => {
      console.warn('[kun] orphaned child-run reconciliation failed:', error)
    })
  return {
    ...server,
    runtime,
    instanceId,
    shutdownRequested,
    close: async () => {
      await settleCleanupSteps([
        async () => { await runtime.shutdown?.() },
        () => server.close(),
        async () => {
          if (!registeredWithManager || !options.serviceManager) return
          try {
            await unregisterRuntimeWithManager({
              manager: options.serviceManager,
              flavor: runtimeFlavor,
              instanceId
            })
          } finally {
            registeredWithManager = false
          }
        },
        async () => {
          await removeRuntimeDiscovery(
            options.discoveryDir ?? options.dataDir,
            discovery.instanceId,
            options.runtimeFlavor ?? 'production'
          )
        }
      ])
    }
  }
}

function createPersistentMemoryStore(
  options: KunServeRuntimeOptions,
  nowIso: () => string
): MemoryStore | undefined {
  const config = options.capabilities?.memory
  if (!config?.enabled) return undefined
  return options.serviceManager
    ? new ManagerRemoteMemoryStore(options.serviceManager, config)
    : new FileMemoryStore({
        rootDir: join(options.dataDir, 'memory'),
        config,
        nowIso
      })
}

function createPersistentAttachmentStore(
  options: KunServeRuntimeOptions,
  nowIso: () => string
): AttachmentStore | undefined {
  const config = options.capabilities?.attachments
  if (!config?.enabled) return undefined
  return options.serviceManager
    ? new ManagerRemoteAttachmentStore(options.serviceManager, config)
    : new FileAttachmentStore({
        rootDir: join(options.dataDir, 'attachments'),
        config,
        nowIso
      })
}

function runtimeBaseUrl(host: string, port: number): string {
  const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return `http://${urlHost}:${port}`
}

export function activeModelConnectionProviderId(
  options: Pick<KunServeRuntimeOptions, 'credentialSourceId' | 'providers'>
): string {
  const prefix = 'settings:provider:'
  const source = options.credentialSourceId?.trim() ?? ''
  const candidate = source.startsWith(prefix)
    ? source.slice(prefix.length).trim()
    : providerIdFromCredentialSource(source)?.trim() ?? ''
  return candidate && options.providers?.[candidate] ? candidate : 'default'
}

function modelConnectionSeedsForOptions(
  options: KunServeRuntimeOptions
): ModelConnectionSeed[] {
  const activeConnectionId = activeModelConnectionProviderId(options)
  const activeProvider = options.providers?.[activeConnectionId]
  const activeKind = activeProvider?.kind ?? 'http'
  const activeModels = uniqueModelCatalog([
    ...(activeProvider?.models ?? []),
    activeProvider?.selectedModel,
    options.model
  ])
  return [
    {
      expectedRevision: 0,
      id: activeConnectionId,
      name: activeConnectionId === 'default' ? 'Default provider' : activeConnectionId,
      ...(activeProvider?.presetSource
        ? { presetSource: activeProvider.presetSource }
        : activeConnectionId === 'default' ? {} : { presetSource: activeConnectionId }),
      kind: activeKind,
      authType: activeProvider?.authType ?? modelConnectionAuthType(activeKind, options.apiKey),
      ...(activeKind === 'http'
        ? { baseUrl: options.baseUrl || 'https://api.deepseek.com' }
        : activeKind === 'gemini-code-assist' && options.baseUrl
          ? { baseUrl: options.baseUrl }
          : {}),
      endpointFormat: options.endpointFormat ?? DEFAULT_MODEL_ENDPOINT_FORMAT,
      ...(options.credentialSourceId
        ? { credentialSourceId: options.credentialSourceId }
        : {}),
      credential: modelConnectionSeedCredential(
        activeKind,
        options.apiKey,
        activeProvider?.geminiAuth ?? options.geminiAuth
      ),
      models: activeModels,
      ...(activeProvider?.modelCapabilities
        ? { modelCapabilities: activeProvider.modelCapabilities }
        : {}),
      selectedModel: options.model,
      probe: false,
      select: true
    },
    ...Object.entries(options.providers ?? {})
      .filter(([providerId]) => providerId !== activeConnectionId)
      .map(([providerId, provider]): ModelConnectionConnectRequest => ({
        expectedRevision: 0,
        id: providerId,
        name: providerId,
        ...(provider.presetSource ? { presetSource: provider.presetSource } : {}),
        kind: provider.kind ?? 'http',
        authType: provider.authType ?? modelConnectionAuthType(provider.kind ?? 'http', provider.apiKey),
        ...((provider.kind ?? 'http') === 'http'
          ? { baseUrl: provider.baseUrl || options.baseUrl || 'https://api.deepseek.com' }
          : (provider.kind ?? 'http') === 'gemini-code-assist' && provider.baseUrl
            ? { baseUrl: provider.baseUrl }
            : {}),
        endpointFormat: provider.endpointFormat ?? DEFAULT_MODEL_ENDPOINT_FORMAT,
        ...(provider.credentialSourceId
          ? { credentialSourceId: provider.credentialSourceId }
          : {}),
        credential: modelConnectionSeedCredential(provider.kind ?? 'http', provider.apiKey, provider.geminiAuth),
        models: uniqueModelCatalog([
          ...(provider.models ?? []),
          provider.selectedModel
        ]),
        ...(provider.modelCapabilities ? { modelCapabilities: provider.modelCapabilities } : {}),
        ...(provider.selectedModel ? { selectedModel: provider.selectedModel } : {}),
        probe: false,
        select: false
      }))
  ]
}

function uniqueModelCatalog(models: readonly (string | undefined)[]): string[] {
  return [...new Set(models.map((model) => model?.trim()).filter((model): model is string => Boolean(model)))]
}

function modelConnectionSeedCredential(
  kind:
    | 'http'
    | 'agent-sdk'
    | 'antigravity-cli'
    | 'cursor-sdk'
    | 'gemini-cli-api'
    | 'gemini-code-assist',
  apiKey: string,
  geminiAuth?: GeminiCodeAssistCredential
): string {
  return kind === 'gemini-code-assist' && geminiAuth
    ? JSON.stringify(geminiAuth)
    : apiKey
}

function modelConnectionAuthType(
  kind:
    | 'http'
    | 'agent-sdk'
    | 'antigravity-cli'
    | 'cursor-sdk'
    | 'gemini-cli-api'
    | 'gemini-code-assist',
  credential: string
): 'api-key' | 'oauth' | 'subscription' {
  if (
    kind === 'agent-sdk' ||
    kind === 'antigravity-cli' ||
    kind === 'cursor-sdk' ||
    kind === 'gemini-cli-api' ||
    kind === 'gemini-code-assist'
  ) return 'subscription'
  try {
    const parsed = JSON.parse(credential) as { kind?: unknown }
    if (parsed.kind === 'codex-oauth' || parsed.kind === 'grok-oauth') return 'oauth'
  } catch {
    // Plain API keys are intentionally not JSON.
  }
  return 'api-key'
}

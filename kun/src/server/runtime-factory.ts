import { mkdir } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { buildRouter } from './routes/index.js'
import type { ServerRuntime } from './routes/server-runtime.js'
import { startNodeHttpServer, type NodeHttpServerHandle } from './node-http-server.js'
import { isLoopbackHost } from './loopback-host.js'
import { ThreadEventStreamRegistry } from './thread-event-stream-registry.js'
import { FileAttachmentStore } from '../attachments/attachment-store.js'
import { InMemoryApprovalGate } from '../adapters/in-memory-approval-gate.js'
import { InMemoryUserInputGate } from '../adapters/in-memory-user-input-gate.js'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { FileSessionStore, FileThreadStore } from '../adapters/file/index.js'
import { HybridSessionStore, HybridThreadStore } from '../adapters/hybrid/index.js'
import { CompatModelClient } from '../adapters/model/compat-model-client.js'
import { ExtensionModelProviderRegistry } from '../adapters/model/extension-model-provider.js'
import { MultiProviderModelClient } from '../adapters/model/multi-provider-model-client.js'
import { CapabilityRegistry } from '../adapters/tool/capability-registry.js'
import {
  createAgentSdkRuntime,
  type AgentSdkRuntimeFactoryDeps
} from '../runtime/agent-sdk/agent-sdk-runtime-factory.js'
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
import { FileArtifactStore } from '../artifacts/artifact-store.js'
import { createTaskGraphTool } from '../adapters/tool/task-graph-tool.js'
import { buildMcpToolProviders } from '../adapters/tool/mcp-tool-provider.js'
import { buildMemoryToolProviders } from '../adapters/tool/memory-tool-provider.js'
import { buildSkillToolProviders } from '../adapters/tool/skill-tool-provider.js'
import { buildDelegationToolProviders } from '../adapters/tool/delegation-tool-provider.js'
import { buildComponentDesignToolProviders } from '../adapters/tool/component-design-tool-provider.js'
import { buildWebToolProviders } from '../adapters/tool/web-tool-provider.js'
import { buildImageGenToolProviders } from '../adapters/tool/image-gen-tool-provider.js'
import { buildComputerUseToolProviders } from '../adapters/tool/computer-use-tool-provider.js'
import {
  buildMusicGenToolProviders,
  buildSpeechGenToolProviders,
  buildVideoGenToolProviders
} from '../adapters/tool/media-gen-tool-provider.js'
import { LocalWorkspaceInspector } from '../adapters/workspace/local-workspace-inspector.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import {
  buildRuntimeCapabilityManifest,
  type KunCapabilitiesConfig
} from '../contracts/capabilities.js'
import type { ApprovalPolicy, SandboxMode } from '../contracts/policy.js'
import { AgentLoop, type AgentLoopOptions } from '../loop/agent-loop.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import type { TokenEconomyConfig } from '../loop/token-economy.js'
import {
  modelCapabilitiesForModel,
  modelContextProfilesFromConfig,
  type ContextCompactionConfig,
  type ModelConfig
} from '../loop/model-context-profile.js'
import {
  DEFAULT_QUALITY_CONFIG,
  DEFAULT_STORAGE_CONFIG,
  DEFAULT_TOOL_OUTPUT_LIMITS_CONFIG,
  expandHomePath,
  type ObservabilityConfig,
  type QualityConfig,
  type RolesConfig,
  type RuntimeTuningConfig,
  type ModelRequestRetryConfig,
  type ServeProviderConfig,
  type StorageConfig,
  type ToolOutputLimitsConfig
} from '../config/kun-config.js'
import { createAgentObservabilityRecorder } from '../telemetry/agent-observability.js'
import { buildBuiltinHooks } from '../hooks/builtins/index.js'
import { mergeBuiltinSubagentProfiles } from '../delegation/builtin-profiles.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { RandomIdGenerator } from '../ports/id-generator.js'
import type { ModelClient } from '../ports/model-client.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import { ScopedMigrationMaintenanceLock } from '../ports/migration-maintenance-lock.js'
import { KUN_SYSTEM_PROMPT } from '../prompt/kun-system-prompt.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import {
  LifecycleFencedSessionStore,
  LifecycleFencedThreadStore,
  ThreadLifecycleFence
} from '../services/thread-lifecycle-fence.js'
import { LlmDebugRecorder } from '../services/llm-debug-recorder.js'
import { ThreadService } from '../services/thread-service.js'
import { TurnService } from '../services/turn-service.js'
import { ReviewService } from '../services/review-service.js'
import { UsageService } from '../services/usage-service.js'
import type { UsageEvent } from '../contracts/events.js'
import type {
  RuntimeConfigApplyRequest,
  RuntimeConfigApplyResponse
} from '../contracts/runtime-config.js'
import {
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  type ModelEndpointFormat
} from '../contracts/model-endpoint-format.js'
import { SkillRuntime } from '../skills/skill-runtime.js'
import { InstructionRuntime } from '../instructions/instruction-runtime.js'
import { resolveConfiguredHooks, type HooksConfig } from '../hooks/hook-config.js'
import { FileMemoryStore } from '../memory/memory-store.js'
import { DelegationRuntime, FileDelegationStore } from '../delegation/delegation-runtime.js'
import { createChildAgentExecutor } from '../delegation/child-agent-executor.js'
import { BackgroundShellRuntime } from '../services/background-shell-runtime.js'
import { stopBashSessionById, createBashLocalTool } from '../adapters/tool/builtin-bash-tool.js'
import { createBackgroundShellTool } from '../adapters/tool/background-shell-tool.js'
import { createSecretEncryptor, defaultSecretCommandRunner } from '../security/secret-store.js'
import type { LocalTool } from '../adapters/tool/local-tool-host.js'
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

export type KunServeRuntimeOptions = {
  host: string
  port: number
  configPath?: string
  dataDir: string
  /** Product-owned catalog of default local .kunx packages. */
  bundledExtensionsDir?: string
  runtimeToken: string
  apiKey: string
  credentialSourceId?: string
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
  model: string
  approvalPolicy: ApprovalPolicy
  sandboxMode: SandboxMode
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
  capabilities?: KunCapabilitiesConfig
  /** Command hooks from config.json; resolved and wired into tool hosts and the loop. */
  hooks?: HooksConfig
  /** Design-quality linter config; drives the builtin PostToolUse hook. */
  quality?: QualityConfig
  startedAt?: string
  /** Test/embedding override; production uses the bundled Host runner. */
  extensionHostRunnerPath?: string
}

export type KunServeHandle = NodeHttpServerHandle & {
  runtime: ServerRuntime
}

/**
 * Composition root for serve mode. This is intentionally the only
 * place that wires concrete adapters to ports; domain, services, loop,
 * and HTTP handlers stay constructor-injected and testable.
 */
export async function createKunServeRuntime(
  options: KunServeRuntimeOptions
): Promise<ServerRuntime> {
  await mkdir(options.dataDir, { recursive: true, mode: 0o700 })
  let activeOptions: KunServeRuntimeOptions = { ...options }
  const eventBus = new InMemoryEventBus()
  const eventStreamRegistry = new ThreadEventStreamRegistry()
  const stores = await createPersistentStores({
    dataDir: options.dataDir,
    storage: options.storage,
    nowIso: () => new Date().toISOString()
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
  const steering = new SteeringQueue()
  const compactor = new ContextCompactor({
    contextCompaction: activeOptions.contextCompaction,
    models: activeOptions.models
  })
  let tokenEconomy = tokenEconomyConfigForOptions(activeOptions)
  const ids = new RandomIdGenerator()
  const nowIso = () => new Date().toISOString()
  const allocateSeq = (threadId: string) => eventBus.allocateSeq(threadId)
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
      'system: keep the HTTP/SSE contract stable for the GUI',
      'system: keep the stable Kun prefix byte-stable for prompt-cache reuse'
    ]
  })
  let abortThreadExecution: ((threadId: string) => number) | undefined
  let stopThreadAuxiliaryWork: ((threadId: string) => Promise<void>) | undefined
  const threadService = new ThreadService({
    threadStore,
    deleteThreadStore: rawThreadStore,
    sessionStore,
    events,
    ids,
    nowIso,
    defaultApprovalPolicy: activeOptions.approvalPolicy,
    defaultSandboxMode: activeOptions.sandboxMode,
    lifecycleFence,
    onDeleting: async (threadId) => {
      abortThreadExecution?.(threadId)
      await stopThreadAuxiliaryWork?.(threadId)
    },
    onDeleted: (threadId) => {
      eventStreamRegistry.closeThread(threadId)
      usageService.reset(threadId)
      events.clearThread(threadId)
      eventBus.clearThread(threadId)
    }
  })
  const artifactStore = new FileArtifactStore(join(activeOptions.dataDir, 'artifacts'), nowIso)
  let modelProfiles = modelContextProfilesFromConfig({
    contextCompaction: activeOptions.contextCompaction,
    models: activeOptions.models
  })
  const modelCapabilities = (model: string) => modelCapabilitiesForModel(model, modelProfiles)
  const llmDebug = activeOptions.runtime?.llmDebug?.enabled ? new LlmDebugRecorder() : undefined
  // Providers whose kind is 'agent-sdk' don't get an HTTP client — their turns
  // are delegated to the embedded Claude Agent SDK (subscription) instead.
  const agentSdkProviderIds = agentSdkProviderIdsForOptions(activeOptions)
  let agentSdkSignature = agentSdkProviderSignature(activeOptions)
  const extensionProviderAccounts = new ExtensionProviderAccountStore({
    dataDir: activeOptions.dataDir,
    nowIso
  })
  const extensionCredentialKeyProvider = await createSecretEncryptor({
    keyFilePath: join(activeOptions.dataDir, 'secret.key'),
    run: defaultSecretCommandRunner
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
  const migrateLegacyProviderCredentials = async (): Promise<void> => {
    const sources = [
      ...(activeOptions.apiKey.trim() && !activeOptions.credentialSourceId ? [{
        sourceId: 'runtime:default',
        providerId: 'default',
        providerName: 'Kun default provider',
        label: 'Migrated runtime credential',
        apiKey: activeOptions.apiKey
      }] : []),
      ...Object.entries(activeOptions.providers ?? {})
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
  const modelClient = new MultiProviderModelClient(
    buildModelClientRouterInput(activeOptions, modelCapabilities, llmDebug)
  )
  const replaceRoutedModelClients = (): void => {
    const next = buildModelClientRouterInput(activeOptions, modelCapabilities, llmDebug)
    for (const [providerId, client] of extensionModelProviders.clientMap()) {
      next.providers.set(providerId, client)
    }
    modelClient.replace(next)
  }
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
  const instructionRuntime = new InstructionRuntime(activeOptions.capabilities?.instructions)
  const migrationMaintenance = new ScopedMigrationMaintenanceLock()
  const turnService = new TurnService({
    threadStore,
    sessionStore,
    events,
    inflight,
    steering,
    compactor,
    model: modelClient,
    usage: usageService,
    prefix,
    defaultModel: options.model,
    contextCompaction: options.contextCompaction,
    maxConcurrentTurns: activeOptions.runtime?.turnLimits?.maxConcurrentTurns,
    lifecycleFence,
    migrationMaintenance,
    ids,
    nowIso
  })
  abortThreadExecution = (threadId) => turnService.abortThreadExecution(threadId)
  const backgroundShellRuntime = new BackgroundShellRuntime({
    events,
    threadStore,
    turns: turnService,
    nowIso
  })
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
    model: modelClient,
    defaultModel: activeOptions.model,
    nowIso,
    modelCapabilities,
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
	  let attachmentStore = activeOptions.capabilities?.attachments.enabled
	    ? new FileAttachmentStore({
	        rootDir: join(activeOptions.dataDir, 'attachments'),
	        config: activeOptions.capabilities.attachments,
	        nowIso
	      })
	    : undefined
	  let memoryStore = activeOptions.capabilities?.memory.enabled
	    ? new FileMemoryStore({
	        rootDir: join(activeOptions.dataDir, 'memory'),
	        config: activeOptions.capabilities.memory,
	        nowIso
	      })
	    : undefined
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
	    memoryStore: () => memoryStore
	  })
	  let imageGenProviders = buildImageGenToolProviders(activeOptions.capabilities?.imageGen, {
	    attachmentStore,
	    nowIso
	  })
	  let speechGenProviders = buildSpeechGenToolProviders(activeOptions.capabilities?.speechGen, { nowIso })
	  let musicGenProviders = buildMusicGenToolProviders(activeOptions.capabilities?.musicGen, { nowIso })
	  let videoGenProviders = buildVideoGenToolProviders(activeOptions.capabilities?.videoGen, { nowIso })
	  let computerUseProviders = await buildComputerUseToolProviders(activeOptions.capabilities?.computerUse)
  const designCanvasProvider = {
    id: 'design-canvas',
    kind: 'gui' as const,
    enabled: true,
    available: true,
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
    tools: buildPptMasterLocalTools()
  }
	  const taskGraphTool = createTaskGraphTool({ rootDir: join(activeOptions.dataDir, 'task-graphs') })
	  let baseToolProviders = [
    {
      id: 'builtin',
      kind: 'built-in' as const,
      enabled: true,
      available: true,
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
      tools: [createReadArtifactTool()]
    },
    ...mcpProviders.providers,
    ...webProviders.providers,
    ...buildMemoryToolProviders(memoryStore),
    ...buildSkillToolProviders(skillRuntime),
    ...imageGenProviders.providers,
    ...speechGenProviders.providers,
    ...musicGenProviders.providers,
    ...videoGenProviders.providers,
    pptMasterProvider,
    designCanvasProvider,
    // NOTE: computer_use is intentionally NOT in baseToolProviders — host
    // control must not be delegable to subagents. It is added to the main
    // registry only (below).
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
	  let delegationRuntime = activeOptions.capabilities?.subagents.enabled
	    ? new DelegationRuntime({
	        config: mergeBuiltinSubagentProfiles(activeOptions.capabilities.subagents),
	        store: new FileDelegationStore(join(activeOptions.dataDir, 'child-runs')),
	        events,
	        threadStore,
	        turns: turnService,
	        nowIso,
	        executor: createChildAgentExecutor({
	          model: modelClient,
	          toolHost: childToolHost,
	          prefix,
	          defaultModel: activeOptions.model,
	          models: activeOptions.models,
	          contextCompaction: activeOptions.contextCompaction,
	          approvalPolicy: activeOptions.approvalPolicy,
	          sandboxMode: activeOptions.sandboxMode,
	          modelCapabilities,
	          skillRuntime,
	          instructionRuntime,
	          tokenEconomy,
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
    }
  })
	  let registry = new CapabilityRegistry([
    ...baseToolProviders,
    // Host control is available to the top-level agent only, never to
    // delegated subagents (which use childRegistry/baseToolProviders).
    ...computerUseProviders.providers,
    {
      id: 'goal',
      kind: 'gui' as const,
      enabled: true,
      available: true,
      tools: buildGoalLocalTools(threadService)
    },
    {
      id: 'todo',
      kind: 'gui' as const,
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
    ...buildDelegationToolProviders(delegationRuntime),
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
  // Subscription engine: only constructed when at least one provider is the
  // 'agent-sdk' kind. Owns the delegated turn for those providers' threads.
  // The runtime's own default provider can itself be agent-sdk (the Claude
  // subscription set as the main model). kun-process signals that via env so we
  // route default-provider turns to the SDK too, not just per-provider ones.
	  const defaultIsAgentSdk = process.env.KUN_RUNTIME_PROVIDER_KIND === 'agent-sdk'
	  let sdkRuntimeDeps: AgentSdkRuntimeFactoryDeps | undefined
	  if (agentSdkProviderIds.size > 0 || defaultIsAgentSdk) {
	    sdkRuntimeDeps = {
	      registry,
	      toolHost,
	      turns: turnService,
	      sessionStore,
	      threadStore,
	      events,
	      ids,
	      prefix,
	      providerConfigs: activeOptions.providers ?? {},
	      agentSdkProviderIds,
	      defaultApprovalPolicy: activeOptions.approvalPolicy,
	      defaultSandboxMode: activeOptions.sandboxMode,
	      defaultModel: activeOptions.model,
	      defaultIsAgentSdk,
	      defaultToken: activeOptions.apiKey,
	      turnLimits: activeOptions.runtime?.turnLimits,
	      approvalGate,
	      skillRuntime,
	      instructionRuntime,
	      userInputGate,
	      nowIso,
	      ...(attachmentStore ? { attachmentStore } : {}),
	      ...(memoryStore ? { memoryStore } : {}),
	      ...(process.env.KUN_CLAUDE_BINARY
	        ? { pathToClaudeCodeExecutable: process.env.KUN_CLAUDE_BINARY }
	        : {})
	    }
	  }

  // The main turn abort signal already reaches foreground children. Detached
  // children and background shells intentionally have independent lifetimes,
  // so a destructive thread delete must cancel them explicitly before the
  // lifecycle fence drains and removes the thread directory.
  stopThreadAuxiliaryWork = async (threadId) => {
    await Promise.allSettled([
      backgroundShellRuntime.stopThread(threadId),
      Promise.resolve(delegationRuntime?.abortDetachedChildrenForThread(threadId) ?? 0)
    ])
  }
	  const sdkRuntime = sdkRuntimeDeps ? createAgentSdkRuntime(sdkRuntimeDeps) : undefined
	  const loopOptions: AgentLoopOptions = {
	    threadStore,
	    sessionStore,
	    approvalGate,
    userInputGate,
    model: modelClient,
    toolHost,
    ...(sdkRuntime ? { sdkRuntime } : {}),
    usage: usageService,
    events,
    turns: turnService,
    inflight,
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
	    onPlanWritten: async ({ threadId, planId, relativePath, markdown }) => {
	      await threadService.syncTodosFromPlan(threadId, {
	        planId,
        relativePath,
        markdown,
	        preserveCompleted: true
	      })
	    }
	  }
	  const loop = new AgentLoop(loopOptions)
	  const activeRuntimeRuns = new Set<Promise<'completed' | 'failed' | 'aborted'>>()
	  let shuttingDown = false
	  const trackRuntimeRun = <T extends 'completed' | 'failed' | 'aborted'>(run: Promise<T>): Promise<T> => {
	    activeRuntimeRuns.add(run)
	    void run.then(
	      () => activeRuntimeRuns.delete(run),
	      () => activeRuntimeRuns.delete(run)
	    )
	    return run
	  }
	  const runAgentTurn = (threadId: string, turnId: string): Promise<'completed' | 'failed' | 'aborted'> => {
	    if (shuttingDown) {
	      return turnService.interruptTurn({ threadId, turnId })
	        .then(() => 'aborted' as const)
	        .catch(() => 'aborted' as const)
	    }
	    return trackRuntimeRun(loop.runTurn(threadId, turnId))
	  }
	  const runReview = (input: Parameters<typeof reviewService.runReview>[0]) =>
	    trackRuntimeRun(reviewService.runReview(input))
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
	      kunVersion: '0.1.0',
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
	    const nextOptions = await hydrateLegacyCredentialOptions(
	      mergeRuntimeConfigApplyOptions(activeOptions, request),
	      legacyCredentialMigration
	    )
	    const nextAgentSdkSignature = agentSdkProviderSignature(nextOptions)
	    if (nextAgentSdkSignature !== agentSdkSignature) {
	      return {
	        ok: false,
	        code: 'restart_required',
	        message: 'agent-sdk provider routing changed and requires a runtime restart'
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
	    const nextAttachmentStore = nextOptions.capabilities?.attachments.enabled
	      ? new FileAttachmentStore({
	          rootDir: join(activeOptions.dataDir, 'attachments'),
	          config: nextOptions.capabilities.attachments,
	          nowIso
	        })
	      : undefined
	    const nextMemoryStore = nextOptions.capabilities?.memory.enabled
	      ? new FileMemoryStore({
	          rootDir: join(activeOptions.dataDir, 'memory'),
	          config: nextOptions.capabilities.memory,
	          nowIso
	        })
	      : undefined
	    const nextWebProviders = buildWebToolProviders(nextOptions.capabilities?.web)
	    const nextImageGenProviders = buildImageGenToolProviders(nextOptions.capabilities?.imageGen, {
	      attachmentStore: nextAttachmentStore,
	      nowIso
	    })
	    const nextSpeechGenProviders = buildSpeechGenToolProviders(nextOptions.capabilities?.speechGen, { nowIso })
	    const nextMusicGenProviders = buildMusicGenToolProviders(nextOptions.capabilities?.musicGen, { nowIso })
	    const nextVideoGenProviders = buildVideoGenToolProviders(nextOptions.capabilities?.videoGen, { nowIso })
	    const nextComputerUseProviders = await buildComputerUseToolProviders(nextOptions.capabilities?.computerUse)
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
	      ...nextMcpProviders.providers,
	      ...nextWebProviders.providers,
	      ...buildMemoryToolProviders(nextMemoryStore),
	      ...buildSkillToolProviders(nextSkillRuntime),
	      ...nextImageGenProviders.providers,
	      ...nextSpeechGenProviders.providers,
	      ...nextMusicGenProviders.providers,
	      ...nextVideoGenProviders.providers,
	      nextPptMasterProvider,
	      designCanvasProvider
	    ]
	    const nextChildRegistry = new CapabilityRegistry(nextBaseToolProviders)
	    if (delegationRuntime && nextOptions.capabilities?.subagents) {
	      delegationRuntime.replaceConfig(mergeBuiltinSubagentProfiles(nextOptions.capabilities.subagents))
	    }
	    const nextRegistry = new CapabilityRegistry([
	      ...nextBaseToolProviders,
	      ...nextComputerUseProviders.providers,
	      {
	        id: 'goal',
	        kind: 'gui' as const,
	        enabled: true,
	        available: true,
	        tools: buildGoalLocalTools(threadService)
	      },
	      {
	        id: 'todo',
	        kind: 'gui' as const,
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
	      ...buildDelegationToolProviders(delegationRuntime),
	      ...buildComponentDesignToolProviders(delegationRuntime)
	    ])

	    const previousMcpProviders = mcpProviders
	    activeOptions = nextOptions
	    modelProfiles = nextModelProfiles
	    tokenEconomy = nextTokenEconomy
	    agentSdkSignature = nextAgentSdkSignature
	    replaceRoutedModelClients()
	    await migrateLegacyProviderCredentials()
	    skillRuntime.replaceWith(nextSkillRuntime)
	    instructionRuntime.replaceConfig(activeOptions.capabilities?.instructions)
	    mcpProviders = nextMcpProviders
	    webProviders = nextWebProviders
	    attachmentStore = nextAttachmentStore
	    memoryStore = nextMemoryStore
	    imageGenProviders = nextImageGenProviders
	    speechGenProviders = nextSpeechGenProviders
	    musicGenProviders = nextMusicGenProviders
	    videoGenProviders = nextVideoGenProviders
	    computerUseProviders = nextComputerUseProviders
	    resolvedHooks = nextResolvedHooks
	    baseToolProviders = nextBaseToolProviders
	    childRegistry = nextChildRegistry
	    registry = nextRegistry
	    extensionTools.rebindRegistry(registry)
	    childToolHost.replaceRuntimeComponents({ registry: childRegistry, hooks: resolvedHooks })
	    toolHost.replaceRuntimeComponents({ registry, hooks: resolvedHooks })
	    if (sdkRuntimeDeps) {
	      sdkRuntimeDeps.registry = registry
	      sdkRuntimeDeps.providerConfigs = activeOptions.providers ?? {}
	      sdkRuntimeDeps.defaultApprovalPolicy = activeOptions.approvalPolicy
	      sdkRuntimeDeps.defaultSandboxMode = activeOptions.sandboxMode
	      sdkRuntimeDeps.defaultModel = activeOptions.model
	      sdkRuntimeDeps.defaultToken = activeOptions.apiKey
	      sdkRuntimeDeps.turnLimits = activeOptions.runtime?.turnLimits
	      sdkRuntimeDeps.skillRuntime = skillRuntime
	      sdkRuntimeDeps.instructionRuntime = instructionRuntime
	      if (attachmentStore) {
	        sdkRuntimeDeps.attachmentStore = attachmentStore
	      } else {
	        delete sdkRuntimeDeps.attachmentStore
	      }
	      if (memoryStore) {
	        sdkRuntimeDeps.memoryStore = memoryStore
	      } else {
	        delete sdkRuntimeDeps.memoryStore
	      }
	    }
	    turnService.updateRuntimeConfig({
	      defaultModel: activeOptions.model,
	      contextCompaction: activeOptions.contextCompaction,
	      model: modelClient,
	      maxConcurrentTurns: activeOptions.runtime?.turnLimits?.maxConcurrentTurns
	    })
	    extensionAgent.updateRuntimeConfig({
	      defaultBinding: { providerId: 'default', modelId: activeOptions.model }
	    })
	    extensionPreparations.clear()
	    threadService.updateRuntimeDefaults({
	      approvalPolicy: activeOptions.approvalPolicy,
	      sandboxMode: activeOptions.sandboxMode
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
	    loopOptions.tokenEconomy = tokenEconomy
	    loopOptions.contextCompaction = activeOptions.contextCompaction
	    loopOptions.roles = activeOptions.roles
	    loopOptions.instructionRuntime = instructionRuntime
	    loopOptions.toolStorm = activeOptions.runtime?.toolStorm
	    loopOptions.turnLimits = activeOptions.runtime?.turnLimits
	    loopOptions.toolArgumentRepair = activeOptions.runtime?.toolArgumentRepair
	    loopOptions.hooks = resolvedHooks
	    loopOptions.attachmentStore = attachmentStore
	    loopOptions.memoryStore = memoryStore
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
	    return { ok: true }
	  }
	  return {
    threadService,
    turnService,
    reviewService,
    usageService,
    eventBus,
    sessionStore,
    events,
    eventStreamRegistry,
    llmDebug,
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
	      bundledSeedResults
	    },
	    modelClient,
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
	    allocateSeq,
	    nowIso,
	    applyConfig,
	    info: () => {
	      const memory = process.memoryUsage()
	      const peakRssBytes = Math.max(memory.rss, process.resourceUsage().maxRSS * 1024)
	      return {
	        host: activeOptions.host,
	        port: activeOptions.port,
	        configPath: activeOptions.configPath,
	        dataDir: activeOptions.dataDir,
	        model: activeOptions.model,
	        endpointFormat: activeOptions.endpointFormat ?? DEFAULT_MODEL_ENDPOINT_FORMAT,
	        approvalPolicy: activeOptions.approvalPolicy,
	        sandboxMode: activeOptions.sandboxMode,
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
    skills: () => skillRuntime.diagnostics(),
    shutdown: async () => {
      try {
        shuttingDown = true
        eventStreamRegistry.closeAll()
        loop.shutdownGoalResume()
	        await backgroundShellRuntime.shutdown()
	        await extensionJobs.handleRuntimeShutdown()
	        extensionMediaJobs.dispose()
	        extensionAudioAnalysisJobs.dispose()
	        extensionMediaArchiveJobs.dispose()
        await turnService.interruptActiveTurns()
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
      } finally {
        try {
          await agentObservability?.shutdown()
        } finally {
          await stores.shutdown?.()
        }
      }
    }
  }
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
  if (options.credentialSourceId) {
    const resolved = await migration.resolveApiKey(options.credentialSourceId).catch(() => null)
    if (resolved) {
      const material = materializeLegacyProviderCredential(resolved.apiKey)
      apiKey = material.apiKey
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
    ...(headers ? { headers } : {}),
    ...(options.providers ? { providers } : {})
  }
}

function buildModelClientRouterInput(
  options: KunServeRuntimeOptions,
  modelCapabilities: (model: string) => ReturnType<typeof modelCapabilitiesForModel>,
  llmDebug?: LlmDebugRecorder
): { default: CompatModelClient; providers: Map<string, ModelClient> } {
  const streamIdleOverride =
    options.runtime?.streamIdleTimeoutMs !== undefined
      ? { streamIdleTimeoutMs: options.runtime.streamIdleTimeoutMs }
      : {}
  const defaultClient = new CompatModelClient({
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    modelProxyUrl: options.modelProxyUrl,
    endpointFormat: options.endpointFormat ?? DEFAULT_MODEL_ENDPOINT_FORMAT,
    retry: options.retry,
    model: options.model,
    modelCapabilities,
    headers: options.headers,
    ...(llmDebug ? { debugSink: llmDebug } : {}),
    ...streamIdleOverride
  })
  const providerClients = new Map<string, ModelClient>()
  for (const [providerId, provider] of Object.entries(options.providers ?? {})) {
    const trimmedId = providerId.trim()
    if (!trimmedId || (provider.kind ?? 'http') === 'agent-sdk') continue
    providerClients.set(
      trimmedId,
      new CompatModelClient({
        baseUrl: provider.baseUrl ?? options.baseUrl ?? '',
        apiKey: provider.apiKey,
        modelProxyUrl: provider.modelProxyUrl ?? options.modelProxyUrl,
        endpointFormat: provider.endpointFormat ?? options.endpointFormat ?? DEFAULT_MODEL_ENDPOINT_FORMAT,
        retry: provider.retry ?? options.retry,
        model: options.model,
        modelCapabilities,
        headers: provider.headers,
        ...(llmDebug ? { debugSink: llmDebug } : {}),
        ...streamIdleOverride
      })
    )
  }
  return { default: defaultClient, providers: providerClients }
}

function agentSdkProviderIdsForOptions(options: KunServeRuntimeOptions): Set<string> {
  const out = new Set<string>()
  for (const [providerId, provider] of Object.entries(options.providers ?? {})) {
    const trimmedId = providerId.trim()
    if (trimmedId && (provider.kind ?? 'http') === 'agent-sdk') out.add(trimmedId)
  }
  return out
}

function agentSdkProviderSignature(options: KunServeRuntimeOptions): string {
  return [...agentSdkProviderIdsForOptions(options)].sort().join('\n')
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
    model: serve.model ?? current.model,
    approvalPolicy: serve.approvalPolicy ?? current.approvalPolicy,
    sandboxMode: serve.sandboxMode ?? current.sandboxMode,
    tokenEconomyMode: serve.tokenEconomyMode ?? current.tokenEconomyMode,
    tokenEconomy: serve.tokenEconomy ?? current.tokenEconomy,
    toolOutputLimits: serve.toolOutputLimits ?? current.toolOutputLimits,
    models: request.models ?? current.models,
    contextCompaction: request.contextCompaction ?? current.contextCompaction,
    runtime: request.runtime ?? current.runtime,
    roles: request.roles ?? current.roles,
    capabilities: request.capabilities ?? current.capabilities,
    hooks: request.hooks ?? current.hooks,
    quality: request.quality ?? current.quality
  }
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
}): Promise<{ threadStore: ThreadStore; sessionStore: SessionStore; shutdown?: () => Promise<void> }> {
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
  const runtime = await createKunServeRuntime(options)
  const router = buildRouter(runtime)
  const server = await startNodeHttpServer({
    router,
    host: options.host,
    port: options.port
  })
  // Background sweep after listen: settle turns orphaned by a crash so
  // clients stop spinning on them, without delaying readiness. Then resume
  // goals that were interrupted mid-run so an active goal doesn't sit "in
  // progress" forever with nothing running (KunAgent/Kun#370).
  void runtime.turnService
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
  void runtime.delegationRuntime
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
    close: async () => {
      try {
        await server.close()
      } finally {
        await runtime.shutdown?.()
      }
    }
  }
}

import type { ThreadActivityRegistry } from '../../services/thread-activity-registry.js'
import type { ThreadService } from '../../services/thread-service.js'
import type { TurnService } from '../../services/turn-service.js'
import type { ThreadStore } from '../../ports/thread-store.js'
import type { TurnRunOutcome } from '../../loop/turn-execution-types.js'
import type { UsageService } from '../../services/usage-service.js'
import type { ReviewService } from '../../services/review-service.js'
import type { EventBus } from '../../ports/event-bus.js'
import type { SessionStore } from '../../ports/session-store.js'
import type { ApprovalGate } from '../../ports/approval-gate.js'
import type { UserInputGate } from '../../ports/user-input-gate.js'
import type { WorkspaceInspector } from '../../ports/workspace-inspector.js'
import type { ToolHost, ToolProviderPolicy } from '../../ports/tool-host.js'
import type { RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'
import type { CanvasReceiptRegistry } from '../../services/canvas-receipt-registry.js'
import type { LlmDebugRecorder } from '../../services/llm-debug-recorder.js'
import type { RuntimeInfoResponse } from '../../contracts/runtime-info.js'
import type {
  McpCapabilityConfig,
  McpServerConfig
} from '../../contracts/capabilities.js'
import type {
  RuntimeConfigApplyRequest,
  RuntimeConfigApplyResponse
} from '../../contracts/runtime-config.js'
import type {
  McpOAuthAuthorizeResult,
  McpOAuthClearResult,
  McpOAuthDiagnostic,
  McpServerDiagnostic
} from '../../adapters/tool/mcp-tool-provider.js'
import type { McpSearchRuntimeDiagnostic } from '../../adapters/tool/mcp-tool-search.js'
import type { WebProviderDiagnostic } from '../../adapters/tool/web-tool-provider.js'
import type { ImageGenDiagnostic } from '../../adapters/tool/image-gen-tool-provider.js'
import type {
  MusicGenDiagnostic,
  SpeechGenDiagnostic,
  VideoGenDiagnostic
} from '../../adapters/tool/media-gen-tool-provider.js'
import type { SkillRuntimeDiagnostics } from '../../skills/skill-runtime.js'
import type { InstructionRuntimeDiagnostics } from '../../instructions/instruction-runtime.js'
import type { AttachmentDiagnostics } from '../../contracts/attachments.js'
import type { AttachmentStore } from '../../attachments/attachment-store.js'
import type { MemoryDiagnostics } from '../../contracts/memory.js'
import type { MemoryStore } from '../../memory/memory-store.js'
import type { ReviewTarget } from '../../contracts/review.js'
import type { DelegationRuntime } from '../../delegation/delegation-runtime.js'
import type { BackgroundShellRuntime } from '../../services/background-shell-runtime.js'
import type { ModelClient } from '../../ports/model-client.js'
import type { ModelRoutePoolConfig } from '../../contracts/model-route-pool.js'
import type { GatewayCredentialService } from '../../services/gateway-credential-service.js'
import type { RoutePoolHealthStore } from '../../adapters/model/route-pool-model-client.js'
import type { RoutePoolTestService } from '../../services/route-pool-test-service.js'
import type { GraphRuntimeConfig, RolesConfig } from '../../config/kun-config.js'
import type {
  FileGraphWriteCoordinator,
  FileGraphThreadReferenceStore,
  FileGraphPlanningDraftStore,
  GraphControlService,
  GraphLearningService,
  GraphMailbox,
  GraphRecoveryService,
  GraphRunStore,
  GraphScheduler,
  GraphSupervisor,
  ProjectAgentRegistry
} from '../../graph/index.js'
import type { ImmutablePrefix } from '../../cache/immutable-prefix.js'
import type { PublisherTrustStore } from '../../supplychain/publisher-trust-store.js'
import type { ThreadEventStreamRegistry } from '../thread-event-stream-registry.js'
import type {
  ArchiveValidationOptions,
  ExtensionIndexClient,
  ExtensionManager,
  ExtensionPackageManager,
  ExtensionPaths,
  ExtensionRegistry,
  ExtensionStateStore,
  BundledExtensionSeedResult
} from '../../extensions/index.js'
import type { ExtensionHostBroker } from '../../services/extension-host-broker.js'
import type { ExtensionAgentService } from '../../services/extension-agent-service.js'
import type { ExtensionToolRegistry } from '../../adapters/tool/extension-tool-provider.js'
import type { ExtensionModelProviderRegistry } from '../../adapters/model/extension-model-provider.js'
import type { ExtensionProviderAccountStore } from '../../services/extension-provider-account-store.js'
import type { ExtensionAccountBroker } from '../../services/extension-account-broker.js'
import type { ExtensionCredentialStore } from '../../services/extension-credential-store.js'
import type { ExtensionViewSessionService } from '../../services/extension-view-session-service.js'
import type { ExtensionSecretRevealConsentService } from '../../services/extension-secret-reveal-consent.js'
import type { ExtensionConfigurationService } from '../../services/extension-configuration-service.js'
import type { ExtensionArtifactService } from '../../services/extension-artifact-service.js'
import type { ExtensionMediaHandleService } from '../../services/extension-media-handle-service.js'
import type { ExtensionJobService } from '../../services/extension-job-service.js'
import type { RuntimeMigrationService } from '../../services/runtime-migration-service.js'
import type { RuntimeMigrationImportService } from '../../services/runtime-migration-import-service.js'
import type { ArtifactStore } from '../../artifacts/artifact-store.js'
import type { ModelConnectionRegistry } from '../../services/model-connection-registry.js'
import type { ModelConnectionOAuthService } from '../../services/model-connection-oauth.js'
import type {
  OfficialProviderAuthService,
  OfficialProviderCliService
} from '../../services/official-provider-cli.js'
import type { ProviderQuotaService } from '../../services/provider-quota-service.js'
import type { ToolCancellationService } from '../../services/tool-cancellation-service.js'
import type { KnowledgeBaseService } from '../../knowledge/knowledge-base-service.js'
import type { ProjectBoardService } from '../../services/project-board-service.js'

export type RuntimeToolDiagnostics = {
  providers: ToolProviderPolicy[]
  mcpServers: McpServerDiagnostic[]
  mcpOAuth?: McpOAuthDiagnostic[]
  mcpSearch?: McpSearchRuntimeDiagnostic
  webProviders: WebProviderDiagnostic[]
  skills: SkillRuntimeDiagnostics
  instructions?: InstructionRuntimeDiagnostics
  attachments: AttachmentDiagnostics
  memory: MemoryDiagnostics
  imageGen?: ImageGenDiagnostic[]
  speechGen?: SpeechGenDiagnostic[]
  musicGen?: MusicGenDiagnostic[]
  videoGen?: VideoGenDiagnostic[]
  extensions?: {
    tools: ReturnType<ExtensionToolRegistry['list']>
    providers: string[]
    providerDiagnostics: ReturnType<ExtensionModelProviderRegistry['diagnostics']>
    hosts: Awaited<ReturnType<ExtensionManager['listDiagnostics']>>
    jobs?: {
      activeCount: number
      subscriptionCount: number
      recent: Array<{
        jobId: string
        ownerExtensionId: string
        kind: string
        state: string
        executionAttempt: number
        action: string
        code?: string
      }>
    }
  }
}

export type ExtensionPlatformRuntime = {
  paths: ExtensionPaths
  registry: ExtensionRegistry
  packageManager: ExtensionPackageManager
  manager: ExtensionManager
  indexClient: ExtensionIndexClient
  validation: ArchiveValidationOptions
  broker: ExtensionHostBroker
  agent: ExtensionAgentService
  tools: ExtensionToolRegistry
  modelProviders: ExtensionModelProviderRegistry
  providerAccounts: ExtensionProviderAccountStore
  accounts: ExtensionAccountBroker
  credentials: ExtensionCredentialStore
  state: ExtensionStateStore
  configuration: ExtensionConfigurationService
  mediaHandles: ExtensionMediaHandleService
  artifacts: ExtensionArtifactService
  viewSessions: ExtensionViewSessionService
  secretReveals: ExtensionSecretRevealConsentService
  jobs?: ExtensionJobService
  bundledSeedResults?: readonly BundledExtensionSeedResult[]
}

/**
 * Dependencies that the HTTP router needs. Bundled into a single
 * type so callers can compose the runtime from the in-memory or
 * file-backed adapters without leaking concrete types into routes.
 */
export type ServerRuntime = {
  threadService: ThreadService
  projectBoardService?: ProjectBoardService
  turnService: TurnService
  toolCancellationService?: ToolCancellationService
  usageService: UsageService
  reviewService?: ReviewService
  eventBus: EventBus
  sessionStore: SessionStore
  events: RuntimeEventRecorder
  /** Compact process-wide invalidations used by sidebar observers. */
  threadActivity?: ThreadActivityRegistry
  /** Active SSE streams, so a successful thread delete can close them. */
  eventStreamRegistry?: ThreadEventStreamRegistry
  /** Optional troubleshooting buffer of the most recent LLM rounds (in-memory). */
  llmDebug?: LlmDebugRecorder
  /** Two-phase design canvas tool receipts (renderer application confirmation). */
  canvasReceipts?: CanvasReceiptRegistry
  /**
   * Cheap non-sensitive live counters for stall/heartbeat diagnostics.
   * Must never touch the filesystem or await persistence.
   */
  liveCounters?: () => { inflight: number; activeCaptures: number }
  approvalGate: ApprovalGate
  userInputGate: UserInputGate
  workspaceInspector: WorkspaceInspector
  toolHost?: ToolHost
  attachmentStore?: AttachmentStore
  memoryStore?: MemoryStore
  knowledgeBaseService?: KnowledgeBaseService
  migrationService?: RuntimeMigrationService
  migrationImportService?: RuntimeMigrationImportService
  /**
   * Active delegation runtime exposed for diagnostics + agent profile
   * listing. Optional so test scaffolds can omit it.
   */
  delegationRuntime?: DelegationRuntime
  graph?: {
    control: GraphControlService
    store: GraphRunStore
    drafts: FileGraphPlanningDraftStore
    config(): GraphRuntimeConfig
    scheduler: GraphScheduler
    supervisor: GraphSupervisor
    mailbox: GraphMailbox
    writes: FileGraphWriteCoordinator
    recovery: GraphRecoveryService
    registry: ProjectAgentRegistry
    learning: GraphLearningService
    references: FileGraphThreadReferenceStore
    artifacts: ArtifactStore
  }
  backgroundShellRuntime?: BackgroundShellRuntime
  supplyChainTrust?: PublisherTrustStore
  /** Single extension platform instance shared by HTTP, CLI-style services, tools, and model routing. */
  extensionPlatform?: ExtensionPlatformRuntime
  /**
   * Default ModelClient + model id for one-shot completions outside the
   * agent loop (e.g. AI-generated subagent profiles). Optional so test
   * scaffolds can omit it.
   */
  modelClient?: ModelClient
  modelConnections?: ModelConnectionRegistry
  modelConnectionOAuth?: ModelConnectionOAuthService
  officialProviderAuth?: OfficialProviderAuthService
  officialProviderCli?: OfficialProviderCliService
  providerQuotaService?: Pick<ProviderQuotaService, 'list'>
  modelGateway?: {
    enabled(): boolean
    pools(): ModelRoutePoolConfig[]
    configuredPools(): ModelRoutePoolConfig[]
    health: RoutePoolHealthStore
    tests: RoutePoolTestService
    credentials: GatewayCredentialService
  }
  defaultModel?: string
  /**
   * Internal-LLM role model routing. Used by on-demand routes (e.g. session
   * summary) to resolve the summary/title/codeReview model precedence
   * (role override -> smallModel -> defaultModel). Optional for test scaffolds.
   */
  roles?: RolesConfig
  /**
   * Immutable prefix (systemPrompt + few-shots + fingerprint). Exposed so
   * one-shot internal routes can reuse the runtime's systemPrompt. Optional.
   */
  immutablePrefix?: ImmutablePrefix
  runTurn(threadId: string, turnId: string): Promise<TurnRunOutcome> | void
  /**
   * Relaunch goal continuation turns for threads whose in-flight turn was
   * just reconciled to `failed` after a runtime restart. Returns the number
   * of goals resumed. Optional so embedders without the agent loop can omit it.
   */
  resumeInterruptedGoals?(
    sources: readonly import('../../loop/restart-recovery-source.js').RestartRecoverySource[]
  ): Promise<number>
  /**
   * Relaunch continuation turns for ordinary threads (no active goal) whose
   * in-flight turn was just reconciled to `failed` after a runtime restart.
   * Optional so embedders without the agent loop can omit it.
   */
  resumeInterruptedTurns?(
    sources: readonly import('../../loop/restart-recovery-source.js').RestartRecoverySource[],
    childRecoveryCandidates?: readonly import('../../loop/interrupted-turn-coordinator.js').InterruptedSubagentRecoveryCandidate[]
  ): Promise<number>
  /**
   * Durable per-thread turn queue drain, used by turn settlement and by the
   * restart sweep. Optional so embedders without the agent loop can omit it.
   */
  queuedTurnDispatcher?: import('../queued-turn-dispatcher.js').QueuedTurnDispatcher
  /**
   * Canonical thread store, exposed for maintenance sweeps (e.g. the
   * memory-pressure monitor compacting idle thread histories).
   */
  threadStore?: ThreadStore
  runReview?(input: {
    threadId: string
    turnId: string
    reviewItemId: string
    target: ReviewTarget
    model?: string
    providerId?: string
    accountId?: string
    reasoningEffort?: 'auto' | 'off' | 'low' | 'medium' | 'high' | 'max'
  }): Promise<'completed' | 'failed' | 'aborted'> | void
  runtimeToken: string
  insecure: boolean
  allocateSeq: (threadId: string) => number | Promise<number>
  nowIso: () => string
  info(): RuntimeInfoResponse
  /** Present only when all canonical persistence is fenced by the manager. */
  managerProtocolVersion?: number
  activeTurnCount?(): number
  requestShutdown?(instanceId: string): Promise<boolean>
  /** Starts non-critical historical scans only after the HTTP server is live. */
  startBackgroundMaintenance?(): void
  /** Restores usage counters before the server accepts turns or usage reads. */
  prepareForRequests?(): Promise<void>
  /** Runs the bounded thread-store guardian immediately. */
  inspectThreadStore?(): Promise<import('../../services/thread-store-guardian.js').ThreadStoreGuardianResult>
  /** Read-only session storage health scans (guardian). */
  sessionGuardian?: import('../../services/session-guardian.js').SessionGuardian
  /** Shared thread snapshot store for prune/restore flows. */
  threadSnapshots?: import('../../services/thread-snapshot-store.js').ThreadSnapshotStore
  /** Forward active-turn controls to the flavor that currently owns the lease. */
  forwardThreadControl?(request: Request, threadId: string): Promise<Response | null>
  forwardControlById?(
    request: Request,
    kind: 'approval' | 'user-input',
    id: string
  ): Promise<Response | null>
  applyConfig(request: RuntimeConfigApplyRequest): Promise<RuntimeConfigApplyResponse>
  toolDiagnostics?(): RuntimeToolDiagnostics | Promise<RuntimeToolDiagnostics>
  mcpOAuth?(): McpOAuthDiagnostic[] | Promise<McpOAuthDiagnostic[]>
  clearMcpOAuth?(serverId?: string): Promise<McpOAuthClearResult>
  authorizeMcpOAuth?(serverId: string): Promise<McpOAuthAuthorizeResult>
  mcpConfig?(): McpCapabilityConfig
  setMcpServer?(serverId: string, server: McpServerConfig | null): Promise<RuntimeConfigApplyResponse>
  skills?(workspace?: string): SkillRuntimeDiagnostics | Promise<SkillRuntimeDiagnostics>
  refreshSkills?(): Promise<void>
  setSkillsEnabled?(enabled: boolean): Promise<RuntimeConfigApplyResponse>
  setLocalCapabilityEnabled?(
    id: 'attachments' | 'memory',
    enabled: boolean
  ): Promise<RuntimeConfigApplyResponse>
  shutdown?(): Promise<void>
}

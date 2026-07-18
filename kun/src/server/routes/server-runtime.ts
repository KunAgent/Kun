import type { ThreadService } from '../../services/thread-service.js'
import type { TurnService } from '../../services/turn-service.js'
import type { UsageService } from '../../services/usage-service.js'
import type { ReviewService } from '../../services/review-service.js'
import type { EventBus } from '../../ports/event-bus.js'
import type { SessionStore } from '../../ports/session-store.js'
import type { ApprovalGate } from '../../ports/approval-gate.js'
import type { UserInputGate } from '../../ports/user-input-gate.js'
import type { WorkspaceInspector } from '../../ports/workspace-inspector.js'
import type { ToolHost, ToolProviderPolicy } from '../../ports/tool-host.js'
import type { RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'
import type { LlmDebugRecorder } from '../../services/llm-debug-recorder.js'
import type { RuntimeInfoResponse } from '../../contracts/runtime-info.js'
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
import type { RolesConfig } from '../../config/kun-config.js'
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
import type { RuntimeMigrationService } from '../../services/runtime-migration-service.js'
import type { RuntimeMigrationImportService } from '../../services/runtime-migration-import-service.js'

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
  bundledSeedResults?: readonly BundledExtensionSeedResult[]
}

/**
 * Dependencies that the HTTP router needs. Bundled into a single
 * type so callers can compose the runtime from the in-memory or
 * file-backed adapters without leaking concrete types into routes.
 */
export type ServerRuntime = {
  threadService: ThreadService
  turnService: TurnService
  usageService: UsageService
  reviewService?: ReviewService
  eventBus: EventBus
  sessionStore: SessionStore
  events: RuntimeEventRecorder
  /** Active SSE streams, so a successful thread delete can close them. */
  eventStreamRegistry?: ThreadEventStreamRegistry
  /** Optional troubleshooting buffer of the most recent LLM rounds (in-memory). */
  llmDebug?: LlmDebugRecorder
  approvalGate: ApprovalGate
  userInputGate: UserInputGate
  workspaceInspector: WorkspaceInspector
  toolHost?: ToolHost
  attachmentStore?: AttachmentStore
  memoryStore?: MemoryStore
  migrationService?: RuntimeMigrationService
  migrationImportService?: RuntimeMigrationImportService
  /**
   * Active delegation runtime exposed for diagnostics + agent profile
   * listing. Optional so test scaffolds can omit it.
   */
  delegationRuntime?: DelegationRuntime
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
  runTurn(threadId: string, turnId: string): Promise<'completed' | 'failed' | 'aborted'> | void
  /**
   * Relaunch goal continuation turns for threads whose in-flight turn was
   * just reconciled to `failed` after a runtime restart. Returns the number
   * of goals resumed. Optional so embedders without the agent loop can omit it.
   */
  resumeInterruptedGoals?(threadIds: readonly string[]): Promise<number>
  runReview?(input: {
    threadId: string
    turnId: string
    reviewItemId: string
    target: ReviewTarget
    model?: string
    providerId?: string
    accountId?: string
  }): Promise<'completed' | 'failed' | 'aborted'> | void
  runtimeToken: string
  insecure: boolean
  allocateSeq: (threadId: string) => number
  nowIso: () => string
  info(): RuntimeInfoResponse
  applyConfig(request: RuntimeConfigApplyRequest): Promise<RuntimeConfigApplyResponse>
  toolDiagnostics?(): RuntimeToolDiagnostics | Promise<RuntimeToolDiagnostics>
  mcpOAuth?(): McpOAuthDiagnostic[] | Promise<McpOAuthDiagnostic[]>
  clearMcpOAuth?(serverId?: string): Promise<McpOAuthClearResult>
  authorizeMcpOAuth?(serverId: string): Promise<McpOAuthAuthorizeResult>
  skills?(): SkillRuntimeDiagnostics | Promise<SkillRuntimeDiagnostics>
  shutdown?(): Promise<void>
}

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

export type RuntimeToolDiagnostics = {
  providers: ToolProviderPolicy[]
  mcpServers: McpServerDiagnostic[]
  mcpOAuth?: McpOAuthDiagnostic[]
  mcpSearch?: McpSearchRuntimeDiagnostic
  webProviders: WebProviderDiagnostic[]
  skills: SkillRuntimeDiagnostics
  attachments: AttachmentDiagnostics
  memory: MemoryDiagnostics
  imageGen?: ImageGenDiagnostic[]
  speechGen?: SpeechGenDiagnostic[]
  musicGen?: MusicGenDiagnostic[]
  videoGen?: VideoGenDiagnostic[]
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
  /** Optional troubleshooting buffer of the most recent LLM rounds (in-memory). */
  llmDebug?: LlmDebugRecorder
  approvalGate: ApprovalGate
  userInputGate: UserInputGate
  workspaceInspector: WorkspaceInspector
  toolHost?: ToolHost
  attachmentStore?: AttachmentStore
  memoryStore?: MemoryStore
  /**
   * Active delegation runtime exposed for diagnostics + agent profile
   * listing. Optional so test scaffolds can omit it.
   */
  delegationRuntime?: DelegationRuntime
  backgroundShellRuntime?: BackgroundShellRuntime
  supplyChainTrust?: PublisherTrustStore
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
  }): Promise<'completed' | 'failed' | 'aborted'> | void
  runtimeToken: string
  insecure: boolean
  allocateSeq: (threadId: string) => number
  nowIso: () => string
  info(): RuntimeInfoResponse
  toolDiagnostics?(): RuntimeToolDiagnostics | Promise<RuntimeToolDiagnostics>
  mcpOAuth?(): McpOAuthDiagnostic[] | Promise<McpOAuthDiagnostic[]>
  clearMcpOAuth?(serverId?: string): Promise<McpOAuthClearResult>
  authorizeMcpOAuth?(serverId: string): Promise<McpOAuthAuthorizeResult>
  skills?(): SkillRuntimeDiagnostics | Promise<SkillRuntimeDiagnostics>
  shutdown?(): Promise<void>
}

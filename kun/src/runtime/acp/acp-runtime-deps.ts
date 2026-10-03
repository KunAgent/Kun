/**
 * `AcpRuntimeDeps` kept out of the runtime class file (700-line gate): the
 * dependency surface is large and mostly structural, so it lives beside
 * `acp-runtime.ts` and is re-exported from it for existing import sites.
 */
import type {
  HarnessDefinition,
  HarnessId,
  HarnessRoute
} from '../../contracts/harness.js'
import type {
  ApprovalPolicy,
  ApprovalReviewer,
  SandboxMode
} from '../../contracts/policy.js'
import type { SessionStore } from '../../ports/session-store.js'
import type { ThreadStore } from '../../ports/thread-store.js'
import type { UserInputGate } from '../../ports/user-input-gate.js'
import type { WorkerCallbackService } from '../../services/worker-callback-service.js'
import type { ApprovalGate } from '../../ports/approval-gate.js'
import type { ApprovalReviewPort } from '../../ports/approval-review.js'
import type { AttachmentStore } from '../../attachments/attachment-store.js'
import type { RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'
import type { TurnService } from '../../services/turn-service.js'
import type { LlmDebugSink } from '../../services/llm-debug-recorder.js'
import type { TaskWorkspaceLister } from '../../handoff/turn-handoff.js'
import type { TurnLimitsConfig } from '../../loop/turn-limits.js'
import type { DelegatedSessionCoordinator } from '../delegated-session-binding.js'
import type { AcpConnectionPool } from './acp-connection-pool.js'
import type { AcpClientHost } from './acp-client-host.js'
import type { AcpSessionManager } from './acp-session-manager.js'
import type { AcpSpawnFn } from './acp-process.js'
import type { AcpCredentialEnvInput } from './acp-runtime-support.js'
import type { AcpDebugLog } from './acp-jsonrpc.js'
import type { KunToolsMcpProvider } from './kun-tools-mcp.js'
import type { HarnessDefaultsEntry } from '../../config/kun-config-application.js'
import type { HarnessSecretRefResolver } from '../../harness/harness-secret-env.js'

export interface AcpRuntimeDeps {
  readiness?: Pick<import('../../harness/harness-readiness.js').HarnessReadinessService, 'validateTurn' | 'commandForTurn'>
  /** Harness catalog lookup for the frozen route's definition. */
  catalog: { get(id: string): HarnessDefinition | undefined }
  /** Settings `harnesses.binaryPaths` override for `launch.command`. */
  binaryPath?: (harnessId: HarnessId) => string | undefined
  /**
   * `agents.kun.harnesses.defaults` lookup (p4 §3.6, P4-11): supplies the
   * default permission mode when the turn does not pin one.
   */
  harnessDefaults?: (harnessId: HarnessId) => HarnessDefaultsEntry | undefined
  /** Resolves `launch.secretEnv` credential-store refs at spawn (P4-12). */
  resolveSecretEnv?: HarnessSecretRefResolver
  threadStore: ThreadStore
  sessionStore: SessionStore
  turns: TurnService
  events: RuntimeEventRecorder
  ids: { next(prefix: string): string }
  /** Immutable Kun/role prompt supplied by the owning runtime boundary. */
  systemPrompt?: string
  sessionCoordinator?: DelegatedSessionCoordinator
  /** Serve-process-scoped singletons; tests may inject doubles. */
  connectionPool?: AcpConnectionPool
  clientHost?: AcpClientHost
  sessionManager?: AcpSessionManager
  spawn?: AcpSpawnFn
  approvalGate?: ApprovalGate
  approvalReview?: ApprovalReviewPort
  /** Elicitation (P2-10): user_input gate / ask_manager bridges per turn. */
  userInputGate?: UserInputGate
  workerCallbacks?: Pick<WorkerCallbackService, 'askManager'>
  /**
   * Credential env for `kun-gateway`/`provider` modes (`native-login`
   * receives none). Default: none — gateway bridging lands in P1-08.
   */
  credentialEnv?: (input: AcpCredentialEnvInput) => Promise<Record<string, string>>
  /** Extra env keys to strip from the harness child beyond the shared denylist. */
  stripEnv?: readonly string[]
  attachmentStore?: AttachmentStore
  /** Kun Tools MCP provider (P3-08): per-turn kun-tools grant + descriptor. */
  kunToolsMcp?: KunToolsMcpProvider
  taskWorkspaces?: TaskWorkspaceLister
  deterministicHandoff?: boolean
  /** Delegated read-only children deny mutation regardless of parent defaults. */
  enforceReadOnly?: boolean
  /** Narrower mediation roots for child/delegated scopes. */
  allowedReadPaths?: readonly string[]
  allowedWritePaths?: readonly string[]
  allowUnattendedFullAccess?: boolean
  defaultApprovalPolicy?: ApprovalPolicy
  defaultSandboxMode?: SandboxMode
  defaultApprovalReviewer?: ApprovalReviewer
  turnLimits?: TurnLimitsConfig
  /** Desktop Git snapshot gate awaited by the first mutating mediated call. */
  awaitWorkspaceCheckpoint?: (
    checkpointRequestId: string,
    signal: AbortSignal
  ) => Promise<string | null>
  debugSink?: LlmDebugSink
  nowIso?: () => string
  debug?: AcpDebugLog
  cancelSettleMs?: number
  /**
   * P4-03: a real connection acquisition failed (spawn/initialize, not an
   * abort) — report back so the harness catalog stops claiming `ready`.
   */
  onLaunchFailure?: (harnessId: HarnessId, detail: string) => void
}

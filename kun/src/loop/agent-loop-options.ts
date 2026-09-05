import type { ModelClient } from '../ports/model-client.js'
import type { DelegatedTurnRuntime } from '../runtime/delegated-turn-runtime.js'
import type { ToolHost, GuiPlanContext } from '../ports/tool-host.js'
import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ApprovalGate } from '../ports/approval-gate.js'
import type { ApprovalReviewPort } from '../ports/approval-review.js'
import type { UserInputGate } from '../ports/user-input-gate.js'
import type { UsageService } from '../services/usage-service.js'
import type { TurnService } from '../services/turn-service.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { CanvasReceiptRegistry } from '../services/canvas-receipt-registry.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { ImmutablePrefix } from '../cache/immutable-prefix.js'
import type { ContextCompactor } from './context-compactor.js'
import type { RolesConfig } from '../config/kun-config.js'
import type { InflightTracker } from './inflight-tracker.js'
import type { ToolCancellationRegistry } from './tool-cancellation-registry.js'
import type { SteeringQueue } from './steering-queue.js'
import type { ContextCompactionConfig } from './model-context-profile.js'
import type { SkillRuntime } from '../skills/skill-runtime.js'
import type { InstructionRuntime } from '../instructions/instruction-runtime.js'
import type { AttachmentStore } from '../attachments/attachment-store.js'
import type { MemoryStore } from '../memory/memory-store.js'
import type { ArtifactStore } from '../artifacts/artifact-store.js'
import type { PptWorkflowScope } from '../ports/tool-host.js'
import type { ResolvedHook } from '../hooks/hook-engine.js'
import type { TokenEconomyConfig } from './token-economy.js'
import type { ToolStormBreakerOptions } from './tool-storm-breaker.js'
import type { TurnLimitsConfig } from './turn-limits.js'
import type { GoalTurnCoordinatorOptions } from './goal-turn-coordinator.js'
import type { InterruptedTurnResumeOptions } from './interrupted-turn-coordinator.js'
import type { TurnRunOutcome } from './turn-execution-types.js'

export type AgentLoopOptions = {
  threadStore: ThreadStore
  sessionStore: SessionStore
  approvalGate: ApprovalGate
  approvalReview?: ApprovalReviewPort
  userInputGate: UserInputGate
  model: ModelClient
  toolHost: ToolHost
  usage: UsageService
  events: RuntimeEventRecorder
  turns: TurnService
  inflight: InflightTracker
  toolCancellation?: ToolCancellationRegistry
  steering: SteeringQueue
  compactor: ContextCompactor
  prefix: ImmutablePrefix
  ids: IdGenerator
  nowIso: () => string
  nowMs?: () => number
  modelCapabilities?: (model: string, providerId?: string) => ModelCapabilityMetadata
  skillRuntime?: SkillRuntime
  instructionRuntime?: InstructionRuntime
  attachmentStore?: AttachmentStore
  memoryStore?: MemoryStore
  artifactStore?: ArtifactStore
  /** Kun runtime data root for sandbox-safe background shell output reads. */
  runtimeDataDir?: string
  tokenEconomy?: TokenEconomyConfig
  contextCompaction?: ContextCompactionConfig
  /** Internal-LLM role model routing (smallModel slot + title/summary/codeReview overrides). */
  roles?: RolesConfig
  /** Renderer receipt registry for two-phase design canvas tools. */
  receipts?: CanvasReceiptRegistry
  toolStorm?: ToolStormBreakerOptions & { enabled?: boolean }
  turnLimits?: TurnLimitsConfig
  /** Zero-based model step at which tools are withheld for bounded final synthesis. */
  finalAnswerOnlyStep?: number
  /** Internal retrieval-child marker propagated into discovery and execution contexts. */
  fastContext?: boolean
  /** Parent chat thread used to isolate Fast Context scheduling and source-tool slots. */
  fastContextScopeId?: string
  /** Grouped Fast Context task count used to require explicit source attribution. */
  fastContextTaskCount?: number
  /**
   * Disable only the wall-clock deadline for this loop. Delegated child
   * agents use this so they run until completion or explicit cancellation;
   * step and per-response tool-call limits still apply.
   */
  disableWallTimeLimit?: boolean
  toolArgumentRepair?: {
    maxStringBytes?: number
  }
  /** Desktop Git snapshot gate awaited only by the first mutating tool. */
  awaitWorkspaceCheckpoint?: (
    checkpointRequestId: string,
    signal: AbortSignal
  ) => Promise<string | null>
  /**
   * Tuning + test seams for goal auto-resume (KunAgent/Kun#370). Defaults
   * back off exponentially and bound consecutive no-progress retries; tests
   * inject a synchronous timer and small caps for determinism.
   */
  goalResume?: GoalTurnCoordinatorOptions
  /**
   * Tuning + test seams for interrupted-turn auto-resume after a runtime
   * restart (ordinary threads without an active goal). `enabled` defaults to
   * true; `cooldownMs` bounds how soon the same thread can be auto-resumed
   * again after a crash so a restart loop cannot burn model budget.
   */
  interruptedResume?: InterruptedTurnResumeOptions
  /**
   * Host-owned continuation runner. Serve mode uses this to put goal and
   * restart auto-resume work in the same shutdown-wait registry as HTTP,
   * Graph, review, and extension launches.
   */
  runContinuationTurn?: (threadId: string, turnId: string) => Promise<TurnRunOutcome>
  /**
   * Hard allow-list intersected into every tool context for this loop. Used
   * by read-only subagents to clamp the inherited tool host to investigation
   * tools — enforced at both the schema (listTools) and execute layers.
   */
  forcedAllowedToolNames?: readonly string[]
  /** Model-provider allow-list inherited from the parent turn for delegated loops. */
  allowedModelProviderIds?: readonly string[]
  /** Model allow-list inherited from the parent turn for delegated loops. */
  allowedModelIds?: readonly string[]
  /** Provider allow-list inherited from the parent turn for delegated loops. */
  allowedProviderIds?: readonly string[]
  /** Skill allow-list captured at the delegated child boundary. */
  allowedSkillIds?: readonly string[]
  /** Workspace-relative read scopes captured at the delegated child boundary. */
  allowedReadPaths?: readonly string[]
  /** Workspace-relative write scopes captured at the delegated child boundary. */
  allowedWritePaths?: readonly string[]
  /** Artifact capability set captured at the delegated child boundary. */
  allowedArtifactIds?: readonly string[]
  /** Host-minted managed PPT authority for this child execution only. */
  pptWorkflowScope?: PptWorkflowScope
  /**
   * Provider ids hard-blocked for this loop (e.g. a subagent profile's blocked
   * MCP servers, as `mcp:<serverId>`). Deny-list layered on top of inherit and
   * enforced at both the schema and execute layers.
   */
  blockedProviderIds?: readonly string[]
  /**
   * Tool names hard-blocked for this loop (e.g. a subagent profile's blocked
   * built-in tools). Deny-list layered on top of inherit; enforced at both layers.
   */
  blockedToolNames?: readonly string[]
  /**
   * Skill ids hard-blocked for this loop's turns (e.g. a subagent profile's
   * blockedSkills). Hidden from the catalog + auto-activation and rejected by
   * `load_skill`, without mutating the shared skill runtime.
   */
  blockedSkillIds?: readonly string[]
  /**
   * Lifecycle hooks (UserPromptSubmit, TurnStart, TurnEnd, PreCompact).
   * Tool phases are handled by the tool host; the loop ignores them.
   */
  hooks?: readonly ResolvedHook[]
  /**
   * Optional fallback GUI plan context for embedders that run the loop
   * without persisted turn metadata. Normal serve mode reads GUI plan
   * context from the active turn record.
   */
  activePlanContext?: GuiPlanContext
  /**
   * Optional callback to mutate the active plan context (e.g. when the
   * loop records a successful `create_plan` result). The default is a
   * no-op for callers that don't track plan state.
   */
  onActivePlanContextChange?: (context: GuiPlanContext | undefined) => void
  onPlanWritten?: (input: {
    threadId: string
    turnId: string
    planId: string
    relativePath: string
    markdown: string
  }) => Promise<void>
  /**
   * Subscription engine. When set and it owns the active thread's provider,
   * the entire turn is delegated to that provider-native SDK/CLI instead of
   * Kun's HTTP model loop.
   */
  sdkRuntime?: DelegatedTurnRuntime
}

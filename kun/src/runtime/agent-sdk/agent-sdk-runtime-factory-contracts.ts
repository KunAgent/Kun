/**
 * Binds the decoupled {@link AgentSdkRuntime} to kun's real runtime services.
 * This is the only place that touches the SDK package and kun's concrete stores,
 * keeping the orchestration (and its tests) free of both.
 */
import {
  AgentSdkCredentialUnavailableError,
  AgentSdkRuntime,
  agentSdkCapabilities,
  type SdkRuntimeDeps,
  type SdkTurnContext
} from './agent-sdk-runtime.js'
import type { SdkStreamResourceLimits } from './sdk-event-mapper.js'
import {
  normalizeClaudeOAuthToken,
  resolveSdkModel,
  type ToolApprovalDecision
} from './sdk-options-builder.js'
import {
  selectBridgeableTools,
  type BridgeableTool,
  type KunToolResult
} from './sdk-tool-bridge.js'
import type { SdkApi } from './sdk-protocol.js'
import type { RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'
import type { LlmDebugSink } from '../../services/llm-debug-recorder.js'
import type { TurnService } from '../../services/turn-service.js'
import type { TurnRunOutcome } from '../../loop/turn-execution-types.js'
import type { SessionStore } from '../../ports/session-store.js'
import type { ThreadStore } from '../../ports/thread-store.js'
import type { CapabilityRegistry } from '../../adapters/tool/capability-registry.js'
import type { ToolHost, ToolHostContext } from '../../ports/tool-host.js'
import {
  DEFAULT_APPROVAL_REVIEWER,
  DEFAULT_SANDBOX_MODE,
  type ApprovalPolicy,
  type ApprovalReviewer,
  type SandboxMode
} from '../../contracts/policy.js'
import type { ServeProviderConfig } from '../../config/kun-config.js'
import type { AttachmentStore } from '../../attachments/attachment-store.js'
import type { SkillRuntime } from '../../skills/skill-runtime.js'
import type { InstructionRuntime } from '../../instructions/instruction-runtime.js'
import type { MemoryStore } from '../../memory/memory-store.js'
import {
  PLAN_MODE_INSTRUCTION,
  todoContinuationInstruction,
  memoryInstructions,
  isStalePlanContext
} from '../../loop/agent-loop.js'
import {
  filterGoalContextsForGoalKey,
  goalContextKey
} from '../../loop/continuation-instructions.js'
import {
  DESIGN_MODE_INSTRUCTION,
  SVG_ARTIFACT_ALLOWED_TOOL_NAMES,
  SVG_ARTIFACT_MODE_INSTRUCTION
} from '../../loop/design-mode.js'
import type { GuiDesignArtifactContext, GuiPlanContext } from '../../ports/tool-host.js'
import type { ThreadRecord } from '../../contracts/threads.js'
import type {
  UserInputGate,
  UserInputRequest,
  UserInputResolution
} from '../../ports/user-input-gate.js'
import { goalContextTexts, type TurnItem } from '../../contracts/items.js'
import type { ApprovalGate } from '../../ports/approval-gate.js'
import {
  createApprovalActionEnvelope,
  createApprovalRequest,
  safeApprovalActionSummary,
  type ApprovalRequest,
  type ApprovalResolution
} from '../../domain/approval.js'
import type { ApprovalReviewPort } from '../../ports/approval-review.js'
import type { ActingTurnModelRoute } from '../../contracts/turns.js'
import { makeUserInputItem } from '../../domain/item.js'
import { awaitAbortableGate } from '../../services/interactive-gate.js'
import {
  buildHistoryTranscript,
  DEFAULT_SDK_HISTORY_TRANSCRIPT_MAX_BYTES
} from './sdk-context-assembler.js'
import { shellSpawnEnv } from '../../adapters/tool/builtin-tool-utils.js'
import type { TurnLimitsConfig } from '../../loop/turn-limits.js'
import { userMessageTextWithComposerContexts } from '../../domain/composer-context.js'
import { mkdir } from 'node:fs/promises'
import { resolveTurnClientSurface } from '../../loop/turn-context-resolver.js'
import { buildClientSurfaceInstruction } from '../../prompt/kun-prompt-context.js'
import {
  delegatedCapabilityFingerprint,
  delegatedCredentialIdentity,
  priorItemsForDelegatedTurn,
  type DelegatedSessionCoordinator,
  type DelegatedSessionPreparation
} from '../delegated-session-binding.js'
import {
  delegatedGraphCompletionCheck,
  delegatedGraphAllowedToolNames,
  delegatedGraphTurnPolicy,
  intersectDelegatedToolNames,
  parkDelegatedGraphTurnAfterRecovery
} from '../delegated-graph-turn-policy.js'

const CLAUDE_KUN_TOOL_INSTRUCTION = [
  'Kun-managed capabilities are available through the mcp__kun__ tools.',
  'Use these tools for Kun capabilities such as MCP, extensions, skills, memory, media, GUI input, and delegation.',
  'Their execution remains governed by Kun ToolHost approval and sandbox policy.'
].join(' ')

const SDK_ON_REQUEST_AUTO_ALLOWED_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'TodoWrite'
])

export interface AgentSdkRuntimeFactoryDeps {
  registry: CapabilityRegistry
  /**
   * The canonical host boundary for bridged Kun tool execution. Serve always
   * supplies this; an omitted host is denied closed rather than bypassing the
   * policy, sandbox, approval, hook, and operation-journal layers.
   */
  toolHost?: ToolHost
  turns: TurnService
  sessionStore: SessionStore
  threadStore: ThreadStore
  events: RuntimeEventRecorder
  /** Existing Agent Perspective model-request trace sink. */
  debugSink?: LlmDebugSink
  ids: { next(prefix: string): string }
  prefix: { systemPrompt: string }
  /** serve.providers map; `kind:'agent-sdk'` entries carry the OAuth token in apiKey. */
  providerConfigs: Record<string, ServeProviderConfig>
  /** Provider ids whose kind is 'agent-sdk' (this runtime owns them). */
  agentSdkProviderIds: ReadonlySet<string>
  defaultApprovalPolicy: ApprovalPolicy
  defaultSandboxMode?: SandboxMode
  defaultApprovalReviewer?: ApprovalReviewer
  /** Isolated, no-tools automatic reviewer shared with native Kun turns. */
  approvalReview?: ApprovalReviewPort
  /** Runtime default model — used as the Claude model when a thread carries a non-Anthropic id. */
  defaultModel?: string
  /** True when the runtime's own default provider is agent-sdk (Claude sub as main model). */
  defaultIsAgentSdk?: boolean
  /** Token for the default provider (used when a turn doesn't target a specific provider). */
  defaultToken?: string
  /** Protected source for the default route; resolved for every turn. */
  defaultCredentialSourceId?: string
  /**
   * Request-time credential authority. A configured source must resolve here;
   * cached providerConfig.apiKey material is never a fallback because another
   * Runtime may have installed a durable replacement fence.
   */
  resolveCredentialSource?: (sourceId: string) => Promise<{ apiKey: string } | null>
  /** Resolves a turn's image attachments so they can be forwarded to the model. */
  attachmentStore?: AttachmentStore
  /** Skill engine — injects the available-skills catalog + activated skills per turn. */
  skillRuntime?: SkillRuntime
  /** Native Kun AGENTS.md instruction engine — injects global/workspace instructions per turn. */
  instructionRuntime?: InstructionRuntime
  /** Long-term memory store — injects relevant memories per turn. */
  memoryStore?: MemoryStore
  /** Interactive-input gate rendered by whichever supported client initiated the turn. */
  userInputGate?: UserInputGate
  /** Approval gate shared with native tool execution. Missing means deny closed. */
  approvalGate?: ApprovalGate
  /** Clock for stamping item timestamps (falls back to Date when absent). */
  nowIso?: () => string
  /** Cap for the replayed history transcript (bytes); defaults to the assembler's. */
  historyTranscriptMaxBytes?: number
  /** Native runtime safety limits, also applied to delegated Agent SDK turns. */
  turnLimits?: TurnLimitsConfig
  /**
   * Static capability envelope applied to every tool discovery and execution
   * context owned by this runtime (used by delegated child turns).
   */
  toolContextBoundary?: Pick<
    ToolHostContext,
    | 'allowedModelProviderIds'
    | 'allowedModelIds'
    | 'allowedProviderIds'
    | 'allowedToolNames'
    | 'allowedSkillIds'
    | 'allowedReadPaths'
    | 'allowedWritePaths'
    | 'allowedArtifactIds'
    | 'pptWorkflowScope'
    | 'blockedProviderIds'
    | 'blockedToolNames'
    | 'blockedSkillIds'
  >
  /** Child runtimes disable SDK-native tools so all execution crosses Kun's child host. */
  allowSdkBuiltins?: boolean
  /** Optional SDK stream-budget overrides; omitted in normal production wiring. */
  sdkStreamLimits?: Partial<SdkStreamResourceLimits>
  pathToClaudeCodeExecutable?: string
  /** Shared durable provider-session coordinator. */
  sessionCoordinator?: DelegatedSessionCoordinator
  contextProfile?: (model: string) => {
    contextWindowTokens: number
    softThresholdTokens: number
    hardThresholdTokens: number
  }
}

/** Lazily load the real SDK without a static import (so kun typechecks without it). */

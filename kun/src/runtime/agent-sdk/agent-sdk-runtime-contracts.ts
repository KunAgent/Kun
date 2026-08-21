import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'
import type { TurnItem } from '../../contracts/items.js'
import type { ModelRequestTraceDelegated } from '../../contracts/model-request-trace.js'
import type { ApprovalPolicy, ApprovalReviewer, SandboxMode } from '../../contracts/policy.js'
import type { ActingTurnModelRoute } from '../../contracts/turns.js'
import type { LlmDebugSink } from '../../services/llm-debug-recorder.js'
import type { TurnLimitsConfig } from '../../loop/turn-limits.js'
import type { TurnRunOutcome } from '../../loop/turn-execution-types.js'
import type { SdkStreamResourceLimits } from './sdk-event-mapper.js'
import type { ToolApprovalDecision } from './sdk-options-builder.js'
import type { BridgeableTool, KunToolResult } from './sdk-tool-bridge.js'
import type { SdkApi } from './sdk-protocol.js'
import type { DelegatedSessionPreparation } from '../delegated-session-binding.js'
import type {
  DelegatedGraphCompletionCheck,
  DelegatedGraphPhase
} from '../delegated-graph-turn-policy.js'

export type TurnStatus = 'completed' | 'failed' | 'aborted'

export class AgentSdkProtocolError extends Error {
  readonly code = 'agent_sdk_protocol_error'

  constructor(message: string) {
    super(message)
    this.name = 'AgentSdkProtocolError'
  }
}

/** Safe, source-id-free failure raised when a managed Claude credential is fenced or unreadable. */
export class AgentSdkCredentialUnavailableError extends Error {
  readonly code = 'agent_sdk_credential_unavailable'

  constructor() {
    super('Protected Claude subscription credentials are unavailable. Reconnect the provider in Settings.')
    this.name = 'AgentSdkCredentialUnavailableError'
  }
}

export interface SdkTurnContext {
  /** Workspace root the SDK runs in (cwd). */
  workspace: string
  additionalWorkspaces?: readonly string[]
  /** The user's prompt for this turn. */
  userText: string
  /** Send userText byte-for-byte instead of composing portable context into the user prompt. */
  preserveExactUserPrompt?: boolean
  /** Thread-level persona appended to the system prompt. */
  threadPersona?: string
  approvalPolicy: ApprovalPolicy
  sandboxMode?: SandboxMode
  approvalReviewer?: ApprovalReviewer
  actingModelRoute?: ActingTurnModelRoute
  planMode?: boolean
  /** Dedicated artifact turns disable Claude Code's raw filesystem/shell tools. */
  allowSdkBuiltins?: boolean
  /** Preserve Kun read/grep/etc tools when Graph disables the overlapping SDK built-ins. */
  bridgeKunBuiltinOverlaps?: boolean
  /** Durable Graph phase for the bounded host-gated completion exchange. */
  graphPhase?: DelegatedGraphPhase
  /** Enforce structured SVG mutation followed by a later successful validation. */
  requireSvgCompletion?: boolean
  model?: string
  /** Non-sensitive subscription attribution inherited from the selected provider. */
  billingKind?: 'subscription'
  /** Per-turn Claude adaptive-thinking effort selected by the shared client. */
  reasoningEffort?: string
  /** Prior SDK session id for multi-turn continuity. */
  resumeSessionId?: string
  /** Kun-owned local Claude state root for this thread. */
  claudeConfigDir?: string
  /** Opaque, non-secret coordinator token for committing a successful turn. */
  sessionPreparation?: DelegatedSessionPreparation
  /** Expire this provider-native session after request-local dynamic context. */
  disableNativeContinuation?: boolean
  contextProfile?: {
    contextWindowTokens: number
    softThresholdTokens: number
    hardThresholdTokens: number
  }
  /** Subscription OAuth token; absent => rely on the host's Claude Code login. */
  oauthToken?: string
  /** Image attachments to forward to the model (base64 + media type). */
  images?: Array<{ mediaType: string; base64: string }>
  /** kun tool catalog to consider bridging (overlap/excluded are filtered here). */
  bridgeableTools: BridgeableTool[]
  /**
   * Portable prior-conversation handoff used only when creating/rebasing a
   * native session. Resumed turns send only their current delta.
   */
  historyTranscript?: string
  /** Internal context values that must be removed from request diagnostics. */
  redactedRequestValues?: string[]
  /**
   * Per-turn instruction blocks injected after the history (skill catalog,
   * activated skills, memories, goal/todo continuation, plan instruction).
   * Mirrors the native loop's `contextInstructions`.
   */
  contextInstructions?: string[]
  activeSkillIds?: string[]
}

/**
 * When the turn has images, the prompt must be a structured user message (text +
 * image content blocks) rather than a plain string. We yield a single message in
 * the SDK's streaming-input form; the generator ending runs exactly one turn.
 */
export function userMessageStream(
  text: string,
  images: ReadonlyArray<{ mediaType: string; base64: string }>
): AsyncIterable<unknown> {
  const content: Array<Record<string, unknown>> = []
  if (text.trim()) content.push({ type: 'text', text })
  for (const image of images) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mediaType, data: image.base64 }
    })
  }
  const message = { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null }
  return {
    [Symbol.asyncIterator]: async function* () {
      yield message
    }
  }
}

export interface SdkRuntimeDeps {
  /** True when this runtime owns the given provider (kind: 'agent-sdk'). */
  handlesProvider(providerId: string | undefined): boolean
  /** Resolve the turn's inputs; null aborts the turn early (e.g. no user text). */
  loadTurnContext(threadId: string, turnId: string, signal?: AbortSignal): Promise<SdkTurnContext | null>
  /** Execute a kun tool in-process (raw — permission/hooks handled by the SDK seam).
   *  `signal` aborts in-flight interactive work (e.g. a pending user_input). */
  executeKunTool(
    threadId: string,
    turnId: string,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<KunToolResult>
  /** kun's per-call permission decision (routes to the initiating client's approval UI). */
  decideToolApproval(
    threadId: string,
    turnId: string,
    toolName: string,
    input: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<ToolApprovalDecision>
  /** Persist + publish a runtime event (recorder.record). */
  recordEvent(draft: RuntimeEventDraft): Promise<void>
  /** Upsert a turn item into the item store (turns.applyItem). */
  applyItem(threadId: string, item: TurnItem): Promise<void>
  /** Persist one cumulative assistant item before publishing its offset delta. */
  applyAssistantDelta(
    threadId: string,
    item: TurnItem,
    deltaText: string,
    deltaOffset: number
  ): Promise<void>
  /** Finish the turn lifecycle (turns.finishTurn). */
  finishTurn(
    threadId: string,
    turnId: string,
    status: TurnStatus,
    error?: string,
    code?: string
  ): Promise<TurnRunOutcome | void>
  /**
   * Check durable Graph state after the first model response. This may park an
   * idle Graph slice, but it must not force-park pending supervision.
   */
  checkGraphCompletion?(
    threadId: string,
    turnId: string
  ): Promise<DelegatedGraphCompletionCheck>
  /** Stage the SDK session id for commit after Kun finishes successfully. */
  saveSessionId(threadId: string, turnId: string, sessionId: string): Promise<void>
  /** Rotate an unusable native resume preparation before the portable retry. */
  rejectResume?(threadId: string, turnId: string): Promise<void> | void
  /** Lazy-load the real `@anthropic-ai/claude-agent-sdk`. */
  loadSdk(): Promise<SdkApi>
  /** Base process env to scope for the Claude Code subprocess. */
  baseEnv(): Record<string, string | undefined>
  /** The stable kun system prompt (persona) appended to the claude_code preset. */
  kunSystemPrompt(): string
  /** Monotonic id allocator for assistant items. */
  nextId(prefix: string): string
  /** Runtime turn limits, resolved at the start of each delegated SDK turn. */
  getTurnLimits?(): TurnLimitsConfig | undefined
  /** Optional SDK stream-budget overrides (primarily a focused-test seam). */
  getSdkStreamLimits?(): Partial<SdkStreamResourceLimits> | undefined
  /** Existing Agent Perspective trace sink; observability must never affect execution. */
  debugSink?: LlmDebugSink
  /** Optional explicit path to the bundled Claude Code binary (packaging). */
  pathToClaudeCodeExecutable?: string
  /** Serialize native ownership for one Kun thread. */
  runExclusive?<T>(threadId: string, operation: () => Promise<T>): Promise<T>
}

/** Persist an item only at milestones, not on every streaming delta. */

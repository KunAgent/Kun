import { z } from 'zod'
import {
  isPublicTurnItem,
  TurnItem,
  UserInputAnswerSchema,
  UserInputQuestionSchema,
  UserMessageSource
} from './items.js'
import { ThreadAgentSurface, ThreadGoalSchema, ThreadTodoListSchema } from './threads.js'
import { UsageSnapshotSchema } from './usage.js'
import { RuntimeErrorSeverity } from './errors.js'
import {
  ApprovalPolicySchema,
  ApprovalReviewerSchema,
  SandboxModeSchema
} from './policy.js'
import {
  ApprovalActionEnvelopeSchema,
  ApprovalReviewTerminalStatusSchema
} from './approvals.js'
import { SubagentToolPolicy } from './capabilities.js'
import {
  GraphEventEnvelopeV1Schema,
  GraphPlanningLifecycleEventV1Schema
} from './graph.js'
import {
  SteeringEntrySchema,
  TurnClientSurfaceSchema,
  TurnReasoningEffortSchema,
  TurnServiceTierSchema
} from './turns.js'
import { ChildRunFailureSchema, ProactiveRetryStatusSchema } from './subagent-retry.js'
import { MAX_TURN_ATTACHMENT_IDS } from './attachments.js'
import {
  DesignDocumentTargetSchema,
  DesignTaskProfileSchema
} from './design-task-profile.js'

/**
 * Persisted runtime events. Every event has a per-thread `seq` so the
 * SSE stream can be replayed with `since_seq` after reconnects.
 */
export const RuntimeEventKind = z.enum([
  'thread_created',
  'thread_updated',
  'thread_pruned',
  'thread_restored',
  'turn_started',
  'turn_completed',
  'turn_failed',
  'turn_aborted',
  'turn_steered',
  'turn_steering_updated',
  'item_created',
  'item_updated',
  'item_completed',
  'assistant_text_delta',
  'assistant_reasoning_delta',
  'tool_call_ready',
  'required_tool_gate',
  'model_request_retry',
  'tool_result_upload_wait',
  'tool_storm_suppressed',
  'source_tool_page',
  'tool_catalog_changed',
  'tool_call_started',
  'tool_call_finished',
  'approval_requested',
  'approval_resolved',
  'approval_review_started',
  'approval_review_completed',
  'user_input_requested',
  'user_input_resolved',
  'compaction_started',
  'compaction_completed',
  'goal_updated',
  'goal_cleared',
  'todos_updated',
  'todos_cleared',
  'bash_session_started',
  'bash_session_updated',
  'bash_session_completed',
  'pipeline_stage',
  'delegated_runtime',
  'graph_planning',
  'graph_event',
  'context_snapshot',
  'usage',
  'error',
  'canvas_receipt',
  'heartbeat'
])
export type RuntimeEventKind = z.infer<typeof RuntimeEventKind>

export const PipelineStage = z.enum([
  'setup',
  'pre_start',
  'post_start',
  'input_received',
  'input_cached',
  'input_routed',
  'input_compressed',
  'input_remembered',
  'pre_send',
  'post_send',
  'response_received'
])
export type PipelineStage = z.infer<typeof PipelineStage>

/**
 * Safe, compact progress projected from a child thread onto its parent.
 *
 * This intentionally carries only a phase label, never reasoning text or
 * tool output. A parent client can therefore show Kimi-style live activity
 * without subscribing to every child transcript or duplicating private
 * child-session content in the parent event log.
 */
export const ChildRunActivity = z.object({
  phase: z.enum(['starting', 'thinking', 'responding', 'tool', 'retrying', 'compacting', 'waiting']),
  label: z.string().min(1).max(500),
  toolName: z.string().min(1).max(256).optional(),
  startedAt: z.string(),
  updatedAt: z.string()
}).strict()
export type ChildRunActivity = z.infer<typeof ChildRunActivity>

const RuntimeEventBase = z.object({
  seq: z.number().int().nonnegative(),
  timestamp: z.string(),
  threadId: z.string().min(1),
  turnId: z.string().optional(),
  itemId: z.string().optional(),
  child: z.object({
    parentThreadId: z.string().min(1),
    parentTurnId: z.string().min(1),
    childId: z.string().min(1),
    childLabel: z.string().optional(),
    childStatus: z.enum(['queued', 'running', 'completed', 'failed', 'aborted']),
    childSeq: z.number().int().nonnegative(),
    childLauncher: z.preprocess(
      (value) => (value === 'explore_agent' ? 'fast_context' : value),
      z.enum(['delegate_task', 'fast_context', 'ppt_agent', 'component_design', 'graph'])
    ).optional(),
    childTerminationReason: z.enum(['user_stop', 'manual_stop', 'runtime_restart', 'child_error']).optional(),
    resumable: z.boolean().optional(),
    resumeCount: z.number().int().nonnegative().optional(),
    failure: ChildRunFailureSchema.optional(),
    proactiveRetry: ProactiveRetryStatusSchema.optional(),
    detached: z.boolean().optional(),
    // Observability metrics carried alongside the child lifecycle event so
    // the GUI can show prefix reuse, tool fan-out, timing, and cost per
    // subagent without a separate diagnostics fetch.
    childModel: z.string().optional(),
    childProviderId: z.string().optional(),
    childProfile: z.string().optional(),
    childProfileName: z.string().optional(),
    childToolPolicy: SubagentToolPolicy.optional(),
    prefixReused: z.boolean().optional(),
    inheritedHistoryItems: z.number().int().nonnegative().optional(),
    toolInvocations: z.number().int().nonnegative().optional(),
    durationMs: z.number().int().nonnegative().optional(),
    queuedMs: z.number().int().nonnegative().optional(),
    summaryTruncated: z.boolean().optional(),
    resultRef: z.object({
      artifactId: z.string().min(1),
      byteSize: z.number().int().nonnegative(),
      lineCount: z.number().int().nonnegative(),
      mimeType: z.literal('text/markdown')
    }).strict().optional(),
    resultUnavailableReason: z.string().min(1).max(500).optional(),
    totalTokens: z.number().int().nonnegative().optional(),
    cacheHitRate: z.number().min(0).max(1).nullable().optional(),
    costUsd: z.number().nonnegative().optional(),
    costCny: z.number().nonnegative().optional(),
    activity: ChildRunActivity.optional()
  }).optional()
})

/**
 * For assistant_*_delta events, item.text is the newly emitted fragment and
 * consumers MUST append it once by stable item id after applying the seq
 * idempotency gate. item_created/item_updated/item_completed and tool item
 * events carry authoritative snapshots and replace the projected item.
 */
export const ItemEvent = RuntimeEventBase.extend({
  kind: z.enum([
    'item_created',
    'item_updated',
    'item_completed',
    'assistant_text_delta',
    'assistant_reasoning_delta',
    'tool_call_started',
    'tool_call_finished'
  ]),
  /**
   * UTF-16 string offset of an assistant delta within the complete item text.
   * New producers persist the cumulative item snapshot before recording the
   * delta. Consumers can use this offset to make replay idempotent when a
   * hydration snapshot already contains some or all of the fragment. Legacy
   * events omit the field and retain append-once semantics.
   */
  deltaOffset: z.number().int().nonnegative().optional(),
  item: TurnItem
})
export type ItemEvent = z.infer<typeof ItemEvent>

export const ThreadLifecycleEvent = RuntimeEventBase.extend({
  kind: z.enum(['thread_created', 'thread_updated', 'thread_pruned', 'thread_restored']),
  title: z.string().optional(),
  titleAuto: z.boolean().optional(),
  status: z.string().optional(),
  mode: z.enum(['agent', 'plan']).optional(),
  workspace: z.string().optional(),
  additionalWorkspaces: z.array(z.string()).optional(),
  knowledgeBases: z.array(z.object({
    id: z.string(),
    root: z.string(),
    name: z.string(),
    source: z.literal('write-workspace'),
    access: z.literal('read-only')
  })).optional(),
  approvalPolicy: ApprovalPolicySchema.optional(),
  approvalReviewer: ApprovalReviewerSchema.optional(),
  sandboxMode: SandboxModeSchema.optional(),
  modelRequestCaptureEnabled: z.boolean().optional(),
  agentSurface: ThreadAgentSurface.optional(),
  designProfile: DesignTaskProfileSchema.optional()
})
export type ThreadLifecycleEvent = z.infer<typeof ThreadLifecycleEvent>

export const TurnLifecycleEvent = RuntimeEventBase.extend({
  kind: z.enum([
    'turn_started',
    'turn_completed',
    'turn_failed',
    'turn_aborted',
    'turn_steered'
  ]),
  status: z.string().optional(),
  text: z.string().optional(),
  displayText: z.string().optional(),
  messageSource: UserMessageSource.optional(),
  attachmentIds: z.array(z.string().min(1)).max(MAX_TURN_ATTACHMENT_IDS).optional(),
  message: z.string().optional(),
  code: z.string().optional(),
  details: z.unknown().optional(),
  severity: RuntimeErrorSeverity.optional(),
  model: z.string().min(1).optional(),
  providerId: z.string().min(1).optional(),
  accountId: z.string().min(1).optional(),
  reasoningEffort: TurnReasoningEffortSchema.optional(),
  serviceTier: TurnServiceTierSchema.optional(),
  clientSurface: TurnClientSurfaceSchema.optional(),
  approvalPolicy: ApprovalPolicySchema.optional(),
  sandboxMode: SandboxModeSchema.optional(),
  approvalReviewer: ApprovalReviewerSchema.optional(),
  mode: z.enum(['agent', 'plan']).optional(),
  /** Durable thread ownership; `agentSurface` below is only the turn intent. */
  threadAgentSurface: ThreadAgentSurface.optional(),
  agentSurface: ThreadAgentSurface.optional(),
  designProfile: DesignTaskProfileSchema.optional(),
  designDocumentTarget: DesignDocumentTargetSchema.optional()
})
export type TurnLifecycleEvent = z.infer<typeof TurnLifecycleEvent>

export const SteeringEvent = RuntimeEventBase.extend({
  kind: z.literal('turn_steering_updated'),
  entries: z.array(SteeringEntrySchema)
})
export type SteeringEvent = z.infer<typeof SteeringEvent>

export const ApprovalEvent = RuntimeEventBase.extend({
  kind: z.enum(['approval_requested', 'approval_resolved']),
  approvalId: z.string().min(1),
  toolName: z.string().min(1),
  status: z.enum(['pending', 'allowed', 'denied', 'expired']),
  approvalPolicy: ApprovalPolicySchema.optional(),
  approvalReviewer: ApprovalReviewerSchema.optional(),
  decisionSource: ApprovalReviewerSchema.optional(),
  sandboxMode: SandboxModeSchema.optional(),
  summary: z.string().optional(),
  reason: z.string().optional(),
  action: ApprovalActionEnvelopeSchema.optional()
})
export type ApprovalEvent = z.infer<typeof ApprovalEvent>

export const ApprovalReviewStartedEvent = RuntimeEventBase.extend({
  kind: z.literal('approval_review_started'),
  reviewId: z.string().min(1),
  approvalId: z.string().min(1),
  toolName: z.string().min(1),
  reviewer: z.literal('agent'),
  status: z.literal('in-progress'),
  summary: z.string().min(1).max(2_048),
  action: ApprovalActionEnvelopeSchema.optional()
}).strict()
export type ApprovalReviewStartedEvent = z.infer<typeof ApprovalReviewStartedEvent>

export const ApprovalReviewCompletedEvent = RuntimeEventBase.extend({
  kind: z.literal('approval_review_completed'),
  reviewId: z.string().min(1),
  approvalId: z.string().min(1),
  toolName: z.string().min(1),
  reviewer: z.literal('agent'),
  status: ApprovalReviewTerminalStatusSchema,
  summary: z.string().min(1).max(2_048),
  decision: z.enum(['allow', 'deny']).optional(),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  rationale: z.string().min(1).max(2_048)
}).strict()
export type ApprovalReviewCompletedEvent = z.infer<typeof ApprovalReviewCompletedEvent>

export const UserInputEvent = RuntimeEventBase.extend({
  kind: z.enum(['user_input_requested', 'user_input_resolved']),
  inputId: z.string().min(1),
  status: z.enum(['pending', 'submitted', 'cancelled', 'timeout']),
  prompt: z.string().optional(),
  questions: z.array(UserInputQuestionSchema).optional(),
  answers: z.array(UserInputAnswerSchema).optional(),
  timeoutSeconds: z.number().int().positive().optional()
})
export type UserInputEvent = z.infer<typeof UserInputEvent>

export const ToolCallReadyEvent = RuntimeEventBase.extend({
  kind: z.literal('tool_call_ready'),
  toolName: z.string().min(1),
  callId: z.string().min(1),
  readyCount: z.number().int().positive()
})
export type ToolCallReadyEvent = z.infer<typeof ToolCallReadyEvent>

/** Structured progress for a hard named-tool gate; never assistant text. */
export const RequiredToolGateEvent = RuntimeEventBase.extend({
  kind: z.literal('required_tool_gate'),
  toolName: z.string().min(1).max(256),
  phase: z.enum(['preparing', 'retrying', 'succeeded', 'failed']),
  attempt: z.number().int().positive(),
  maxAttempts: z.number().int().positive(),
  failureSummary: z.string().min(1).max(2_048).optional()
})
export type RequiredToolGateEvent = z.infer<typeof RequiredToolGateEvent>

export const ModelRequestRetryEvent = RuntimeEventBase.extend({
  kind: z.literal('model_request_retry'),
  status: z.number().int().min(100).max(599).optional(),
  attempt: z.number().int().positive(),
  maxAttempts: z.number().int().positive(),
  delayMs: z.number().int().nonnegative(),
  reason: z.enum(['network', 'stream_transport', 'context_overflow']).optional(),
  /** Sanitized upstream failure retained so a retry row can expose details. */
  failureSummary: z.string().min(1).max(1_024).optional()
})
export type ModelRequestRetryEvent = z.infer<typeof ModelRequestRetryEvent>

export const ToolUploadStatusEvent = RuntimeEventBase.extend({
  kind: z.literal('tool_result_upload_wait'),
  status: z.literal('waiting'),
  toolResultCount: z.number().int().nonnegative()
})
export type ToolUploadStatusEvent = z.infer<typeof ToolUploadStatusEvent>

export const ToolStormSuppressedEvent = RuntimeEventBase.extend({
  kind: z.literal('tool_storm_suppressed'),
  toolName: z.string().min(1),
  callId: z.string().min(1),
  message: z.string()
})
export type ToolStormSuppressedEvent = z.infer<typeof ToolStormSuppressedEvent>

export const SourceToolPageEvent = RuntimeEventBase.extend({
  kind: z.literal('source_tool_page'),
  toolName: z.enum(['read', 'grep', 'glob', 'find']),
  callId: z.string().min(1),
  hasMore: z.boolean(),
  continuation: z.enum(['offset', 'cursor', 'none']),
  budgetTokens: z.number().int().nonnegative().optional()
})
export type SourceToolPageEvent = z.infer<typeof SourceToolPageEvent>

export const ToolCatalogEvent = RuntimeEventBase.extend({
  kind: z.literal('tool_catalog_changed'),
  fingerprint: z.string().min(1),
  toolCount: z.number().int().nonnegative(),
  changeKind: z.enum(['additive', 'breaking']).optional(),
  toolNames: z.array(z.string().min(1)).optional(),
  message: z.string().optional()
})
export type ToolCatalogEvent = z.infer<typeof ToolCatalogEvent>

export const CompactionEvent = RuntimeEventBase.extend({
  kind: z.enum(['compaction_started', 'compaction_completed']),
  summary: z.string().optional(),
  replacedTokens: z.number().int().nonnegative().optional(),
  // Whether the compaction was triggered automatically by the loop
  // (context threshold) or explicitly requested by the user via the
  // `/compact` command. Absent on legacy/auto events (treated as auto).
  auto: z.boolean().optional(),
  pinnedConstraints: z.array(z.string()).optional(),
  sourceDigest: z.string().min(1).optional(),
  digestMarker: z.string().min(1).optional(),
  sourceItemIds: z.array(z.string().min(1)).optional(),
  /** Post-compaction estimated input tokens for the next request. */
  contextEstimate: z.number().int().nonnegative().optional(),
  /** Token budget the verbatim tail was trimmed to, when configured. */
  tailTokenBudget: z.number().int().positive().optional(),
  /** Number of model_context deltas folded into the canonical baseline. */
  squashedContextItems: z.number().int().nonnegative().optional()
})
export type CompactionEvent = z.infer<typeof CompactionEvent>

export const GoalEvent = RuntimeEventBase.extend({
  kind: z.enum(['goal_updated', 'goal_cleared']),
  goal: ThreadGoalSchema.nullable().optional(),
  cleared: z.boolean().optional()
})
export type GoalEvent = z.infer<typeof GoalEvent>

export const TodoEvent = RuntimeEventBase.extend({
  kind: z.enum(['todos_updated', 'todos_cleared']),
  todos: ThreadTodoListSchema.nullable().optional(),
  cleared: z.boolean().optional()
})
export type TodoEvent = z.infer<typeof TodoEvent>

export const BashSessionEvent = RuntimeEventBase.extend({
  kind: z.enum(['bash_session_started', 'bash_session_updated', 'bash_session_completed']),
  sessionId: z.string().min(1),
  command: z.string(),
  cwd: z.string(),
  shell: z.string(),
  status: z.enum(['running', 'completed', 'stopped', 'failed']),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  exitCode: z.number().int().nullable().optional(),
  detached: z.boolean(),
  output: z.string().default(''),
  outputTruncated: z.boolean().optional(),
  outputFilePath: z.string().optional(),
  error: z.string().optional()
})
export type BashSessionEvent = z.infer<typeof BashSessionEvent>

export const RequestContextTokenBreakdownSchema = z.object({
  tools: z.number().int().nonnegative(),
  system: z.number().int().nonnegative(),
  skills: z.number().int().nonnegative(),
  messages: z.number().int().nonnegative(),
  other: z.number().int().nonnegative()
})
export type RequestContextTokenBreakdown = z.infer<typeof RequestContextTokenBreakdownSchema>

export const ContextSnapshotEvent = RuntimeEventBase.extend({
  kind: z.literal('context_snapshot'),
  model: z.string().min(1),
  providerId: z.string().min(1).optional(),
  stepIndex: z.number().int().nonnegative(),
  contextWindowTokens: z.number().int().positive(),
  softThresholdTokens: z.number().int().positive(),
  hardThresholdTokens: z.number().int().positive(),
  estimatedInputTokens: z.number().int().nonnegative(),
  breakdown: RequestContextTokenBreakdownSchema,
  toolCount: z.number().int().nonnegative(),
  activeSkillIds: z.array(z.string().min(1)),
  contextManagement: z.enum(['kun-managed', 'sdk-managed']).optional(),
  nativeHistory: z.enum(['known', 'unknown', 'none']).optional()
})
export type ContextSnapshotEvent = z.infer<typeof ContextSnapshotEvent>

export const DelegatedRuntimeCapabilitiesSchema = z.object({
  nativeResume: z.boolean(),
  structuredStreaming: z.boolean(),
  kunTools: z.boolean(),
  externalApproval: z.boolean(),
  liveSteering: z.boolean(),
  nativeContextTelemetry: z.boolean(),
  fork: z.boolean()
})

export const DelegatedRuntimeEvent = RuntimeEventBase.extend({
  kind: z.literal('delegated_runtime'),
  providerKind: z.enum(['agent-sdk', 'cursor-sdk', 'antigravity-cli']),
  providerId: z.string().min(1),
  phase: z.enum(['portable', 'resumed', 'rebased']),
  reason: z.enum([
    'new',
    'route_changed',
    'capabilities_changed',
    'history_changed',
    'native_state_unavailable'
  ]).optional(),
  capabilities: DelegatedRuntimeCapabilitiesSchema
})
export type DelegatedRuntimeEvent = z.infer<typeof DelegatedRuntimeEvent>

export const GraphRuntimeEvent = RuntimeEventBase.extend({
  kind: z.literal('graph_event'),
  graph: GraphEventEnvelopeV1Schema
})
export type GraphRuntimeEvent = z.infer<typeof GraphRuntimeEvent>

export const GraphPlanningRuntimeEvent = RuntimeEventBase.extend({
  kind: z.literal('graph_planning'),
  planning: GraphPlanningLifecycleEventV1Schema
}).strict()
export type GraphPlanningRuntimeEvent = z.infer<typeof GraphPlanningRuntimeEvent>

export const UsageEvent = RuntimeEventBase.extend({
  kind: z.literal('usage'),
  model: z.string().optional(),
  providerId: z.string().min(1).optional(),
  accountId: z.string().min(1).optional(),
  attribution: z.enum(['agent-turn', 'approval-review']).optional(),
  usage: UsageSnapshotSchema
})
export type UsageEvent = z.infer<typeof UsageEvent>

export const PipelineStageEvent = RuntimeEventBase.extend({
  kind: z.literal('pipeline_stage'),
  stage: PipelineStage,
  label: z.string().min(1).optional(),
  details: z.record(z.string(), z.unknown()).optional()
})
export type PipelineStageEvent = z.infer<typeof PipelineStageEvent>

export const ErrorEvent = RuntimeEventBase.extend({
  kind: z.literal('error'),
  message: z.string(),
  code: z.string().optional(),
  details: z.unknown().optional(),
  severity: RuntimeErrorSeverity.optional()
})
export type ErrorEvent = z.infer<typeof ErrorEvent>

export const HeartbeatEvent = RuntimeEventBase.extend({
  kind: z.literal('heartbeat')
})
export type HeartbeatEvent = z.infer<typeof HeartbeatEvent>

export const CanvasReceiptEvent = RuntimeEventBase.extend({
  kind: z.literal('canvas_receipt'),
  itemId: z.string().min(1),
  receiptKey: z.string().min(1),
  status: z.enum(['applied', 'failed']),
  errorCount: z.number().int().min(0).optional(),
  affectedCount: z.number().int().min(0).optional()
})
export type CanvasReceiptEvent = z.infer<typeof CanvasReceiptEvent>

export const RuntimeEvent = z.discriminatedUnion('kind', [
  ItemEvent,
  ThreadLifecycleEvent,
  TurnLifecycleEvent,
  SteeringEvent,
  ApprovalEvent,
  ApprovalReviewStartedEvent,
  ApprovalReviewCompletedEvent,
  UserInputEvent,
  ToolCallReadyEvent,
  RequiredToolGateEvent,
  ModelRequestRetryEvent,
  ToolUploadStatusEvent,
  ToolStormSuppressedEvent,
  SourceToolPageEvent,
  ToolCatalogEvent,
  CompactionEvent,
  GoalEvent,
  TodoEvent,
  BashSessionEvent,
  PipelineStageEvent,
  DelegatedRuntimeEvent,
  GraphPlanningRuntimeEvent,
  GraphRuntimeEvent,
  ContextSnapshotEvent,
  UsageEvent,
  ErrorEvent,
  CanvasReceiptEvent,
  HeartbeatEvent
])
export type RuntimeEvent = z.infer<typeof RuntimeEvent>

/**
 * Runtime streams can contain model-only item records for durable internal
 * state. Public transports must never expose those records even if a legacy
 * migration or a future producer accidentally persists an item event for one.
 */
export function isPublicRuntimeEvent(event: RuntimeEvent): boolean {
  return !('item' in event) || isPublicTurnItem(event.item)
}

export const RuntimeEventList = z.array(RuntimeEvent)
export type RuntimeEventList = z.infer<typeof RuntimeEventList>

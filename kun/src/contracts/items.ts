import { z } from 'zod'
import { ReviewOutputSchema, ReviewTargetSchema } from './review.js'
import { RuntimeErrorSeverity } from './errors.js'
import {
  ComposerContextAttachmentSchema,
  MAX_COMPOSER_CONTEXT_ATTACHMENTS
} from './composer-context.js'
import {
  DesignDocumentTargetSchema,
  DesignImagePlacementTargetSchema,
  DesignTaskProfileSchema
} from './design-task-profile.js'

/**
 * Conversation items returned as part of a thread or turn.
 *
 * Items represent normalized content (text, reasoning, tool calls, tool
 * results, approvals, and errors). The renderer maps items into chat
 * blocks; the server only persists and replays them.
 */
export const TurnItemRole = z.enum(['user', 'assistant', 'system', 'tool'])
export type TurnItemRole = z.infer<typeof TurnItemRole>

export const TurnItemStatus = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'aborted'
])
export type TurnItemStatus = z.infer<typeof TurnItemStatus>

export const TurnItemBase = z.object({
  id: z.string().min(1),
  turnId: z.string().min(1),
  threadId: z.string().min(1),
  role: TurnItemRole,
  status: TurnItemStatus,
  createdAt: z.string(),
  finishedAt: z.string().optional()
})

export const UserInputOptionSchema = z.object({
  label: z.string().min(1),
  description: z.string()
})

export const UserInputQuestionSchema = z.object({
  header: z.string().min(1),
  id: z.string().min(1),
  question: z.string().min(1),
  options: z.array(UserInputOptionSchema),
  selectionMode: z.enum(['single', 'multiple']).optional(),
  minSelections: z.number().int().positive().optional(),
  maxSelections: z.number().int().positive().optional()
})

export const UserInputAnswerSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  value: z.string().default(''),
  labels: z.array(z.string().min(1)).optional(),
  values: z.array(z.string()).optional()
})

export const UserFileReferenceSchema = z.object({
  path: z.string().min(1),
  relativePath: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['file', 'directory']).optional()
})
export type UserFileReference = z.infer<typeof UserFileReferenceSchema>

export const UserMessageSource = z.enum([
  'background_shell',
  'background_subagent',
  'graph_runtime',
  'subagent_resume',
  'design_continuation'
])
export type UserMessageSource = z.infer<typeof UserMessageSource>

export const UserTurnItem = TurnItemBase.extend({
  kind: z.literal('user_message'),
  text: z.string(),
  displayText: z.string().optional(),
  messageSource: UserMessageSource.optional(),
  attachmentIds: z.array(z.string().min(1)).optional(),
  composerContexts: z.array(ComposerContextAttachmentSchema).max(MAX_COMPOSER_CONTEXT_ATTACHMENTS).optional(),
  fileReferences: z.array(UserFileReferenceSchema).optional(),
  workspaceCheckpointId: z.string().min(1).optional(),
  /** Durable source workspace used to keep session-only Design resumes scoped. */
  workspace: z.string().min(1).max(4096).optional(),
  /** Durable thread ownership snapshot for session-only resume recovery. */
  threadAgentSurface: z.enum(['code', 'write', 'design']).optional(),
  /** Effective per-turn intent; distinct from durable thread ownership. */
  agentSurface: z.enum(['code', 'write', 'design']).optional(),
  /** Effective Design task contract retained with the queued user request. */
  designProfile: DesignTaskProfileSchema.optional(),
  /** Immutable canvas target used for live and replay routing. */
  designDocumentTarget: DesignDocumentTargetSchema.optional(),
  /** Frozen canvas placement intent for replaying an AI image after restart. */
  designImagePlacementTarget: DesignImagePlacementTargetSchema.optional()
})
export type UserTurnItem = z.infer<typeof UserTurnItem>

/**
 * Durable, model-visible context created once when an active goal starts a
 * turn. It deliberately lives in the canonical session history rather than
 * the renderer-facing turn projection: usage and elapsed-time accounting stay
 * host-owned, while the model receives one stable description in chronological
 * history for cache continuity.
 */
export const GoalContextTurnItem = TurnItemBase.extend({
  kind: z.literal('goal_context'),
  role: z.literal('system'),
  status: z.literal('completed'),
  /**
   * Stable identity of the active goal that produced this private item.
   * Optional only to read an interrupted early rollout safely; new records
   * always carry it and legacy records are never forwarded as active context.
   */
  goalKey: z.string().min(1).optional(),
  text: z.string()
})
export type GoalContextTurnItem = z.infer<typeof GoalContextTurnItem>

export const ModelContextAuthority = z.enum([
  'runtime',
  'user',
  'workspace',
  'skill',
  'extension',
  'reference'
])
export type ModelContextAuthority = z.infer<typeof ModelContextAuthority>

export const ModelContextBlockState = z.object({
  key: z.string().min(1),
  kind: z.string().min(1),
  authority: ModelContextAuthority,
  state: z.enum(['active', 'inactive']),
  digest: z.string().min(1).optional(),
  /** Format 2 baseline records carry the canonical content inline. */
  content: z.string().optional()
}).strict()
export type ModelContextBlockState = z.infer<typeof ModelContextBlockState>

/**
 * Exact, private model-visible context appended before a model dispatch.
 * The rendered text is persisted so a restart never regenerates already-sent
 * time, persona, mode, workspace, Skill, or recovery bytes differently.
 *
 * Format 1 stores append-only deltas whose `text` is the rendered envelope.
 * A baseline item adds `baseline: true` and carries canonical `content`
 * inline on each active block so a squashed history can be rebuilt
 * structurally without parsing rendered text.
 */
export const ModelContextTurnItem = TurnItemBase.extend({
  kind: z.literal('model_context'),
  role: z.literal('system'),
  status: z.literal('completed'),
  formatVersion: z.literal(1),
  /** Marks a squashed canonical baseline replacing all earlier deltas. */
  baseline: z.literal(true).optional(),
  stepIndex: z.number().int().nonnegative(),
  contentDigest: z.string().min(1),
  blocks: z.array(ModelContextBlockState),
  text: z.string().min(1)
})
export type ModelContextTurnItem = z.infer<typeof ModelContextTurnItem>

export const INTERNAL_RUNTIME_CONTEXT_MAX_CHARS = 32_768

/** Private host input projected into request-only context for its owning turn. */
export const RuntimeContextSourceTurnItem = TurnItemBase.extend({
  kind: z.literal('runtime_context_source'),
  role: z.literal('system'),
  status: z.literal('completed'),
  contextKind: z.literal('host-control'),
  content: z.string().trim().min(1).max(INTERNAL_RUNTIME_CONTEXT_MAX_CHARS)
})
export type RuntimeContextSourceTurnItem = z.infer<typeof RuntimeContextSourceTurnItem>

/**
 * Durable, model-visible checkpoint written when a turn is interrupted by a
 * runtime restart or host shutdown. It records what the task was doing (first
 * user request, last assistant progress, recently completed tool calls) so an
 * auto-resumed turn can pick up where the work stopped instead of asking the
 * user to repeat themselves. Like goal context it is canonical session
 * history, never renderer content.
 */
export const InterruptionNoteTurnItem = TurnItemBase.extend({
  kind: z.literal('interruption_note'),
  role: z.literal('system'),
  status: z.literal('completed'),
  /** Stable id of the interrupted turn this note describes. */
  sourceTurnId: z.string().min(1),
  text: z.string()
})
export type InterruptionNoteTurnItem = z.infer<typeof InterruptionNoteTurnItem>

export const AssistantTextTurnItem = TurnItemBase.extend({
  kind: z.literal('assistant_text'),
  text: z.string()
})
export type AssistantTextTurnItem = z.infer<typeof AssistantTextTurnItem>

export const AssistantReasoningTurnItem = TurnItemBase.extend({
  kind: z.literal('assistant_reasoning'),
  text: z.string()
})
export type AssistantReasoningTurnItem = z.infer<typeof AssistantReasoningTurnItem>

export const ToolCallTurnItem = TurnItemBase.extend({
  kind: z.literal('tool_call'),
  toolName: z.string().min(1),
  callId: z.string().min(1),
  /** Set when a user requested cancellation of this still-running call. */
  cancelRequestedAt: z.string().optional(),
  toolKind: z.enum(['tool_call', 'command_execution', 'file_change']),
  arguments: z.record(z.string(), z.unknown()),
  /**
   * Bounded provider-owned continuation data required to replay a tool call.
   * It is persisted with canonical history but never sent to tools or
   * providers other than the owning adapter.
   */
  providerMetadata: z.object({
    gemini: z.object({
      thoughtSignature: z.string().min(1).max(131_072)
    }).strict().optional(),
    anthropic: z.object({
      /**
       * Exact opaque thinking blocks returned before a Messages API tool use.
       * Anthropic requires the latest assistant tool-use turn to be replayed
       * byte-for-byte, including signatures. These blocks are used only for
       * that same Kun turn and are never synthesized for another protocol.
       */
      thinkingBlocks: z.array(z.discriminatedUnion('type', [
        z.object({
          type: z.literal('thinking'),
          thinking: z.string().max(262_144),
          signature: z.string().min(1).max(262_144)
        }).strict(),
        z.object({
          type: z.literal('redacted_thinking'),
          data: z.string().min(1).max(262_144)
        }).strict()
      ])).min(1).max(16)
    }).strict().optional()
  }).strict().optional(),
  summary: z.string().optional()
})
export type ToolCallTurnItem = z.infer<typeof ToolCallTurnItem>
export type ToolCallProviderMetadata = NonNullable<ToolCallTurnItem['providerMetadata']>

export const ToolResultTurnItem = TurnItemBase.extend({
  kind: z.literal('tool_result'),
  toolName: z.string().min(1),
  callId: z.string().min(1),
  toolKind: z.enum(['tool_call', 'command_execution', 'file_change']),
  output: z.unknown(),
  isError: z.boolean().default(false)
})
export type ToolResultTurnItem = z.infer<typeof ToolResultTurnItem>

export const ApprovalTurnItem = TurnItemBase.extend({
  kind: z.literal('approval'),
  approvalId: z.string().min(1),
  toolName: z.string().min(1),
  summary: z.string(),
  status: z.enum(['pending', 'allowed', 'denied', 'expired']),
  approvalReviewer: z.enum(['user', 'agent']).optional(),
  decisionSource: z.enum(['user', 'agent']).optional(),
  reason: z.string().optional()
})
export type ApprovalTurnItem = z.infer<typeof ApprovalTurnItem>

export const UserInputTurnItem = TurnItemBase.extend({
  kind: z.literal('user_input'),
  inputId: z.string().min(1),
  prompt: z.string(),
  questions: z.array(UserInputQuestionSchema).default([]),
  answers: z.array(UserInputAnswerSchema).optional(),
  status: z.enum(['pending', 'submitted', 'cancelled', 'timeout']),
  timeoutSeconds: z.number().int().positive().optional()
})
export type UserInputTurnItem = z.infer<typeof UserInputTurnItem>

export const CompactionTurnItem = TurnItemBase.extend({
  kind: z.literal('compaction'),
  summary: z.string(),
  replacedTokens: z.number().int().nonnegative(),
  // `false` when the user explicitly ran `/compact`; absent for
  // loop-triggered (automatic) compaction so legacy items keep rendering
  // as auto.
  auto: z.boolean().optional(),
  pinnedConstraints: z.array(z.string()),
  sourceDigest: z.string().min(1).optional(),
  digestMarker: z.string().min(1).optional(),
  sourceItemIds: z.array(z.string().min(1)).optional()
})
export type CompactionTurnItem = z.infer<typeof CompactionTurnItem>

export const ReviewTurnItem = TurnItemBase.extend({
  kind: z.literal('review'),
  target: ReviewTargetSchema,
  title: z.string().min(1),
  reviewText: z.string().optional(),
  output: ReviewOutputSchema.optional()
})
export type ReviewTurnItem = z.infer<typeof ReviewTurnItem>

export const ErrorTurnItem = TurnItemBase.extend({
  kind: z.literal('error'),
  message: z.string(),
  code: z.string().optional(),
  details: z.unknown().optional(),
  severity: RuntimeErrorSeverity.optional()
})
export type ErrorTurnItem = z.infer<typeof ErrorTurnItem>

export const TurnItem = z.discriminatedUnion('kind', [
  UserTurnItem,
  GoalContextTurnItem,
  ModelContextTurnItem,
  RuntimeContextSourceTurnItem,
  InterruptionNoteTurnItem,
  AssistantTextTurnItem,
  AssistantReasoningTurnItem,
  ToolCallTurnItem,
  ToolResultTurnItem,
  ApprovalTurnItem,
  UserInputTurnItem,
  CompactionTurnItem,
  ReviewTurnItem,
  ErrorTurnItem
])
export type TurnItem = z.infer<typeof TurnItem>

export type TurnItemKind = TurnItem['kind']

/** Internal history records must never be projected through public thread APIs. */
export function isPublicTurnItem(item: TurnItem): boolean {
  return item.kind !== 'goal_context' && item.kind !== 'model_context' &&
    item.kind !== 'runtime_context_source' && item.kind !== 'interruption_note'
}

/**
 * Exact private strings to remove from any diagnostic request capture. Covers
 * all internal record kinds: active-goal instructions, append-only model
 * context, and interruption checkpoints must not leak into debug traces.
 */
export function goalContextTexts(items: readonly TurnItem[]): string[] {
  return [...new Set(items.flatMap((item) =>
    item.kind === 'goal_context' || item.kind === 'model_context' ||
      item.kind === 'interruption_note' ? [item.text] : []
  ))]
}

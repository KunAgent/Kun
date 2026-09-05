import { z } from 'zod'
import { TurnItem, UserFileReferenceSchema, UserMessageSource } from './items.js'
import { isGuiPlanRelativePath } from '../shared/gui-plan.js'
import {
  ApprovalPolicySchema,
  ApprovalReviewerSchema,
  SandboxModeSchema
} from './policy.js'
import { MAX_TURN_ATTACHMENT_IDS } from './attachments.js'
import {
  ComposerContextAttachmentSchema,
  MAX_COMPOSER_CONTEXT_ATTACHMENTS
} from './composer-context.js'
import { GraphOrchestrationStrategySchema } from './graph.js'
import { GraphPlanningDraftStatusSchema } from './graph-planning.js'
import { TurnReasoningEffortSchema } from './turn-reasoning.js'
import { ThreadRetentionPolicySchema } from './thread-retention.js'
import {
  DesignDocumentTargetSchema,
  DesignImagePlacementTargetSchema,
  DesignTaskProfileInputSchema,
  DesignTaskProfileSchema
} from './design-task-profile.js'
import { WriteTurnContextSchema } from './write-turn-context.js'

export { TurnReasoningEffortSchema } from './turn-reasoning.js'
export type { TurnReasoningEffort } from './turn-reasoning.js'

/**
 * Upper bound for a turn-scoped persona. Personas are short stance/voice
 * guidance, not documents; the cap keeps a mistyped paste from displacing
 * conversation context.
 */
export const TURN_PERSONA_MAX_CHARS = 2000

/**
 * Mode enum, inlined here (instead of importing `ThreadMode` from
 * `threads.js`) to avoid a `threads <-> turns` module init cycle:
 * `threads.ts` already imports `TurnSchema` from this file. The two
 * literals must stay in sync with `ThreadMode` in `threads.ts`.
 */
const TurnModeSchema = z.enum(['agent', 'plan'])
export const SubagentResumeRequestSchema = z.object({
  childId: z.string().trim().min(1).max(256),
  expectedResumeCount: z.number().int().nonnegative()
}).strict()
export type SubagentResumeRequest = z.infer<typeof SubagentResumeRequestSchema>
/** Canonical Codex/API request value. The legacy UI label is "fast". */
export const TurnServiceTierSchema = z.literal('priority')
export type TurnServiceTier = z.infer<typeof TurnServiceTierSchema>
export const TurnClientSurfaceSchema = z.enum(['gui', 'tui', 'cli', 'api', 'im', 'extension'])
export type TurnClientSurface = z.infer<typeof TurnClientSurfaceSchema>

/**
 * Immutable transport route used by model-controlled approval review for one
 * acting turn. It contains identifiers only; credentials remain host-owned.
 */
export const ActingTurnModelRouteSchema = z.object({
  model: z.string().trim().min(1),
  providerId: z.string().trim().min(1).optional(),
  accountId: z.string().trim().min(1).optional()
}).strict()
export type ActingTurnModelRoute = Readonly<z.infer<typeof ActingTurnModelRouteSchema>>

/**
 * Plan operation kinds the renderer can advertise on a plan turn.
 * Mirrors the shared renderer contract so request metadata stays
 * stable across reconnects and replays.
 */
export const GuiPlanOperationSchema = z.enum(['draft', 'refine'])
export type GuiPlanOperationJson = z.infer<typeof GuiPlanOperationSchema>

/**
 * Plan context the renderer can attach to a `StartTurnRequest`. The
 * thread mode is carried on the thread record; this struct adds the
 * reserved path and source request needed to scope `create_plan`.
 */
export const GuiPlanContextSchema = z.object({
  operation: GuiPlanOperationSchema,
  workspaceRoot: z.string().min(1),
  relativePath: z
    .string()
    .min(1)
    .refine(isGuiPlanRelativePath, {
      message: 'relativePath must be a direct Markdown file under .kunsdd/plan'
    }),
  planId: z.string().min(1),
  sourceRequest: z.string().optional(),
  title: z.string().optional()
})
export type GuiPlanContextJson = z.infer<typeof GuiPlanContextSchema>

export const GuiDesignArtifactContextSchema = z.object({
  kind: z.literal('svg'),
  artifactId: z.string().min(1),
  relativePath: z.string().min(1).refine((value) => {
    const normalized = value.replaceAll('\\', '/')
    return normalized === value &&
      normalized.startsWith('.kun-design/') &&
      !normalized.split('/').includes('..') &&
      /\/v\d+\.svg$/i.test(normalized)
  }, { message: 'relativePath must be a versioned SVG file under .kun-design' })
})
export type GuiDesignArtifactContextJson = z.infer<typeof GuiDesignArtifactContextSchema>

export const TurnStatus = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'aborted'
])
export type TurnStatus = z.infer<typeof TurnStatus>

export const InjectedMemorySummarySchema = z.object({
  id: z.string().min(1),
  content: z.string()
})
export type InjectedMemorySummary = z.infer<typeof InjectedMemorySummarySchema>

export const InjectedInstructionSourceSchema = z.object({
  scope: z.enum(['global', 'workspace']),
  path: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  truncated: z.boolean().default(false)
})
export type InjectedInstructionSource = z.infer<typeof InjectedInstructionSourceSchema>

/**
 * Durable state for a hard named-tool gate. It is deliberately optional so
 * legacy turns remain valid, while an interrupted Graph creation turn cannot
 * restart its bounded retry window after a runtime restart.
 */
export const RequiredToolGateSchema = z.object({
  toolName: z.string().min(1).max(256),
  attempt: z.number().int().positive(),
  maxAttempts: z.number().int().positive(),
  phase: z.enum(['preparing', 'retrying', 'succeeded', 'failed']),
  lastError: z.string().min(1).max(2_048).optional()
}).strict()
export type RequiredToolGate = z.infer<typeof RequiredToolGateSchema>

/**
 * Durable ownership state for a Graph source Lead. The turn remains logically
 * running while its process-local execution lease is suspended between
 * material Graph events.
 */
export const GraphLeadLifecycleSchema = z.object({
  version: z.literal(1),
  runId: z.string().min(1),
  state: z.enum(['supervising', 'awaiting_user', 'finalizing']),
  lastDeliveredSeq: z.number().int().nonnegative().default(0),
  suspendedAt: z.string().optional(),
  resumedAt: z.string().optional()
}).strict()
export type GraphLeadLifecycle = z.infer<typeof GraphLeadLifecycleSchema>

export const GraphPlanningLifecycleSchema = z.object({
  version: z.literal(1),
  draftId: z.string().min(1),
  reservedRunId: z.string().min(1),
  state: GraphPlanningDraftStatusSchema,
  draftRevision: z.number().int().positive(),
  /** Process shutdown parked execution without changing the durable draft state. */
  suspendedAt: z.string().optional()
}).strict()
export type GraphPlanningLifecycle = z.infer<typeof GraphPlanningLifecycleSchema>

/** Manager-authored proof that an execution owner expired for this turn. */
export const ManagerLeaseSettlementSchema = z.object({
  code: z.literal('owner_lease_expired'),
  ownerFlavor: z.enum(['production', 'development']),
  ownerInstanceId: z.string().min(1).max(256),
  fencingToken: z.number().int().positive(),
  settledAt: z.string().datetime()
}).strict()
export type ManagerLeaseSettlement = z.infer<typeof ManagerLeaseSettlementSchema>

export const TurnSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  /** Client-generated admission key. Missing on turns created by legacy clients. */
  clientRequestId: z.string().trim().min(1).max(256).optional(),
  /** SHA-256 of the canonical start request bound to clientRequestId. */
  clientRequestFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  /** Set when the user item and any first-turn ownership locks are durably committed. */
  admissionCompletedAt: z.string().optional(),
  /**
   * Marks a start record whose user item/profile commit has not reached the
   * durable admission boundary yet. Missing is intentional for committed and
   * legacy turns so restart recovery never mistakes old history for debris.
   */
  admissionPending: z.literal(true).optional(),
  status: TurnStatus,
  prompt: z.string(),
  messageSource: UserMessageSource.optional(),
  /** Explicit one-click continuation request for an interrupted generic child. */
  subagentResume: SubagentResumeRequestSchema.optional(),
  model: z.string().optional(),
  providerId: z.string().optional(),
  accountId: z.string().min(1).optional(),
  /** First successfully resolved route; immutable for the remainder of this turn. */
  actingModelRoute: ActingTurnModelRouteSchema.optional(),
  reasoningEffort: TurnReasoningEffortSchema.optional(),
  serviceTier: TurnServiceTierSchema.optional(),
  /** Client that initiated this turn. Used only for per-turn capability and prompt scoping. */
  clientSurface: TurnClientSurfaceSchema.optional(),
  /** Immutable execution-authority snapshot captured when this turn starts. */
  approvalPolicy: ApprovalPolicySchema.optional(),
  sandboxMode: SandboxModeSchema.optional(),
  approvalReviewer: ApprovalReviewerSchema.optional(),
  /** Steered text queued by the user mid-turn. Cleared on completion. */
  steering: z.array(z.string()).default([]),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  items: z.array(TurnItem).default([]),
  attachmentIds: z.array(z.string().min(1)).default([]),
  composerContexts: z.array(ComposerContextAttachmentSchema).max(MAX_COMPOSER_CONTEXT_ATTACHMENTS).optional(),
  activeSkillIds: z.array(z.string().min(1)).default([]),
  injectedMemoryIds: z.array(z.string().min(1)).default([]),
  injectedMemorySummaries: z.array(InjectedMemorySummarySchema).default([]),
  skillInjectionBytes: z.number().int().nonnegative().optional(),
  injectedInstructionSources: z.array(InjectedInstructionSourceSchema).default([]),
  instructionInjectionBytes: z.number().int().nonnegative().optional(),
  workspaceCheckpointId: z.string().min(1).optional(),
  /** Pending GUI checkpoint whose completion gates the first mutating tool. */
  workspaceCheckpointRequestId: z.string().min(1).optional(),
  toolCatalogFingerprint: z.string().optional(),
  toolCatalogToolCount: z.number().int().nonnegative().optional(),
  toolCatalogDrift: z.boolean().optional(),
  /** Optional persisted hard-tool gate. Missing legacy values mean inactive. */
  requiredToolGate: RequiredToolGateSchema.optional(),
  /** Optional durable ownership state for a suspended/resumable Graph Lead. */
  graphLeadLifecycle: GraphLeadLifecycleSchema.optional(),
  /** Durable pre-GraphRun planning ownership for Graph turns. */
  graphPlanningLifecycle: GraphPlanningLifecycleSchema.optional(),
  /** Extension-run budget accounting persisted across runtime restarts. */
  extensionBudgetTokenBaseline: z.number().int().nonnegative().optional(),
  extensionModelRequests: z.number().int().nonnegative().optional(),
  extensionToolInvocations: z.number().int().nonnegative().optional(),
  guiPlan: GuiPlanContextSchema.optional(),
  /**
   * True for renderer-owned design canvas turns. Kun advertises the
   * `design_canvas` tool only for these turns; the renderer applies the
   * returned ops to its canvas store.
   */
  guiDesignCanvas: z.boolean().optional(),
  /** True only for product Design-mode turns; Code canvas turns leave it unset. */
  guiDesignMode: z.boolean().optional(),
  /** Product surface that owns this turn. Missing legacy values behave as Code. */
  agentSurface: z.enum(['code', 'write', 'design']).optional(),
  /** Effective immutable Design profile snapshotted at admission. */
  designProfile: DesignTaskProfileSchema.optional(),
  /** Explicit replay target duplicated from the effective Design profile. */
  designDocumentTarget: DesignDocumentTargetSchema.optional(),
  /** Durable document reference for Write turns; verified again at promotion. */
  writeContext: WriteTurnContextSchema.optional(),
  /**
   * Turn-scoped persona text chosen by the user in the composer. Rendered as
   * a `user`-authority dynamic context block after history, so it never
   * touches the immutable prefix or the cached history span.
   */
  persona: z.string().max(TURN_PERSONA_MAX_CHARS).optional(),
  /** Reserved first-class SVG artifact for structured SVG tools. */
  guiDesignArtifact: GuiDesignArtifactContextSchema.optional(),
  /**
   * Optional per-turn mode override. When set, it takes precedence over
   * the thread mode for this turn (e.g. a Plan-mode turn inside an
   * otherwise agent thread, or a Build turn that runs as agent).
   */
  mode: TurnModeSchema.optional(),
  /** Per-turn orchestration strategy. Missing legacy values behave as direct. */
  orchestration: GraphOrchestrationStrategySchema.default('direct'),
  /**
   * True when no interactive user is attached to this turn (IM bridges,
   * headless runs). Kun hides `user_input`/`request_user_input` and
   * rejects calls to them instead of blocking on a GUI answer.
   */
  disableUserInput: z.boolean().optional(),
  /**
   * True when this turn originated from an IM bridge. Kun exposes
   * IM-only tools such as outbound attachment delivery only for these
   * turns.
   */
  imContext: z.boolean().optional(),
  /** Optional stable machine-readable reason for a terminal turn. */
  terminalCode: z.string().trim().min(1).max(128).optional(),
  /** Internal Manager-authored ownership-expiry provenance. */
  managerLeaseSettlement: ManagerLeaseSettlementSchema.optional(),
  error: z.string().optional()
})
export type Turn = z.infer<typeof TurnSchema>

export const StartTurnRequest = z.object({
  prompt: z.string().min(1),
  /** Retry-stable client-generated admission key, scoped to this thread. */
  clientRequestId: z.string().trim().min(1).max(256).optional(),
  /**
   * Opaque one-time host proof for the first turn in a managed plan-build
   * fork. It contributes to the canonical request fingerprint but is never
   * copied into a durable Turn record.
   */
  displayText: z.string().optional(),
  messageSource: UserMessageSource.optional(),
  /** Binds this turn to one interrupted child and its last observed attempt. */
  subagentResume: SubagentResumeRequestSchema.optional(),
  model: z.string().optional(),
  providerId: z.string().optional(),
  accountId: z.string().min(1).optional(),
  reasoningEffort: TurnReasoningEffortSchema.optional(),
  serviceTier: TurnServiceTierSchema.optional(),
  /** Initiating client surface. It does not grant authority beyond the advertised tool policy. */
  clientSurface: TurnClientSurfaceSchema.optional(),
  approvalPolicy: ApprovalPolicySchema.optional(),
  sandboxMode: SandboxModeSchema.optional(),
  approvalReviewer: ApprovalReviewerSchema.optional(),
  /**
   * Optional per-turn mode. Overrides the thread mode for this turn so
   * the GUI can toggle Plan/agent without recreating the thread. In Plan
   * mode Kun advertises `create_plan` for the whole conversation.
   */
  mode: TurnModeSchema.optional(),
  /**
   * Optional persona text for this turn only. It guides tone, stance, and
   * working style; it cannot grant tools or relax policy. Kun renders it as
   * a `user`-authority context block after history so switching personas
   * mid-thread leaves the cached prefix and history byte-stable.
   */
  persona: z.string().max(TURN_PERSONA_MAX_CHARS).optional(),
  /**
   * Explicitly selects host-owned Graph orchestration for this turn.
   * Missing values preserve the existing direct agent loop.
   */
  orchestration: GraphOrchestrationStrategySchema.default('direct'),
  attachments: z
    .array(
      z.object({
        path: z.string().min(1),
        name: z.string().min(1)
      })
    )
    .optional(),
  attachmentIds: z.array(z.string().min(1)).max(MAX_TURN_ATTACHMENT_IDS).refine(
    (ids) => new Set(ids).size === ids.length,
    { message: 'attachmentIds must not contain duplicates' }
  ).default([]),
  composerContexts: z.array(ComposerContextAttachmentSchema)
    .max(MAX_COMPOSER_CONTEXT_ATTACHMENTS)
    .refine(
      (attachments) => new Set(attachments.map((attachment) => attachment.attachmentId)).size === attachments.length,
      { message: 'composerContexts must not contain duplicate attachmentId values' }
    )
    .default([]),
  fileReferences: z.array(UserFileReferenceSchema).default([]),
  workspaceCheckpointId: z.string().min(1).optional(),
  workspaceCheckpointRequestId: z.string().min(1).optional(),
  /**
   * Optional GUI plan context. When set, Kun advertises the
   * `create_plan` tool for the turn and writes only to the reserved
   * path advertised in the context.
   */
  guiPlan: GuiPlanContextSchema.optional(),
  /**
   * True for renderer-owned design canvas turns. Enables the `design_canvas`
   * tool for this turn only.
   */
  guiDesignCanvas: z.boolean().optional(),
  /** True only for product Design-mode turns; Code canvas turns leave it unset. */
  guiDesignMode: z.boolean().optional(),
  /** Product surface used to scope subagent discovery and execution. */
  agentSurface: z.enum(['code', 'write', 'design']).optional(),
  /** Candidate profile for the first Design turn, or a matching later-turn snapshot. */
  designProfile: DesignTaskProfileInputSchema.optional(),
  /** Canvas routing target; when supplied it must match designProfile.documentTarget. */
  designDocumentTarget: DesignDocumentTargetSchema.optional(),
  /** Durable document reference for Write turns. */
  writeContext: WriteTurnContextSchema.optional(),
  /** Frozen target for durable placement of a generated primary image. */
  designImagePlacementTarget: DesignImagePlacementTargetSchema.optional(),
  /** Reserved first-class SVG artifact for structured SVG tools. */
  guiDesignArtifact: GuiDesignArtifactContextSchema.optional(),
  /**
   * True when the caller cannot relay structured input prompts to a
   * user (IM bridges such as WeChat/Feishu, headless runs). The turn
   * runs without the `user_input`/`request_user_input` tools.
   */
  disableUserInput: z.boolean().optional(),
  /**
   * True when the turn is handled through an IM bridge. This gates
   * IM-only tool exposure separately from generic headless turns.
   */
  imContext: z.boolean().optional(),
  /**
   * When true and the thread already has an active turn, the request is
   * persisted as a queued turn instead of being rejected with a busy
   * conflict. The runtime starts queued turns in order once the active
   * turn settles. Callers that omit this keep the historical 409 behavior.
   */
  enqueueIfBusy: z.boolean().optional()
}).superRefine((value, ctx) => {
  if (Boolean(value.designProfile) !== Boolean(value.designDocumentTarget)) {
    ctx.addIssue({
      code: 'custom',
      path: ['designDocumentTarget'],
      message: 'designProfile and designDocumentTarget must be supplied together'
    })
  }
  if (
    value.designProfile &&
    value.designDocumentTarget &&
    (
      value.designProfile.documentTarget.documentId !== value.designDocumentTarget.documentId ||
      value.designProfile.documentTarget.boardArtifactId !== value.designDocumentTarget.boardArtifactId
    )
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['designDocumentTarget'],
      message: 'designDocumentTarget must match designProfile.documentTarget'
    })
  }
  if (value.designProfile && value.agentSurface && value.agentSurface !== 'design') {
    ctx.addIssue({
      code: 'custom',
      path: ['agentSurface'],
      message: 'a Design profile requires agentSurface design'
    })
  }
  if (value.designImagePlacementTarget && value.designProfile?.outputMedium !== 'image') {
    ctx.addIssue({
      code: 'custom',
      path: ['designImagePlacementTarget'],
      message: 'image placement requires an image Design profile'
    })
  }
})
export type StartTurnRequest = z.input<typeof StartTurnRequest>

export const StartTurnResponse = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  userMessageItemId: z.string().min(1),
  /** Present for enqueueIfBusy requests persisted as queued turns. */
  status: TurnStatus.optional(),
  /** 1-based position among this thread's queued turns when status is queued. */
  queuedPosition: z.number().int().positive().optional(),
  /** Durable thread ownership; distinct from the effective surface of this turn. */
  threadAgentSurface: z.enum(['code', 'write', 'design']).optional(),
  /** Effective surface for this turn. */
  agentSurface: z.enum(['code', 'write', 'design']).optional(),
  designProfile: DesignTaskProfileSchema.optional(),
  designDocumentTarget: DesignDocumentTargetSchema.optional(),
  writeContext: WriteTurnContextSchema.optional()
})
export type StartTurnResponse = z.infer<typeof StartTurnResponse>

export const MoveQueuedTurnRequest = z.object({
  /** Move the queued turn directly before this queued sibling. */
  beforeTurnId: z.string().min(1).optional(),
  /** Move the queued turn directly after this queued sibling. */
  afterTurnId: z.string().min(1).optional()
}).refine(
  (value) => Boolean(value.beforeTurnId) !== Boolean(value.afterTurnId),
  { message: 'exactly one of beforeTurnId or afterTurnId is required' }
)
export type MoveQueuedTurnRequest = z.infer<typeof MoveQueuedTurnRequest>

export const SteerTurnRequest = z.object({
  text: z.string().min(1),
  displayText: z.string().optional(),
  messageSource: UserMessageSource.optional(),
  attachmentIds: z.array(z.string().trim().min(1)).max(MAX_TURN_ATTACHMENT_IDS).refine(
    (ids) => new Set(ids).size === ids.length,
    { message: 'attachmentIds must not contain duplicates' }
  ).optional()
})
export type SteerTurnRequest = z.infer<typeof SteerTurnRequest>

export const SteeringEntrySchema = z.object({
  text: z.string().trim().min(1),
  displayText: z.string().trim().min(1).optional(),
  messageSource: UserMessageSource.optional(),
  attachmentIds: z.array(z.string().trim().min(1)).max(MAX_TURN_ATTACHMENT_IDS).refine(
    (ids) => new Set(ids).size === ids.length,
    { message: 'attachmentIds must not contain duplicates' }
  ).optional()
}).strict()
export type SteeringEntry = z.infer<typeof SteeringEntrySchema>

export const ReplaceSteeringRequest = z.object({
  entries: z.array(SteeringEntrySchema).max(32)
}).strict()
export type ReplaceSteeringRequest = z.infer<typeof ReplaceSteeringRequest>

export const SteeringQueueResponse = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  entries: z.array(SteeringEntrySchema)
}).strict()
export type SteeringQueueResponse = z.infer<typeof SteeringQueueResponse>

export const InterruptTurnRequest = z.object({
  /**
   * When true, discard generated items from the interrupted turn while
   * preserving the user's prompt. Omitted/false keeps the aborted items
   * visible for inspection.
   */
  discard: z.boolean().optional()
})
export type InterruptTurnRequest = z.infer<typeof InterruptTurnRequest>

export const InterruptTurnResponse = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  status: TurnStatus
})
export type InterruptTurnResponse = z.infer<typeof InterruptTurnResponse>

export const CancelToolCallResponse = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  callId: z.string().min(1),
  status: z.enum(['cancellation_requested', 'already_requested'])
}).strict()
export type CancelToolCallResponse = z.infer<typeof CancelToolCallResponse>

export const CompactRequest = z.object({
  reason: z.string().optional(),
  /** Optional explicit token budget. */
  budgetTokens: z.number().int().positive().optional(),
  /** Archive history through this completed turn, preserving the later tail verbatim. */
  cutoffTurnId: z.string().trim().min(1).optional(),
  /** Internal prune path may explicitly skip the archive hook. */
  archiveBeforePrune: z.boolean().optional()
})
export type CompactRequest = z.infer<typeof CompactRequest>

export const CompactResponse = z.object({
  threadId: z.string().min(1),
  replacedTokens: z.number().int().nonnegative(),
  summary: z.string(),
  pinnedConstraints: z.array(z.string()),
  sourceDigest: z.string().min(1).optional(),
  digestMarker: z.string().min(1).optional(),
  sourceItemIds: z.array(z.string().min(1)).optional(),
  archivePath: z.string().min(1).optional(),
  archivedItems: z.number().int().nonnegative().optional(),
  retainedItems: z.number().int().nonnegative().optional(),
  contextEstimate: z.number().int().nonnegative().optional()
})
export type CompactResponse = z.infer<typeof CompactResponse>

export const PruneThreadRequest = ThreadRetentionPolicySchema
export type PruneThreadRequest = z.infer<typeof PruneThreadRequest>

export const PruneThreadResponse = z.object({
  threadId: z.string().min(1),
  policy: ThreadRetentionPolicySchema,
  pruned: z.boolean(),
  cutoffTurnId: z.string().min(1).optional(),
  archivedItems: z.number().int().nonnegative(),
  retainedItems: z.number().int().nonnegative(),
  archivePath: z.string().min(1).optional(),
  /** Complete pre-prune snapshot created before any canonical rewrite. */
  snapshotId: z.string().min(1).optional(),
  /** Number of turn skeletons removed from ThreadRecord.turns. */
  removedTurns: z.number().int().nonnegative().optional(),
  /** New replay floor for SSE clients; cursors below it must re-sync. */
  eventReplayFloorSeq: z.number().int().nonnegative().optional()
}).strict()
export type PruneThreadResponse = z.infer<typeof PruneThreadResponse>

export const PrunePreviewRequest = ThreadRetentionPolicySchema
export type PrunePreviewRequest = z.infer<typeof PrunePreviewRequest>

export const PrunePreviewResponse = z.object({
  threadId: z.string().min(1),
  cutoffTurnId: z.string().min(1).optional(),
  prunableTurns: z.number().int().nonnegative(),
  prunableItems: z.number().int().nonnegative(),
  retainedTurns: z.number().int().nonnegative(),
  retainedItems: z.number().int().nonnegative(),
  contextEstimateBefore: z.number().int().nonnegative(),
  contextEstimateAfter: z.number().int().nonnegative(),
  snapshotRequiredBytes: z.number().int().nonnegative(),
  blockedBy: z.array(z.enum(['active_turn', 'thread_missing', 'nothing_to_prune'])).default([]),
  /** Present when not blocked; pass back as expectedThreadRevision to prune. */
  threadRevision: z.number().int().nonnegative().optional()
}).strict()
export type PrunePreviewResponse = z.infer<typeof PrunePreviewResponse>

export const PruneCommitRequest = ThreadRetentionPolicySchema.extend({
  /** Optional optimistic-concurrency guard from a preceding preview. */
  expectedThreadRevision: z.number().int().nonnegative().optional()
})
export type PruneCommitRequest = z.infer<typeof PruneCommitRequest>

export const ThreadSnapshotSummary = z.object({
  snapshotId: z.string().min(1),
  createdAt: z.string().min(1),
  reason: z.enum(['prune', 'restore', 'scheduled', 'manual']),
  threadRevision: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  verified: z.boolean()
}).strict()
export type ThreadSnapshotSummary = z.infer<typeof ThreadSnapshotSummary>

export const ThreadSnapshotsResponse = z.object({
  threadId: z.string().min(1),
  snapshots: z.array(ThreadSnapshotSummary)
}).strict()
export type ThreadSnapshotsResponse = z.infer<typeof ThreadSnapshotsResponse>

export const RestoreSnapshotResponse = z.object({
  threadId: z.string().min(1),
  snapshotId: z.string().min(1),
  restored: z.boolean(),
  /** Safety snapshot captured immediately before the restore ran. */
  safetySnapshotId: z.string().min(1).optional()
}).strict()
export type RestoreSnapshotResponse = z.infer<typeof RestoreSnapshotResponse>

export const RewindThreadRequest = z.object({
  turnId: z.string().min(1)
})
export type RewindThreadRequest = z.infer<typeof RewindThreadRequest>

export const RewindThreadResponse = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  removedTurns: z.number().int().nonnegative(),
  remainingTurns: z.number().int().nonnegative()
})
export type RewindThreadResponse = z.infer<typeof RewindThreadResponse>

/**
 * A lightweight summary of one durable turn still waiting in a thread's queue.
 * Used by the renderer to reconcile locally-persisted rows against the runtime
 * after a crash between admission and local persistence.
 */
export const QueuedTurnSummarySchema = z.object({
  turnId: z.string().min(1),
  clientRequestId: z.string().trim().min(1).max(256).optional(),
  position: z.number().int().nonnegative(),
  createdAt: z.string()
}).strict()
export type QueuedTurnSummary = z.infer<typeof QueuedTurnSummarySchema>

export const QueuedTurnsResponseSchema = z.object({
  queuedTurns: z.array(QueuedTurnSummarySchema)
}).strict()
export type QueuedTurnsResponse = z.infer<typeof QueuedTurnsResponseSchema>

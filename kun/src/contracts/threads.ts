import { z } from 'zod'
import { TurnSchema, TurnStatus } from './turns.js'
import {
  ApprovalPolicySchema,
  ApprovalReviewerSchema,
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_APPROVAL_REVIEWER,
  DEFAULT_SANDBOX_MODE,
  SandboxModeSchema
} from './policy.js'
import {
  DesignDocumentTargetSchema,
  DesignTaskProfileSchema
} from './design-task-profile.js'
import { ThreadRetentionPolicySchema } from './thread-retention.js'
import { ThreadIndexStatusInfoSchema } from './thread-index-status.js'

export const ThreadStatus = z.enum(['idle', 'running', 'archived', 'deleted'])
export type ThreadStatus = z.infer<typeof ThreadStatus>

export const THREAD_RUNTIME_STATE_SCHEMA_VERSION = 1

/**
 * Small runtime-facing projection for background status checks.  Unlike the
 * full thread document this deliberately excludes turn items/history, making
 * it safe to poll while another conversation is selected.
 */
export const ThreadRuntimeStateSchema = z.object({
  schemaVersion: z.literal(THREAD_RUNTIME_STATE_SCHEMA_VERSION),
  id: z.string().min(1),
  status: ThreadStatus,
  updatedAt: z.string(),
  latestSeq: z.number().int().nonnegative(),
  replayFloorSeq: z.number().int().nonnegative().optional(),
  /** Live request ids that still require a user response. */
  pendingUserInputIds: z.array(z.string().min(1)),
  latestTurn: z.object({
    id: z.string().min(1),
    status: TurnStatus,
    orchestration: z.enum(['direct', 'graph'])
  }).nullable()
})
export type ThreadRuntimeState = z.infer<typeof ThreadRuntimeStateSchema>

/**
 * Wire reader for state forwarded by another execution owner. Older runtimes
 * predate both the version marker and live user-input projection; accept only
 * those two omissions, then normalize the result through the strict schema.
 */
export const CompatibleThreadRuntimeStateSchema = ThreadRuntimeStateSchema.extend({
  schemaVersion: z.literal(THREAD_RUNTIME_STATE_SCHEMA_VERSION).optional(),
  pendingUserInputIds: z.array(z.string().min(1)).optional().default([]),
  replayFloorSeq: z.number().int().nonnegative().optional()
})

export function normalizeThreadRuntimeStateWire(
  value: unknown
): ThreadRuntimeState {
  return ThreadRuntimeStateSchema.parse({
    schemaVersion: THREAD_RUNTIME_STATE_SCHEMA_VERSION,
    ...CompatibleThreadRuntimeStateSchema.parse(value)
  })
}

export const THREAD_RUNTIME_STATE_BATCH_MAX_IDS = 200
export const THREAD_RUNTIME_STATE_BATCH_CONCURRENCY = 4

export const ThreadRuntimeStateBatchRequestSchema = z.object({
  threadIds: z.array(z.string().trim().min(1))
    .min(1)
    .max(THREAD_RUNTIME_STATE_BATCH_MAX_IDS)
}).strict()
export type ThreadRuntimeStateBatchRequest = z.infer<typeof ThreadRuntimeStateBatchRequestSchema>

export const ThreadRuntimeStateBatchResultSchema = z.discriminatedUnion('ok', [
  z.object({
    id: z.string().min(1),
    ok: z.literal(true),
    state: ThreadRuntimeStateSchema
  }),
  z.object({
    id: z.string().min(1),
    ok: z.literal(false),
    error: z.object({
      // `unavailable` stays the generic bucket; the finer codes exist so logs
      // and operators can tell owner/schema/storage failures apart. Renderers
      // should keep showing a single "state unavailable" affordance.
      code: z.enum([
        'not_found',
        'unavailable',
        'owner_unreachable',
        'owner_error',
        'schema_incompatible',
        'storage_error'
      ]),
      message: z.string().min(1)
    })
  })
])
export type ThreadRuntimeStateBatchResult = z.infer<typeof ThreadRuntimeStateBatchResultSchema>

export const ThreadRuntimeStateBatchResponseSchema = z.object({
  results: z.array(ThreadRuntimeStateBatchResultSchema).max(THREAD_RUNTIME_STATE_BATCH_MAX_IDS)
})
export type ThreadRuntimeStateBatchResponse = z.infer<typeof ThreadRuntimeStateBatchResponseSchema>

export const THREAD_TIMELINE_MAX_ITEMS = 300
export const THREAD_TIMELINE_MAX_ITEM_BYTES = 4 * 1024 * 1024

export const ThreadTimelinePageSchema = z.object({
  nextCursor: z.string().min(1).optional(),
  hasMore: z.boolean(),
  itemCount: z.number().int().nonnegative().max(THREAD_TIMELINE_MAX_ITEMS),
  itemBytes: z.number().int().nonnegative().max(THREAD_TIMELINE_MAX_ITEM_BYTES)
})
export type ThreadTimelinePage = z.infer<typeof ThreadTimelinePageSchema>

/**
 * The generic thread PATCH endpoint only owns the archival visibility
 * overlay. Execution and deletion states are controlled by TurnService and
 * ThreadService.delete respectively, so an HTTP client cannot manufacture a
 * running/deleted lifecycle state.
 */
export const ThreadUpdateStatus = z.enum(['idle', 'archived'])
export type ThreadUpdateStatus = z.infer<typeof ThreadUpdateStatus>

export const ThreadMode = z.enum(['agent', 'plan'])
export type ThreadMode = z.infer<typeof ThreadMode>

/** Product surface that owns a thread. Missing legacy values are resolved conservatively. */
export const ThreadAgentSurface = z.enum(['code', 'write', 'design'])
export type ThreadAgentSurface = z.infer<typeof ThreadAgentSurface>

/** Recoverable source metadata required before cloning a persisted session. */
export const ResumeSessionMetadataSchema = z.object({
  sessionId: z.string().min(1),
  sourceAgentSurface: ThreadAgentSurface,
  workspace: z.string().min(1).optional(),
  sourceDesignProfile: DesignTaskProfileSchema.optional(),
  sourceDesignDocumentTarget: DesignDocumentTargetSchema.optional(),
  requiresIndependentDesignTarget: z.boolean()
})
export type ResumeSessionMetadata = z.infer<typeof ResumeSessionMetadataSchema>

export const MAX_THREAD_KNOWLEDGE_BASES = 8

export const KnowledgeBaseMountSchema = z.object({
  id: z.string().trim().min(1).max(128),
  root: z.string().trim().min(1).max(4_096),
  name: z.string().trim().min(1).max(200),
  source: z.literal('write-workspace'),
  access: z.literal('read-only')
}).strict()
export type KnowledgeBaseMount = z.infer<typeof KnowledgeBaseMountSchema>

export const KnowledgeBaseMountsSchema = z.array(KnowledgeBaseMountSchema)
  .max(MAX_THREAD_KNOWLEDGE_BASES)
  .superRefine((mounts, ctx) => {
    const ids = new Set<string>()
    const roots = new Set<string>()
    mounts.forEach((mount, index) => {
      const root = mount.root.replace(/[\\/]+$/, '').toLocaleLowerCase()
      if (ids.has(mount.id)) {
        ctx.addIssue({ code: 'custom', path: [index, 'id'], message: 'knowledge base ids must be unique' })
      }
      if (roots.has(root)) {
        ctx.addIssue({ code: 'custom', path: [index, 'root'], message: 'knowledge base roots must be unique' })
      }
      ids.add(mount.id)
      roots.add(root)
    })
  })

export const KnowledgeBaseIndexStateSchema = z.enum([
  'pending', 'indexing', 'ready', 'stale', 'unavailable', 'error'
])
export type KnowledgeBaseIndexState = z.infer<typeof KnowledgeBaseIndexStateSchema>

export const KnowledgeBaseIndexStatusSchema = z.object({
  id: z.string().min(1),
  state: KnowledgeBaseIndexStateSchema,
  documentCount: z.number().int().nonnegative(),
  nodeCount: z.number().int().nonnegative(),
  availableDocumentCount: z.number().int().nonnegative().optional(),
  unavailableDocumentCount: z.number().int().nonnegative().optional(),
  truncatedDocumentCount: z.number().int().nonnegative().optional(),
  formatCounts: z.record(z.string(), z.number().int().nonnegative()).optional(),
  diagnostics: z.array(z.string().max(500)).max(20).optional(),
  lastIndexedAt: z.string().optional(),
  error: z.string().max(1_000).optional()
})
export type KnowledgeBaseIndexStatus = z.infer<typeof KnowledgeBaseIndexStatusSchema>

export const ThreadKnowledgeBasesResponseSchema = z.object({
  mounts: KnowledgeBaseMountsSchema,
  statuses: z.array(KnowledgeBaseIndexStatusSchema).max(MAX_THREAD_KNOWLEDGE_BASES)
})
export type ThreadKnowledgeBasesResponse = z.infer<typeof ThreadKnowledgeBasesResponseSchema>

/**
 * Discriminator describing how a thread relates to its origin.
 *
 * - `primary`: a top-level thread (the default).
 * - `fork`: a manual fork of another thread (switched-away clone).
 * - `side`: a "by-the-way" side conversation that inherits a one-time
 *   snapshot of its parent and runs in parallel. Excluded from the
 *   default thread listing.
 */
export const ThreadRelation = z.enum(['primary', 'fork', 'side'])
export type ThreadRelation = z.infer<typeof ThreadRelation>

export const ThreadGoalStatus = z.enum([
  'active',
  'paused',
  'blocked',
  'usageLimited',
  'budgetLimited',
  'complete'
])
export type ThreadGoalStatus = z.infer<typeof ThreadGoalStatus>

export const MAX_THREAD_GOAL_OBJECTIVE_CHARS = 4_000

export const ThreadGoalSchema = z.object({
  threadId: z.string().min(1),
  objective: z.string().trim().min(1).max(MAX_THREAD_GOAL_OBJECTIVE_CHARS),
  status: ThreadGoalStatus,
  tokenBudget: z.number().int().positive().nullable().optional(),
  tokensUsed: z.number().int().nonnegative(),
  timeUsedSeconds: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type ThreadGoal = z.infer<typeof ThreadGoalSchema>

export const ThreadTodoStatus = z.enum(['pending', 'in_progress', 'completed'])
export type ThreadTodoStatus = z.infer<typeof ThreadTodoStatus>

export const ThreadTodoSourceSchema = z.object({
  kind: z.literal('plan'),
  planId: z.string().min(1),
  relativePath: z.string().min(1),
  ordinal: z.number().int().nonnegative(),
  contentHash: z.string().min(1)
})
export type ThreadTodoSource = z.infer<typeof ThreadTodoSourceSchema>

export const MAX_THREAD_TODO_CONTENT_CHARS = 1_000
export const MAX_THREAD_TODOS = 200

export const ThreadTodoItemSchema = z.object({
  id: z.string().min(1),
  content: z.string().trim().min(1).max(MAX_THREAD_TODO_CONTENT_CHARS),
  status: ThreadTodoStatus,
  source: ThreadTodoSourceSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type ThreadTodoItem = z.infer<typeof ThreadTodoItemSchema>

export const ThreadTodoListSchema = z.object({
  threadId: z.string().min(1),
  items: z.array(ThreadTodoItemSchema).max(MAX_THREAD_TODOS),
  updatedAt: z.string()
}).superRefine((value, ctx) => {
  const inProgressCount = value.items.filter((item) => item.status === 'in_progress').length
  if (inProgressCount > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['items'],
      message: 'at most one todo can be in_progress'
    })
  }
})
export type ThreadTodoList = z.infer<typeof ThreadTodoListSchema>

/** Visibility of a thread created through the public Extension Agent API. */
export const ExtensionThreadVisibilitySchema = z.enum(['private', 'workspace'])
export type ExtensionThreadVisibility = z.infer<typeof ExtensionThreadVisibilitySchema>

/**
 * Effective (already policy-clamped) limits captured when an extension run is
 * created. Keeping this snapshot on the thread makes headless resume and audit
 * behavior independent from later manifest or host-policy changes.
 */
export const ExtensionRunBudgetSchema = z.object({
  maxTokens: z.number().int().positive(),
  maxElapsedMs: z.number().int().positive(),
  maxConcurrentRuns: z.number().int().positive(),
  maxModelRequests: z.number().int().positive(),
  maxToolInvocations: z.number().int().positive(),
  maxRetainedEvents: z.number().int().positive()
})
export type ExtensionRunBudget = z.infer<typeof ExtensionRunBudgetSchema>

/** Resolved, immutable profile data used by an extension-owned thread. */
export const ExtensionAgentProfileSnapshotSchema = z.object({
  id: z.string().min(1),
  instructionDigest: z.string().min(1),
  /** Bounded, attributed context appended after Kun's immutable system prefix. */
  instructionOverlay: z.string().max(32_000).optional(),
  model: z.string().min(1),
  providerId: z.string().min(1).optional(),
  accountId: z.string().min(1).optional(),
  allowedToolScopes: z.array(z.string().min(1)).default([])
})
export type ExtensionAgentProfileSnapshot = z.infer<typeof ExtensionAgentProfileSnapshotSchema>

/** Canonical, permission-eligible tool snapshot pinned to a thread boundary. */
export const ExtensionToolCatalogEntrySchema = z.object({
  canonicalToolId: z.string().min(1),
  modelAlias: z.string().min(1),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
  sideEffect: z.enum(['none', 'workspace-read', 'workspace-write', 'network', 'external'])
})
export type ExtensionToolCatalogEntry = z.infer<typeof ExtensionToolCatalogEntrySchema>

export const ExtensionToolCatalogEpochSchema = z.object({
  id: z.string().min(1),
  fingerprint: z.string().min(1),
  toolCount: z.number().int().nonnegative(),
  canonicalToolIds: z.array(z.string().min(1)),
  schemaDigests: z.record(z.string(), z.string().min(1)),
  tools: z.array(ExtensionToolCatalogEntrySchema).optional(),
  createdAt: z.string().min(1)
})
export type ExtensionToolCatalogEpoch = z.infer<typeof ExtensionToolCatalogEpochSchema>

/** Internal metadata supplied only by the authenticated Extension broker. */
export const ExtensionThreadMetadataSchema = z.object({
  ownerExtensionId: z.string().min(1),
  ownerExtensionVersion: z.string().min(1),
  accountId: z.string().min(1).optional(),
  extensionVisibility: ExtensionThreadVisibilitySchema,
  extensionProfile: ExtensionAgentProfileSnapshotSchema.optional(),
  extensionBudget: ExtensionRunBudgetSchema,
  toolCatalogEpoch: ExtensionToolCatalogEpochSchema.optional()
})
export type ExtensionThreadMetadata = z.infer<typeof ExtensionThreadMetadataSchema>

export const DesignCloneOperationSchema = z.object({
  operationId: z.string().trim().min(1).max(160)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  kind: z.enum(['fork', 'resume']),
  sourceId: z.string().trim().min(1).max(256)
}).strict()
export type DesignCloneOperation = z.infer<typeof DesignCloneOperationSchema>

export const ThreadSchemaBase = z.object({
  id: z.string().min(1),
  /** Internal optimistic-concurrency version; defaults for legacy records. */
  revision: z.number().int().nonnegative().optional(),
  title: z.string(),
  /**
   * Whether the current title was auto-derived (client-side first-message
   * heuristic or the backend LLM titler) rather than set by the user.
   * - `true`  → provisional/auto title; the backend LLM titler may upgrade it.
   * - `false` → the user renamed it manually; never auto-overwrite.
   * - absent  → legacy/unknown; the backend only upgrades placeholder titles.
   */
  titleAuto: z.boolean().optional(),
  /**
   * Optional whole-conversation summary (~1 paragraph) produced on demand by
   * the Summary internal-LLM role. Surfaced as the conversation's hover /
   * subtitle in the thread list. Absent until the user runs "summarize".
   */
  summary: z.string().optional(),
  workspace: z.string(),
  additionalWorkspaces: z.array(z.string().min(1)).max(32).optional(),
  knowledgeBases: KnowledgeBaseMountsSchema.optional(),
  model: z.string(),
  /** Durable product-surface ownership. Missing legacy values resolve from homogeneous turn history. */
  agentSurface: ThreadAgentSurface.optional(),
  /** Immutable Design task contract. Missing on Code, Work, and legacy threads. */
  designProfile: DesignTaskProfileSchema.optional(),
  /** Idempotency audit record for a renderer-prepared independent Design clone. */
  designCloneOperation: DesignCloneOperationSchema.optional(),
  /**
   * Optional provider id. When set, every turn on this thread routes its
   * model request to the matching per-provider client; absent → use the
   * runtime's default provider. Lets workflow / scheduled-task / IM
   * bridges pin a non-runtime provider per thread.
   */
  providerId: z.string().optional(),
  /** Stable owner derived from the authenticated Extension Host session. */
  ownerExtensionId: z.string().min(1).optional(),
  /** Creating extension version retained as audit metadata across upgrades. */
  ownerExtensionVersion: z.string().min(1).optional(),
  /** Opaque account reference; never credential material. */
  accountId: z.string().min(1).optional(),
  extensionVisibility: ExtensionThreadVisibilitySchema.optional(),
  extensionProfile: ExtensionAgentProfileSnapshotSchema.optional(),
  extensionBudget: ExtensionRunBudgetSchema.optional(),
  toolCatalogEpoch: ExtensionToolCatalogEpochSchema.optional(),
  /**
   * Optional subagent profile id this thread is bound to. When set, the
   * thread persona (model / providerId / systemPrompt below) is a snapshot
   * of the agent at thread-create time so later agent edits don't drift
   * historical conversations.
   */
  agentId: z.string().optional(),
  /**
   * Optional thread-level systemPrompt override. When non-empty, it
   * replaces the runtime's base systemPrompt in every ModelRequest on this
   * thread (primary-agent persona snapshot path).
   */
  systemPrompt: z.string().optional(),
  mode: ThreadMode,
  status: ThreadStatus,
  approvalPolicy: ApprovalPolicySchema.default(DEFAULT_APPROVAL_POLICY),
  sandboxMode: SandboxModeSchema.default(DEFAULT_SANDBOX_MODE),
  approvalReviewer: ApprovalReviewerSchema.default(DEFAULT_APPROVAL_REVIEWER),
  /** Whether future model requests for this thread are retained for Agent Perspective. */
  modelRequestCaptureEnabled: z.boolean().optional(),
  pinned: z.boolean().optional(),
  costBudgetUsd: z.number().positive().optional(),
  costBudgetWarningSent: z.boolean().optional(),
  relation: ThreadRelation.default('primary'),
  parentThreadId: z.string().optional(),
  planBuildRunId: z.string().trim().min(1).max(160).optional(),
  /** Legacy plan-build metadata retained only for read compatibility. */
  planBuildAdmissionFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  /** Legacy plan-build metadata retained only for read compatibility. */
  planBuildAdmissionCapabilityHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  /** Legacy inert fence value retained only for read compatibility. */
  planBuildAdmissionFrozen: z.boolean().optional(),
  forkedFromThreadId: z.string().optional(),
  forkedFromTitle: z.string().optional(),
  forkedAt: z.string().optional(),
  forkedFromMessageCount: z.number().int().nonnegative().optional(),
  forkedFromTurnCount: z.number().int().nonnegative().optional(),
  goal: ThreadGoalSchema.optional(),
  todos: ThreadTodoListSchema.optional(),
  retentionPolicy: ThreadRetentionPolicySchema.optional(),
  /**
   * ISO timestamp of the last time this thread was auto-resumed after a
   * runtime restart. Used as a cooldown gate so a crash loop cannot burn
   * model budget by auto-resuming the same thread on every boot.
   */
  lastAutoResumeAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  turns: z.array(TurnSchema).default([])
})
/** Legacy plan-build fields are parsed and persisted as inert history metadata. */
export const ThreadSchema = ThreadSchemaBase
export const ThreadSchemaReadable = ThreadSchemaBase
export type ThreadRecord = z.infer<typeof ThreadSchema>

export const ThreadTimelineResponseSchema = ThreadSchemaReadable.extend({
  latestSeq: z.number().int().nonnegative(),
  latestTurn: TurnSchema.omit({ items: true }).nullable(),
  pendingUserInputIds: z.array(z.string()),
  pendingApprovalIds: z.array(z.string()).optional(),
  timeline: ThreadTimelinePageSchema
})
export type ThreadTimelineResponse = z.infer<typeof ThreadTimelineResponseSchema>

export const ThreadSummarySchema = ThreadSchemaBase.pick({
  id: true,
  title: true,
  titleAuto: true,
  summary: true,
  workspace: true,
  additionalWorkspaces: true,
  knowledgeBases: true,
  model: true,
  agentSurface: true,
  designProfile: true,
  designCloneOperation: true,
  providerId: true,
  ownerExtensionId: true,
  ownerExtensionVersion: true,
  accountId: true,
  extensionVisibility: true,
  extensionProfile: true,
  extensionBudget: true,
  toolCatalogEpoch: true,
  agentId: true,
  systemPrompt: true,
  mode: true,
  status: true,
  approvalPolicy: true,
  sandboxMode: true,
  approvalReviewer: true,
  modelRequestCaptureEnabled: true,
  pinned: true,
  costBudgetUsd: true,
  costBudgetWarningSent: true,
  relation: true,
  parentThreadId: true,
  planBuildRunId: true,
  planBuildAdmissionFingerprint: true,
  planBuildAdmissionCapabilityHash: true,
  planBuildAdmissionFrozen: true,
  forkedFromThreadId: true,
  forkedFromTitle: true,
  forkedAt: true,
  forkedFromMessageCount: true,
  forkedFromTurnCount: true,
  goal: true,
  todos: true,
  createdAt: true,
  updatedAt: true
}).extend({
  /** First accepted Code/Design mode, derived from durable turn history. */
  lockedTaskSurface: ThreadAgentSurface.optional(),
  /** Rebuildable event-log high-water mark used by lean activity observers. */
  latestSeq: z.number().int().nonnegative().optional()
})
export type ThreadSummary = z.infer<typeof ThreadSummarySchema>

/** Lean sidebar listing projection (omits heavy metadata blobs the list never reads). */
export const ThreadListSummarySchema = ThreadSummarySchema.omit({
  additionalWorkspaces: true, knowledgeBases: true, ownerExtensionId: true, ownerExtensionVersion: true, accountId: true,
  extensionVisibility: true, extensionProfile: true, extensionBudget: true, toolCatalogEpoch: true, costBudgetUsd: true,
  costBudgetWarningSent: true, planBuildAdmissionFingerprint: true, planBuildAdmissionCapabilityHash: true, planBuildAdmissionFrozen: true
})
export type ThreadListSummary = z.infer<typeof ThreadListSummarySchema>

export const CreateThreadRequest = z.object({
  title: z.string().optional(),
  /** Marks the provided title as an auto/provisional title (see ThreadSchema.titleAuto). */
  titleAuto: z.boolean().optional(),
  workspace: z.string().min(1),
  additionalWorkspaces: z.array(z.string().min(1)).max(32).optional(),
  knowledgeBases: KnowledgeBaseMountsSchema.optional(),
  model: z.string().min(1),
  /** Durable product-surface ownership for renderer-created threads. */
  agentSurface: ThreadAgentSurface.optional(),
  /**
   * Optional provider id. The runtime keeps using its default provider
   * when omitted (backwards compatible). When set to a configured
   * non-default provider, every turn on this thread routes through that
   * provider's HTTP client.
   */
  providerId: z.string().optional(),
  /** Opaque core-managed account reference for the selected provider. */
  accountId: z.string().min(1).optional(),
  /** Optional subagent profile id to bind this thread to. */
  agentId: z.string().optional(),
  /** Optional persona systemPrompt snapshot applied to every ModelRequest on this thread. */
  systemPrompt: z.string().optional(),
  mode: ThreadMode.default('agent'),
  approvalPolicy: ApprovalPolicySchema.optional(),
  sandboxMode: SandboxModeSchema.optional(),
  approvalReviewer: ApprovalReviewerSchema.optional(),
  modelRequestCaptureEnabled: z.boolean().optional(),
  costBudgetUsd: z.number().positive().optional()
})
export type CreateThreadRequest = z.infer<typeof CreateThreadRequest>

/**
 * Optional body for `POST /v1/threads/{id}/fork`.
 *
 * `relation` defaults to `'fork'` to preserve the existing manual-fork
 * behavior when the body is absent. Passing `relation: 'side'` marks
 * the new thread as a side conversation (e.g. spawned by `/btw`).
 */
export const ForkThreadRequest = z
  .object({
    relation: ThreadRelation.default('fork'),
    title: z.string().optional(),
    turnId: z.string().trim().min(1).optional(),
    /** Exclude turnId itself, allowing a faithful undo branch before turn one. */
    beforeTurn: z.boolean().optional(),
    /**
     * Compatibility echo only. A fork cannot replace the source reviewer;
     * ThreadService rejects any value that differs from the captured source.
     */
    approvalReviewer: ApprovalReviewerSchema.optional(),
    /** Independently cloned board target prepared by the Design client before fork. */
    designDocumentTarget: DesignDocumentTargetSchema.optional(),
    /** Stable client operation used to retry the same Design clone/thread atomically. */
    designCloneOperationId: z.string().trim().min(1).max(160)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/).optional()
  })
  .refine((value) => !value.beforeTurn || value.turnId !== undefined, {
    message: 'beforeTurn requires turnId'
  })
  .refine((value) => Boolean(value.designDocumentTarget) === Boolean(value.designCloneOperationId), {
    message: 'designDocumentTarget and designCloneOperationId must be supplied together'
  })
  .optional()
export type ForkThreadRequest = z.infer<typeof ForkThreadRequest>

export const SetThreadGoalRequest = z
  .object({
    objective: z.string().trim().min(1).max(MAX_THREAD_GOAL_OBJECTIVE_CHARS).optional(),
    status: ThreadGoalStatus.optional(),
    tokenBudget: z.number().int().positive().nullable().optional()
  })
  .refine(
    (value) =>
      value.objective !== undefined ||
      value.status !== undefined ||
      value.tokenBudget !== undefined,
    { message: 'goal request must change at least one field' }
  )
export type SetThreadGoalRequest = z.infer<typeof SetThreadGoalRequest>

export const ThreadGoalResponse = z.object({
  goal: ThreadGoalSchema.nullable()
})
export type ThreadGoalResponse = z.infer<typeof ThreadGoalResponse>

export const ClearThreadGoalResponse = z.object({
  cleared: z.boolean()
})
export type ClearThreadGoalResponse = z.infer<typeof ClearThreadGoalResponse>

export const SetThreadTodosRequest = z.object({
  todos: z.array(
    z.object({
      id: z.string().min(1).optional(),
      content: z.string().trim().min(1).max(MAX_THREAD_TODO_CONTENT_CHARS),
      status: ThreadTodoStatus,
      source: ThreadTodoSourceSchema.optional()
    })
  ).max(MAX_THREAD_TODOS)
}).superRefine((value, ctx) => {
  const inProgressCount = value.todos.filter((item) => item.status === 'in_progress').length
  if (inProgressCount > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['todos'],
      message: 'at most one todo can be in_progress'
    })
  }
})
export type SetThreadTodosRequest = z.infer<typeof SetThreadTodosRequest>

export const ThreadTodosResponse = z.object({
  todos: ThreadTodoListSchema.nullable()
})
export type ThreadTodosResponse = z.infer<typeof ThreadTodosResponse>

export const ClearThreadTodosResponse = z.object({
  cleared: z.boolean()
})
export type ClearThreadTodosResponse = z.infer<typeof ClearThreadTodosResponse>

export const UpdateThreadRequest = z
  .object({
    title: z.string().optional(),
    /** Marks the new title as auto/provisional (true) or user-set/locked (false). */
    titleAuto: z.boolean().optional(),
    workspace: z.string().min(1).optional(),
    additionalWorkspaces: z.array(z.string().min(1)).max(32).optional(),
    knowledgeBases: KnowledgeBaseMountsSchema.optional(),
    mode: ThreadMode.optional(),
    status: ThreadUpdateStatus.optional(),
    approvalPolicy: ApprovalPolicySchema.optional(),
    sandboxMode: SandboxModeSchema.optional(),
    approvalReviewer: ApprovalReviewerSchema.optional(),
    modelRequestCaptureEnabled: z.boolean().optional(),
    pinned: z.boolean().optional(),
    costBudgetUsd: z.number().positive().nullable().optional(),
    costBudgetWarningSent: z.boolean().optional(),
    relation: ThreadRelation.optional()
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.titleAuto !== undefined ||
      value.workspace !== undefined ||
      value.additionalWorkspaces !== undefined ||
      value.knowledgeBases !== undefined ||
      value.mode !== undefined ||
      value.status !== undefined ||
      value.approvalPolicy !== undefined ||
      value.sandboxMode !== undefined ||
      value.approvalReviewer !== undefined ||
      value.modelRequestCaptureEnabled !== undefined ||
      value.pinned !== undefined ||
      value.costBudgetUsd !== undefined ||
      value.costBudgetWarningSent !== undefined ||
      value.relation !== undefined,
    { message: 'update request must change at least one field' }
  )
export type UpdateThreadRequest = z.infer<typeof UpdateThreadRequest>

export const ListThreadsResponse = z.object({
  threads: z.array(ThreadSummarySchema),
  nextCursor: z.string().optional(),
  hasMore: z.boolean().optional(),
  total: z.number().int().nonnegative().optional(),
  indexStatus: ThreadIndexStatusInfoSchema.optional()
})
export type ListThreadsResponse = z.infer<typeof ListThreadsResponse>

export const DeleteThreadResponse = z.object({
  id: z.string().min(1),
  deleted: z.literal(true)
})
export type DeleteThreadResponse = z.infer<typeof DeleteThreadResponse>

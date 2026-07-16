import { z } from 'zod'
import { TurnSchema } from './turns.js'
import {
  ApprovalPolicySchema,
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_SANDBOX_MODE,
  SandboxModeSchema
} from './policy.js'

export const ThreadStatus = z.enum(['idle', 'running', 'archived', 'deleted'])
export type ThreadStatus = z.infer<typeof ThreadStatus>

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

export const ThreadSchema = z.object({
  id: z.string().min(1),
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
  model: z.string(),
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
  /**
   * Optional expert profile id this thread is bound to. When set, the expert's
   * roleDefinition is injected into the agent loop context as systemPrompt.
   * (Stage 2: experts extension)
   */
  expertId: z.string().optional(),
  /**
   * Optional expert team id this thread is bound to. When set, enables team
   * collaboration orchestration for this conversation.
   * (Stage 2: experts extension)
   */
  expertTeamId: z.string().optional(),
  /**
   * Conversation mode when using experts: 'chat' for direct interaction,
   * 'task' for task-oriented delegation with expert orchestration.
   * (Stage 2: experts extension)
   */
  conversationMode: z.enum(['chat', 'task']).optional(),
  mode: ThreadMode,
  status: ThreadStatus,
  approvalPolicy: ApprovalPolicySchema.default(DEFAULT_APPROVAL_POLICY),
  sandboxMode: SandboxModeSchema.default(DEFAULT_SANDBOX_MODE),
  pinned: z.boolean().optional(),
  costBudgetUsd: z.number().positive().optional(),
  costBudgetWarningSent: z.boolean().optional(),
  relation: ThreadRelation.default('primary'),
  parentThreadId: z.string().optional(),
  forkedFromThreadId: z.string().optional(),
  forkedFromTitle: z.string().optional(),
  forkedAt: z.string().optional(),
  forkedFromMessageCount: z.number().int().nonnegative().optional(),
  forkedFromTurnCount: z.number().int().nonnegative().optional(),
  goal: ThreadGoalSchema.optional(),
  todos: ThreadTodoListSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  turns: z.array(TurnSchema).default([])
})
export type ThreadRecord = z.infer<typeof ThreadSchema>

export const ThreadSummarySchema = ThreadSchema.pick({
  id: true,
  title: true,
  titleAuto: true,
  summary: true,
  workspace: true,
  model: true,
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
  expertId: true,
  expertTeamId: true,
  conversationMode: true,
  mode: true,
  status: true,
  approvalPolicy: true,
  sandboxMode: true,
  pinned: true,
  costBudgetUsd: true,
  costBudgetWarningSent: true,
  relation: true,
  parentThreadId: true,
  forkedFromThreadId: true,
  forkedFromTitle: true,
  forkedAt: true,
  forkedFromMessageCount: true,
  forkedFromTurnCount: true,
  goal: true,
  todos: true,
  createdAt: true,
  updatedAt: true
})
export type ThreadSummary = z.infer<typeof ThreadSummarySchema>

export const CreateThreadRequest = z.object({
  title: z.string().optional(),
  /** Marks the provided title as an auto/provisional title (see ThreadSchema.titleAuto). */
  titleAuto: z.boolean().optional(),
  workspace: z.string().min(1),
  model: z.string().min(1),
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
  /** Optional expert profile id to bind this thread to. */
  expertId: z.string().optional(),
  /** Optional expert team id to bind this thread to. */
  expertTeamId: z.string().optional(),
  /** Conversation mode when using experts. */
  conversationMode: z.enum(['chat', 'task']).optional(),
  mode: ThreadMode.default('agent'),
  approvalPolicy: ApprovalPolicySchema.optional(),
  sandboxMode: SandboxModeSchema.optional(),
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
    turnId: z.string().trim().min(1).optional()
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
    status: ThreadUpdateStatus.optional(),
    approvalPolicy: ApprovalPolicySchema.optional(),
    sandboxMode: SandboxModeSchema.optional(),
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
      value.status !== undefined ||
      value.approvalPolicy !== undefined ||
      value.sandboxMode !== undefined ||
      value.pinned !== undefined ||
      value.costBudgetUsd !== undefined ||
      value.costBudgetWarningSent !== undefined ||
      value.relation !== undefined,
    { message: 'update request must change at least one field' }
  )
export type UpdateThreadRequest = z.infer<typeof UpdateThreadRequest>

export const ListThreadsResponse = z.object({
  threads: z.array(ThreadSummarySchema)
})
export type ListThreadsResponse = z.infer<typeof ListThreadsResponse>

export const DeleteThreadResponse = z.object({
  id: z.string().min(1),
  deleted: z.literal(true)
})
export type DeleteThreadResponse = z.infer<typeof DeleteThreadResponse>

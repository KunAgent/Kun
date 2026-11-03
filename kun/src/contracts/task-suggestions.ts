import { z } from 'zod'
import { AgentDispatchAssignmentRouteSchema } from './agent-dispatch-intents.js'

/**
 * Suggestion cards: a main conversation proposes independent follow-up work
 * and the user starts each piece as its own `relation: 'task'` session. Unlike
 * dispatch cards, the user owns the sessions and reviews their results.
 */
export const TASK_SUGGESTION_MAX_TASKS = 6

/** Which Agent runs one task session, on which model. Same shape as a dispatch route. */
export const TaskSuggestionRouteSchema = AgentDispatchAssignmentRouteSchema
export type TaskSuggestionRoute = z.infer<typeof TaskSuggestionRouteSchema>

export const TaskSuggestionBriefSchema = z.object({
  goal: z.string().trim().min(1).max(8_000),
  scope: z.array(z.string().trim().min(1).max(2_000)).max(12).default([]),
  done: z.array(z.string().trim().min(1).max(2_000)).max(12).default([])
}).strict()
export type TaskSuggestionBrief = z.infer<typeof TaskSuggestionBriefSchema>

/**
 * Row lifecycle. `waiting` (approval or input needed) is not stored: clients
 * derive it from the task thread's live activity while the row is `running`.
 * `here` means the user continued the task inside the suggesting conversation.
 */
export const TaskSuggestionRowStateSchema = z.enum([
  'suggested', 'starting', 'running', 'done', 'failed', 'start_failed', 'cancelled', 'ignored', 'here'
])
export type TaskSuggestionRowState = z.infer<typeof TaskSuggestionRowStateSchema>

export const TaskSuggestionFailureCodeSchema = z.enum([
  'disk_space', 'worktree_conflict', 'agent_unavailable', 'quota', 'runtime'
])
export type TaskSuggestionFailureCode = z.infer<typeof TaskSuggestionFailureCodeSchema>

export const TaskSuggestionFailureSchema = z.object({
  code: TaskSuggestionFailureCodeSchema,
  message: z.string().max(2_000)
}).strict()
export type TaskSuggestionFailure = z.infer<typeof TaskSuggestionFailureSchema>

export const TaskSuggestionResultSchema = z.object({
  turnStatus: z.enum(['completed', 'failed', 'aborted']),
  summary: z.string().max(4_000).optional(),
  error: z.string().max(2_000).optional(),
  changedFiles: z.number().int().min(0).optional()
}).strict()
export type TaskSuggestionResult = z.infer<typeof TaskSuggestionResultSchema>

export const TaskSuggestionTaskSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(200),
  area: z.string().trim().max(200).optional(),
  brief: TaskSuggestionBriefSchema,
  route: TaskSuggestionRouteSchema,
  worktree: z.boolean(),
  inheritContext: z.boolean().default(false),
  state: TaskSuggestionRowStateSchema,
  /** Bumped by every retry so a retried start gets a fresh thread and turn. */
  attempt: z.number().int().min(0).max(32).default(0),
  threadId: z.string().min(1).optional(),
  turnId: z.string().min(1).optional(),
  taskWorkspaceId: z.string().min(1).optional(),
  branch: z.string().max(512).optional(),
  startedAt: z.string().datetime().optional(),
  settledAt: z.string().datetime().optional(),
  failure: TaskSuggestionFailureSchema.optional(),
  result: TaskSuggestionResultSchema.optional(),
  /** The user dismissed the result report in the suggesting conversation. */
  reportAcknowledged: z.boolean().optional()
}).strict()
export type TaskSuggestionTask = z.infer<typeof TaskSuggestionTaskSchema>

/**
 * Card phase. `countdown` and `paused` exist only before any task starts;
 * `settled` once every row reached a final state.
 */
export const TaskSuggestionCardStateSchema = z.enum(['suggested', 'countdown', 'paused', 'active', 'settled'])
export type TaskSuggestionCardState = z.infer<typeof TaskSuggestionCardStateSchema>

export const TaskSuggestionSourceSchema = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  toolCallId: z.string().min(1)
}).strict()

export const TaskSuggestionIntentSchema = z.object({
  intentId: z.string().min(1).max(256),
  revision: z.number().int().positive(),
  source: TaskSuggestionSourceSchema,
  state: TaskSuggestionCardStateSchema,
  workspace: z.string().min(1).max(4_096),
  reason: z.string().max(2_000).optional(),
  deadline: z.string().datetime().optional(),
  autoStarted: z.boolean().optional(),
  tasks: z.array(TaskSuggestionTaskSchema).min(1).max(TASK_SUGGESTION_MAX_TASKS),
  /** Recent action request ids; a replayed request returns the current card. */
  requestIds: z.array(z.string().max(256)).max(64).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict()
export type TaskSuggestionIntent = z.infer<typeof TaskSuggestionIntentSchema>

export const TaskSuggestionIntentPublicSchema = TaskSuggestionIntentSchema.omit({ requestIds: true })
export type TaskSuggestionIntentPublic = z.infer<typeof TaskSuggestionIntentPublicSchema>

export function publicTaskSuggestion(intent: TaskSuggestionIntent): TaskSuggestionIntentPublic {
  const { requestIds: _requests, ...rest } = intent
  return TaskSuggestionIntentPublicSchema.parse(rest)
}

export const TaskSuggestionTaskChangesSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  route: TaskSuggestionRouteSchema.optional(),
  worktree: z.boolean().optional(),
  inheritContext: z.boolean().optional(),
  brief: TaskSuggestionBriefSchema.optional()
}).strict()
export type TaskSuggestionTaskChanges = z.infer<typeof TaskSuggestionTaskChangesSchema>

export const TaskSuggestionActionSchema = z.object({
  action: z.enum(['start', 'pause', 'resume', 'update', 'ignore', 'retry', 'continue_here', 'acknowledge']),
  expectedRevision: z.number().int().positive(),
  requestId: z.string().min(1).max(256),
  /** start / ignore / acknowledge: omitted means every eligible row. */
  taskIds: z.array(z.string().min(1).max(64)).max(TASK_SUGGESTION_MAX_TASKS).optional(),
  /** update / retry / continue_here: the one row to change. */
  taskId: z.string().min(1).max(64).optional(),
  changes: TaskSuggestionTaskChangesSchema.optional()
}).strict()
export type TaskSuggestionAction = z.infer<typeof TaskSuggestionActionSchema>

export const TaskSuggestionFileSchema = z.object({
  version: z.literal(1), intents: z.array(TaskSuggestionIntentSchema)
}).strict()
export type TaskSuggestionFile = z.infer<typeof TaskSuggestionFileSchema>

/** Model-facing input of `suggest_tasks`. */
export const SuggestTasksInputSchema = z.object({
  reason: z.string().trim().max(2_000).optional(),
  tasks: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    area: z.string().trim().max(200).optional(),
    goal: z.string().trim().min(1).max(8_000),
    scope: z.array(z.string().trim().min(1).max(2_000)).max(12).optional(),
    done: z.array(z.string().trim().min(1).max(2_000)).max(12).optional(),
    worktree: z.boolean().optional(),
    /** Agent roster id the session should play; it must allow primary sessions. */
    profile: z.string().trim().min(1).max(128).optional()
  }).strict()).min(2).max(TASK_SUGGESTION_MAX_TASKS)
}).strict()
export type SuggestTasksInput = z.infer<typeof SuggestTasksInputSchema>

const FINAL_ROW_STATES: ReadonlySet<TaskSuggestionRowState> = new Set(['done', 'failed', 'cancelled', 'ignored', 'here'])
export const isFinalTaskRowState = (state: TaskSuggestionRowState): boolean => FINAL_ROW_STATES.has(state)

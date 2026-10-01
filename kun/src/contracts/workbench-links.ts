import { z } from 'zod'
import { ParticipantAgentId } from './agent-identities.js'
import { RoomIdSchema } from './rooms.js'
import { TurnReasoningEffortSchema, TurnServiceTierSchema } from './turns.js'
import { HarnessIdSchema, HarnessCredentialModeSchema } from './harness.js'

const Timestamp = z.string().datetime({ offset: true })
const ThreadId = z.string().min(1).max(256)

/** Bounds shared by tools, routes and the reconciler. */
export const WORKBENCH_LIMITS = {
  maxRunLinks: 2,
  maxOpenConfirmations: 20,
  maxContentBytes: 100_000,
  maxResultExcerpt: 4_000,
  maxChangedFiles: 50,
  maxSearchResults: 20,
  maxThreadReadChars: 6_000,
  maxDocumentPageChars: 12_000,
  maxScheduledPerAgent: 20,
  maxSeriesPerAgent: 5
} as const

export const WorkbenchLinkKindSchema = z.enum(['code_task', 'work_task', 'work_document', 'work_edit', 'board_card', 'watch', 'schedule_series'])
export const WorkbenchLinkSurfaceSchema = z.enum(['code', 'work'])
export const WorkbenchLinkStatusSchema = z.enum([
  'awaiting_confirmation', 'queued', 'running', 'needs_attention',
  'completed', 'failed', 'cancelled', 'dismissed', 'recovery_required', 'scheduled', 'missed', 'plan_ready', 'active', 'paused', 'ended'
])
export type WorkbenchLinkKind = z.infer<typeof WorkbenchLinkKindSchema>
export type WorkbenchLinkStatus = z.infer<typeof WorkbenchLinkStatusSchema>

export const WORKBENCH_TERMINAL_STATUSES: readonly WorkbenchLinkStatus[] = ['completed', 'failed', 'cancelled', 'dismissed', 'ended']
export const WORKBENCH_ACTIVE_STATUSES: readonly WorkbenchLinkStatus[] = ['queued', 'running', 'needs_attention', 'recovery_required']
export const isWorkbenchTerminal = (status: WorkbenchLinkStatus) => WORKBENCH_TERMINAL_STATUSES.includes(status)

export const WorkbenchBoardDraftSchema = z.object({
  description: z.string().max(4000).default(''),
  category: z.enum(['feature', 'bug', 'refactor', 'tech_debt', 'docs', 'test', 'api', 'sync', 'ui', 'interaction', 'chore', 'other']).default('other'),
  priority: z.enum(['P0', 'P1', 'P2']).nullable().default(null)
}).strict()

export const WorkbenchEditSchema = z.object({
  oldText: z.string().min(1).max(4_000),
  newText: z.string().max(8_000)
}).strict()
export type WorkbenchEdit = z.infer<typeof WorkbenchEditSchema>

export const WorkbenchExecutionSchema = z.object({
  mode: z.enum(['direct', 'plan', 'auto', 'goal']),
  goalTokenBudget: z.number().int().positive().nullable().optional(),
  model: z.object({
    providerId: z.string().min(1).max(128).optional(), model: z.string().min(1).max(512),
    accountId: z.string().min(1).max(128).optional(), harnessId: HarnessIdSchema.optional(),
    credentialMode: HarnessCredentialModeSchema.optional(),
    reasoningEffort: TurnReasoningEffortSchema.optional(), serviceTier: TurnServiceTierSchema.optional()
  }).strict().optional(),
  persona: z.object({ id: z.string().max(128), name: z.string().max(160), text: z.string().max(2000) }).strict().optional(),
  permission: z.enum(['ask-for-approval', 'approve-for-me', 'full-access']).optional(),
  orchestration: z.enum(['direct', 'graph']).optional()
}).strict()
export type WorkbenchExecution = z.infer<typeof WorkbenchExecutionSchema>

export const WorkbenchScheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), runAt: Timestamp, timeZone: z.string().min(1).max(100) }).strict(),
  z.object({ kind: z.literal('recurring'), every: z.enum(['day', 'weekday', 'week']),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), timeZone: z.string().min(1).max(100),
    endsAt: Timestamp.optional(), maxRuns: z.number().int().min(1).max(1000).optional()
  }).strict()
])
export type WorkbenchSchedule = z.infer<typeof WorkbenchScheduleSchema>

export const WorkbenchRequestSchema = z.object({
  title: z.string().trim().min(1).max(160),
  goal: z.string().trim().max(8000).default(''),
  acceptance: z.string().trim().max(2000).optional(),
  /** Code project root, Work workspace root, or the board's workspace. */
  workspaceRoot: z.string().min(1).max(4096).optional(),
  /** Work-relative path for documents and edits. */
  relativePath: z.string().min(1).max(4096).optional(),
  mode: z.enum(['agent', 'plan']).default('agent'),
  isolation: z.enum(['inherit', 'worktree']).default('inherit'),
  /** `silent` updates the card only; `final` also wakes the Agent with the outcome. */
  report: z.enum(['final', 'silent', 'failure']).default('final'),
  execution: WorkbenchExecutionSchema.optional(),
  schedule: WorkbenchScheduleSchema.optional(),
  /** New document body, or the complete proposed content of an edit. */
  content: z.string().max(WORKBENCH_LIMITS.maxContentBytes).optional(),
  /** Hash of the document the edit was written against. */
  baseSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  /** Exact-match replacements a `work_edit` applies to the document, in order. */
  edits: z.array(WorkbenchEditSchema).min(1).max(20).optional(),
  board: WorkbenchBoardDraftSchema.optional()
}).strict().refine((value) => (value.edits ?? []).reduce((sum, edit) => sum + edit.oldText.length + edit.newText.length, 0) <=
  WORKBENCH_LIMITS.maxContentBytes, 'edits are too large')
export type WorkbenchRequest = z.infer<typeof WorkbenchRequestSchema>

export const WorkbenchResultSchema = z.object({
  summary: z.string().max(2000).default(''),
  finalExcerpt: z.string().max(WORKBENCH_LIMITS.maxResultExcerpt).default(''),
  changedFiles: z.array(z.string().max(1024)).max(WORKBENCH_LIMITS.maxChangedFiles).default([]),
  commands: z.array(z.object({ command: z.string().max(240), exitCode: z.number().int().optional() }).strict()).max(10).default([]),
  /** Path of a document the task created or changed. */
  path: z.string().max(4096).optional(),
  /** Project board card the task created. */
  cardId: z.string().max(256).optional(),
  finishedAt: Timestamp
}).strict()
export type WorkbenchResult = z.infer<typeof WorkbenchResultSchema>

export const WorkbenchAttentionSchema = z.object({
  kind: z.enum(['approval', 'user_input']),
  summary: z.string().max(300)
}).strict()

export const WorkbenchOriginSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('tool'), runId: RoomIdSchema, toolCallId: z.string().min(1).max(256),
    /** Host-frozen source; model arguments and card edits cannot change it. */
    clientSurface: z.enum(['gui', 'im']).optional(),
    turnId: z.string().min(1).max(256), requestId: z.string().min(1).max(256).optional(),
    /** True when the run answers a fresh user message, the only trigger `auto` may act on. */
    fresh: z.boolean()
  }).strict(),
  z.object({ kind: z.literal('user'), action: z.enum(['watch', 'send_to_bot']) }).strict(),
  z.object({ kind: z.literal('series'), seriesId: RoomIdSchema, occurrence: z.number().int().positive() }).strict()
])

export const WorkbenchLinkSchema = z.object({
  schemaVersion: z.literal(1),
  id: RoomIdSchema,
  roomId: RoomIdSchema,
  participantAgentId: ParticipantAgentId,
  memberId: RoomIdSchema,
  kind: WorkbenchLinkKindSchema,
  surface: WorkbenchLinkSurfaceSchema,
  status: WorkbenchLinkStatusSchema,
  origin: WorkbenchOriginSchema,
  originRunId: RoomIdSchema.optional(),
  /** Card message in the bot conversation. */
  messageId: RoomIdSchema.optional(),
  /** Target Code/Work thread once started. */
  threadId: ThreadId.optional(),
  turnId: ThreadId.optional(),
  /** Stable admission key of the first target turn; recovery reconciles against it. */
  clientRequestId: z.string().min(1).max(256).optional(),
  admissionAttempted: z.boolean().optional(),
  request: WorkbenchRequestSchema,
  attention: WorkbenchAttentionSchema.optional(),
  result: WorkbenchResultSchema.optional(),
  /** The user sent their own message in the target thread after the task started. */
  userTookOver: z.boolean().optional(),
  /** A stop was requested; the target turn is being interrupted. */
  cancelRequested: z.boolean().optional(),
  /** Isolated worktree this task waits for or runs in. */
  taskWorkspaceId: z.string().min(1).max(256).optional(),
  scheduledFor: Timestamp.optional(),
  phase: z.enum(['plan', 'build']).optional(),
  planPath: z.string().max(4096).optional(),
  goal: z.object({ status: z.string(), tokensUsed: z.number().int().nonnegative(),
    tokenBudget: z.number().int().positive().nullable().optional(), timeUsedSeconds: z.number().int().nonnegative() }).strict().optional(),
  seriesId: RoomIdSchema.optional(),
  occurrence: z.number().int().positive().optional(),
  runCount: z.number().int().nonnegative().optional(),
  recentRunIds: z.array(RoomIdSchema).max(50).optional(),
  /** The outcome wake was queued (or deliberately skipped) exactly once. */
  reported: z.boolean().optional(),
  error: z.string().max(2000).optional(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  confirmedAt: Timestamp.optional(),
  finishedAt: Timestamp.optional()
}).strict()
export type WorkbenchLink = z.infer<typeof WorkbenchLinkSchema>
export type WorkbenchLinkEntry = WorkbenchLink & { revision: number }

const ClientRequestId = RoomIdSchema
export const ConfirmWorkbenchLinkSchema = z.object({
  clientRequestId: ClientRequestId,
  expectedRevision: z.number().int().nonnegative(),
  /** The user may adjust the proposal before starting it. */
  edits: z.object({
    title: z.string().trim().min(1).max(160).optional(),
    goal: z.string().trim().max(8000).optional(),
    acceptance: z.string().trim().max(2000).optional(),
    mode: z.enum(['agent', 'plan']).optional(),
    isolation: z.enum(['inherit', 'worktree']).optional(),
    report: z.enum(['final', 'silent', 'failure']).optional(),
    execution: WorkbenchExecutionSchema.optional(),
    schedule: WorkbenchScheduleSchema.optional()
  }).strict().optional()
}).strict()
export type ConfirmWorkbenchLink = z.infer<typeof ConfirmWorkbenchLinkSchema>

export const ResolveWorkbenchLinkSchema = z.object({
  clientRequestId: ClientRequestId,
  expectedRevision: z.number().int().nonnegative()
}).strict()

export const WatchWorkbenchThreadSchema = z.object({
  clientRequestId: ClientRequestId,
  threadId: ThreadId,
  title: z.string().trim().max(160).optional()
}).strict()

/** Workspace roots the desktop shell knows about; Kun cannot discover Work roots on its own. */
export const WorkbenchDirectorySchema = z.object({
  workRoots: z.array(z.string().min(1).max(4096)).max(50).default([]),
  defaultWorkRoot: z.string().min(1).max(4096).optional(),
  codeProjects: z.array(z.string().min(1).max(4096)).max(200).default([])
}).strict()
export type WorkbenchDirectory = z.infer<typeof WorkbenchDirectorySchema>

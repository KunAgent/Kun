import { z } from 'zod'
import { HarnessRouteSchema } from './harness.js'
import { ChildSecuritySnapshot } from '../delegation/delegation-runtime-contracts.js'

/**
 * ADE manager control-plane records. Every file shell is strict and carries
 * `version: 1` so future migrations can detect the layout unambiguously.
 * Team data lives under `dataDir/ade/teams/<managerThreadId>/` (09 §3.2).
 */

export const TeamLimitsSchema = z
  .object({
    softWorkers: z.number().int().positive().max(64).default(4),
    hardWorkers: z.number().int().positive().max(64).default(8)
  })
  .strict()
export type TeamLimits = z.infer<typeof TeamLimitsSchema>

export const WorkerRecordSchema = z
  .object({
    /** Worker thread id; identical to its ChildRunRecord id. */
    workerId: z.string().min(1).max(256),
    label: z.string().min(1).max(64),
    role: z.string().max(64).optional(),
    /** Frozen route chosen at creation (01: harness/provider/model/credential). */
    route: HarnessRouteSchema,
    /** Harness permission mode id after the manager-authority clamp. */
    permissionMode: z.string().min(1).max(128),
    lifecycle: z.enum(['persistent', 'ephemeral']),
    taskWorkspaceId: z.string().min(1).optional(),
    /**
     * Immutable security snapshot captured at creation. Every later dispatch
     * runs under this ceiling; it does not widen with later manager turns.
     */
    securitySnapshot: ChildSecuritySnapshot,
    control: z.enum(['manager', 'user']),
    state: z.enum(['active', 'released', 'detached']),
    createdAt: z.string(),
    releasedAt: z.string().optional()
  })
  .strict()
export type WorkerRecord = z.infer<typeof WorkerRecordSchema>

export const TeamRecordSchema = z
  .object({
    version: z.literal(1),
    teamId: z.string().min(1).max(256),
    managerThreadId: z.string().min(1).max(256),
    status: z.enum(['active', 'ended']),
    limits: TeamLimitsSchema,
    /** Optional budget enforced against summed worker-thread usage. */
    budget: z
      .object({
        softTokens: z.number().int().positive().optional(),
        hardTokens: z.number().int().positive().optional()
      })
      .strict()
      .optional(),
    workers: z.array(WorkerRecordSchema).max(256).default([]),
    createdAt: z.string(),
    updatedAt: z.string()
  })
  .strict()
export type TeamRecord = z.infer<typeof TeamRecordSchema>

export const DispatchStateSchema = z.enum([
  'pending',
  'delivering',
  'uncertain',
  'accepted',
  'completed',
  'failed',
  'cancelled'
])
export type DispatchState = z.infer<typeof DispatchStateSchema>

export const TurnRunOutcomeSchema = z.enum([
  'completed',
  'failed',
  'aborted',
  'suspended',
  'suspended_pending_supervision'
])
export type TurnRunOutcome = z.infer<typeof TurnRunOutcomeSchema>

/** Explicit task context the manager attaches to a dispatch. */
export const DispatchContextSchema = z
  .object({
    files: z.array(z.string().min(1)).max(64).optional(),
    links: z.array(z.string().min(1)).max(32).optional(),
    constraints: z.array(z.string().min(1)).max(32).optional(),
    notes: z.string().max(4_000).optional()
  })
  .strict()
export type DispatchContext = z.infer<typeof DispatchContextSchema>

export const QualityCheckSchema = z
  .object({
    name: z.string().min(1).max(128),
    status: z.enum(['passed', 'failed', 'skipped']),
    source: z.enum(['worker', 'host', 'reviewer']),
    detail: z.string().max(2_000).optional()
  })
  .strict()
export type QualityCheck = z.infer<typeof QualityCheckSchema>

export const QualityVerdictSchema = z
  .object({
    status: z.enum(['pending', 'passed', 'needs_changes', 'rejected', 'waived']),
    decidedBy: z.enum(['manager', 'user', 'reviewer']).optional(),
    reviewerWorkerId: z.string().min(1).max(256).optional(),
    checks: z.array(QualityCheckSchema).max(64).default([]),
    notes: z.string().max(4_000).optional(),
    decidedAt: z.string().optional()
  })
  .strict()
export type QualityVerdict = z.infer<typeof QualityVerdictSchema>

/** Structured worker self-report written by `submit_result` (05 §2.4). */
export const WorkerReportSchema = z
  .object({
    summary: z.string().min(1).max(4_000),
    outcome: z.enum(['succeeded', 'partial', 'failed']),
    filesChanged: z.array(z.string().min(1)).max(256).optional(),
    checks: z.array(QualityCheckSchema.omit({ source: true })).max(64).optional(),
    risks: z.array(z.string().min(1)).max(32).optional(),
    submittedAt: z.string()
  })
  .strict()
export type WorkerReport = z.infer<typeof WorkerReportSchema>

export const DispatchRecordSchema = z
  .object({
    /** `dsp_` + random; doubles as the child startTurn clientRequestId. */
    dispatchId: z.string().min(1).max(256),
    teamId: z.string().min(1).max(256),
    workerId: z.string().min(1).max(256),
    /** Manager turn that created the dispatch (or the latest manager turn). */
    parentTurnId: z.string().min(1).max(256),
    title: z.string().min(1).max(240),
    task: z.string().min(1).max(32_000),
    context: DispatchContextSchema.optional(),
    mode: z.enum(['queue', 'interrupt']),
    state: DispatchStateSchema,
    /** Worker turn admitted for this dispatch once known. */
    turnId: z.string().min(1).max(256).optional(),
    outcome: TurnRunOutcomeSchema.optional(),
    workerReport: WorkerReportSchema.optional(),
    /** Fallback excerpt of the worker's last assistant message (<=1500 chars). */
    resultExcerpt: z.string().max(1_500).optional(),
    capture: z
      .object({
        changedFiles: z.number().int().nonnegative(),
        insertions: z.number().int().nonnegative(),
        deletions: z.number().int().nonnegative(),
        patchArtifactId: z.string().min(1).max(256).optional()
      })
      .strict()
      .optional(),
    verdict: QualityVerdictSchema.optional(),
    failureReason: z.string().max(4_000).optional(),
    createdAt: z.string(),
    updatedAt: z.string()
  })
  .strict()
export type DispatchRecord = z.infer<typeof DispatchRecordSchema>

export const QuestionRecordSchema = z
  .object({
    questionId: z.string().min(1).max(256),
    dispatchId: z.string().min(1).max(256),
    workerId: z.string().min(1).max(256),
    question: z.string().min(1).max(8_000),
    options: z.array(z.string().min(1).max(512)).max(16).optional(),
    state: z.enum(['open', 'answered', 'escalated', 'timeout', 'cancelled']),
    answer: z.string().max(8_000).optional(),
    answeredBy: z.enum(['manager', 'user']).optional(),
    deadline: z.string(),
    createdAt: z.string(),
    updatedAt: z.string()
  })
  .strict()
export type QuestionRecord = z.infer<typeof QuestionRecordSchema>

/**
 * One pending manager wake-up item. Notices are persisted before delivery so
 * a restart replays unacknowledged batches (09 §6.2).
 */
export const WorkerNoticeSchema = z
  .object({
    noticeId: z.string().min(1).max(256),
    teamId: z.string().min(1).max(256),
    workerId: z.string().min(1).max(256),
    kind: z.enum([
      'dispatch_completed',
      'dispatch_failed',
      'dispatch_cancelled',
      'question',
      'worker_released',
      'worker_detached'
    ]),
    dispatchId: z.string().min(1).max(256).optional(),
    questionId: z.string().min(1).max(256).optional(),
    /** Short worker/dispatch label used in the aggregated notice text. */
    title: z.string().min(1).max(240),
    /** Harness/model pairing for display, e.g. `claude-code · claude-opus-4-8`. */
    harnessLabel: z.string().max(160).optional(),
    /** Bounded worker report excerpt or failure/question detail. */
    detail: z.string().max(4_000).optional(),
    /** Question choices forwarded to the manager. */
    options: z.array(z.string().min(1).max(512)).max(16).optional(),
    capture: z
      .object({
        changedFiles: z.number().int().nonnegative(),
        insertions: z.number().int().nonnegative(),
        deletions: z.number().int().nonnegative()
      })
      .strict()
      .optional(),
    createdAt: z.string(),
    /** Failed wake-up deliveries; drives backoff and restart replay. */
    attempts: z.number().int().nonnegative().default(0),
    lastAttemptAt: z.string().optional(),
    lastError: z.string().max(1_024).optional(),
    ackedAt: z.string().optional()
  })
  .strict()
export type WorkerNotice = z.infer<typeof WorkerNoticeSchema>

/**
 * `POST /v1/teams/:managerThreadId/notice-hold` (09 §6.2): the renderer
 * renews this while the composer has focus and unsent text so a wake-up
 * turn never interrupts a user mid-draft.
 */
export const WorkerNoticeHoldRequestSchema = z
  .object({ holdMs: z.number().int().min(1).max(60_000) })
  .strict()
export type WorkerNoticeHoldRequest = z.infer<typeof WorkerNoticeHoldRequestSchema>

/** File shells: one JSON document per collection inside the team directory. */
export const TeamFileSchema = z
  .object({ version: z.literal(1), team: TeamRecordSchema })
  .strict()
export const DispatchFileSchema = z
  .object({
    version: z.literal(1),
    dispatches: z.array(DispatchRecordSchema).max(1_024).default([])
  })
  .strict()
export const QuestionFileSchema = z
  .object({
    version: z.literal(1),
    questions: z.array(QuestionRecordSchema).max(1_024).default([])
  })
  .strict()
export const WorkerNoticeFileSchema = z
  .object({
    version: z.literal(1),
    notices: z.array(WorkerNoticeSchema).max(1_024).default([])
  })
  .strict()

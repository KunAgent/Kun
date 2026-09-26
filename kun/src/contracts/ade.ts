import { z } from 'zod'
import { HarnessRouteSchema } from './harness.js'
import { SUBAGENT_READ_ONLY_TOOL_NAMES } from './capabilities-core.js'
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
    /** Profile that produced this route when the worker selector chose one. */
    profileId: z.string().min(1).max(128).optional(),
    /**
     * Selector decision captured for reproducibility (10 §3.3): the reason
     * sentence plus runner-up candidates with their deterministic scores.
     */
    selection: z
      .object({
        reason: z.string().min(1).max(2_000),
        /** Deterministic score of the winning candidate. */
        score: z.number(),
        alternatives: z
          .array(
            z
              .object({
                route: HarnessRouteSchema,
                profileId: z.string().min(1).max(128).optional(),
                label: z.string().min(1).max(128),
                score: z.number()
              })
              .strict()
          )
          .max(3)
          .default([])
      })
      .strict()
      .optional(),
    /** Harness permission mode id after the manager-authority clamp. */
    permissionMode: z.string().min(1).max(128),
    lifecycle: z.enum(['persistent', 'ephemeral']),
    taskWorkspaceId: z.string().min(1).optional(),
    /**
     * Cross-review (10 §5): the dispatch this ephemeral reviewer inspects.
     * Reviewers run read-only in the reviewed worker's task workspace and
     * hold no write lease on it.
     */
    reviewOf: z.string().min(1).max(256).optional(),
    /**
     * Immutable security snapshot captured at creation. Every later dispatch
     * runs under this ceiling; it does not widen with later manager turns.
     */
    securitySnapshot: ChildSecuritySnapshot,
    control: z.enum(['manager', 'user']),
    /**
     * Working-tree sha captured when control flipped to 'user' (09 §9);
     * hand-back reports the diff between this baseline and the live tree.
     */
    takeoverBaseline: z.string().min(1).max(128).optional(),
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

/** A decided verdict displaced by a later one (10 §4.1: keep both on record). */
export const SupersededVerdictSchema = z
  .object({
    status: z.enum(['passed', 'needs_changes', 'rejected', 'waived']),
    decidedBy: z.enum(['manager', 'user', 'reviewer']),
    notes: z.string().max(4_000).optional(),
    decidedAt: z.string().optional()
  })
  .strict()
export type SupersededVerdict = z.infer<typeof SupersededVerdictSchema>

export const QualityVerdictSchema = z
  .object({
    status: z.enum(['pending', 'passed', 'needs_changes', 'rejected', 'waived']),
    decidedBy: z.enum(['manager', 'user', 'reviewer']).optional(),
    reviewerWorkerId: z.string().min(1).max(256).optional(),
    checks: z.array(QualityCheckSchema).max(64).default([]),
    notes: z.string().max(4_000).optional(),
    decidedAt: z.string().optional(),
    /** Prior decided verdicts, newest first; the current verdict stays effective. */
    superseded: z.array(SupersededVerdictSchema).max(8).optional()
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
      'worker_detached',
      'worker_taken_over',
      'worker_handed_back',
      'worker_approval',
      'review_completed'
    ]),
    dispatchId: z.string().min(1).max(256).optional(),
    questionId: z.string().min(1).max(256).optional(),
    /** Approval id for worker_approval notices (feeds `worker_approve`). */
    approvalId: z.string().min(1).max(256).optional(),
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

/**
 * `POST /v1/teams/questions/:questionId/answer` (09 §9): the user answers a
 * worker question directly; the record stores `answeredBy: 'user'`.
 */
export const QuestionAnswerRequestSchema = z
  .object({ answer: z.string().min(1).max(8_000) })
  .strict()
export type QuestionAnswerRequest = z.infer<typeof QuestionAnswerRequestSchema>

/**
 * `POST /v1/teams/workers/:workerId/dispatch` (09 §9): a GUI-originated
 * dispatch (review comments sent back to the worker, P1-18). Same durable
 * dispatch + delivery semantics as manager-created work.
 */
export const WorkerDispatchRequestSchema = z
  .object({
    title: z.string().min(1).max(240).optional(),
    task: z.string().min(1).max(32_000),
    context: DispatchContextSchema.optional(),
    mode: z.enum(['queue', 'interrupt']).optional()
  })
  .strict()
export type WorkerDispatchRequest = z.infer<typeof WorkerDispatchRequestSchema>

/**
 * `POST /v1/teams/dispatches/:dispatchId/verdict` (10 §4.3): the user records
 * a quality verdict from the review panel. `decidedBy: 'user'` overrides a
 * manager verdict while both stay on record.
 */
export const DispatchVerdictRequestSchema = z
  .object({
    status: z.enum(['passed', 'needs_changes', 'rejected', 'waived']),
    notes: z.string().min(1).max(4_000).optional()
  })
  .strict()
export type DispatchVerdictRequest = z.infer<typeof DispatchVerdictRequestSchema>

/** Worker-callback tools every ADE worker keeps even under a read-only ceiling. */
export const ADE_WORKER_CALLBACK_TOOL_NAMES = [
  'report_progress',
  'ask_manager',
  'read_manager_context',
  'submit_result'
] as const

/**
 * Read-only tool ceiling for a child run (10 §5): ADE worker children keep
 * their manager-callback channel — a reviewer could not `submit_result`
 * without it. Non-worker read-only children get the base subagent ceiling.
 */
export function readOnlyToolCeiling(
  executionUnit: { kind: string } | undefined
): readonly string[] {
  return executionUnit?.kind === 'worker'
    ? [...SUBAGENT_READ_ONLY_TOOL_NAMES, ...ADE_WORKER_CALLBACK_TOOL_NAMES]
    : SUBAGENT_READ_ONLY_TOOL_NAMES
}

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

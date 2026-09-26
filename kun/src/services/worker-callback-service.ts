import { z } from 'zod'
import type { ActivityPatch, ActivityProvenance } from '../contracts/activity.js'
import type { QuestionRecord } from '../contracts/ade.js'
import { WorkerReportSchema } from '../contracts/ade.js'
import type { AssistantTextTurnItem, TurnItem, UserTurnItem } from '../contracts/items.js'
import type { FileTeamStore } from '../ade/team-store.js'
import type { FileDispatchStore } from '../ade/dispatch-store.js'
import type { FileQuestionStore } from '../ade/question-store.js'
import type { FileWorkerNoticeStore, WorkerNoticeSink } from '../ade/worker-notice-store.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { SessionStore } from '../ports/session-store.js'

/**
 * Host-side implementation of the worker callback tools (05 §2). The worker
 * identity is always derived from the calling thread's persisted
 * `executionUnit`; callers can never nominate another thread.
 */
export type WorkerCallbackServiceDeps = {
  threadStore: Pick<ThreadStore, 'get'>
  sessionStore: Pick<SessionStore, 'loadItems'>
  teams: FileTeamStore
  dispatches: FileDispatchStore
  questions: FileQuestionStore
  /**
   * Initial sink; composition rebinds it to the WorkerNoticeCoordinator so
   * question notices schedule manager wake-ups too (09 §6.2).
   */
  notices: WorkerNoticeSink
  activity?: { apply(unitId: string, patch: ActivityPatch, provenance: ActivityProvenance): void }
  nowIso?: () => string
  nowMs?: () => number
  idGenerator?: () => string
}

const REPORT_PROGRESS_MIN_INTERVAL_MS = 10_000
const ASK_DEFAULT_TIMEOUT_S = 600
const ASK_MAX_TIMEOUT_S = 3_600
const CONTEXT_SCAN_LIMIT = 500
const CONTEXT_DEFAULT_LIMIT = 10
const CONTEXT_MAX_LIMIT = 50

export const ReportProgressInputSchema = z.object({
  summary: z.string().min(1).max(280),
  phase: z.enum(['investigating', 'implementing', 'verifying', 'blocked']).optional()
}).strict()

export const AskManagerInputSchema = z.object({
  question: z.string().min(1).max(8_000),
  options: z.array(z.string().min(1).max(512)).max(16).optional(),
  timeoutSeconds: z.number().int().min(1).max(ASK_MAX_TIMEOUT_S).optional()
}).strict()

export const ReadManagerContextInputSchema = z.object({
  query: z.string().max(1_024).optional(),
  cursor: z.string().max(1_024).optional(),
  limit: z.number().int().min(1).max(CONTEXT_MAX_LIMIT).optional()
}).strict()

export const SubmitResultInputSchema = WorkerReportSchema.omit({ submittedAt: true })

export type AskManagerResult =
  | { status: 'answered'; answer: string; answeredBy: 'manager' | 'user' }
  | { status: 'timeout' }
  | { status: 'cancelled' }

export type ManagerContextEntry = {
  role: 'user' | 'assistant'
  text: string
  turnId: string
  createdAt: string
}

type QuestionWaiter = {
  teamId: string
  resolve: (result: AskManagerResult) => void
  timer: ReturnType<typeof setTimeout>
  abort: () => void
}

export class WorkerCallbackService {
  private readonly nowIso: () => string
  private readonly nowMs: () => number
  private readonly lastProgressAt = new Map<string, number>()
  private readonly waiters = new Map<string, QuestionWaiter>()
  private noticeSink: WorkerNoticeSink

  constructor(private readonly deps: WorkerCallbackServiceDeps) {
    this.noticeSink = deps.notices
    this.nowIso = deps.nowIso ?? (() => new Date().toISOString())
    this.nowMs = deps.nowMs ?? (() => Date.now())
  }

  /**
   * Late binding: the coordinator only exists after agent composition, while
   * this service is built earlier for the tool providers.
   */
  setNoticeSink(sink: WorkerNoticeSink): void {
    this.noticeSink = sink
  }

  /** Resolve the calling worker's team binding or throw "not a worker". */
  private async requireWorker(workerThreadId: string): Promise<{
    teamId: string
    managerThreadId: string
    harnessLabel?: string
  }> {
    const thread = await this.deps.threadStore.get(workerThreadId)
    const unit = thread?.executionUnit
    if (unit?.kind !== 'worker') {
      throw new Error(`thread ${workerThreadId} is not a worker`)
    }
    const team = await this.deps.teams.get(unit.teamId)
    if (!team) throw new Error(`worker team ${unit.teamId} does not exist`)
    const record = team.workers.find((entry) => entry.workerId === workerThreadId)
    const harnessLabel = record
      ? `${record.route.harnessId} · ${record.route.model}`.slice(0, 160)
      : undefined
    return { teamId: unit.teamId, managerThreadId: unit.managerThreadId, harnessLabel }
  }

  private async activeDispatch(teamId: string, workerId: string) {
    const accepted = await this.deps.dispatches.listByState(teamId, ['accepted'])
    return accepted.find((entry) => entry.workerId === workerId) ?? null
  }

  /** report_progress: throttle to one write per 10s per worker. */
  async reportProgress(
    workerThreadId: string,
    rawInput: unknown
  ): Promise<{ status: 'recorded' | 'rate_limited' }> {
    const input = ReportProgressInputSchema.parse(rawInput)
    await this.requireWorker(workerThreadId)
    const now = this.nowMs()
    const last = this.lastProgressAt.get(workerThreadId)
    if (last !== undefined && now - last < REPORT_PROGRESS_MIN_INTERVAL_MS) {
      return { status: 'rate_limited' }
    }
    this.lastProgressAt.set(workerThreadId, now)
    this.deps.activity?.apply(workerThreadId, {
      ...(input.phase ? { phase: input.phase } : {}),
      progressNote: input.summary
    }, 'callback')
    return { status: 'recorded' }
  }

  /**
   * ask_manager: create a persisted question, mark the worker waiting, notify
   * the manager, then block this tool call until an answer, the deadline, or
   * turn cancellation arrives.
   */
  async askManager(
    workerThreadId: string,
    rawInput: unknown,
    signal: AbortSignal
  ): Promise<AskManagerResult> {
    const input = AskManagerInputSchema.parse(rawInput)
    const worker = await this.requireWorker(workerThreadId)
    const dispatch = await this.activeDispatch(worker.teamId, workerThreadId)
    if (!dispatch) throw new Error('no active dispatch for this worker')
    const timeoutMs = Math.min(
      ASK_MAX_TIMEOUT_S,
      Math.max(1, input.timeoutSeconds ?? ASK_DEFAULT_TIMEOUT_S)
    ) * 1_000
    const now = this.nowIso()
    const questionId = this.deps.idGenerator?.() ?? `q_${Math.random().toString(36).slice(2, 10)}`
    const question: QuestionRecord = {
      questionId,
      dispatchId: dispatch.dispatchId,
      workerId: workerThreadId,
      question: input.question,
      ...(input.options?.length ? { options: input.options } : {}),
      state: 'open',
      deadline: new Date(this.nowMs() + timeoutMs).toISOString(),
      createdAt: now,
      updatedAt: now
    }
    await this.deps.questions.create(worker.teamId, question)
    this.deps.activity?.apply(workerThreadId, {
      mainState: 'waiting',
      waitingReason: 'question'
    }, 'callback')
    await this.noticeSink.enqueue({
      noticeId: `ntc_${questionId}`,
      teamId: worker.teamId,
      workerId: workerThreadId,
      kind: 'question',
      dispatchId: dispatch.dispatchId,
      questionId,
      title: dispatch.title,
      ...(worker.harnessLabel ? { harnessLabel: worker.harnessLabel } : {}),
      detail: input.question.slice(0, 4_000),
      ...(input.options?.length ? { options: input.options } : {}),
      attempts: 0,
      createdAt: now
    })
    try {
      return await this.waitForAnswer(worker.teamId, question, timeoutMs, signal)
    } finally {
      // Whether answered, timed out, or cancelled, the worker is no longer
      // parked on this question.
      this.deps.activity?.apply(workerThreadId, {
        mainState: 'working',
        waitingReason: undefined
      }, 'callback')
    }
  }

  /** worker_answer entry point: persist the answer and release the waiter. */
  async answerQuestion(input: {
    teamId: string
    questionId: string
    answer: string
    answeredBy: 'manager' | 'user'
  }): Promise<QuestionRecord | null> {
    const updated = await this.deps.questions.update(input.teamId, input.questionId, {
      state: 'answered',
      answer: input.answer.slice(0, 8_000),
      answeredBy: input.answeredBy
    })
    const waiter = this.waiters.get(input.questionId)
    if (waiter && updated) {
      waiter.resolve({ status: 'answered', answer: updated.answer ?? input.answer, answeredBy: input.answeredBy })
    }
    return updated
  }

  /**
   * Startup reconciliation: questions whose waiter died with the last process
   * can never be answered; mark them timed out and drop stale waiters.
   */
  async reconcileOnStartup(teamId: string): Promise<number> {
    for (const [, waiter] of this.waiters) {
      if (waiter.teamId === teamId) waiter.abort()
    }
    return this.deps.questions.markOpenTimedOut(teamId)
  }

  /** Reconcile every persisted team; safe to call once at runtime boot. */
  async reconcileAllTeams(): Promise<void> {
    for (const team of await this.deps.teams.list()) {
      await this.reconcileOnStartup(team.teamId)
    }
  }

  private waitForAnswer(
    teamId: string,
    question: QuestionRecord,
    timeoutMs: number,
    signal: AbortSignal
  ): Promise<AskManagerResult> {
    const questionId = question.questionId
    return new Promise<AskManagerResult>((resolve) => {
      const settleFromRecord = async (fallback: AskManagerResult): Promise<AskManagerResult> => {
        // If a terminal state beat this write (answer arrived first), honor it.
        const record = await this.deps.questions.get(teamId, questionId).catch(() => null)
        if (record?.state === 'answered' && record.answer !== undefined) {
          return { status: 'answered', answer: record.answer, answeredBy: record.answeredBy ?? 'manager' }
        }
        return fallback
      }
      const onAbort = (): void => {
        // Persist the terminal state before resolving so the caller never
        // observes a cancelled result over a still-open record.
        void this.deps.questions.update(teamId, questionId, { state: 'cancelled' })
          .then(() => finish({ status: 'cancelled' }))
          .catch(() => settleFromRecord({ status: 'cancelled' }).then(finish))
      }
      const finish = (result: AskManagerResult): void => {
        const waiter = this.waiters.get(questionId)
        if (waiter) clearTimeout(waiter.timer)
        this.waiters.delete(questionId)
        signal.removeEventListener('abort', onAbort)
        resolve(result)
      }
      const timer = setTimeout(() => {
        void this.deps.questions.update(teamId, questionId, { state: 'timeout' })
          .then(() => finish({ status: 'timeout' }))
          .catch(() => settleFromRecord({ status: 'timeout' }).then(finish))
      }, timeoutMs)
      const waiter: QuestionWaiter = {
        teamId,
        resolve: finish,
        timer,
        abort: () => onAbort()
      }
      this.waiters.set(questionId, waiter)
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  /**
   * read_manager_context: bounded read over the manager thread's own visible
   * messages — user text (displayText preferred; host-sourced user items are
   * excluded) and assistant text only. Never other threads, tools, reasoning.
   */
  async readManagerContext(
    workerThreadId: string,
    rawInput: unknown
  ): Promise<{ items: ManagerContextEntry[]; nextCursor?: string }> {
    const input = ReadManagerContextInputSchema.parse(rawInput)
    const worker = await this.requireWorker(workerThreadId)
    if (worker.managerThreadId === workerThreadId) {
      throw new Error('worker cannot read its own thread as manager context')
    }
    const items = await this.deps.sessionStore.loadItems(worker.managerThreadId)
    // loadItems returns chronological order; keep the most recent
    // CONTEXT_SCAN_LIMIT visible entries, then paginate newest-first.
    const recent = items
      .filter(isManagerVisibleItem)
      .map((item): ManagerContextEntry => item.kind === 'user_message'
        ? {
            role: 'user',
            text: item.displayText ?? item.text,
            turnId: item.turnId,
            createdAt: item.createdAt
          }
        : { role: 'assistant', text: item.text, turnId: item.turnId, createdAt: item.createdAt })
      .slice(-CONTEXT_SCAN_LIMIT)
      .reverse()
    const query = input.query?.trim().toLowerCase()
    const matched = query
      ? recent.filter((entry) => entry.text.toLowerCase().includes(query))
      : recent
    const limit = Math.min(CONTEXT_MAX_LIMIT, Math.max(1, input.limit ?? CONTEXT_DEFAULT_LIMIT))
    const startIndex = input.cursor ? decodeCursor(input.cursor) : 0
    const page = matched.slice(startIndex, startIndex + limit)
    const nextIndex = startIndex + page.length
    return {
      items: page,
      ...(nextIndex < matched.length ? { nextCursor: encodeCursor(nextIndex) } : {})
    }
  }

  /** submit_result: bounded structured report on the active dispatch. */
  async submitResult(
    workerThreadId: string,
    rawInput: unknown
  ): Promise<{ status: 'recorded' }> {
    const input = SubmitResultInputSchema.parse(rawInput)
    const worker = await this.requireWorker(workerThreadId)
    const dispatch = await this.activeDispatch(worker.teamId, workerThreadId)
    if (!dispatch) throw new Error('no active dispatch for this worker')
    await this.deps.dispatches.update(worker.teamId, dispatch.dispatchId, {
      workerReport: { ...input, submittedAt: this.nowIso() }
    })
    return { status: 'recorded' }
  }
}

function isManagerVisibleItem(item: TurnItem): item is UserTurnItem | AssistantTextTurnItem {
  if (item.kind === 'user_message') {
    // Host-injected messages (worker_update, handoffs, resume envelopes) are
    // control traffic, not manager-authored conversation.
    return item.messageSource === undefined
  }
  return item.kind === 'assistant_text'
}

function encodeCursor(index: number): string {
  return Buffer.from(String(index), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): number {
  try {
    const index = Number.parseInt(Buffer.from(cursor, 'base64url').toString('utf8'), 10)
    return Number.isFinite(index) && index >= 0 ? index : 0
  } catch {
    return 0
  }
}

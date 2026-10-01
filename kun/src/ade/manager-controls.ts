import { newManagerWorkRefusal } from './new-work-admission.js'
import { refreshTeamExecutionPolicy } from './team-execution-policy.js'
import { isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod'
import {
  DispatchContextSchema,
  type DispatchRecord,
  type QuestionRecord,
  type TeamRecord,
  type WorkerNotice,
  type WorkerRecord
} from '../contracts/ade.js'
import type { ApprovalRequest } from '../domain/approval.js'
import type { DeliverOutcome } from './dispatch-deliverer.js'
import {
  createDispatch as createDispatchRecord,
  sendReport as dispatchSendReport
} from './dispatch-create.js'
import {
  budgetHardRefusal,
  budgetSoftNoticeDetail
} from './team-budget.js'
import type { ManagerToolContext, ManagerRuntimeDeps } from './manager-runtime.js'
import { PERMISSION_RANK } from './permission-clamp.js'
import { reportLanguage } from './user-report.js'

/** `worker_send` (09 §4.1): a new dispatch for an existing worker. */
export const WorkerSendInputSchema = z
  .object({
    workerId: z.string().min(1).max(256),
    task: z.string().min(1).max(32_000),
    title: z.string().min(1).max(240).optional(),
    context: DispatchContextSchema.optional(),
    mode: z.enum(['queue', 'interrupt']).optional()
  })
  .strict()
export type WorkerSendInput = z.infer<typeof WorkerSendInputSchema>

export const WorkerStopInputSchema = z
  .object({ workerId: z.string().min(1).max(256) })
  .strict()

export const WorkerReleaseInputSchema = z
  .object({
    workerId: z.string().min(1).max(256),
    /** Also hide the worker from the activity board (09 §4.1). */
    archive: z.boolean().optional()
  })
  .strict()

export const WorkerAnswerInputSchema = z
  .object({
    questionId: z.string().min(1).max(256),
    answer: z.string().min(1).max(8_000)
  })
  .strict()

export const DispatchQueueInputSchema = z
  .object({ workerId: z.string().min(1).max(256).optional() })
  .strict()

/** `dispatch_update`: only `task` and `context` may change (09 §4.1). */
export const DispatchUpdateInputSchema = z
  .object({
    dispatchId: z.string().min(1).max(256),
    task: z.string().min(1).max(32_000).optional(),
    context: DispatchContextSchema.optional()
  })
  .strict()

export const DispatchCancelInputSchema = z
  .object({ dispatchId: z.string().min(1).max(256) })
  .strict()

/** `worker_approve` (09 §6.5): only advertised while managerMayApprove is on. */
export const WorkerApproveInputSchema = z
  .object({
    approvalId: z.string().min(1).max(256),
    decision: z.enum(['allow', 'deny'])
  })
  .strict()

export type WorkerSendResult = {
  ok: boolean
  /** The receiving worker — the renderer links the card to its thread. */
  workerId?: string
  dispatchId?: string
  dispatched?: boolean
  deliveryPending?: DeliverOutcome['pendingReason']
  refusal?: string
  userReport: string
}

export type ControlResult = {
  ok: boolean
  refusal?: string
  userReport: string
}

/** States a dispatch may still be edited or withdrawn in (09 §4.1). */
const MUTABLE_STATES = ['pending'] as const
/** States not yet owned by a worker turn (queue view, 09 §4.1). */
const QUEUED_STATES = ['pending', 'delivering', 'uncertain'] as const

/**
 * Manager control-plane tool operations (09 §4.1): worker_send/stop/release/
 * answer, dispatch queue/update/cancel, and the opt-in worker_approve. The
 * GUI team routes share the helpers via TeamControls; every write path here
 * is also reachable through ManagerRuntime delegates.
 */
export class ManagerControls {
  constructor(private readonly deps: ManagerRuntimeDeps) {}

  language(): 'en' | 'zh' {
    return reportLanguage(this.deps.language?.())
  }

  harnessLabel(worker: WorkerRecord): string | undefined {
    const name = this.deps.catalog.get(worker.route.harnessId)?.displayName ?? worker.route.harnessId
    const label = worker.route.model ? `${name} · ${worker.route.model}` : name
    return label.length <= 160 ? label : label.slice(0, 160)
  }

  async teamForWorker(workerId: string): Promise<{
    team: TeamRecord
    worker: WorkerRecord
  } | null> {
    for (const team of await this.deps.teams.list()) {
      const worker = team.workers.find((entry) => entry.workerId === workerId)
      if (worker) return { team, worker }
    }
    return null
  }

  async teamForQuestion(questionId: string): Promise<{
    team: TeamRecord
    question: QuestionRecord
  } | null> {
    for (const team of await this.deps.teams.list()) {
      const question = await this.deps.questions.get(team.teamId, questionId)
      if (question) return { team, question }
    }
    return null
  }

  /** Persist + deliver one dispatch (worker_send and the GUI route share this). */
  createDispatch(input: Parameters<typeof createDispatchRecord>[1]) {
    return createDispatchRecord(this.deps, input)
  }

  sendReport(worker: WorkerRecord, delivered: DeliverOutcome, language: 'en' | 'zh'): string {
    return dispatchSendReport(worker, delivered, language)
  }

  /** `worker_send` — refuse while the user holds control or the worker ended. */
  async workerSend(ctx: ManagerToolContext, rawInput: unknown): Promise<WorkerSendResult> {
    const input = WorkerSendInputSchema.parse(rawInput)
    const refused = await newManagerWorkRefusal(this.deps, ctx.threadId, ctx.turnId)
    if (refused) return refused
    const language = this.language()
    const team = await this.deps.teams.get(ctx.threadId)
    const worker = team?.workers.find((entry) => entry.workerId === input.workerId)
    if (!team || !worker) {
      return {
        ok: false,
        refusal: 'worker_not_found',
        userReport: language === 'zh' ? '该 worker 不在此团队中。' : 'That worker is not in this team.'
      }
    }
    if (worker.state !== 'active') {
      return {
        ok: false,
        refusal: 'worker_not_active',
        userReport: language === 'zh'
          ? '该 worker 已释放或分离，不能再派活。'
          : 'The worker was released or detached; it cannot take new work.'
      }
    }
    if (worker.control === 'user') {
      return {
        ok: false,
        refusal: 'under_user_control',
        userReport: language === 'zh'
          ? '未派出：该 worker 已由用户接管，交还后才能派活。'
          : 'Not dispatched: the user has taken over this worker; wait for hand-back.'
      }
    }
    const budgetRefusal = await this.budgetRefusal(team, language)
    if (budgetRefusal) return budgetRefusal
    const { dispatch, delivered } = await this.createDispatch({
      teamId: team.teamId,
      workerId: worker.workerId,
      parentTurnId: ctx.turnId,
      ...(input.title ? { title: input.title } : {}),
      task: input.task,
      ...(input.context ? { context: input.context } : {}),
      ...(input.mode ? { mode: input.mode } : {})
    })
    return {
      ok: true,
      workerId: worker.workerId,
      dispatchId: dispatch.dispatchId,
      dispatched: delivered.accepted,
      ...(delivered.pendingReason ? { deliveryPending: delivered.pendingReason } : {}),
      userReport: this.sendReport(worker, delivered, language)
    }
  }

  /** `worker_stop` — interrupt the worker's active/queued turn (09 §4.1). */
  async workerStop(ctx: ManagerToolContext, rawInput: unknown): Promise<ControlResult & {
    stopped?: boolean
  }> {
    const input = WorkerStopInputSchema.parse(rawInput)
    const language = this.language()
    const team = await this.deps.teams.get(ctx.threadId)
    const worker = team?.workers.find((entry) => entry.workerId === input.workerId)
    if (!team || !worker) {
      return {
        ok: false,
        refusal: 'worker_not_found',
        userReport: language === 'zh' ? '该 worker 不在此团队中。' : 'That worker is not in this team.'
      }
    }
    if (worker.state !== 'active') {
      return {
        ok: false,
        refusal: 'worker_not_active',
        userReport: language === 'zh'
          ? '该 worker 已释放或分离，它的会话不再受总管控制。'
          : 'The worker was released or detached; its thread is no longer under manager control.'
      }
    }
    if (worker.control === 'user') {
      return {
        ok: false,
        refusal: 'under_user_control',
        userReport: language === 'zh'
          ? '该 worker 已由用户接管，总管不能中断用户的对话。'
          : 'The worker is under user control; the manager cannot interrupt the user\'s turn.'
      }
    }
    const stopped = await this.deps.deliverer.stopWorker(worker.workerId)
    const didStop = stopped.turnStopped || stopped.runAborted
    return {
      ok: true,
      stopped: didStop,
      userReport: language === 'zh'
        ? didStop
          ? `已中断「${worker.label}」当前这一轮，队列中的派活不受影响。`
          : `「${worker.label}」当前没有运行中的任务。`
        : didStop
          ? `Interrupted "${worker.label}"'s current turn; queued dispatches are unaffected.`
          : `"${worker.label}" has no running turn.`
    }
  }

  /**
   * `worker_release` (09 §4.1/§9): stop work, mark released, dorm the
   * activity row. The task workspace is captured first; an empty diff is
   * discarded, unmerged changes stay on disk and the report says so.
   */
  async workerRelease(ctx: ManagerToolContext, rawInput: unknown): Promise<ControlResult & {
    workspaceKept?: boolean
    workspacePath?: string
  }> {
    const input = WorkerReleaseInputSchema.parse(rawInput)
    const language = this.language()
    const team = await this.deps.teams.get(ctx.threadId)
    const worker = team?.workers.find((entry) => entry.workerId === input.workerId)
    if (!team || !worker) {
      return {
        ok: false,
        refusal: 'worker_not_found',
        userReport: language === 'zh' ? '该 worker 不在此团队中。' : 'That worker is not in this team.'
      }
    }
    if (worker.state === 'released') {
      return {
        ok: true,
        userReport: language === 'zh'
          ? `「${worker.label}」已经是释放状态。`
          : `"${worker.label}" is already released.`
      }
    }
    await this.deps.deliverer.stopWorker(worker.workerId)
    // Pending dispatches can never run on a released worker — cancel now
    // instead of leaving them to fail on the next delivery attempt.
    for (const pending of await this.deps.dispatches.listByWorker(team.teamId, worker.workerId)) {
      if (pending.state !== 'pending') continue
      await this.deps.dispatches.update(team.teamId, pending.dispatchId, {
        state: 'cancelled',
        failureReason: 'worker released'
      }, { expect: MUTABLE_STATES }).catch(() => undefined)
    }
    await this.deps.teams.updateWorker(team.teamId, worker.workerId, {
      state: 'released',
      releasedAt: this.deps.nowIso()
    })
    this.deps.activity?.apply(worker.workerId, {
      residency: 'dormant',
      ...(input.archive ? { visibility: 'archived' } : {})
    }, 'runtime')

    let workspaceKept = false
    let workspacePath: string | undefined
    if (worker.taskWorkspaceId && this.deps.taskWorkspaces) {
      const workspaceId = worker.taskWorkspaceId
      workspacePath = this.deps.taskWorkspaces.get(workspaceId)?.path
      const stat = await this.deps.taskWorkspaces
        .captureForDispatch(workspaceId)
        .then((result) => result.stat)
        .catch(() => null)
      // 07 §8.3: keep the worktree whenever it may still hold unmerged work
      // (non-empty diff, or capture could not prove it clean).
      if (stat && stat.changedFiles === 0) {
        await this.deps.taskWorkspaces.discard(workspaceId, true).catch(() => undefined)
      } else {
        workspaceKept = true
      }
    }
    await this.enqueueNotice(team.teamId, worker, 'worker_released')
    const keptNote = workspaceKept
      ? language === 'zh'
        ? `任务工作区有未合入的改动，已保留${workspacePath ? `（${workspacePath}）` : ''}。`
        : ` The task workspace has unmerged changes; it was kept${workspacePath ? ` at ${workspacePath}` : ''}.`
      : ''
    return {
      ok: true,
      ...(workspaceKept ? { workspaceKept, ...(workspacePath ? { workspacePath } : {}) } : {}),
      userReport: (language === 'zh'
        ? `已释放「${worker.label}」，进入休眠。`
        : `Released "${worker.label}"; it is now dormant.`) + keptNote
    }
  }

  /** `worker_answer` (09 §6.4) — releases the waiting askManager call. */
  async workerAnswer(ctx: ManagerToolContext, rawInput: unknown): Promise<ControlResult> {
    const input = WorkerAnswerInputSchema.parse(rawInput)
    const language = this.language()
    const question = await this.deps.questions.get(ctx.threadId, input.questionId)
    if (!question) {
      return {
        ok: false,
        refusal: 'question_not_found',
        userReport: language === 'zh' ? '该问题不在此团队中。' : 'That question is not in this team.'
      }
    }
    if (question.state !== 'open' && question.state !== 'escalated') {
      return {
        ok: false,
        refusal: 'question_not_open',
        userReport: language === 'zh'
          ? `问题已经是 ${question.state} 状态，不能再回答。`
          : `The question is already ${question.state}; it can no longer be answered.`
      }
    }
    const answered = await this.deps.workerCallbacks?.answerQuestion({
      teamId: ctx.threadId,
      questionId: input.questionId,
      answer: input.answer,
      answeredBy: 'manager'
    })
    if (!answered) {
      return {
        ok: false,
        refusal: 'answer_failed',
        userReport: language === 'zh' ? '回答未能写入。' : 'The answer could not be recorded.'
      }
    }
    return {
      ok: true,
      userReport: language === 'zh'
        ? '已回复 worker 的问题，它会继续执行。'
        : 'Replied to the worker question; it will resume.'
    }
  }

  /** `dispatch_queue` — pre-acceptance dispatches (pending/delivering/uncertain). */
  async dispatchQueue(ctx: ManagerToolContext, rawInput: unknown): Promise<{
    dispatches: DispatchRecord[]
  }> {
    const input = DispatchQueueInputSchema.parse(rawInput)
    const team = await this.deps.teams.get(ctx.threadId)
    if (!team) return { dispatches: [] }
    const queued = await this.deps.dispatches.listByState(team.teamId, QUEUED_STATES)
    return {
      dispatches: input.workerId
        ? queued.filter((entry) => entry.workerId === input.workerId)
        : queued
    }
  }

  /** `dispatch_update` — only `task`/`context`, only while `pending` (09 §4.1). */
  async dispatchUpdate(ctx: ManagerToolContext, rawInput: unknown): Promise<ControlResult & {
    dispatch?: DispatchRecord
  }> {
    const input = DispatchUpdateInputSchema.parse(rawInput)
    const language = this.language()
    const team = await this.deps.teams.get(ctx.threadId)
    const dispatch = team
      ? await this.deps.dispatches.get(team.teamId, input.dispatchId)
      : null
    if (!team || !dispatch) {
      return {
        ok: false,
        refusal: 'dispatch_not_found',
        userReport: language === 'zh' ? '该派活不在此团队中。' : 'That dispatch is not in this team.'
      }
    }
    if (input.task === undefined && input.context === undefined) {
      return {
        ok: false,
        refusal: 'nothing_to_update',
        userReport: language === 'zh'
          ? '没有提供要修改的字段（只能改 task 或 context）。'
          : 'Nothing to update (only task or context may change).'
      }
    }
    const updated = await this.deps.dispatches.update(
      team.teamId,
      input.dispatchId,
      {
        ...(input.task !== undefined ? { task: input.task } : {}),
        ...(input.context !== undefined ? { context: input.context } : {})
      },
      { expect: MUTABLE_STATES }
    )
    if (!updated) {
      return {
        ok: false,
        refusal: 'dispatch_not_pending',
        userReport: language === 'zh'
          ? `派活已是 ${dispatch.state} 状态，只有 pending 的派活可以修改。`
          : `The dispatch is already ${dispatch.state}; only pending dispatches can be edited.`
      }
    }
    return {
      ok: true,
      dispatch: updated,
      userReport: language === 'zh' ? '已更新派活内容。' : 'Dispatch updated.'
    }
  }

  /** `dispatch_cancel` — withdraw a `pending` dispatch (09 §4.1). */
  async dispatchCancel(ctx: ManagerToolContext, rawInput: unknown): Promise<ControlResult> {
    const input = DispatchCancelInputSchema.parse(rawInput)
    const language = this.language()
    const team = await this.deps.teams.get(ctx.threadId)
    const dispatch = team
      ? await this.deps.dispatches.get(team.teamId, input.dispatchId)
      : null
    if (!team || !dispatch) {
      return {
        ok: false,
        refusal: 'dispatch_not_found',
        userReport: language === 'zh' ? '该派活不在此团队中。' : 'That dispatch is not in this team.'
      }
    }
    const updated = await this.deps.dispatches.update(
      team.teamId,
      input.dispatchId,
      { state: 'cancelled', failureReason: 'cancelled by manager' },
      { expect: MUTABLE_STATES }
    )
    if (!updated) {
      return {
        ok: false,
        refusal: 'dispatch_not_pending',
        userReport: language === 'zh'
          ? `派活已是 ${dispatch.state} 状态，只有 pending 的派活可以撤回。`
          : `The dispatch is already ${dispatch.state}; only pending dispatches can be cancelled.`
      }
    }
    return {
      ok: true,
      userReport: language === 'zh' ? '已撤回该派活。' : 'Dispatch cancelled.'
    }
  }

  /**
   * `worker_approve` (09 §6.5): resolve a worker's approval request when the
   * action stays inside the manager's own authority snapshot. File writes
   * must land inside the worker's frozen write roots; command/effect kinds
   * additionally require the manager to run at full-access. Actions marked
   * `requiresUserDecision` can never be delegated.
   */
  async workerApprove(ctx: ManagerToolContext, rawInput: unknown): Promise<ControlResult & {
    decided?: 'allow' | 'deny'
  }> {
    const input = WorkerApproveInputSchema.parse(rawInput)
    const language = this.language()
    const reason = language === 'zh' ? '由总管批准' : 'approved by manager'
    if (!this.deps.managerMayApprove?.()) {
      return {
        ok: false,
        refusal: 'disabled',
        userReport: language === 'zh'
          ? '未启用 managerMayApprove，worker 的审批只能由用户处理。'
          : 'managerMayApprove is disabled; worker approvals are user-only.'
      }
    }
    const gate = this.deps.approvalGate
    const events = this.deps.approvalEvents
    if (!gate || !events) {
      return {
        ok: false,
        refusal: 'unavailable',
        userReport: language === 'zh' ? '审批通道不可用。' : 'The approval channel is unavailable.'
      }
    }
    const approval = gate.get(input.approvalId)
    const team = await this.deps.teams.get(ctx.threadId)
    const worker = approval
      ? team?.workers.find((entry) => entry.workerId === approval.threadId)
      : undefined
    if (!approval || !team || !worker) {
      return {
        ok: false,
        refusal: 'approval_not_found',
        userReport: language === 'zh'
          ? '该审批不属于此团队的 worker。'
          : 'That approval does not belong to a worker of this team.'
      }
    }
    if (approval.status !== 'pending') {
      return {
        ok: false,
        refusal: 'already_decided',
        userReport: language === 'zh'
          ? `审批已是 ${approval.status} 状态。`
          : `The approval is already ${approval.status}.`
      }
    }
    if (input.decision === 'allow') {
      const violation = this.approvalOutsideAuthority(approval, worker, ctx)
      if (violation) {
        return {
          ok: false,
          refusal: 'outside_authority',
          userReport: language === 'zh'
            ? `不能代批：${violation}。`
            : `Cannot approve on the user's behalf: ${violation}.`
        }
      }
    }
    if (!gate.reserveDecision(approval.id, input.decision, reason)) {
      return {
        ok: false,
        refusal: 'already_decided',
        userReport: language === 'zh' ? '审批已被处理。' : 'The approval was already resolved.'
      }
    }
    try {
      await events.record({
        kind: 'approval_resolved',
        threadId: approval.threadId,
        turnId: approval.turnId,
        itemId: undefined,
        approvalId: approval.id,
        toolName: approval.toolName,
        status: input.decision === 'allow' ? 'allowed' : 'denied',
        approvalReviewer: 'agent',
        summary: approval.summary,
        ...(approval.action ? { action: approval.action } : {}),
        reason
      })
    } catch (error) {
      gate.rollbackDecision(approval.id)
      throw error
    }
    gate.commitDecision(approval.id)
    return {
      ok: true,
      decided: input.decision,
      userReport: language === 'zh'
        ? input.decision === 'allow' ? `已批准「${worker.label}」的审批请求。` : `已拒绝「${worker.label}」的审批请求。`
        : input.decision === 'allow'
          ? `Approved "${worker.label}"'s request.`
          : `Denied "${worker.label}"'s request.`
    }
  }

  /** null = inside authority; a string explains the first violation found. */
  private approvalOutsideAuthority(
    approval: ApprovalRequest,
    worker: WorkerRecord,
    ctx: ManagerToolContext
  ): string | null {
    const action = approval.action
    if (!action) return 'the request has no verifiable action data'
    if (action.requiresUserDecision) return 'this action requires a user decision'
    const rank = PERMISSION_RANK[ctx.authority.kunPermissionMode]
    if (rank < PERMISSION_RANK['approve-for-me']) {
      return 'the manager permission level cannot approve worker actions'
    }
    const effects = action.effects
    if (rank < PERMISSION_RANK['full-access'] &&
      (action.kind !== 'file' || effects.network || effects.externalWrite
        || effects.processExecution || effects.guiAutomation)) {
      // approve-for-me delegates only in-workspace file writes.
      return 'only in-workspace file writes are delegatable at this manager level'
    }
    // File writes must land inside the worker's frozen write roots at every
    // manager level — approving beyond them would exceed the delegation.
    if (action.kind !== 'file') return null
    const roots = worker.securitySnapshot.allowedWritePaths?.length
      ? worker.securitySnapshot.allowedWritePaths
      : [worker.securitySnapshot.sandboxRoot]
    const fileTargets = action.targets.filter((target) => target.kind === 'file')
    if (fileTargets.length === 0) return 'no file targets could be verified'
    const base = action.cwd ?? action.workspace
    const outside = fileTargets.find((target) =>
      !roots.some((root) => pathContains(root, resolve(isAbsolute(target.value) ? '/' : base, target.value))))
    return outside ? `file target ${outside.value} is outside the worker workspace` : null
  }

  /** Mirror control flips onto the thread's executionUnit; null clears it. */
  async patchExecutionUnit(
    workerId: string,
    control: 'manager' | 'user' | null
  ): Promise<void> {
    const thread = await this.deps.threads.get(workerId).catch(() => null)
    const unit = thread?.executionUnit
    if (!thread || unit?.kind !== 'worker') return
    const next = { ...thread, updatedAt: this.deps.nowIso() }
    if (control === null) delete next.executionUnit
    else next.executionUnit = { ...unit, control }
    await this.deps.threads.upsert(next).catch((error) => {
      console.warn(`[kun] ade worker ${workerId} executionUnit update failed:`, error)
    })
  }

  /** P3-15 hard cap: refuse new work; first soft crossing sends one notice. */
  async budgetRefusal(
    team: TeamRecord,
    language: 'en' | 'zh'
  ): Promise<{ ok: false; refusal: 'budget_exceeded'; userReport: string } | null> {
    team = await refreshTeamExecutionPolicy(this.deps, team)
    const check = this.deps.teamBudget?.check(team)
    this.notifyBudgetCheck(team, check)
    return budgetHardRefusal(check, language)
  }

  /** P3-15: first soft-cap crossing wakes the manager once. */
  notifyBudgetCheck(
    team: TeamRecord,
    check: import('./team-budget.js').TeamBudgetCheck | undefined
  ): void {
    if (check?.exceeded !== 'soft-first') return
    void this.enqueueNotice(
      team.teamId, check.topWorker, 'team_budget', undefined,
      budgetSoftNoticeDetail(check, this.language()))
  }

  async enqueueNotice(
    teamId: string,
    worker: WorkerRecord,
    kind: WorkerNotice['kind'],
    capture?: WorkerNotice['capture'],
    detail?: string
  ): Promise<void> {
    await this.deps.notices.enqueue({
      noticeId: this.deps.ids.next('ntc'),
      teamId,
      workerId: worker.workerId,
      kind,
      title: worker.label,
      harnessLabel: this.harnessLabel(worker),
      ...(capture ? { capture } : {}),
      ...(detail ? { detail } : {}),
      attempts: 0,
      createdAt: this.deps.nowIso()
    }).catch((error) => {
      console.warn(`[kun] ade ${kind} notice enqueue failed for ${worker.workerId}:`, error)
    })
  }
}

/** Absolute `candidate` inside absolute `root` (delegation-security rules). */
function pathContains(root: string, candidate: string): boolean {
  const outside = relative(resolve(root), resolve(candidate))
  return outside === '' || (!outside.startsWith('..') && !isAbsolute(outside))
}

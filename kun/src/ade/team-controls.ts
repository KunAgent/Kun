import { newManagerWorkRefusal } from './new-work-admission.js'
import type {
  DispatchRecord,
  QuestionRecord,
  RaceRecord,
  TeamRecord,
  WorkerNotice,
  WorkerRecord
} from '../contracts/ade.js'
import type { ManagerRuntimeDeps } from './manager-runtime.js'
import type { ManagerControls, WorkerSendResult } from './manager-controls.js'
import { computeTeamUsage } from './team-budget.js'
import {
  runWorkspaceChecks,
  type RunWorkspaceChecksResult
} from './check-runner.js'

/**
 * GUI team-control operations (09 §9): manager-thread overview, user
 * takeover/hand-back, detach, user question answers, and GUI-originated
 * dispatches (review comments routed back to a worker, P1-18). Every
 * operation resolves the team from durable records — the routes carry only
 * worker/question ids, never client-asserted team ids.
 */
export class TeamControls {
  constructor(
    private readonly deps: ManagerRuntimeDeps,
    private readonly controls: ManagerControls
  ) {}

  /** P3-15 soft-cap notice passthrough for lifecycle hooks. */
  notifyBudgetCheck(
    team: TeamRecord,
    check: import('./team-budget.js').TeamBudgetCheck | undefined
  ): void {
    this.controls.notifyBudgetCheck(team, check)
  }

  /**
   * `GET /v1/teams/workers/:workerId` (09 §9): the worker record plus its
   * owning team — the worker thread's control banner keys off `control`.
   */
  async workerById(workerId: string): Promise<{
    team: TeamRecord
    worker: WorkerRecord
  } | null> {
    return this.controls.teamForWorker(workerId)
  }

  /**
   * `POST /v1/teams/workers/:workerId/stop` (09 §9): the user stops the
   * worker's active turn; queued dispatches stay pending, exactly like the
   * manager tool's `worker_stop`.
   */
  async stopWorker(workerId: string): Promise<{
    ok: boolean
    refusal?: string
    stopped?: boolean
  }> {
    const found = await this.controls.teamForWorker(workerId)
    if (!found) return { ok: false, refusal: 'worker_not_found' }
    const { worker } = found
    if (worker.state !== 'active') return { ok: false, refusal: 'worker_not_active' }
    const stopped = await this.deps.deliverer.stopWorker(workerId)
    return { ok: true, stopped: stopped.turnStopped || stopped.runAborted }
  }

  /** `GET /v1/teams/by-manager/:threadId` (09 §9): roster + recent work + races. */
  async teamOverview(managerThreadId: string): Promise<{
    team: TeamRecord
    dispatches: DispatchRecord[]
    questions: QuestionRecord[]
    races: RaceRecord[]
    /** P3-15: summed worker-thread usage + soft/hard exceed flags. */
    usage?: import('./team-budget.js').TeamUsageReport
  } | null> {
    const team = await this.deps.teams.get(managerThreadId)
    if (!team) return null
    return {
      team,
      dispatches: (await this.deps.dispatches.list(managerThreadId)).slice(-50),
      questions: (await this.deps.questions.list(managerThreadId)).slice(-50),
      races: this.deps.races ? (await this.deps.races.list(managerThreadId)).slice(-50) : [],
      ...(this.deps.usage
        ? { usage: computeTeamUsage(team, this.deps.usage) }
        : {})
    }
  }

  /**
   * Take-over (09 §9): `control` becomes 'user'. User messages on the worker
   * thread are ordinary turns; queued dispatches hold until hand-back.
   */
  async takeOverWorker(workerId: string): Promise<{
    ok: boolean
    refusal?: string
    worker?: WorkerRecord
  }> {
    const found = await this.controls.teamForWorker(workerId)
    if (!found) return { ok: false, refusal: 'worker_not_found' }
    const { team, worker } = found
    if (worker.state !== 'active') return { ok: false, refusal: 'worker_not_active' }
    if (worker.control === 'user') return { ok: true, worker }
    // Baseline for the hand-back interval diff (09 §9); absent when the
    // worker has no worktree (hand-back then falls back to cumulative stats).
    const takeoverBaseline = worker.taskWorkspaceId && this.deps.taskWorkspaces
      ? await this.deps.taskWorkspaces.snapshotBaseline(worker.taskWorkspaceId)
      : undefined
    const updated = await this.deps.teams.updateWorker(team.teamId, workerId, {
      control: 'user',
      ...(takeoverBaseline ? { takeoverBaseline } : {})
    })
    await this.controls.patchExecutionUnit(workerId, 'user')
    await this.controls.enqueueNotice(team.teamId, worker, 'worker_taken_over')
    return { ok: true, ...(updated ? { worker: updated } : {}) }
  }

  /**
   * Hand-back (09 §9): control returns to the manager; the notice carries
   * the takeover-period diff stats, and held dispatches resume delivery.
   */
  async handBackWorker(workerId: string): Promise<{
    ok: boolean
    refusal?: string
    worker?: WorkerRecord
    capture?: WorkerNotice['capture']
  }> {
    const found = await this.controls.teamForWorker(workerId)
    if (!found) return { ok: false, refusal: 'worker_not_found' }
    const { team, worker } = found
    if (worker.state !== 'active') return { ok: false, refusal: 'worker_not_active' }
    if (worker.control === 'manager') return { ok: true, worker }
    const capture = worker.taskWorkspaceId && this.deps.taskWorkspaces
      ? worker.takeoverBaseline
        ? await this.deps.taskWorkspaces
            .diffSinceBaseline(worker.taskWorkspaceId, worker.takeoverBaseline)
            .catch(() => undefined)
        : await this.deps.taskWorkspaces
            .captureForDispatch(worker.taskWorkspaceId)
            .then((result) => ({
              changedFiles: result.stat.changedFiles,
              insertions: result.stat.insertions,
              deletions: result.stat.deletions
            }))
            .catch(() => undefined)
      : undefined
    const updated = await this.deps.teams.updateWorker(team.teamId, workerId, {
      control: 'manager',
      takeoverBaseline: undefined
    })
    await this.controls.patchExecutionUnit(workerId, 'manager')
    await this.controls.enqueueNotice(team.teamId, worker, 'worker_handed_back', capture)
    // Queued dispatches held during takeover resume now.
    await this.deps.deliverer.tryDeliverNext(team.teamId, workerId)
      .catch((error) => console.warn(`[kun] ade hand-back delivery failed for ${workerId}:`, error))
    return {
      ok: true,
      ...(updated ? { worker: updated } : {}),
      ...(capture ? { capture } : {})
    }
  }

  /**
   * Detach (09 §9): the worker leaves the team and its thread's
   * `executionUnit` clears — the thread becomes a normal conversation and is
   * not stopped or moved. Queued dispatches can never run, so they cancel.
   */
  async detachWorker(workerId: string): Promise<{
    ok: boolean
    refusal?: string
    worker?: WorkerRecord
  }> {
    const found = await this.controls.teamForWorker(workerId)
    if (!found) return { ok: false, refusal: 'worker_not_found' }
    const { team, worker } = found
    if (worker.state === 'detached') return { ok: true, worker }
    // Queued dispatches can never run, and an in-flight one's terminal hook
    // will no longer resolve it once executionUnit clears — cancel both so
    // the record is honest. The turn itself keeps running as an ordinary
    // conversation (09 §9: 不停止、不移动).
    for (const live of await this.deps.dispatches.listByWorker(team.teamId, workerId)) {
      // delivering/uncertain have no direct cancelled edge — normalize
      // through accepted first, then withdraw.
      if (live.state === 'delivering' || live.state === 'uncertain') {
        await this.deps.dispatches.update(team.teamId, live.dispatchId,
          { state: 'accepted' }, { expect: ['delivering', 'uncertain'] }).catch(() => undefined)
      }
      await this.deps.dispatches.update(team.teamId, live.dispatchId, {
        state: 'cancelled',
        failureReason: 'worker detached'
      }, { expect: ['pending', 'accepted'] }).catch(() => undefined)
    }
    const updated = await this.deps.teams.updateWorker(team.teamId, workerId, { state: 'detached' })
    await this.controls.patchExecutionUnit(workerId, null)
    await this.controls.enqueueNotice(team.teamId, worker, 'worker_detached')
    return { ok: true, ...(updated ? { worker: updated } : {}) }
  }

  /** Question answer (09 §6.4) — recorded as `answeredBy: 'user'`. */
  async answerQuestionAsUser(
    questionId: string,
    answer: string
  ): Promise<{ ok: boolean; refusal?: string; question?: QuestionRecord }> {
    const found = await this.controls.teamForQuestion(questionId)
    if (!found) return { ok: false, refusal: 'question_not_found' }
    const { team, question } = found
    if (question.state !== 'open' && question.state !== 'escalated') {
      return { ok: false, refusal: 'question_not_open', question }
    }
    const answered = await this.deps.workerCallbacks?.answerQuestion({
      teamId: team.teamId,
      questionId,
      answer,
      answeredBy: 'user'
    })
    if (!answered) return { ok: false, refusal: 'answer_failed' }
    return { ok: true, question: answered }
  }

  /**
   * `POST /v1/teams/workers/:workerId/run-checks` (10 §4.2): the review
   * panel's run-checks button — same host check runner the manager tool
   * uses, resolved through the worker's owning team.
   */
  async runWorkerChecks(
    workerId: string,
    names?: string[]
  ): Promise<RunWorkspaceChecksResult> {
    const found = await this.controls.teamForWorker(workerId)
    if (!found) return { ok: false, refusal: 'worker_not_found', userReport: 'worker not found' }
    const deps = this.deps.checks
    if (!deps) {
      return { ok: false, refusal: 'checks_unavailable', userReport: 'check runner unavailable' }
    }
    return runWorkspaceChecks(
      {
        teams: this.deps.teams,
        dispatches: this.deps.dispatches,
        taskWorkspaces: this.deps.taskWorkspaces,
        ...deps,
        language: this.deps.language,
        nowIso: this.deps.nowIso
      },
      { teamId: found.team.teamId, workerId, ...(names ? { names } : {}) }
    )
  }

  /**
   * GUI-originated dispatch (09 §9): same durable dispatch + exactly-once
   * delivery as worker_send; still refuses while the user holds control —
   * the user can send an ordinary message in the worker thread instead.
   */
  async guiDispatch(workerId: string, input: {
    title?: string
    task: string
    context?: DispatchRecord['context']
    mode?: 'queue' | 'interrupt'
  }): Promise<WorkerSendResult> {
    const language = this.controls.language()
    const found = await this.controls.teamForWorker(workerId)
    if (!found) {
      return {
        ok: false,
        refusal: 'worker_not_found',
        userReport: language === 'zh' ? '该 worker 不在团队中。' : 'That worker is not in a team.'
      }
    }
    const { team, worker } = found
    const refused = await newManagerWorkRefusal(this.deps, team.managerThreadId)
    if (refused) return refused
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
          ? '该 worker 已由用户接管；请直接在它的会话里发消息。'
          : 'The worker is under user control; send a normal message in its thread instead.'
      }
    }
    const budgetRefusal = await this.controls.budgetRefusal(team, language)
    if (budgetRefusal) return budgetRefusal
    const parentTurnId = (await this.deps.threads.get(team.managerThreadId).catch(() => null))
      ?.turns.at(-1)?.id ?? 'gui'
    const { dispatch, delivered } = await this.controls.createDispatch({
      teamId: team.teamId,
      workerId,
      parentTurnId,
      ...(input.title ? { title: input.title } : {}),
      task: input.task,
      ...(input.context ? { context: input.context } : {}),
      ...(input.mode ? { mode: input.mode } : {})
    })
    return {
      ok: true,
      dispatchId: dispatch.dispatchId,
      dispatched: delivered.accepted,
      ...(delivered.pendingReason ? { deliveryPending: delivered.pendingReason } : {}),
      userReport: this.controls.sendReport(worker, delivered, language)
    }
  }
}

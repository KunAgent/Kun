import { stat } from 'node:fs/promises'
import { backfillDispatchTiming } from './dispatch-turn-timing.js'
import type { WorkerNoticeSink } from './worker-notice-store.js'
import type { HarnessGatewayBinding } from '../contracts/harness-gateway-binding.js'
import type {
  ChildRunRecord,
  ChildRoutingMetadata,
  ChildSecuritySnapshot,
  FileDelegationStore
} from '../delegation/delegation-runtime-contracts.js'
import type {
  DispatchRecord,
  TeamRecord,
  WorkerRecord
} from '../contracts/ade.js'
import type { ThreadExecutionUnit } from '../contracts/threads.js'
import type { ApprovalPolicy, ApprovalReviewer, SandboxMode } from '../contracts/policy.js'
import type { TaskWorkspaceRecord } from '../contracts/task-workspace.js'
import type { TaskWorkspaceService } from '../workspace-tasks/task-workspace-service.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { TurnService } from '../services/turn-service.js'
import type { FileDispatchStore } from './dispatch-store.js'
import type { FileTeamStore } from './team-store.js'
import { renderAssignment } from './assignment-template.js'
import { reportLanguage } from './user-report.js'
import { withAdeTeamMutex, withAdeDeliveryMutex } from './ade-file.js'

export type DeliverOutcome = {
  accepted: boolean
  failureReason?: string
  pendingReason?: 'workspace' | 'worker-busy' | 'user-control'
}

type RunChildInput = {
  parentThreadId: string
  parentTurnId: string
  launcher?: 'manager-worker'
  label?: string
  prompt: string
  clientRequestId?: string
  workspace?: string
  model?: string
  providerId?: string
  reasoningEffort?: WorkerRecord['reasoningEffort']
  /** Resolved subagent profile id applied to the child's role. */
  profile?: string
  /** Selector decision metadata recorded on the child run. */
  routing?: ChildRoutingMetadata
  security?: ChildSecuritySnapshot
  harnessId?: WorkerRecord['route']['harnessId']
  gatewayBinding?: HarnessGatewayBinding
  credentialMode?: WorkerRecord['route']['credentialMode']
  /** Read-only policy/sandbox ceiling for reviewer workers. */
  toolPolicyCeiling?: 'readOnly'
  sandboxMode?: SandboxMode
  approvalPolicy?: ApprovalPolicy
  approvalReviewer?: ApprovalReviewer
  childId?: string
  executionUnit?: ThreadExecutionUnit
  detach?: boolean
  signal: AbortSignal
}

type ResumeChildInput = {
  childId: string
  parentThreadId: string
  parentTurnId: string
  prompt: string
  clientRequestId?: string
  harnessId?: WorkerRecord['route']['harnessId']
  gatewayBinding?: HarnessGatewayBinding
  credentialMode?: WorkerRecord['route']['credentialMode']
  security?: ChildSecuritySnapshot
  expectedResumeCount?: number
  expectedLaunchers?: readonly string[]
  /** Resumed worker turns keep the detached lifecycle of the first run. */
  detach?: boolean
  signal: AbortSignal
}

/** The delegation-runtime surface the deliverer needs. */
export type DelivererDelegation = {
  runChild(input: RunChildInput): Promise<ChildRunRecord>
  resumeChild(input: ResumeChildInput): Promise<ChildRunRecord>
  /** Cancels a live detached/foreground child run (worker_stop, release). */
  abortChild?(childId: string): boolean
}

export type DispatchDelivererDeps = {
  notices?: WorkerNoticeSink
  agentDispatchService?: Pick<import('../delegation/agent-dispatch-service.js').AgentDispatchService, 'get'>
  teams: FileTeamStore
  dispatches: FileDispatchStore
  taskWorkspaces?: TaskWorkspaceService
  /** Absent when subagents are disabled; dispatches then fail fast. */
  delegation?: DelivererDelegation
  childRuns: FileDelegationStore
  threads: ThreadStore
  turns: Pick<TurnService, 'interruptTurn'>
  /** Manager UI language for the fixed assignment template (zh* → zh). */
  language?: () => string | undefined
  /** Manager display label rendered into the assignment's `from` attribute. */
  managerLabel?: () => string | undefined
}

/**
 * Exactly-once dispatch delivery. A dispatch row is persisted before
 * the worker turn exists; `clientRequestId = dispatchId` makes the turn
 * admission idempotent so a restart or double-fire can never spawn a second
 * turn for the same dispatch.
 */
export class DispatchDeliverer {
  /** One AbortController per worker — worker runs outlive manager turns. */
  private readonly controllers = new Map<string, AbortController>()

  constructor(private readonly deps: DispatchDelivererDeps) {}

  signalFor(workerId: string): AbortSignal {
    let controller = this.controllers.get(workerId)
    if (!controller || controller.signal.aborted) {
      controller = new AbortController()
      this.controllers.set(workerId, controller)
    }
    return controller.signal
  }

  /** Stop every in-flight dispatch for a worker (release/team teardown). */
  abortWorker(workerId: string, reason?: unknown): void {
    this.controllers.get(workerId)?.abort(reason)
  }

  async workerBusy(workerId: string): Promise<boolean> {
    const thread = await this.deps.threads.get(workerId).catch(() => null)
    return thread?.turns.some((turn) => turn.status === 'running' || turn.status === 'queued') ?? false
  }

  private async abortWorkerTurn(workerId: string): Promise<boolean> {
    const thread = await this.deps.threads.get(workerId).catch(() => null)
    const active = thread?.turns.find((turn) => turn.status === 'running' || turn.status === 'queued')
    if (!active) return false
    // Detached worker runs ignore turn status — the delegation controller is
    // what actually stops them; interruptTurn records the intent.
    this.deps.delegation?.abortChild?.(workerId)
    await this.deps.turns.interruptTurn({ threadId: workerId, turnId: active.id }).catch(() => undefined)
    return true
  }

  /**
   * `worker_stop`: abort the detached run's controller and interrupt
   * any active/queued turn. The turn-terminal hook marks the dispatch
   * cancelled; queued dispatches stay pending for the next free slot.
   */
  async stopWorker(workerId: string): Promise<{ turnStopped: boolean; runAborted: boolean }> {
    const runAborted = this.deps.delegation?.abortChild?.(workerId) === true
    const turnStopped = await this.abortWorkerTurn(workerId)
    this.abortWorker(workerId)
    return { turnStopped, runAborted }
  }

  /**
   * Deliver one dispatch if it is deliverable now. Serialized per worker so two
   * callers can never double-start the same dispatch or interleave delivery
   * order for that worker.
   */
  async tryDeliver(teamId: string, dispatchId: string): Promise<DeliverOutcome> {
    const dispatch = await this.deps.dispatches.get(teamId, dispatchId)
    if (!dispatch) return { accepted: false }
    return withAdeDeliveryMutex(teamId, dispatch.workerId, () => this.tryDeliverLocked(teamId, dispatchId))
  }

  /**
   * Deliver the oldest queued dispatch for a worker (after its turn ends or
   * a workspace becomes ready). Other workers' pending rows are untouched.
   */
  async tryDeliverNext(teamId: string, workerId: string): Promise<void> {
    const queued = (await this.deps.dispatches.listByWorker(teamId, workerId))
      .filter((entry) => entry.state === 'pending' || entry.state === 'uncertain')
    for (const next of queued) {
      await this.tryDeliver(teamId, next.dispatchId)
      const state = (await this.deps.dispatches.get(teamId, next.dispatchId))?.state
      if (state !== 'failed' && state !== 'cancelled') break
    }
  }

  /** Fire a `tryDeliver` when a task workspace reaches `ready`. */
  async onWorkspaceReady(teamId: string, workerId: string): Promise<void> {
    await this.tryDeliverNext(teamId, workerId)
  }

  private async cancel(teamId: string, dispatch: DispatchRecord, reason: string): Promise<void> {
    await this.deps.dispatches.update(teamId, dispatch.dispatchId, {
      state: 'cancelled',
      failureReason: reason
    }).catch((error) => {
      console.warn(`[kun] ade dispatch ${dispatch.dispatchId} cancel failed:`, error)
    })
  }

  private async fail(teamId: string, dispatch: DispatchRecord, reason: string): Promise<DeliverOutcome> {
    const failed = await this.deps.dispatches.update(teamId, dispatch.dispatchId, {
      state: 'failed',
      failureReason: reason
    })
    if (failed) await this.notifyFailure(failed)
    return { accepted: false, failureReason: reason }
  }

  async notifyFailure(dispatch: DispatchRecord): Promise<void> {
    if (dispatch.state !== 'failed' || !dispatch.failureReason) return
    const worker = await this.deps.teams.worker(dispatch.teamId, dispatch.workerId)
    if (worker && (worker.control === 'user' || worker.state !== 'active')) return
    if (!worker) {
      const intent = dispatch.dispatchIntentId ? await this.deps.agentDispatchService?.get(dispatch.dispatchIntentId) : undefined
      if (intent?.cancellationRequested || intent?.takenOver) return
      const source = await this.deps.threads.get(dispatch.teamId)
      if (!source || source.status === 'archived' || source.status === 'deleted') return
      const turn = source.turns.find(turn => turn.id === dispatch.parentTurnId)
      if (turn?.status === 'aborted') return
    }
    await this.deps.notices?.enqueue({
      noticeId: `ntc_${dispatch.dispatchId}`,
      teamId: dispatch.teamId,
      workerId: dispatch.workerId,
      parentTurnId: dispatch.parentTurnId,
      dispatchId: dispatch.dispatchId,
      ...(dispatch.dispatchIntentId ? { dispatchIntentId: dispatch.dispatchIntentId } : {}),
      kind: 'dispatch_failed',
      title: dispatch.title,
      detail: dispatch.failureReason,
      attempts: 0,
      createdAt: dispatch.updatedAt
    })
  }

  private async tryDeliverLocked(teamId: string, dispatchId: string): Promise<DeliverOutcome> {
    const dispatch = await this.deps.dispatches.get(teamId, dispatchId)
    if (!dispatch) return { accepted: false }
    if (dispatch.state !== 'pending' && dispatch.state !== 'uncertain') {
      return { accepted: dispatch.state === 'accepted', ...(dispatch.failureReason ? { failureReason: dispatch.failureReason } : {}) }
    }
    const team = await this.deps.teams.get(teamId)
    const worker = await this.deps.teams.worker(teamId, dispatch.workerId)
    if (!team || !worker) {
      return this.fail(teamId, dispatch, 'team or worker record missing')
    }
    if (await this.intentBlocked(worker, dispatch)) {
      return { accepted: false, pendingReason: 'user-control' }
    }
    if (worker.control === 'user') {
      // User takeover holds the queue instead of destroying it —
      // hand-back resumes delivery through tryDeliverNext.
      return { accepted: false, pendingReason: 'user-control' }
    }
    if (worker.state !== 'active') {
      await this.cancel(teamId, dispatch, 'worker released')
      return { accepted: false }
    }
    // Admission may be persisted before its turn exists. Let terminal recovery
    // settle that dispatch before assigning the same child another task.
    const priorDispatches = await this.deps.dispatches.listByWorker(teamId, worker.workerId)
    if (priorDispatches.some((entry) => entry.dispatchId !== dispatch.dispatchId &&
      (entry.state === 'accepted' || entry.state === 'delivering' || entry.state === 'uncertain'))) {
      if (dispatch.mode === 'queue' || !await this.workerBusy(worker.workerId)) {
        return { accepted: false, pendingReason: 'worker-busy' }
      }
    }
    const workspace = worker.taskWorkspaceId && this.deps.taskWorkspaces
      ? this.deps.taskWorkspaces.get(worker.taskWorkspaceId) ?? null
      : null
    if (worker.taskWorkspaceId && !workspace) {
      return this.fail(teamId, dispatch, 'task workspace record missing')
    }
    if (workspace) {
      if (workspace.state === 'creating' || workspace.state === 'setting-up') {
        return { accepted: false, pendingReason: 'workspace' }
      }
      // Capture preserves the checkout; review/rework must reuse those changes.
      if (workspace.state !== 'ready' && workspace.state !== 'captured') {
        return this.fail(teamId, dispatch, `workspace ${workspace.state}: ${workspace.lastError ?? 'not executable'}`)
      }
      const directory = await stat(workspace.path).catch(() => null)
      if (!directory?.isDirectory()) {
        return this.fail(teamId, dispatch, 'task workspace directory missing or inaccessible')
      }
    }
    const busy = await this.workerBusy(dispatch.workerId)
    if (busy && dispatch.mode === 'queue') {
      return { accepted: false, pendingReason: 'worker-busy' }
    }
    if (busy && dispatch.mode === 'interrupt') {
      await this.abortWorkerTurn(dispatch.workerId)
      if (await this.workerBusy(dispatch.workerId)) {
        // The interrupted turn is still unwinding; the turn-terminal hook
        // retries queued dispatches when the worker frees up.
        return { accepted: false, pendingReason: 'worker-busy' }
      }
    }
    if (!this.deps.delegation) {
      return this.fail(teamId, dispatch, 'delegation runtime is not enabled')
    }
    const prior = await this.deps.childRuns.get(dispatch.workerId).catch(() => undefined)
    const signal = this.signalFor(worker.workerId)
    const claimed = await withAdeTeamMutex(teamId, async () => {
      const latest = await this.deps.teams.worker(teamId, worker.workerId)
      if (!latest || latest.state !== 'active' || latest.control !== 'manager' ||
          signal.aborted || await this.intentBlocked(latest, dispatch)) return false
      return Boolean(await this.deps.dispatches.update(teamId, dispatchId, { state: 'delivering' },
        { expect: ['pending', 'uncertain'] }))
    })
    if (!claimed) return { accepted: false, pendingReason: 'user-control' }
    let failure: unknown
    try {
      await this.startRun(team, dispatch, worker, workspace ?? null, prior ?? null, signal)
    } catch (error) {
      failure = error
    }
    // Admission is external I/O. Re-read controls before committing its result;
    // release/stop/takeover may have completed while the child was starting.
    const outcome = await withAdeTeamMutex(teamId, async (): Promise<DeliverOutcome> => {
      const latest = await this.deps.teams.worker(teamId, worker.workerId)
      const row = await this.deps.dispatches.get(teamId, dispatchId)
      const blocked = !latest || latest.state !== 'active' || latest.control !== 'manager' ||
        signal.aborted || await this.intentBlocked(latest, dispatch)
      if (blocked || row?.state === 'cancelled') {
        if (row && ['delivering', 'uncertain', 'accepted'].includes(row.state)) {
          await this.cancel(teamId, row, 'worker control changed during admission')
        }
        return { accepted: false, pendingReason: 'user-control' }
      }
      if (row?.state !== 'delivering') return { accepted: row?.state === 'accepted' }
      if (failure !== undefined) {
        await this.classifyFailure(teamId, dispatchId, failure)
        return { accepted: false, failureReason: failure instanceof Error ? failure.message : String(failure) }
      }
      await this.deps.dispatches.update(teamId, dispatchId, { state: 'accepted' })
      return { accepted: true }
    })
    if (outcome.pendingReason === 'user-control') await this.stopLateAdmission(teamId, worker.workerId, dispatchId)
    return outcome
  }

  private async stopLateAdmission(teamId: string, workerId: string, dispatchId: string): Promise<void> {
    this.abortWorker(workerId)
    this.deps.delegation?.abortChild?.(workerId)
    const admitted = await this.deps.threads.get(workerId)
    const turn = admitted?.turns.find(entry => entry.clientRequestId === dispatchId &&
      (entry.status === 'running' || entry.status === 'queued'))
    if (turn) await this.deps.turns.interruptTurn({ threadId: workerId, turnId: turn.id })
      .catch(() => undefined)
    // Takeover/release may have run before admission created the thread.
    // Repair only its control metadata, using the latest persisted worker.
    await withAdeTeamMutex(teamId, async () => {
      const worker = await this.deps.teams.worker(teamId, workerId)
      const thread = await this.deps.threads.get(workerId)
      if (!thread?.executionUnit || thread.executionUnit.kind !== 'worker') return
      if (!worker || worker.state !== 'active') delete thread.executionUnit
      else thread.executionUnit = { ...thread.executionUnit, control: worker.control }
      await this.deps.threads.upsert(thread)
    })
  }

  private async intentBlocked(worker: WorkerRecord, dispatch: DispatchRecord): Promise<boolean> {
    const intent = worker.dispatchIntentId ? await this.deps.agentDispatchService?.get(worker.dispatchIntentId) : undefined
    return Boolean(intent && intent.source.turnId === dispatch.parentTurnId &&
      (intent.cancellationRequested || intent.takenOver))
  }

  private startRun(
    team: TeamRecord,
    dispatch: DispatchRecord,
    worker: WorkerRecord,
    workspace: TaskWorkspaceRecord | null,
    prior: ChildRunRecord | null,
    signal: AbortSignal
  ): Promise<ChildRunRecord> {
    const common = {
      parentThreadId: team.managerThreadId,
      parentTurnId: dispatch.parentTurnId,
      prompt: renderAssignment({
        dispatch,
        worker,
        workspace,
        language: reportLanguage(this.deps.language?.()),
        managerLabel: this.deps.managerLabel?.()
      }),
      clientRequestId: dispatch.dispatchId,
      security: worker.securitySnapshot,
      harnessId: worker.route.harnessId,
      credentialMode: worker.route.credentialMode,
      gatewayBinding: worker.route.gatewayBinding,
      ...worker.permissionSnapshot
    }
    if (prior) {
      return this.deps.delegation!.resumeChild({
        ...common,
        childId: dispatch.workerId,
        expectedResumeCount: prior.resumeCount ?? 0,
        expectedLaunchers: ['manager-worker'],
        detach: true,
        signal
      })
    }
    return this.deps.delegation!.runChild({
      ...common,
      launcher: 'manager-worker',
      label: worker.label,
      childId: dispatch.workerId,
      // Reviewers hold no task-workspace record; their sandboxRoot is the
      // reviewed worker's workspace.
      workspace: workspace?.path ?? (worker.reviewOf ? worker.securitySnapshot.sandboxRoot : undefined),
      model: worker.route.model,
      providerId: worker.route.providerId,
      ...(worker.reasoningEffort ? { reasoningEffort: worker.reasoningEffort } : {}),
      // Reviewers run under the host read-only ceiling; resumeChild
      // inherits the policy from the stored run record automatically.
      ...(worker.reviewOf
        ? { toolPolicyCeiling: 'readOnly' as const, sandboxMode: 'read-only' as const }
        : {}),
      // An explicitly chosen roster role applies with or without selector rationale.
      ...(worker.profileId ? { profile: worker.profileId } : {}),
      ...(worker.selection
        ? {
            routing: {
              method: 'worker-selector' as const,
              selectedKind: (worker.profileId ? 'profile' : 'harness') as 'profile' | 'harness',
              selectedId: worker.profileId ?? worker.route.harnessId,
              candidates: [
                ...(worker.profileId
                  ? [{
                      kind: 'profile' as const,
                      targetId: worker.profileId,
                      name: worker.profileId,
                      source: 'configured' as const,
                      score: Math.max(0, worker.selection.score)
                    }]
                  : []),
                ...worker.selection.alternatives.map((alt) => alt.profileId
                  ? {
                      kind: 'profile' as const,
                      targetId: alt.profileId,
                      name: alt.label,
                      source: 'configured' as const,
                      score: Math.max(0, alt.score)
                    }
                  : {
                      kind: 'harness' as const,
                      targetId: alt.route.harnessId,
                      name: alt.label,
                      source: 'configured' as const,
                      score: Math.max(0, alt.score)
                    })
              ].slice(0, 5),
              reason: worker.selection.reason.slice(0, 2_000)
            }
          }
        : {}),
      executionUnit: {
        kind: 'worker',
        teamId: team.teamId,
        managerThreadId: team.managerThreadId,
        label: worker.label,
        ...(worker.role ? { role: worker.role } : {}),
        lifecycle: worker.lifecycle,
        ...(worker.taskWorkspaceId ? { taskWorkspaceId: worker.taskWorkspaceId } : {}),
        control: worker.control
      },
      detach: true,
      signal
    })
  }

  /**
   * Classify a rejected run: errors proving the turn never started
   * (validation, resume fences) mark the dispatch `failed`; anything that may
   * have reached admission becomes `uncertain` for startup reconciliation.
   */
  private async classifyFailure(teamId: string, dispatchId: string, error: unknown): Promise<void> {
    const started = await this.dispatchTurnExists(teamId, dispatchId)
    const message = error instanceof Error ? error.message : String(error)
    if (!started) {
      const dispatch = await this.deps.dispatches.get(teamId, dispatchId)
      if (dispatch) await this.fail(teamId, dispatch, message.slice(0, 2_000))
      return
    }
    await this.deps.dispatches.update(teamId, dispatchId, {
      state: 'uncertain',
      failureReason: message.slice(0, 2_000)
    }).catch((updateError) => {
      console.warn(`[kun] ade dispatch ${dispatchId} track update failed:`, updateError)
    })
  }

  /** A persisted worker turn carrying this dispatch's idempotency key. */
  private async dispatchTurnExists(teamId: string, dispatchId: string): Promise<boolean> {
    const dispatch = await this.deps.dispatches.get(teamId, dispatchId)
    if (!dispatch) return false
    const thread = await this.deps.threads.get(dispatch.workerId).catch(() => null)
    return thread?.turns.some((turn) => turn.clientRequestId === dispatchId) ?? false
  }

  /**
   * Startup reconciliation: `delivering`/`uncertain` dispatches are
   * looked up by `clientRequestId` on the worker thread. Found → `accepted`
   * with `turnId` backfilled; missing → redelivered under the same key so
   * exactly one turn ever exists per dispatch.
   */
  async reconcileTeam(teamId: string): Promise<void> {
    const stuck = await this.deps.dispatches.listByState(teamId, ['delivering', 'uncertain'])
    for (const dispatch of stuck) {
      await withAdeDeliveryMutex(teamId, dispatch.workerId, async () => {
        const current = await this.deps.dispatches.get(teamId, dispatch.dispatchId)
        if (!current || !['delivering', 'uncertain'].includes(current.state)) return
        const blocked = await withAdeTeamMutex(teamId, async () => {
          const worker = await this.deps.teams.worker(teamId, dispatch.workerId)
          if (!worker || worker.state !== 'active' || worker.control !== 'manager' ||
              await this.intentBlocked(worker, dispatch)) {
            await this.cancel(teamId, dispatch, 'worker control changed during admission')
            return 'blocked'
          }
          const thread = await this.deps.threads.get(dispatch.workerId).catch(() => null)
          const turn = thread?.turns.find((entry) => entry.clientRequestId === dispatch.dispatchId)
          if (!turn) return 'retry'
          await this.deps.dispatches.update(teamId, dispatch.dispatchId, {
            state: 'accepted', turnId: turn.id
          }, { expect: ['delivering', 'uncertain'] })
          await backfillDispatchTiming(this.deps.dispatches, teamId, dispatch.dispatchId, turn)
          return 'accepted'
        })
        if (blocked === 'blocked') await this.stopLateAdmission(teamId, dispatch.workerId, dispatch.dispatchId)
        if (blocked !== 'retry') return
        if (current.state === 'delivering') {
          await this.deps.dispatches.update(teamId, dispatch.dispatchId, { state: 'uncertain' },
            { expect: ['delivering'] })
        }
        await this.tryDeliverLocked(teamId, dispatch.dispatchId)
      })
    }
    const pending = await this.deps.dispatches.listByState(teamId, ['pending'])
    for (const workerId of new Set(pending.map((entry) => entry.workerId))) {
      await this.tryDeliverNext(teamId, workerId)
    }
    // Recover a crash between persisting a pre-admission failure and its notice.
    for (const failed of await this.deps.dispatches.listByState(teamId, ['failed'])) {
      if (!failed.turnId && !failed.outcome) await this.notifyFailure(failed)
    }
  }

  async reconcileAll(): Promise<void> {
    for (const team of await this.deps.teams.list()) {
      await this.reconcileTeam(team.teamId).catch((error) => {
        console.warn(`[kun] ade dispatch reconcile failed team=${team.teamId}:`, error)
      })
    }
  }
}

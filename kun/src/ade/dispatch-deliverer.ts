import type {
  ChildRunRecord,
  ChildSecuritySnapshot,
  FileDelegationStore
} from '../delegation/delegation-runtime-contracts.js'
import type {
  DispatchRecord,
  TeamRecord,
  WorkerRecord
} from '../contracts/ade.js'
import type { ThreadExecutionUnit } from '../contracts/threads.js'
import type { TaskWorkspaceRecord } from '../contracts/task-workspace.js'
import type { TaskWorkspaceService } from '../workspace-tasks/task-workspace-service.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { TurnService } from '../services/turn-service.js'
import type { FileDispatchStore } from './dispatch-store.js'
import type { FileTeamStore } from './team-store.js'
import { renderAssignment } from './assignment-template.js'
import { reportLanguage } from './user-report.js'
import { withAdeTeamMutex } from './ade-file.js'

export type DeliverOutcome = {
  accepted: boolean
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
  security?: ChildSecuritySnapshot
  harnessId?: WorkerRecord['route']['harnessId']
  credentialMode?: WorkerRecord['route']['credentialMode']
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
  credentialMode?: WorkerRecord['route']['credentialMode']
  security?: ChildSecuritySnapshot
  expectedResumeCount?: number
  expectedLaunchers?: readonly string[]
  /** Resumed worker turns keep the detached lifecycle of the first run. */
  detach?: boolean
  signal: AbortSignal
}

/** The delegation-runtime surface the deliverer needs (09 §5). */
export type DelivererDelegation = {
  runChild(input: RunChildInput): Promise<ChildRunRecord>
  resumeChild(input: ResumeChildInput): Promise<ChildRunRecord>
  /** Cancels a live detached/foreground child run (worker_stop, release). */
  abortChild?(childId: string): boolean
}

export type DispatchDelivererDeps = {
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
 * Exactly-once dispatch delivery (09 §5). A dispatch row is persisted before
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
   * `worker_stop` (09 §4.1): abort the detached run's controller and interrupt
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
   * Deliver one dispatch if it is deliverable now. Serialized per team so two
   * callers can never double-start the same dispatch or interleave delivery
   * order across a team's workers.
   */
  async tryDeliver(teamId: string, dispatchId: string): Promise<DeliverOutcome> {
    return withAdeTeamMutex(teamId, () => this.tryDeliverLocked(teamId, dispatchId))
  }

  /**
   * Deliver the oldest queued dispatch for a worker (after its turn ends or
   * a workspace becomes ready). Other workers' pending rows are untouched.
   */
  async tryDeliverNext(teamId: string, workerId: string): Promise<void> {
    const next = (await this.deps.dispatches.listByWorker(teamId, workerId))
      .find((entry) => entry.state === 'pending' || entry.state === 'uncertain')
    if (next) await this.tryDeliver(teamId, next.dispatchId)
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

  private async fail(teamId: string, dispatch: DispatchRecord, reason: string): Promise<void> {
    await this.deps.dispatches.update(teamId, dispatch.dispatchId, {
      state: 'failed',
      failureReason: reason
    }).catch((error) => {
      console.warn(`[kun] ade dispatch ${dispatch.dispatchId} fail write failed:`, error)
    })
  }

  private async tryDeliverLocked(teamId: string, dispatchId: string): Promise<DeliverOutcome> {
    const dispatch = await this.deps.dispatches.get(teamId, dispatchId)
    if (!dispatch) return { accepted: false }
    if (dispatch.state !== 'pending' && dispatch.state !== 'uncertain') {
      return { accepted: dispatch.state === 'accepted' }
    }
    const team = await this.deps.teams.get(teamId)
    const worker = await this.deps.teams.worker(teamId, dispatch.workerId)
    if (!team || !worker) {
      await this.fail(teamId, dispatch, 'team or worker record missing')
      return { accepted: false }
    }
    if (worker.control === 'user') {
      // User takeover (09 §9) holds the queue instead of destroying it —
      // hand-back resumes delivery through tryDeliverNext.
      return { accepted: false, pendingReason: 'user-control' }
    }
    if (worker.state !== 'active') {
      await this.cancel(teamId, dispatch, 'worker released')
      return { accepted: false }
    }
    const workspace = worker.taskWorkspaceId && this.deps.taskWorkspaces
      ? this.deps.taskWorkspaces.get(worker.taskWorkspaceId) ?? null
      : null
    if (workspace && workspace.state !== 'ready') {
      if (workspace.state === 'failed') {
        await this.fail(teamId, dispatch, `workspace failed: ${workspace.lastError ?? 'unknown'}`)
        return { accepted: false }
      }
      return { accepted: false, pendingReason: 'workspace' }
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
      await this.fail(teamId, dispatch, 'delegation runtime is not enabled')
      return { accepted: false }
    }
    await this.deps.dispatches.update(teamId, dispatch.dispatchId, { state: 'delivering' })
    const prior = await this.deps.childRuns.get(dispatch.workerId).catch(() => undefined)
    let run: Promise<ChildRunRecord>
    try {
      run = this.startRun(team, dispatch, worker, workspace ?? null, prior ?? null)
    } catch (error) {
      await this.fail(teamId, dispatch, error instanceof Error ? error.message : String(error))
      return { accepted: false }
    }
    // `runChild`/`resumeChild` resolve at admission (detached worker turns
    // keep running in the background); a rejection means the start failed —
    // classify before reporting so persisted state matches the outcome.
    try {
      await run
    } catch (error) {
      await this.classifyFailure(teamId, dispatch.dispatchId, error)
      return { accepted: false }
    }
    // turnId backfills from the admitted turn's clientRequestId (09 §5).
    await this.deps.dispatches.update(teamId, dispatch.dispatchId, { state: 'accepted' })
    return { accepted: true }
  }

  private startRun(
    team: TeamRecord,
    dispatch: DispatchRecord,
    worker: WorkerRecord,
    workspace: TaskWorkspaceRecord | null,
    prior: ChildRunRecord | null
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
      credentialMode: worker.route.credentialMode
    }
    const signal = this.signalFor(dispatch.workerId)
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
      workspace: workspace?.path,
      model: worker.route.model,
      providerId: worker.route.providerId,
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
   * Classify a rejected run (09 §5): errors proving the turn never started
   * (validation, resume fences) mark the dispatch `failed`; anything that may
   * have reached admission becomes `uncertain` for startup reconciliation.
   */
  private async classifyFailure(teamId: string, dispatchId: string, error: unknown): Promise<void> {
    const started = await this.dispatchTurnExists(teamId, dispatchId)
    const message = error instanceof Error ? error.message : String(error)
    await this.deps.dispatches.update(teamId, dispatchId, {
      state: started ? 'uncertain' : 'failed',
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
   * Startup reconciliation (09 §5): `delivering`/`uncertain` dispatches are
   * looked up by `clientRequestId` on the worker thread. Found → `accepted`
   * with `turnId` backfilled; missing → redelivered under the same key so
   * exactly one turn ever exists per dispatch.
   */
  async reconcileTeam(teamId: string): Promise<void> {
    const stuck = await this.deps.dispatches.listByState(teamId, ['delivering', 'uncertain'])
    for (const dispatch of stuck) {
      const thread = await this.deps.threads.get(dispatch.workerId).catch(() => null)
      const turn = thread?.turns.find((entry) => entry.clientRequestId === dispatch.dispatchId)
      if (turn) {
        // delivering -> accepted and uncertain -> accepted are both legal.
        await this.deps.dispatches.update(teamId, dispatch.dispatchId, {
          state: 'accepted',
          turnId: turn.id
        }).catch(() => undefined)
        continue
      }
      // No admitted turn — 'delivering' has no path back to 'pending', so move
      // through 'uncertain' (allowed to re-enter delivering) before retrying.
      if (dispatch.state === 'delivering') {
        await this.deps.dispatches.update(teamId, dispatch.dispatchId, { state: 'uncertain' })
          .catch(() => undefined)
      }
      await this.tryDeliver(teamId, dispatch.dispatchId)
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

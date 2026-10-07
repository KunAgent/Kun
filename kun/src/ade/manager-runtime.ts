import { runWithoutTurnMutationFence } from '../manager/turn-mutation-context.js'
import { ManagerWorkerCreator } from './manager-worker-create.js'
import { ManagerWorkerDispatch } from './manager-worker-dispatch.js'
import { workerWorkspaceSecurity } from './worker-security.js'
import { newManagerWorkRefusal } from './new-work-admission.js'
import type {
  DispatchRecord,
  TurnRunOutcome,
  WorkerRecord
} from '../contracts/ade.js'
import type { HarnessRoute } from '../contracts/harness.js'
import type { TaskWorkspaceRecord } from '../contracts/task-workspace.js'
import type { TurnItem, UserTurnItem, AssistantTextTurnItem } from '../contracts/items.js'
import type { RuntimeEvent } from '../contracts/events.js'
import type { ActivityRow } from '../contracts/activity.js'
import type { DeliverOutcome } from './dispatch-deliverer.js'
import { ManagerControls } from './manager-controls.js'
import { TeamControls } from './team-controls.js'
import { QualityVerdicts } from './quality-verdict.js'
import { ReviewRequests } from './review-request.js'
import { WorkspaceIntegrations } from './workspace-integrate.js'
import { hasOpenWorkerWork } from './worker-open-work.js'
import type { AdmissionResult } from '../harness/harness-admission.js'
import { childSecurity } from '../adapters/tool/delegation-tool-context.js'
import { guiCreateWorker } from './manager-gui-worker.js'
import { buildManagerToolContext, type ManagerToolContextInput } from './manager-tool-context.js'
import { reportWorkerCreateBatch, reportLanguage } from './user-report.js'
import { ManagerWorkerLifecycle } from './manager-worker-lifecycle.js'
import { refreshWorkerReviewActivity } from './worker-review-activity.js'

export type {
  ManagerRuntimeDeps,
  ManagerToolContext
} from './manager-runtime-deps.js'
import type { ManagerRuntimeDeps, ManagerToolContext } from './manager-runtime-deps.js'

export {
  WorkerCreateBatchInputSchema,
  WorkerCreateInputSchema,
  WorkerReadInputSchema,
  WorkerStatusInputSchema
} from './manager-worker-inputs.js'
export type { WorkerCreateBatchInput, WorkerCreateInput } from './manager-worker-inputs.js'
import {
  WorkerCreateBatchInputSchema,
  WorkerReadInputSchema,
  WorkerStatusInputSchema
} from './manager-worker-inputs.js'

export type WorkerCreateResult = {
  ok: boolean
  dispatchIntentId?: string
  dispatchIntent?: import('../contracts/agent-dispatch-intents.js').AgentDispatchIntentPublic
  workerId?: string
  dispatchId?: string
  /** Bound task workspace (07) — renderer shows it as the workspace badge. */
  taskWorkspaceId?: string
  dispatched?: boolean
  deliveryPending?: DeliverOutcome['pendingReason']
  route?: HarnessRoute
  /** Selector decision when `agent` was omitted (10 §3.2/§3.3). */
  selection?: WorkerRecord['selection'] & { profileId?: string }
  permissionMode?: { requested?: string; effective: string; downgraded: boolean }
  admission?: AdmissionResult
  refusal?: 'worker_limit' | 'admission' | 'escalation_declined' | 'invalid_agent' | 'workspace_unavailable' | 'budget_exceeded' | 'collaboration_disabled'
  userReport: string
}

type RaceServiceDepsWithIds =
  import('./race.js').RaceServiceDeps & { ids: { next(prefix: string): string } }

/**
 * The ADE manager control plane (09 §4): worker creation with route
 * resolution, permission clamp, harness admission, user-only escalation,
 * task workspace provisioning, and exactly-once dispatch delivery.
 */
export class ManagerRuntime {
  private readonly lifecycle: ManagerWorkerLifecycle
  private readonly workerCreator: ManagerWorkerCreator
  private readonly workerDispatch: ManagerWorkerDispatch
  /** Control operations (09 §4.1/§9) — worker/dispatch tools + team routes. */
  readonly controls: ManagerControls
  readonly teamControls: TeamControls
  /** Quality verdicts + cross-review (10 §4/§5). */
  readonly verdicts: QualityVerdicts
  readonly reviews: ReviewRequests
  /** User-approved workspace integration (11 §7.2). */
  readonly workspaces: WorkspaceIntegrations

  constructor(private readonly deps: ManagerRuntimeDeps) {
    this.controls = new ManagerControls(deps)
    this.workerCreator = new ManagerWorkerCreator(deps, this.controls)
    this.workerDispatch = new ManagerWorkerDispatch(deps, this)
    this.teamControls = new TeamControls(deps, this.controls)
    this.verdicts = new QualityVerdicts(deps)
    this.reviews = new ReviewRequests(deps)
    this.workspaces = new WorkspaceIntegrations(deps)
    this.lifecycle = new ManagerWorkerLifecycle(deps, this.teamControls, this.verdicts)
  }

  newWorkRefusal(managerThreadId: string, turnId?: string) {
    return newManagerWorkRefusal(this.deps, managerThreadId, turnId)
  }

  /** Race tool/route deps (10 §6); undefined without a race store. */
  get raceServiceDeps(): RaceServiceDepsWithIds | undefined {
    if (!this.deps.races) return undefined
    return {
      races: this.deps.races, dispatches: this.deps.dispatches,
      notices: this.deps.notices, teams: this.deps.teams,
      taskWorkspaces: this.deps.taskWorkspaces, usage: this.deps.usage,
      language: this.deps.language, nowIso: this.deps.nowIso, ids: this.deps.ids
    }
  }

  /** Check-runner deps (10 §4.2); undefined without approved-checks wiring. */
  get checkRunnerDeps(): import('./check-runner.js').WorkspaceCheckRunnerDeps | undefined {
    if (!this.deps.checks) return undefined
    return {
      teams: this.deps.teams, dispatches: this.deps.dispatches,
      taskWorkspaces: this.deps.taskWorkspaces, ...this.deps.checks,
      language: this.deps.language, nowIso: this.deps.nowIso
    }
  }

  private reportLanguage(): 'en' | 'zh' {
    return reportLanguage(this.deps.language?.())
  }

  /**
   * The worker's immutable security ceiling (09 §7.1): the manager turn's
   * snapshot, narrowed to the task workspace as the only write root.
   */
  workerSecurity(
    snapshot: ReturnType<typeof childSecurity>,
    workspacePath: string
  ): ReturnType<typeof childSecurity> {
    return workerWorkspaceSecurity(snapshot, workspacePath)
  }

  async createWorker(
    ctx: ManagerToolContext, rawInput: unknown, toolContext: Parameters<typeof childSecurity>[0]
  ): Promise<WorkerCreateResult> {
    return this.workerDispatch.create(ctx, rawInput, toolContext)
  }

  /** Host-only admission used after the shared dispatch decision is claimed. */
  createWorkerNow(
    ctx: ManagerToolContext, rawInput: unknown, toolContext: Parameters<typeof childSecurity>[0],
    allocation?: { workerId: string; dispatchId: string; intentId: string; selection?: WorkerRecord['selection']; profileId?: string }
  ): Promise<WorkerCreateResult> {
    return this.workerCreator.create(ctx, rawInput, toolContext, allocation)
  }

  /**
   * `worker_create_batch` (09 §4.4): items run in order; the first
   * worker_limit/batch-level failure marks the rest `skipped`. The invariant
   * `requested = created + failed + skipped` is asserted by tests.
   */
  async createWorkerBatch(
    ctx: ManagerToolContext,
    rawInput: unknown,
    toolContext: Parameters<typeof childSecurity>[0]
  ): Promise<{
    dispatchIntentId?: string
    dispatchIntent?: import('../contracts/agent-dispatch-intents.js').AgentDispatchIntentPublic
    pending?: number
    requested: number
    created: number
    failed: number
    skipped: number
    dispatched: number
    items: Array<{ index: number; label: string; result: WorkerCreateResult | 'skipped' }>
    userReport: string
  }> {
    if (this.deps.agentDispatchService && toolContext.activeToolCallId) {
      return this.workerDispatch.createBatch(ctx, rawInput, toolContext)
    }
    const input = WorkerCreateBatchInputSchema.parse(rawInput)
    const items: Array<{ index: number; label: string; result: WorkerCreateResult | 'skipped' }> = []
    let created = 0
    let failed = 0
    let skipped = 0
    let dispatched = 0
    for (let index = 0; index < input.items.length; index += 1) {
      const entry = input.items[index]
      const result = await this.createWorker(ctx, entry, toolContext)
      items.push({ index, label: entry.label, result })
      if (result.ok) {
        created += 1
        if (result.dispatched) dispatched += 1
      } else {
        failed += 1
        if (result.refusal === 'worker_limit') {
          for (let rest = index + 1; rest < input.items.length; rest += 1) {
            items.push({ index: rest, label: input.items[rest].label, result: 'skipped' })
            skipped += 1
          }
          break
        }
      }
    }
    return {
      requested: input.items.length,
      created,
      failed,
      skipped,
      dispatched,
      items,
      userReport: reportWorkerCreateBatch(
        { created, failed, skipped, dispatched },
        this.reportLanguage()
      )
    }
  }

  /** `worker_status` — worker records + their dispatches + activity rows. */
  async workerStatus(ctx: ManagerToolContext, rawInput: unknown): Promise<{
    workers: Array<{
      worker: WorkerRecord
      dispatches: DispatchRecord[]
      activity?: Pick<ActivityRow, 'mainState' | 'waitingReason' | 'phase' | 'progressNote' | 'state'>
    }>
  }> {
    const input = WorkerStatusInputSchema.parse(rawInput)
    const team = await this.deps.teams.get(ctx.threadId)
    if (!team) return { workers: [] }
    const workers = input.workerId
      ? team.workers.filter((worker) => worker.workerId === input.workerId)
      : team.workers
    const rows = await Promise.all(workers.map(async (worker) => {
      const activity = this.deps.activity?.get(worker.workerId)
      return {
        worker,
        dispatches: await this.deps.dispatches.listByWorker(team.teamId, worker.workerId),
        ...(activity
          ? {
              activity: {
                mainState: activity.mainState,
                ...(activity.waitingReason ? { waitingReason: activity.waitingReason } : {}),
                ...(activity.phase ? { phase: activity.phase } : {}),
                ...(activity.progressNote ? { progressNote: activity.progressNote } : {}),
                state: activity.state
              }
            }
          : {})
      }
    }))
    return { workers: rows }
  }

  /** `worker_read` — newest-first visible messages from the worker thread. */
  async workerRead(ctx: ManagerToolContext, rawInput: unknown): Promise<{
    items: Array<{ role: 'user' | 'assistant'; text: string; turnId: string; createdAt: string }>
  }> {
    const input = WorkerReadInputSchema.parse(rawInput)
    const team = await this.deps.teams.get(ctx.threadId)
    const worker = team?.workers.find((entry) => entry.workerId === input.workerId)
    if (!team || !worker) throw new Error(`worker ${input.workerId} is not in this team`)
    const items = await this.deps.sessionStore.loadItems(worker.workerId).catch((): TurnItem[] => [])
    const limit = Math.min(50, Math.max(1, input.limit ?? 10))
    const visible: Array<UserTurnItem | AssistantTextTurnItem> = items.filter(isWorkerVisibleItem)
    return {
      items: visible
        .map((item) => item.kind === 'user_message'
          ? {
              role: 'user' as const,
              text: item.displayText ?? item.text,
              turnId: item.turnId,
              createdAt: item.createdAt
            }
          : { role: 'assistant' as const, text: item.text, turnId: item.turnId, createdAt: item.createdAt })
        .slice(-limit)
        .reverse()
    }
  }

  /**
   * Task-workspace change hook (09 §5): when a worker's workspace reaches
   * `ready`, retry its queued dispatch; a `failed` workspace fails it.
   */
  async handleWorkspaceChange(record: TaskWorkspaceRecord): Promise<void> {
    if (!['ready', 'failed', 'captured', 'conflict', 'integrated'].includes(record.state)) return
    const teams = await this.deps.teams.list()
    for (const team of teams) {
      const worker = team.workers.find((entry) => entry.taskWorkspaceId === record.workspaceId)
      if (!worker) continue
      if (record.state === 'ready' || record.state === 'failed') {
        await this.deps.deliverer.tryDeliverNext(team.teamId, worker.workerId)
      }
      if (!worker.reviewOf && ['captured', 'conflict'].includes(record.state)) {
        await refreshWorkerReviewActivity(
          this.deps.dispatches, this.deps.activity, team.teamId, worker.workerId, record
        )
      }
    }
  }

  /**
   * Activity hibernation gate (docs/ade/06 §7.2 conditions 2-3): unfinished
   * dispatches or unanswered questions for this worker.
   */
  hasOpenWork(workerId: string): Promise<boolean> {
    return hasOpenWorkerWork(this.deps, workerId)
  }

  /**
   * Runtime-event observer hook (09 §5 turnId backfill + §6.1 terminal
   * hook). Wired onto the RuntimeEventRecorder's observer list.
   */
  handleRuntimeEvent(event: RuntimeEvent): void {
    this.lifecycle.handleRuntimeEvent(event)
    if (event.kind === 'agent_dispatch_intent' && event.dispatchIntent.kind === 'worker' && event.dispatchIntent.state === 'failed') {
      void this.workerDispatch.reportPrelaunchFailure(event.dispatchIntent.intentId).catch((error) =>
        console.warn('[kun] dispatch refusal delivery failed:', error))
    }
    if (event.kind === 'turn_aborted' && event.turnId) {
      void runWithoutTurnMutationFence(() => this.workerDispatch.cancelPendingSource(event.threadId, event.turnId!)).catch((error) => {
        console.warn('[kun] source-turn dispatch cancellation failed:', error)
      })
    }
    if (['turn_completed', 'turn_failed', 'turn_aborted', 'turn_started'].includes(event.kind)) {
      void runWithoutTurnMutationFence(() => this.workerDispatch.refreshForWorker(event.threadId)).catch((error) => {
        console.warn('[kun] worker dispatch status refresh failed:', error)
      })
    }
  }

  /**
   * Worker turn terminal hook (09 §6.1) — dispatched from the runtime-event
   * observer and replayed by startup reconciliation.
   */
  async handleWorkerTurnTerminal(
    workerThreadId: string,
    turnId: string,
    outcome: TurnRunOutcome
  ): Promise<void> {
    await this.lifecycle.handleWorkerTurnTerminal(workerThreadId, turnId, outcome)
    await runWithoutTurnMutationFence(() => this.workerDispatch.refreshForWorker(workerThreadId))
  }

  /**
   * Startup reconciliation (09 §5): re-resolve stuck `delivering`/`uncertain`
   * dispatches against the worker thread's turns, then replay the terminal
   * hook for `accepted` dispatches whose turns ended while the app was off.
   */
  async reconcileOnStartup(): Promise<void> {
    await this.lifecycle.reconcileOnStartup()
  }

  /** Manager context for tool execution — built from host-side records. */
  /** GUI-originated worker create — see `manager-gui-worker.ts` (11 §4.4). */
  guiCreateWorker(
    workspace: TaskWorkspaceRecord,
    input: { label: string; task: string; harnessId?: string },
    signal?: AbortSignal
  ): Promise<WorkerCreateResult> {
    return guiCreateWorker(
      this.deps,
      this.createWorker.bind(this),
      workspace,
      input,
      signal
    )
  }

  /** Projects a tool context from a live turn — see `manager-tool-context.ts`. */
  toolContext(input: ManagerToolContextInput): Promise<ManagerToolContext> {
    return buildManagerToolContext(this.deps, input)
  }
}

function isWorkerVisibleItem(item: TurnItem): item is UserTurnItem | AssistantTextTurnItem {
  return item.kind === 'user_message' || item.kind === 'assistant_text'
}

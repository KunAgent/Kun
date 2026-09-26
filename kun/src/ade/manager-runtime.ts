import { z } from 'zod'
import type {
  DispatchRecord,
  TeamRecord,
  TurnRunOutcome,
  WorkerRecord
} from '../contracts/ade.js'
import type { HarnessRoute, HarnessId } from '../contracts/harness.js'
import type { HarnessCapabilities } from '../contracts/harness-capabilities.js'
import type { TaskWorkspaceRecord, StartFrom } from '../contracts/task-workspace.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'
import type { TurnItem, UserTurnItem, AssistantTextTurnItem } from '../contracts/items.js'
import type { RuntimeEvent } from '../contracts/events.js'
import type { ActivityStore } from '../services/activity-store.js'
import type { ActivityRow } from '../contracts/activity.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { SessionStore } from '../ports/session-store.js'
import type { TurnService } from '../services/turn-service.js'
import type { HarnessCatalog } from '../harness/harness-catalog.js'
import type { HarnessDetector } from '../harness/harness-detector.js'
import type { TaskWorkspaceService } from '../workspace-tasks/task-workspace-service.js'
import type { FileDelegationStore } from '../delegation/delegation-runtime-contracts.js'
import type { FileTeamStore } from './team-store.js'
import type { FileDispatchStore } from './dispatch-store.js'
import type { FileQuestionStore } from './question-store.js'
import type { WorkerNoticeSink } from './worker-notice-store.js'
import type { DispatchDeliverer, DelivererDelegation, DeliverOutcome } from './dispatch-deliverer.js'
import type { ApprovalGate } from '../ports/approval-gate.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { WorkerCallbackService } from '../services/worker-callback-service.js'
import { ManagerControls } from './manager-controls.js'
import { TeamControls } from './team-controls.js'
import { QualityVerdicts } from './quality-verdict.js'
import { ReviewRequests } from './review-request.js'
import { hasOpenWorkerWork } from './worker-open-work.js'
import {
  countRecentWorkerFailures,
  NoEligibleWorkerError,
  selectWorkerRoute,
  type WorkerSelectorDeps
} from './worker-selector.js'
import { resolveWorkerRoute, type ResolvedWorkerRoute } from './worker-route.js'
import { checkHarnessAdmission, type AdmissionResult } from '../harness/harness-admission.js'
import { effectiveCapabilitiesForRoute } from '../harness/effective-capabilities.js'
import {
  authorityFromTurn,
  clampPermission,
  type ManagerAuthority,
  type PermissionClamp
} from './permission-clamp.js'
import { requestUserOnlyEscalation } from './escalation-approval.js'
import type { EscalationApprovalContext } from './escalation-approval.js'
import { childSecurity } from '../adapters/tool/delegation-tool-context.js'
import { reportWorkerCreated, reportWorkerCreateBatch, reportLanguage } from './user-report.js'
import { ManagerWorkerLifecycle } from './manager-worker-lifecycle.js'

/** What a manager tool needs from the calling turn (09 §4.2 ctx). */
export type ManagerToolContext = {
  /** Manager thread id — also the team id. */
  threadId: string
  turnId: string
  /** Manager thread's workspace root; task workspaces fork from it. */
  workspace: string
  authority: ManagerAuthority
  signal: AbortSignal
  /** User-only escalation channel (09 §7.2); see escalation-approval.ts. */
  awaitApproval: EscalationApprovalContext['awaitApproval']
}

export const WorkerCreateInputSchema = z
  .object({
    label: z.string().min(1).max(64),
    role: z.string().max(64).optional(),
    task: z.string().min(1).max(32_000),
    context: z
      .object({
        files: z.array(z.string().min(1)).max(64).optional(),
        links: z.array(z.string().min(1)).max(32).optional(),
        constraints: z.array(z.string().min(1)).max(32).optional()
      })
      .strict()
      .optional(),
    agent: z
      .object({
        harnessId: z.string().min(1).max(64).optional(),
        model: z.string().min(1).max(512).optional(),
        providerId: z.string().min(1).max(128).optional(),
        credentialMode: z.string().min(1).max(64).optional()
      })
      .strict()
      .optional(),
    workspace: z
      .object({
        isolation: z.enum(['worktree', 'local']).optional(),
        startFrom: z
          .discriminatedUnion('kind', [
            z.object({ kind: z.literal('default-branch') }).strict(),
            z.object({ kind: z.literal('current-head') }).strict(),
            z.object({ kind: z.literal('branch'), name: z.string().min(1).max(256) }).strict()
          ])
          .optional()
      })
      .strict()
      .optional(),
    permissionMode: z.string().min(1).max(64).optional(),
    lifecycle: z.enum(['persistent', 'ephemeral']).optional(),
    mode: z.enum(['queue', 'interrupt']).optional()
  })
  .strict()
export type WorkerCreateInput = z.infer<typeof WorkerCreateInputSchema>

export const WorkerCreateBatchInputSchema = z
  .object({ items: z.array(WorkerCreateInputSchema).min(1).max(16) })
  .strict()
export type WorkerCreateBatchInput = z.infer<typeof WorkerCreateBatchInputSchema>

export const WorkerStatusInputSchema = z
  .object({ workerId: z.string().min(1).max(256).optional() })
  .strict()

export const WorkerReadInputSchema = z
  .object({
    workerId: z.string().min(1).max(256),
    limit: z.number().int().min(1).max(50).optional()
  })
  .strict()

export type WorkerCreateResult = {
  ok: boolean
  workerId?: string
  dispatchId?: string
  dispatched?: boolean
  deliveryPending?: DeliverOutcome['pendingReason']
  route?: HarnessRoute
  /** Selector decision when `agent` was omitted (10 §3.2/§3.3). */
  selection?: WorkerRecord['selection'] & { profileId?: string }
  permissionMode?: { requested?: string; effective: string; downgraded: boolean }
  admission?: AdmissionResult
  refusal?: 'worker_limit' | 'admission' | 'escalation_declined' | 'invalid_agent'
  userReport: string
}

export type ManagerRuntimeDeps = {
  teams: FileTeamStore
  dispatches: FileDispatchStore
  questions: FileQuestionStore
  /** Raw store or the wake-up coordinator wrapping it (09 §6.2). */
  notices: WorkerNoticeSink
  threads: ThreadStore
  turns: Pick<TurnService, 'getTurn'>
  sessionStore: Pick<SessionStore, 'loadItems'>
  taskWorkspaces?: TaskWorkspaceService
  activity?: ActivityStore
  /** Absent when subagents are disabled; worker creation then refuses. */
  delegation?: DelivererDelegation
  childRuns: FileDelegationStore
  catalog: HarnessCatalog
  detector: HarnessDetector
  /** Effective capabilities for a route (harnessRuntimeMap + static facts). */
  capabilitiesForRoute(route: HarnessRoute): Promise<HarnessCapabilities>
  deliverer: DispatchDeliverer
  ids: { next(prefix: string): string }
  nowIso: () => string
  /** Manager UI language for fixed-sentence reports (zh* → zh, else en). */
  language?: () => string | undefined
  allowUnattendedFullAccess?: () => boolean
  teamLimits?: () => Partial<{ softWorkers: number; hardWorkers: number }> | undefined
  /** Delay before an ephemeral worker is released after completion (default 30s). */
  ephemeralReleaseDelayMs?: () => number
  /** worker_answer / GUI question answers (09 §6.4); absent → answer refuses. */
  workerCallbacks?: Pick<WorkerCallbackService, 'answerQuestion'>
  /** worker_approve decision channel (09 §6.5); gated by managerMayApprove. */
  approvalGate?: Pick<
    ApprovalGate,
    'get' | 'reserveDecision' | 'commitDecision' | 'rollbackDecision'
  >
  /** Audit sink for manager-resolved approvals (09 §6.5). */
  approvalEvents?: Pick<RuntimeEventRecorder, 'record'>
  /** `agents.kun.ade.managerMayApprove` — gates the worker_approve tool. */
  managerMayApprove?: () => boolean
  /**
   * Worker-route selector inputs (10 §3.2); `isolated`/`unattended` come from
   * the create call. Absent → the manager's own provider/model on `kun`.
   */
  selector?: Omit<
    WorkerSelectorDeps,
    'catalog' | 'detector' | 'capabilitiesForRoute' | 'isolated' | 'unattended' | 'allowUnattendedFullAccess' | 'recentFailures' | 'managerRoute' | 'language'
  >
}

/**
 * The ADE manager control plane (09 §4): worker creation with route
 * resolution, permission clamp, harness admission, user-only escalation,
 * task workspace provisioning, and exactly-once dispatch delivery.
 */
export class ManagerRuntime {
  private readonly lifecycle: ManagerWorkerLifecycle
  /** Control operations (09 §4.1/§9) — worker/dispatch tools + team routes. */
  readonly controls: ManagerControls
  readonly teamControls: TeamControls
  /** Quality verdicts + cross-review (10 §4/§5). */
  readonly verdicts: QualityVerdicts
  readonly reviews: ReviewRequests

  constructor(private readonly deps: ManagerRuntimeDeps) {
    this.controls = new ManagerControls(deps)
    this.teamControls = new TeamControls(deps, this.controls)
    this.verdicts = new QualityVerdicts(deps)
    this.reviews = new ReviewRequests(deps)
    this.lifecycle = new ManagerWorkerLifecycle(deps, this.teamControls, this.verdicts)
  }

  private reportLanguage(): 'en' | 'zh' {
    return reportLanguage(this.deps.language?.())
  }

  private activeWorkers(team: TeamRecord): WorkerRecord[] {
    return team.workers.filter((worker) => worker.state === 'active')
  }

  private async resolveRoute(
    ctx: ManagerToolContext,
    input: WorkerCreateInput,
    isolated: boolean
  ): Promise<ResolvedWorkerRoute | { error: string }> {
    const managerThread = await this.deps.threads.get(ctx.threadId).catch(() => null)
    const selector = this.deps.selector
    return resolveWorkerRoute({
      catalog: this.deps.catalog,
      managerModel: managerThread?.model,
      managerProviderId: managerThread?.providerId,
      agent: input.agent,
      ...(selector
        ? {
            // No explicit agent: deterministic worker selection (10 §3.2).
            select: () =>
              selectWorkerRoute(
                {
                  catalog: this.deps.catalog,
                  detector: this.deps.detector,
                  capabilitiesForRoute: (route) => this.deps.capabilitiesForRoute(route),
                  ...selector,
                  isolated,
                  unattended: !ctx.authority.interactive,
                  allowUnattendedFullAccess:
                    this.deps.allowUnattendedFullAccess?.() === true,
                  managerRoute: () => ({
                    model: managerThread?.model?.trim() || undefined,
                    providerId: managerThread?.providerId?.trim() || undefined
                  }),
                  recentFailures: (teamId, harnessId) =>
                    this.recentFailures(teamId, harnessId),
                  language: this.deps.language
                },
                {
                  task: `${input.label}\n${input.task}`,
                  ...(input.role ? { role: input.role } : {}),
                  teamId: ctx.threadId,
                  workspace: ctx.workspace
                }
              ).catch((error) => {
                if (error instanceof NoEligibleWorkerError) {
                  return { error: error.message }
                }
                throw error
              })
          }
        : {})
    })
  }

  /**
   * Same-team same-harness dispatch failures within the last hour (10 §3.2
   * `recentFailurePenalty`). Feeds `worker_selector` via `selector` deps.
   */
  private async recentFailures(teamId: string, harnessId: HarnessId): Promise<number> {
    return countRecentWorkerFailures(
      { teams: this.deps.teams, dispatches: this.deps.dispatches },
      teamId,
      harnessId
    )
  }

  /**
   * The worker's immutable security ceiling (09 §7.1): the manager turn's
   * snapshot, narrowed to the task workspace as the only write root.
   */
  workerSecurity(
    snapshot: ReturnType<typeof childSecurity>,
    workspacePath: string
  ): ReturnType<typeof childSecurity> {
    return { ...snapshot, sandboxRoot: workspacePath, allowedWritePaths: [workspacePath] }
  }

  async createWorker(
    ctx: ManagerToolContext,
    rawInput: unknown,
    /** The calling turn's security view (tool context), for the worker ceiling. */
    toolContext: Parameters<typeof childSecurity>[0]
  ): Promise<WorkerCreateResult> {
    const language = this.reportLanguage()
    const input = WorkerCreateInputSchema.parse(rawInput)
    if (!this.deps.delegation) {
      return {
        ok: false,
        refusal: 'admission',
        userReport: language === 'zh'
          ? '未创建 worker：子代理运行时未启用。'
          : 'Worker not created: the delegation runtime is not enabled.'
      }
    }
    const team = await this.deps.teams.ensure(ctx.threadId, this.deps.teamLimits?.())
    const active = this.activeWorkers(team)
    if (active.length >= team.limits.hardWorkers) {
      return {
        ok: false,
        refusal: 'worker_limit',
        userReport: language === 'zh'
          ? `已达到 worker 数量上限（${team.limits.hardWorkers}），未创建。`
          : `Worker limit reached (${team.limits.hardWorkers}); nothing was created.`
      }
    }
    const isolation = input.workspace?.isolation ?? 'worktree'
    const resolved = await this.resolveRoute(ctx, input, isolation === 'worktree')
    if ('error' in resolved) {
      return { ok: false, refusal: 'invalid_agent', userReport: resolved.error }
    }
    const { route, profileId, selection } = resolved
    const definition = this.deps.catalog.get(route.harnessId)
    if (!definition) {
      return { ok: false, refusal: 'invalid_agent', userReport: `unknown harness ${route.harnessId}` }
    }
    if (isolation === 'worktree' && !this.deps.taskWorkspaces) {
      // Admission would report `isolated` for a run that would actually write
      // into the manager's own workspace — refuse instead (09 §7.1).
      return {
        ok: false,
        refusal: 'admission',
        userReport: language === 'zh'
          ? '未创建 worker：任务工作区服务不可用，无法提供 worktree 隔离。'
          : 'Worker not created: task workspaces are unavailable, so worktree isolation cannot be provided.'
      }
    }
    const permission = clampPermission(definition, input.permissionMode, ctx.authority)
    const effective = await this.deps.capabilitiesForRoute(route)
    const status = await this.deps.detector.status(route.harnessId)
    const admission = checkHarnessAdmission({
      usage: 'manager-worker',
      harness: definition,
      effective,
      status,
      workspace: { isolated: isolation === 'worktree' },
      requestedPermissionMode: permission.effective,
      unattended: !ctx.authority.interactive,
      allowUnattendedFullAccess: this.deps.allowUnattendedFullAccess?.() === true
    })
    if (!admission.ok) {
      return {
        ok: false,
        refusal: 'admission',
        admission,
        route,
        permissionMode: {
          ...(permission.requestedMode ? { requested: permission.requestedMode.id } : {}),
          effective: permission.effective,
          downgraded: permission.downgraded
        },
        userReport: language === 'zh'
          ? `未创建 worker：${admission.message}`
          : `Worker not created: ${admission.message}`
      }
    }
    let effectivePermissionMode = permission.effective
    if (permission.needsUserConfirmation && permission.requestedMode) {
      const confirmed = await requestUserOnlyEscalation(
        {
          threadId: ctx.threadId,
          turnId: ctx.turnId,
          nextId: (prefix) => this.deps.ids.next(prefix),
          awaitApproval: ctx.awaitApproval
        },
        {
          workerLabel: input.label,
          harnessName: definition.displayName,
          workspacePath: ctx.workspace,
          mode: permission.requestedMode
        }
      )
      if (!confirmed) {
        return {
          ok: false,
          refusal: 'escalation_declined',
          route,
          userReport: language === 'zh'
            ? `用户未确认 worker「${input.label}」的权限升级，未创建。`
            : `Permission escalation for worker "${input.label}" was not confirmed; nothing was created.`
        }
      }
      // User confirmed: the worker runs at the requested mode (09 §7.2).
      effectivePermissionMode = permission.requestedMode.id
    }
    const workerId = this.deps.ids.next('child')
    const tws = this.deps.taskWorkspaces
      ? await this.deps.taskWorkspaces.create({
          ownerThreadId: ctx.threadId,
          unitId: workerId,
          label: input.label,
          sourceRoot: ctx.workspace,
          isolation,
          startFrom: (input.workspace?.startFrom ?? { kind: 'default-branch' }) as StartFrom
        }, ctx.signal)
      : null
    const security = this.workerSecurity(childSecurity(toolContext), tws?.path ?? ctx.workspace)
    const worker: WorkerRecord = {
      workerId,
      label: input.label,
      ...(input.role ? { role: input.role } : {}),
      route,
      ...(profileId ? { profileId } : {}),
      ...(selection ? { selection } : {}),
      permissionMode: effectivePermissionMode,
      lifecycle: input.lifecycle ?? 'persistent',
      ...(tws ? { taskWorkspaceId: tws.workspaceId } : {}),
      securitySnapshot: security,
      control: 'manager',
      state: 'active',
      createdAt: this.deps.nowIso()
    }
    await this.deps.teams.upsertWorker(team.teamId, worker)
    this.deps.activity?.register({
      unitId: workerId,
      kind: 'worker',
      threadId: workerId,
      parentThreadId: ctx.threadId,
      teamId: team.teamId,
      harnessId: route.harnessId,
      title: input.label,
      workspace: {
        path: tws?.path ?? ctx.workspace,
        kind: isolation === 'worktree' ? 'worktree' : 'local'
      }
    })
    const dispatch: DispatchRecord = {
      dispatchId: this.deps.ids.next('dsp'),
      teamId: team.teamId,
      workerId,
      parentTurnId: ctx.turnId,
      title: input.label,
      task: input.task,
      ...(input.context ? { context: input.context } : {}),
      mode: input.mode ?? 'queue',
      state: 'pending',
      verdict: { status: 'pending', checks: [] },
      createdAt: this.deps.nowIso(),
      updatedAt: this.deps.nowIso()
    }
    await this.deps.dispatches.create(dispatch)
    const delivered = await this.deps.deliverer.tryDeliver(team.teamId, dispatch.dispatchId)
    return {
      ok: true,
      workerId,
      dispatchId: dispatch.dispatchId,
      dispatched: delivered.accepted,
      ...(delivered.pendingReason ? { deliveryPending: delivered.pendingReason } : {}),
      route,
      ...(selection ? { selection: { ...selection, ...(profileId ? { profileId } : {}) } } : {}),
      permissionMode: {
        ...(permission.requestedMode ? { requested: permission.requestedMode.id } : {}),
        effective: effectivePermissionMode,
        // After a confirmed escalation the worker runs at the requested mode.
        downgraded: permission.downgraded && effectivePermissionMode === permission.effective
      },
      userReport: reportWorkerCreated(
        {
          worker,
          dispatch,
          pendingReason: delivered.pendingReason,
          permission: {
            ...permission,
            downgraded: permission.downgraded && effectivePermissionMode === permission.effective
          },
          harnessLabel: definition.displayName,
          selectionReason: selection?.reason
        },
        language
      )
    }
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
    requested: number
    created: number
    failed: number
    skipped: number
    dispatched: number
    items: Array<{ index: number; label: string; result: WorkerCreateResult | 'skipped' }>
    userReport: string
  }> {
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
    if (record.state !== 'ready' && record.state !== 'failed') return
    const teams = await this.deps.teams.list()
    for (const team of teams) {
      const worker = team.workers.find((entry) => entry.taskWorkspaceId === record.workspaceId)
      if (!worker) continue
      await this.deps.deliverer.tryDeliverNext(team.teamId, worker.workerId)
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
  async toolContext(input: {
    threadId: string
    turnId: string
    workspace: string
    signal: AbortSignal
    awaitApproval: ManagerToolContext['awaitApproval']
    thread?: Pick<
      ThreadRecord,
      'approvalPolicy' | 'sandboxMode' | 'approvalReviewer'
    > | null
    turn?: Pick<
      Turn,
      'approvalPolicy' | 'sandboxMode' | 'approvalReviewer' | 'clientSurface' | 'imContext'
    > | null
  }): Promise<ManagerToolContext> {
    const thread = input.thread ?? await this.deps.threads.get(input.threadId).catch(() => null)
    const turn = input.turn ?? await this.deps.turns.getTurn(input.threadId, input.turnId).catch(() => null)
    if (!thread) throw new Error(`manager thread ${input.threadId} not found`)
    return {
      threadId: input.threadId,
      turnId: input.turnId,
      workspace: input.workspace,
      authority: authorityFromTurn(thread, turn ?? undefined),
      signal: input.signal,
      awaitApproval: input.awaitApproval
    }
  }
}

function isWorkerVisibleItem(item: TurnItem): item is UserTurnItem | AssistantTextTurnItem {
  return item.kind === 'user_message' || item.kind === 'assistant_text'
}

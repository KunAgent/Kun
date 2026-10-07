import type { ToolHostContext } from '../ports/tool-host.js'
import type { WorkerRecord, DispatchRecord } from '../contracts/ade.js'
import type { StartFrom } from '../contracts/task-workspace.js'
import type { HarnessId } from '../contracts/harness.js'
import type { ManagerRuntimeDeps, ManagerToolContext } from './manager-runtime-deps.js'
import type { WorkerCreateResult } from './manager-runtime.js'
import type { ManagerControls } from './manager-controls.js'
import { WorkerCreateInputSchema, type WorkerCreateInput } from './manager-worker-inputs.js'
import { newManagerWorkRefusal } from './new-work-admission.js'
import { budgetHardRefusal } from './team-budget.js'
import { resolveManagerWorkerRoute } from './worker-route.js'
import { countRecentWorkerFailures } from './worker-selector.js'
import { clampPermission } from './permission-clamp.js'
import { checkHarnessAdmission } from '../harness/harness-admission.js'
import { requestUserOnlyEscalation } from './escalation-approval.js'
import { childSecurity } from '../adapters/tool/delegation-tool-context.js'
import { workerWorkspaceSecurity } from './worker-security.js'
import { waitForTaskWorkspaceSettlement } from '../workspace-tasks/task-workspace-settlement.js'
import { reportWorkerCreated, reportLanguage } from './user-report.js'
import { kunToolPermissionModeSettings } from '../contracts/policy.js'
import { intersectDispatchPolicy } from './worker-dispatch-security.js'

export class ManagerWorkerCreator {
  constructor(private readonly deps: ManagerRuntimeDeps, private readonly controls: ManagerControls) {}

  private reportLanguage() { return reportLanguage(this.deps.language?.()) }
  private workerSecurity = workerWorkspaceSecurity
  private resolveRoute(ctx: ManagerToolContext, input: WorkerCreateInput, isolated: boolean) {
    return resolveManagerWorkerRoute(this.deps, ctx, input, isolated, (teamId, harnessId: HarnessId) =>
      countRecentWorkerFailures({ teams: this.deps.teams, dispatches: this.deps.dispatches }, teamId, harnessId))
  }

  async create(
    ctx: ManagerToolContext,
    rawInput: unknown,
    /** The calling turn's security view (tool context), for the worker ceiling. */
    toolContext: ToolHostContext,
    allocation?: { workerId: string; dispatchId: string; intentId: string; selection?: WorkerRecord['selection']; profileId?: string }
  ): Promise<WorkerCreateResult> {
    const language = this.reportLanguage()
    const input = WorkerCreateInputSchema.parse(rawInput)
    const refused = await newManagerWorkRefusal(this.deps, ctx.threadId, ctx.turnId)
    if (refused) return refused
    if (!this.deps.delegation) {
      return {
        ok: false,
        refusal: 'admission',
        userReport: language === 'zh'
          ? '未创建 worker：子代理运行时未启用。'
          : 'Worker not created: the delegation runtime is not enabled.'
      }
    }
    const managerThread = await this.deps.threads.get(ctx.threadId)
    const execution = managerThread?.pendingExecutionConfig ?? managerThread?.executionConfig
    const effectiveLimits = execution?.limits ?? this.deps.teamLimits?.()
    const effectiveBudget = execution ? execution.budget : this.deps.teamBudgetPolicy?.()
    let team = await this.deps.teams.ensure(
      ctx.threadId,
      effectiveLimits,
      effectiveBudget
    )
    if (execution && effectiveLimits) {
      team = await this.deps.teams.updatePolicy(ctx.threadId, effectiveLimits, effectiveBudget) ?? team
    }
    if (allocation) {
      const existing = await this.deps.teams.worker(team.teamId, allocation.workerId)
      const dispatch = await this.deps.dispatches.get(team.teamId, allocation.dispatchId)
      if (existing && dispatch) {
        const delivered = await this.deps.deliverer.tryDeliver(team.teamId, dispatch.dispatchId)
        return { ok: true, workerId: existing.workerId, dispatchId: dispatch.dispatchId,
          dispatched: delivered.accepted, route: existing.route,
          ...(existing.taskWorkspaceId ? { taskWorkspaceId: existing.taskWorkspaceId } : {}),
          userReport: 'Dispatch reconciled with its existing worker.' }
      }
    }
    const active = team.workers.filter((worker) => worker.state === 'active' && worker.workerId !== allocation?.workerId)
    if (active.length >= team.limits.hardWorkers) {
      return {
        ok: false,
        refusal: 'worker_limit',
        userReport: language === 'zh'
          ? `已达到 worker 数量上限（${team.limits.hardWorkers}），未创建。`
          : `Worker limit reached (${team.limits.hardWorkers}); nothing was created.`
      }
    }
    const budgetCheck = this.deps.teamBudget?.check(team)
    const budgetRefusal = budgetHardRefusal(budgetCheck, language)
    if (budgetRefusal) return budgetRefusal
    this.controls.notifyBudgetCheck(team, budgetCheck)
    const reuseId = input.workspace?.reuseTaskWorkspaceId
    const reused = reuseId ? this.deps.taskWorkspaces?.get(reuseId) : undefined
    if (reuseId && (!reused || !['ready', 'captured', 'conflict'].includes(reused.state))) {
      return {
        ok: false,
        refusal: 'workspace_unavailable',
        userReport: language === 'zh'
          ? `任务工作区 ${reuseId} 不可复用，未创建 worker。`
          : `Task workspace ${reuseId} is not reusable; worker not created.`
      }
    }
    // P4-11: an explicitly pinned harness's `defaults.isolation` applies
    // when the caller left isolation unspecified (a selector-picked harness
    // is not known early enough to feed its own default into selection).
    const isolation = reused?.isolation ?? input.workspace?.isolation ??
      (input.agent?.harnessId
        ? this.deps.harnessDefaults?.(input.agent.harnessId as HarnessId)?.isolation
        : undefined) ??
      'worktree'
    const resolved = await this.resolveRoute(ctx, input, isolation === 'worktree')
    if ('error' in resolved) {
      return { ok: false, refusal: 'invalid_agent', userReport: resolved.error }
    }
    const { route } = resolved
    const profileId = allocation?.profileId ?? resolved.profileId
    const selection = allocation?.selection ?? resolved.selection
    const definition = this.deps.catalog.get(route.harnessId)
    if (!definition || this.deps.catalog.isDisabled?.(route.harnessId) || this.deps.catalog.isProfileEnabled?.(route) === false) {
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
    const permission = clampPermission(
      definition,
      input.permissionMode ?? this.deps.harnessDefaults?.(route.harnessId)?.permissionMode,
      ctx.authority
    )
    const effective = await this.deps.capabilitiesForRoute(route)
    const status = await this.deps.detector.status(route.harnessId)
    const admission = checkHarnessAdmission({
      usage: 'manager-worker',
      credentialMode: route.credentialMode,
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
    if (!allocation && permission.needsUserConfirmation && permission.requestedMode) {
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
    const workerId = allocation?.workerId ?? this.deps.ids.next('child')
    if (reused && reused.unitId !== workerId) {
      // The workspace now belongs to the new worker (11 §4.4 'new-worker').
      this.deps.taskWorkspaces?.bindUnit(reused.workspaceId, workerId)
    }
    let tws = reused ?? (this.deps.taskWorkspaces
      ? await this.deps.taskWorkspaces.create({
          ownerThreadId: ctx.threadId,
          unitId: workerId,
          label: input.label,
          sourceRoot: ctx.workspace,
          isolation,
          startFrom: (input.workspace?.startFrom ?? { kind: 'default-branch' }) as StartFrom
        }, ctx.signal)
      : null)
    if (tws && !reused) {
      // `create` returns a provisional record: `path` still names the source
      // root until the async checkout finishes. The snapshot must name the
      // real task workspace — it is both the worker's only write root
      // (09 §7.1) and its thread workspace (delegation-runtime-run).
      tws = (await waitForTaskWorkspaceSettlement(
        this.deps.taskWorkspaces!, tws.workspaceId, ctx.signal)) ?? tws
      if (!['ready', 'captured', 'conflict'].includes(tws.state)) {
        // The promised isolation could not be materialized — refuse rather
        // than scope the worker to the manager's own workspace.
        return {
          ok: false,
          refusal: 'workspace_unavailable',
          userReport: language === 'zh'
            ? `任务工作区创建失败（${tws.lastError ?? tws.state}），未创建 worker。`
            : `Task workspace could not be created (${tws.lastError ?? tws.state}); worker not created.`
        }
      }
    }
    const security = this.workerSecurity(childSecurity(toolContext), tws?.path ?? ctx.workspace)
    const nativeMode = definition.permissionModes.find((mode) => mode.id === effectivePermissionMode)
    const policySource = !allocation && effectivePermissionMode !== permission.effective
      ? kunToolPermissionModeSettings(nativeMode?.kunPermissionMode ?? ctx.authority.kunPermissionMode)
      : toolContext.approvalPolicy ? toolContext : kunToolPermissionModeSettings(ctx.authority.kunPermissionMode)
    const inheritedPolicy = intersectDispatchPolicy(policySource, nativeMode?.kunPermissionMode ?? ctx.authority.kunPermissionMode)
    const worker: WorkerRecord = {
      workerId,
      label: input.label,
      ...(input.role ? { role: input.role } : {}),
      route,
      ...(profileId ? { profileId } : {}),
      ...(selection ? { selection } : {}),
      permissionMode: effectivePermissionMode,
      permissionSnapshot: inheritedPolicy,
      ...(allocation ? { dispatchIntentId: allocation.intentId } : {}),
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
        kind: isolation === 'worktree' ? 'worktree' : isolation === 'directory' ? 'directory' : 'local'
      },
      reviewRequired: true,
      reviewStatus: 'pending'
    })
    const dispatch: DispatchRecord = {
      dispatchId: allocation?.dispatchId ?? this.deps.ids.next('dsp'),
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
      ...(worker.taskWorkspaceId ? { taskWorkspaceId: worker.taskWorkspaceId } : {}),
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

}

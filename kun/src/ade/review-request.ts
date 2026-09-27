import { z } from 'zod'
import {
  ADE_WORKER_CALLBACK_TOOL_NAMES,
  type DispatchRecord,
  type WorkerRecord,
  type WorkerReport
} from '../contracts/ade.js'
import type { HarnessId, HarnessRoute } from '../contracts/harness.js'
import type { ManagerRuntimeDeps, ManagerToolContext } from './manager-runtime.js'
import {
  countRecentWorkerFailures,
  NoEligibleWorkerError,
  selectWorkerRoute,
  type WorkerRouteSelection
} from './worker-selector.js'
import { resolveWorkerRoute, type ResolvedWorkerRoute } from './worker-route.js'
import { checkHarnessAdmission } from '../harness/harness-admission.js'
import { clampPermission } from './permission-clamp.js'
import { childSecurity } from '../adapters/tool/delegation-tool-context.js'
import { reportLanguage } from './user-report.js'

/** `review_request` input (10 §5): cross-review a worker's last dispatch. */
export const ReviewRequestInputSchema = z
  .object({
    workerId: z.string().min(1).max(256),
    /** Default: the worker's most recent completed dispatch. */
    dispatchId: z.string().min(1).max(256).optional(),
    /** Explicit reviewer route; must differ from the reviewed harness. */
    reviewer: z
      .object({
        harnessId: z.string().min(1).max(64).optional(),
        model: z.string().min(1).max(512).optional()
      })
      .strict()
      .optional(),
    /** Review focus, e.g. "concurrency safety" or "API compatibility". */
    focus: z.string().min(1).max(4_000).optional()
  })
  .strict()

export type ReviewRequestRefusal =
  | 'worker_not_found'
  | 'dispatch_not_found'
  | 'dispatch_worker_mismatch'
  | 'dispatch_in_flight'
  | 'no_completed_dispatch'
  | 'same_harness'
  | 'no_reviewer'
  | 'worker_limit'
  | 'admission'
  | 'invalid_agent'

export type ReviewRequestResult = {
  ok: boolean
  reviewerWorkerId?: string
  dispatchId?: string
  reviewedDispatchId?: string
  refusal?: ReviewRequestRefusal
  userReport: string
}

/** Patch budget inside the 32k dispatch task cap (10 §5: bounded summary). */
const PATCH_BUDGET = 24_000

/**
 * Cross-review (10 §5): spawns an ephemeral reviewer worker on a different
 * harness, read-only inside the reviewed worker's task workspace (local
 * semantics — it holds no task-workspace record and no write lease).
 */
export class ReviewRequests {
  constructor(private readonly deps: ManagerRuntimeDeps) {}

  private refuse(
    refusal: ReviewRequestRefusal,
    userReport: string
  ): ReviewRequestResult {
    return { ok: false, refusal, userReport }
  }

  async request(
    ctx: ManagerToolContext,
    rawInput: unknown,
    toolContext: Parameters<typeof childSecurity>[0]
  ): Promise<ReviewRequestResult> {
    const language = reportLanguage(this.deps.language?.())
    const input = ReviewRequestInputSchema.parse(rawInput)
    if (!this.deps.delegation) {
      return this.refuse('admission', language === 'zh'
        ? '无法发起审查：子代理运行时未启用。'
        : 'Review not started: the delegation runtime is not enabled.')
    }
    const team = await this.deps.teams.get(ctx.threadId)
    const reviewedWorker = team?.workers.find((entry) => entry.workerId === input.workerId)
    if (!team || !reviewedWorker) {
      return this.refuse('worker_not_found', language === 'zh'
        ? '该 worker 不在此团队中。'
        : 'That worker is not in this team.')
    }
    if (team.workers.filter((entry) => entry.state === 'active').length >= team.limits.hardWorkers) {
      return this.refuse('worker_limit', language === 'zh'
        ? `已达到 worker 数量上限（${team.limits.hardWorkers}），未创建审查者。`
        : `Worker limit reached (${team.limits.hardWorkers}); no reviewer was created.`)
    }
    const reviewed = await this.reviewedDispatch(team.teamId, input)
    if ('error' in reviewed) {
      const message = {
        dispatch_not_found: language === 'zh' ? '找不到该派活。' : 'Dispatch not found.',
        dispatch_worker_mismatch: language === 'zh'
          ? '该派活不属于这个 worker。'
          : 'That dispatch does not belong to this worker.',
        dispatch_in_flight: language === 'zh'
          ? '该派活仍在执行中，结束后再审查。'
          : 'The dispatch is still in flight; review it once it finishes.',
        no_completed_dispatch: language === 'zh'
          ? '该 worker 没有已完成的派活可审查。'
          : 'The worker has no completed dispatch to review.'
      }[reviewed.error]
      return this.refuse(reviewed.error, message)
    }
    const reviewedHarness = reviewedWorker.route.harnessId
    const managerThread = await this.deps.threads.get(ctx.threadId).catch(() => null)
    const resolved = await this.reviewerRoute(ctx, input, {
      reviewedHarness,
      reviewedTask: reviewed.task,
      managerModel: managerThread?.model,
      managerProviderId: managerThread?.providerId
    })
    if ('error' in resolved) {
      return this.refuse(resolved.refusal, resolved.error)
    }
    const { route, profileId, selection } = resolved
    const definition = this.deps.catalog.get(route.harnessId)
    if (!definition) {
      return this.refuse('invalid_agent', `unknown harness ${route.harnessId}`)
    }
    const permission = clampPermission(definition, undefined, ctx.authority)
    const effective = await this.deps.capabilitiesForRoute(route)
    const status = await this.deps.detector.status(route.harnessId)
    const admission = checkHarnessAdmission({
      usage: 'manager-worker',
      harness: definition,
      effective,
      status,
      // The reviewer writes nowhere: the host clamps every write path empty,
      // a boundary at least as strong as a fresh isolated worktree.
      workspace: { isolated: true },
      requestedPermissionMode: permission.effective,
      unattended: !ctx.authority.interactive,
      allowUnattendedFullAccess: this.deps.allowUnattendedFullAccess?.() === true
    })
    if (!admission.ok) {
      return this.refuse('admission', language === 'zh'
        ? `未创建审查者：${admission.message}`
        : `Reviewer not created: ${admission.message}`)
    }
    const workspace = reviewedWorker.taskWorkspaceId && this.deps.taskWorkspaces
      ? this.deps.taskWorkspaces.get(reviewedWorker.taskWorkspaceId) ?? null
      : null
    const workspacePath = workspace?.path ?? ctx.workspace
    const snapshot = workspace && this.deps.taskWorkspaces
      ? await this.deps.taskWorkspaces.reviewSnapshot(workspace.workspaceId).catch(() => undefined)
      : undefined
    const task = renderReviewBrief({
      dispatch: reviewed,
      worker: reviewedWorker,
      workspacePath,
      focus: input.focus,
      snapshot
    })
    const base = childSecurity(toolContext)
    const workerId = this.deps.ids.next('child')
    const now = this.deps.nowIso()
    const reviewer: WorkerRecord = {
      workerId,
      label: `review ${reviewedWorker.label}`.slice(0, 64),
      role: 'reviewer',
      route,
      ...(profileId ? { profileId } : {}),
      ...(selection ? { selection } : {}),
      permissionMode: permission.effective,
      lifecycle: 'ephemeral',
      reviewOf: reviewed.dispatchId,
      securitySnapshot: {
        ...base,
        sandboxRoot: workspacePath,
        allowedReadPaths: narrowReadScope(base.allowedReadPaths, workspacePath),
        allowedWritePaths: [],
        // The readOnly policy ceiling unions the callback tools for worker
        // children; keep them reachable under a narrowed parent ceiling too.
        ...(base.allowedToolNames
          ? {
              allowedToolNames: [
                ...new Set([...base.allowedToolNames, ...ADE_WORKER_CALLBACK_TOOL_NAMES])
              ]
            }
          : {}),
        memoryEnabled: false
      },
      control: 'manager',
      state: 'active',
      createdAt: now
    }
    await this.deps.teams.upsertWorker(team.teamId, reviewer)
    this.deps.activity?.register({
      unitId: workerId,
      kind: 'worker',
      threadId: workerId,
      parentThreadId: ctx.threadId,
      teamId: team.teamId,
      harnessId: route.harnessId,
      title: reviewer.label,
      workspace: { path: workspacePath, kind: 'local' }
    })
    const dispatch: DispatchRecord = {
      dispatchId: this.deps.ids.next('dsp'),
      teamId: team.teamId,
      workerId,
      parentTurnId: ctx.turnId,
      title: `review: ${reviewed.title}`.slice(0, 240),
      task,
      mode: 'queue',
      state: 'pending',
      verdict: { status: 'pending', checks: [] },
      createdAt: now,
      updatedAt: now
    }
    await this.deps.dispatches.create(dispatch)
    const delivered = await this.deps.deliverer.tryDeliver(team.teamId, dispatch.dispatchId)
    const harness = definition.displayName
    return {
      ok: true,
      reviewerWorkerId: workerId,
      dispatchId: dispatch.dispatchId,
      reviewedDispatchId: reviewed.dispatchId,
      userReport: language === 'zh'
        ? delivered.accepted
          ? `已派「${reviewer.label}」（${harness}）交叉审查「${reviewedWorker.label}」，审查中。`
          : `已创建审查者「${reviewer.label}」（${harness}），稍后自动开始。`
        : delivered.accepted
          ? `Cross-review of "${reviewedWorker.label}" dispatched to "${reviewer.label}" (${harness}); it is running.`
          : `Reviewer "${reviewer.label}" (${harness}) created; it starts shortly.`
    }
  }

  /**
   * The dispatch under review: explicit `dispatchId` must belong to the
   * worker and be finished; otherwise the latest completed one is used.
   */
  private async reviewedDispatch(
    teamId: string,
    input: { workerId: string; dispatchId?: string }
  ): Promise<
    DispatchRecord | {
      error:
        | 'dispatch_not_found'
        | 'dispatch_worker_mismatch'
        | 'dispatch_in_flight'
        | 'no_completed_dispatch'
    }
  > {
    if (input.dispatchId) {
      const dispatch = await this.deps.dispatches.get(teamId, input.dispatchId)
      if (!dispatch) return { error: 'dispatch_not_found' }
      if (dispatch.workerId !== input.workerId) return { error: 'dispatch_worker_mismatch' }
      if (
        dispatch.state === 'pending' ||
        dispatch.state === 'delivering' ||
        dispatch.state === 'uncertain' ||
        dispatch.state === 'accepted'
      ) {
        return { error: 'dispatch_in_flight' }
      }
      return dispatch
    }
    const dispatches = await this.deps.dispatches.listByWorker(teamId, input.workerId)
    const completed = [...dispatches].reverse().find((entry) => entry.state === 'completed')
    return completed ?? { error: 'no_completed_dispatch' }
  }

  /**
   * Reviewer route (10 §5): an explicit `reviewer.harnessId` pin, else the
   * selector with the reviewed harness excluded — different agents miss
   * different things. No alternative → an explicit refusal, never the same
   * harness silently.
   */
  private async reviewerRoute(
    ctx: ManagerToolContext,
    input: z.infer<typeof ReviewRequestInputSchema>,
    meta: {
      reviewedHarness: HarnessId
      reviewedTask: string
      managerModel?: string
      managerProviderId?: string
    }
  ): Promise<ResolvedWorkerRoute | { error: string; refusal: ReviewRequestRefusal }> {
    const sameHarness = { error: 'reviewer must run on a different harness than the reviewed worker', refusal: 'same_harness' as const }
    if (input.reviewer?.harnessId) {
      const resolved = await resolveWorkerRoute({
        catalog: this.deps.catalog,
        ...(meta.managerModel ? { managerModel: meta.managerModel } : {}),
        ...(meta.managerProviderId ? { managerProviderId: meta.managerProviderId } : {}),
        agent: {
          harnessId: input.reviewer.harnessId,
          ...(input.reviewer.model ? { model: input.reviewer.model } : {})
        }
      })
      if ('error' in resolved) return { error: resolved.error, refusal: 'invalid_agent' }
      if (resolved.route.harnessId === meta.reviewedHarness) return sameHarness
      return resolved
    }
    if (!this.deps.selector) {
      return {
        error: 'worker selection is unavailable; pass reviewer.harnessId explicitly',
        refusal: 'no_reviewer'
      }
    }
    let selected: WorkerRouteSelection
    try {
      selected = await selectWorkerRoute(
        {
          catalog: this.deps.catalog,
          detector: this.deps.detector,
          capabilitiesForRoute: (route) => this.deps.capabilitiesForRoute(route),
          ...this.deps.selector,
          isolated: false,
          unattended: !ctx.authority.interactive,
          allowUnattendedFullAccess: this.deps.allowUnattendedFullAccess?.() === true,
          managerRoute: () => ({
            model: meta.managerModel?.trim() || undefined,
            providerId: meta.managerProviderId?.trim() || undefined
          }),
          recentFailures: (teamId, harnessId) =>
            countRecentWorkerFailures(
              { teams: this.deps.teams, dispatches: this.deps.dispatches },
              teamId,
              harnessId
            ),
          language: this.deps.language
        },
        {
          task: `review another agent's work\n${meta.reviewedTask}`,
          role: 'reviewer',
          teamId: ctx.threadId,
          workspace: ctx.workspace,
          exclude: { harnessIds: [meta.reviewedHarness] }
        }
      )
    } catch (error) {
      if (error instanceof NoEligibleWorkerError) {
        return { error: error.message, refusal: 'no_reviewer' }
      }
      throw error
    }
    let route: HarnessRoute = selected.route
    if (input.reviewer?.model) {
      const def = this.deps.catalog.get(route.harnessId)
      const requested = input.reviewer.model.trim()
      if (def?.staticModels.length && !def.staticModels.includes(requested)) {
        return {
          error: `model ${requested} is not in harness ${route.harnessId}'s model list`,
          refusal: 'invalid_agent'
        }
      }
      route = { ...route, model: requested }
    }
    return {
      route,
      ...(selected.profileId ? { profileId: selected.profileId } : {}),
      selection: {
        reason: selected.reason,
        score: selected.score,
        alternatives: selected.alternatives.map((candidate) => ({
          route: candidate.route,
          ...(candidate.profileId ? { profileId: candidate.profileId } : {}),
          label: candidate.label.slice(0, 128),
          score: candidate.score
        }))
      }
    }
  }
}

/**
 * The reviewer's dispatch task (10 §5): original task, worker report,
 * optional focus, and the captured patch — bounded to the inline budget,
 * beyond which only file names + stats are embedded and the reviewer reads
 * files directly.
 */
function renderReviewBrief(input: {
  dispatch: DispatchRecord
  worker: WorkerRecord
  workspacePath: string
  focus?: string
  snapshot?: { changedFiles: string[]; patch: string }
}): string {
  const report = reportLines(input.dispatch.workerReport)
  const patch = patchLines(input)
  const task = [
    'You are a read-only reviewer for another agent\'s completed work. Do ' +
      'not modify any files. Inspect the change below, then finish by ' +
      'calling `submit_result` with { summary, outcome, checks, risks }: ' +
      'one checks entry per concrete finding (mark it failed when the code ' +
      'must change, with file:line detail), and remaining risks under risks.',
    `## Original task\n${input.dispatch.task.trim()}`,
    `## Worker report\n${report}`,
    `## Review focus\n${input.focus?.trim() || 'correctness, completeness, and regressions'}`,
    `## Change under review\n${patch}`
  ].join('\n\n')
  return task.slice(0, 32_000)
}

function reportLines(report: WorkerReport | undefined): string {
  if (!report) return '(no submit_result report — review the diff itself)'
  const lines = [
    `outcome: ${report.outcome}`,
    `summary: ${report.summary}`
  ]
  if (report.checks?.length) {
    lines.push(
      `checks: ${report.checks
        .map((check) => `${check.name}=${check.status}`)
        .join(', ')}`
    )
  }
  if (report.risks?.length) {
    lines.push(`risks: ${report.risks.join('; ')}`.slice(0, 2_000))
  }
  return lines.join('\n')
}

function patchLines(input: {
  dispatch: DispatchRecord
  worker: WorkerRecord
  workspacePath: string
  snapshot?: { changedFiles: string[]; patch: string }
}): string {
  if (!input.snapshot) {
    return (
      `No worktree diff is available (local workspace or missing baseline). ` +
      `Inspect ${input.workspacePath} directly with the read tools.`
    )
  }
  const { changedFiles, patch } = input.snapshot
  const header = `${changedFiles.length} file(s) changed:\n${changedFiles
    .slice(0, 200)
    .map((file) => `- ${file}`)
    .join('\n')}`
  if (!patch.trim()) return `${header}\n(diff is empty)`
  if (patch.length > PATCH_BUDGET) {
    return (
      `${header}\nThe diff exceeds the inline budget; open the listed ` +
      `files with the read/grep tools inside your workspace (${input.workspacePath}).`
    )
  }
  return `${header}\n\n\`\`\`diff\n${patch}\n\`\`\``
}

/** Reviewer read scope: the shared workspace narrowed by the parent ceiling. */
function narrowReadScope(
  base: readonly string[] | undefined,
  workspacePath: string
): string[] {
  if (!base?.length) return [workspacePath]
  const out = new Set<string>()
  for (const entry of base) {
    if (entry === workspacePath || entry.startsWith(`${workspacePath}/`)) out.add(entry)
    else if (workspacePath === entry || workspacePath.startsWith(`${entry}/`)) {
      out.add(workspacePath)
    }
  }
  return [...out]
}

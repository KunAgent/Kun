import { z } from 'zod'
import type { ApprovalActionEnvelope } from '../contracts/approvals.js'
import { createApprovalRequest } from '../domain/approval.js'
import type { TaskWorkspaceIntegrateOutcome } from '../contracts/task-workspace.js'
import type { TaskWorkspaceRecord } from '../contracts/task-workspace.js'
import type { ManagerRuntimeDeps, ManagerToolContext } from './manager-runtime.js'
import { reportLanguage } from './user-report.js'

/**
 * `workspace_integrate` (09 §4.1, 11 §7.2): merging a task worktree back into
 * the user's source checkout is a user-only effect. Interactive managers ask
 * through a `file` approval envelope pinned to the source path; unattended
 * turns cannot ask, so they defer to the user instead of integrating.
 */

export const WorkspaceIntegrateInputSchema = z.object({
  workspaceId: z.string().min(1).max(128).optional(),
  mode: z.enum(['apply-patch', 'merge-branch']).default('apply-patch')
}).strict()
export type WorkspaceIntegrateInput = z.infer<typeof WorkspaceIntegrateInputSchema>

export type WorkspaceIntegrateResult = {
  ok: boolean
  workspaceId?: string
  outcome?: TaskWorkspaceIntegrateOutcome
  refusal?:
    | 'unavailable'
    | 'workspace_not_found'
    | 'workspace_ambiguous'
    | 'pending_user'
    | 'user_declined'
    | 'integrate_failed'
  reason?: string
  recovery?: string[]
  userReport: string
}

/** Workspaces whose state still allows integration. */
const INTEGRABLE = new Set(['ready', 'captured', 'conflict'])

export class WorkspaceIntegrations {
  constructor(private readonly deps: ManagerRuntimeDeps) {}

  private refuse(
    refusal: NonNullable<WorkspaceIntegrateResult['refusal']>,
    userReport: string,
    extra: Partial<WorkspaceIntegrateResult> = {}
  ): WorkspaceIntegrateResult {
    return { ok: false, refusal, userReport, ...extra }
  }

  async integrate(
    ctx: ManagerToolContext,
    rawInput: unknown
  ): Promise<WorkspaceIntegrateResult> {
    const language = reportLanguage(this.deps.language?.())
    const zh = language === 'zh'
    const input = WorkspaceIntegrateInputSchema.parse(rawInput)
    if (!this.deps.taskWorkspaces) {
      return this.refuse('unavailable', zh
        ? '无法合入：任务工作区服务未启用。'
        : 'Cannot integrate: the task workspace service is unavailable.')
    }
    const record = this.resolveWorkspace(ctx, input.workspaceId)
    if (Array.isArray(record)) {
      return this.refuse('workspace_ambiguous', zh
        ? `该团队有 ${record.length} 个可合入的任务工作区；请指定 workspaceId。`
        : `This team has ${record.length} integrable task workspaces; pass workspaceId.`)
    }
    if (!record) {
      return this.refuse('workspace_not_found', zh
        ? '找不到可合入的任务工作区。'
        : 'No integrable task workspace found.')
    }
    if (!ctx.authority.interactive) {
      return this.refuse('pending_user', zh
        ? `工作区 ${record.workspaceId} 已准备好合入 ${record.sourceRoot}；无人值守模式不能替你合入，待你确认。`
        : `Workspace ${record.workspaceId} is ready to integrate into ${record.sourceRoot}; unattended mode cannot merge for you — pending your confirmation.`,
        { workspaceId: record.workspaceId })
    }
    const approved = await this.askUser(ctx, record, input.mode)
    if (!approved) {
      return this.refuse('user_declined', zh
        ? '你已拒绝合入；工作区保持原样。'
        : 'Integration declined; the workspace is unchanged.',
        { workspaceId: record.workspaceId })
    }
    let result
    try {
      result = await this.deps.taskWorkspaces.integrate(record.workspaceId, input.mode)
    } catch (error) {
      return this.refuse('integrate_failed', zh
        ? `合入失败：${(error as Error).message}`
        : `Integration failed: ${(error as Error).message}`,
        { workspaceId: record.workspaceId })
    }
    const done = result.outcome === 'applied' || result.outcome === 'merged'
    const userReport = done
      ? (zh
          ? `已合入 ${record.sourceRoot}（${result.outcome === 'applied' ? '应用补丁' : '合并分支'}）。`
          : `Integrated into ${record.sourceRoot} (${result.outcome}).`)
      : (zh
          ? `合入需要你处理：${result.reason ?? ''}`
          : `Integration needs you: ${result.reason ?? ''}`)
    return {
      ok: done,
      workspaceId: record.workspaceId,
      outcome: result.outcome,
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.recovery ? { recovery: result.recovery } : {}),
      userReport
    }
  }

  private resolveWorkspace(
    ctx: ManagerToolContext,
    workspaceId: string | undefined
  ): TaskWorkspaceRecord | TaskWorkspaceRecord[] | undefined {
    const svc = this.deps.taskWorkspaces
    if (!svc) return undefined
    if (workspaceId) {
      const record = svc.get(workspaceId)
      return record && record.ownerThreadId === ctx.threadId ? record : undefined
    }
    const candidates = svc.list({ ownerThreadId: ctx.threadId })
      .filter((entry) => INTEGRABLE.has(entry.state))
    return candidates.length === 1 ? candidates[0] : candidates.length ? candidates : undefined
  }

  /** User-only approval: file envelope pinned to the source checkout (11 §7.2). */
  private async askUser(
    ctx: ManagerToolContext,
    record: TaskWorkspaceRecord,
    mode: WorkspaceIntegrateInput['mode']
  ): Promise<boolean> {
    const source = record.sourceRoot
    const action: ApprovalActionEnvelope = {
      version: 1,
      kind: 'file',
      toolName: 'ade.workspace_integrate',
      providerKind: 'delegation',
      effects: {
        network: false,
        externalWrite: true,
        processExecution: true,
        guiAutomation: false
      },
      arguments: {
        workspaceId: record.workspaceId,
        mode,
        branch: record.branch,
        changedFiles: record.changedFiles
      },
      workspace: source,
      targets: [{ kind: 'file', value: source }],
      reason:
        `Integrate task workspace "${record.label ?? record.workspaceId}" into ` +
        `the source checkout ${source} (${mode}).`,
      requiresUserDecision: true,
      reviewerRequirement: 'user'
    }
    const request = createApprovalRequest({
      id: this.deps.ids.next('int'),
      threadId: ctx.threadId,
      turnId: ctx.turnId,
      toolName: action.toolName,
      summary:
        `Integrate "${record.label ?? record.workspaceId}" into ${source}`,
      action
    })
    const decision = await ctx.awaitApproval(request).catch(() => 'deny' as const)
    const resolved = typeof decision === 'string' ? decision : decision.decision
    return resolved === 'allow'
  }
}

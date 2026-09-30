import { z } from 'zod'
import type {
  DispatchRecord,
  QualityCheck,
  QualityVerdict,
  SupersededVerdict,
  WorkerReport
} from '../contracts/ade.js'
import type { FileDispatchStore } from './dispatch-store.js'
import type { FileTeamStore } from './team-store.js'
import { reportLanguage } from './user-report.js'

/** `worker_verdict` input (10 §4.2): the manager records a quality decision. */
export const WorkerVerdictInputSchema = z
  .object({
    dispatchId: z.string().min(1).max(256),
    status: z.enum(['passed', 'needs_changes', 'rejected', 'waived']),
    notes: z.string().min(1).max(4_000).optional()
  })
  .strict()

export type VerdictStatus = z.infer<typeof WorkerVerdictInputSchema>['status']

export type VerdictResult = {
  ok: boolean
  dispatchId?: string
  verdict?: QualityVerdict
  refusal?: 'dispatch_not_found' | 'user_verdict_locked'
  userReport: string
}

export type QualityVerdictDeps = {
  teams: Pick<FileTeamStore, 'list'>
  dispatches: Pick<FileDispatchStore, 'get' | 'mutate'>
  nowIso: () => string
  language?: () => string | undefined
}

const STATUS_LABEL: Record<VerdictStatus, { zh: string; en: string }> = {
  passed: { zh: '通过', en: 'passed' },
  needs_changes: { zh: '需修改', en: 'needs changes' },
  rejected: { zh: '驳回', en: 'rejected' },
  waived: { zh: '豁免', en: 'waived' }
}

/**
 * Quality verdicts (10 §4): acceptance stays independent from execution
 * `state`, a later decision supersedes the earlier one into
 * `verdict.superseded` (both stay on record), and a user verdict is final —
 * manager writes afterwards are refused.
 */
export class QualityVerdicts {
  constructor(private readonly deps: QualityVerdictDeps) {}

  private language(): 'en' | 'zh' {
    return reportLanguage(this.deps.language?.())
  }

  private notFound(dispatchId: string): VerdictResult {
    return {
      ok: false,
      refusal: 'dispatch_not_found',
      userReport: this.language() === 'zh'
        ? `找不到派活 ${dispatchId}。`
        : `Dispatch ${dispatchId} was not found.`
    }
  }

  /** Routes only know the dispatch id; the team id scopes the store file. */
  async teamForDispatch(dispatchId: string): Promise<string | null> {
    for (const team of await this.deps.teams.list()) {
      if (await this.deps.dispatches.get(team.teamId, dispatchId)) return team.teamId
    }
    return null
  }

  /** `worker_verdict` tool entry — parses input, decides as the manager. */
  async workerVerdict(
    ctx: { threadId: string },
    rawInput: unknown
  ): Promise<VerdictResult> {
    const input = WorkerVerdictInputSchema.parse(rawInput)
    return this.setVerdict({
      teamId: ctx.threadId,
      dispatchId: input.dispatchId,
      status: input.status,
      decidedBy: 'manager',
      ...(input.notes ? { notes: input.notes } : {})
    })
  }

  /**
   * `setVerdict` (10 §4.2): writes a decided verdict. A prior decided
   * verdict moves into `superseded`; checks/reviewer linkage carry over.
   * Once `decidedBy: 'user'` exists only the user may decide again.
   */
  async setVerdict(input: {
    dispatchId: string
    status: VerdictStatus
    decidedBy: 'manager' | 'user'
    notes?: string
    /** Manager ctx passes it; the route resolves it via teamForDispatch. */
    teamId?: string
  }): Promise<VerdictResult> {
    const language = this.language()
    const teamId = input.teamId ?? (await this.teamForDispatch(input.dispatchId))
    if (!teamId) return this.notFound(input.dispatchId)
    let locked = false
    const updated = await this.deps.dispatches.mutate(
      teamId,
      input.dispatchId,
      (current) => {
        const existing = current.verdict
        if (existing?.decidedBy === 'user' && input.decidedBy !== 'user') {
          locked = true
          return null
        }
        const superseded = previousDecision(existing)
        return {
          verdict: {
            status: input.status,
            decidedBy: input.decidedBy,
            ...(existing?.reviewerWorkerId
              ? { reviewerWorkerId: existing.reviewerWorkerId }
              : {}),
            checks: existing?.checks ?? [],
            ...(input.notes ? { notes: input.notes } : {}),
            decidedAt: this.deps.nowIso(),
            ...(superseded?.length ? { superseded } : {})
          }
        }
      }
    )
    if (locked) {
      return {
        ok: false,
        refusal: 'user_verdict_locked',
        userReport: language === 'zh'
          ? '验收结论已由用户给出，总管不能覆盖。'
          : 'The verdict was already decided by the user and cannot be overridden.'
      }
    }
    if (!updated?.verdict) return this.notFound(input.dispatchId)
    return {
      ok: true,
      dispatchId: input.dispatchId,
      verdict: updated.verdict,
      userReport: language === 'zh'
        ? `验收结论已记录：${STATUS_LABEL[input.status].zh}。`
        : `Verdict recorded: ${STATUS_LABEL[input.status].en}.`
    }
  }

  /**
   * Reviewer findings (10 §5): the reviewer worker's `submit_result` merges
   * into the reviewed dispatch — checks keep their entries, risks become
   * failed checks, all tagged `source: 'reviewer'`. Status/decision stay
   * untouched; the manager or user still decides.
   */
  async mergeReviewerFindings(input: {
    teamId: string
    dispatchId: string
    reviewerWorkerId: string
    report: WorkerReport
  }): Promise<QualityVerdict | undefined> {
    const updated = await this.deps.dispatches.mutate(
      input.teamId,
      input.dispatchId,
      (current) => {
        const existing = current.verdict ?? { status: 'pending' as const, checks: [] }
        const findings: QualityCheck[] = [
          ...(input.report.checks ?? []).map((check) => ({
            ...check,
            source: 'reviewer' as const
          })),
          ...(input.report.risks ?? []).map((risk) => ({
            name: 'risk',
            status: 'failed' as const,
            source: 'reviewer' as const,
            detail: risk.slice(0, 2_000)
          }))
        ]
        return {
          verdict: {
            ...existing,
            reviewerWorkerId: input.reviewerWorkerId,
            checks: [...existing.checks, ...findings].slice(-64)
          }
        }
      }
    )
    return updated?.verdict
  }
}

/** Prior decided verdict → superseded entry (newest first, capped). */
function previousDecision(existing: DispatchRecord['verdict']): SupersededVerdict[] | undefined {
  if (!existing) return undefined
  const prior =
    existing.decidedBy && existing.status !== 'pending'
      ? [
          {
            status: existing.status as SupersededVerdict['status'],
            decidedBy: existing.decidedBy,
            ...(existing.notes ? { notes: existing.notes } : {}),
            ...(existing.decidedAt ? { decidedAt: existing.decidedAt } : {})
          }
        ]
      : []
  return [...prior, ...(existing.superseded ?? [])].slice(0, 8)
}

/**
 * Team usage rollup + budget gate (docs/ade/impl p3-review-followup P3-15):
 * worker-thread usage sums to a team total; crossing the soft cap notifies
 * the manager once, crossing the hard cap refuses new worker_create /
 * worker_send work without interrupting anything already running.
 */
import type { TeamRecord, WorkerRecord } from '../contracts/ade.js'
import type { UsageSnapshot } from '../contracts/usage.js'

export type TeamUsageReport = {
  /** Summed worker-thread usage across the whole roster. */
  totalTokens: number
  perWorker: Array<{
    workerId: string
    label: string
    totalTokens: number
  }>
  softTokens?: number
  hardTokens?: number
  softExceeded: boolean
  hardExceeded: boolean
}

export type TeamBudgetCheck =
  | { exceeded: 'hard'; report: TeamUsageReport }
  | { exceeded: 'soft-first'; report: TeamUsageReport; topWorker: WorkerRecord }
  | { exceeded: 'soft-repeat'; report: TeamUsageReport }
  | { exceeded: null; report: TeamUsageReport }

export type TeamBudgetUsage = Pick<
  import('../services/usage-service-core.js').UsageService,
  'forThread'
>

export function computeTeamUsage(
  team: TeamRecord,
  usage: TeamBudgetUsage
): TeamUsageReport {
  const perWorker = team.workers.map((worker) => ({
    workerId: worker.workerId,
    label: worker.label,
    totalTokens: usage.forThread(worker.workerId)?.totalTokens ?? 0
  }))
  const totalTokens = perWorker.reduce((sum, entry) => sum + entry.totalTokens, 0)
  const soft = team.budget?.softTokens
  const hard = team.budget?.hardTokens
  return {
    totalTokens,
    perWorker,
    ...(soft !== undefined ? { softTokens: soft } : {}),
    ...(hard !== undefined ? { hardTokens: hard } : {}),
    softExceeded: soft !== undefined && totalTokens >= soft,
    hardExceeded: hard !== undefined && totalTokens >= hard
  }
}

export class TeamBudgetGate {
  private readonly softNotified = new Set<string>()

  constructor(private readonly usage: TeamBudgetUsage) {}

  /** Highest-usage worker: the budget notice is attributed to them. */
  topWorker(team: TeamRecord, report: TeamUsageReport): WorkerRecord | undefined {
    let top: WorkerRecord | undefined
    let best = -1
    for (const worker of team.workers) {
      const tokens =
        report.perWorker.find((w) => w.workerId === worker.workerId)?.totalTokens ?? 0
      if (tokens > best) {
        best = tokens
        top = worker
      }
    }
    return top
  }

  /**
   * Evaluate a team: 'hard' always reports; 'soft-first' fires only on the
   * first observed crossing and re-arms if totals ever drop back below the
   * soft cap (e.g. a raised budget or a reset team).
   */
  check(team: TeamRecord): TeamBudgetCheck {
    const report = computeTeamUsage(team, this.usage)
    if (report.hardExceeded) return { exceeded: 'hard', report }
    if (!report.softExceeded) {
      this.softNotified.delete(team.teamId)
      return { exceeded: null, report }
    }
    if (this.softNotified.has(team.teamId)) {
      return { exceeded: 'soft-repeat', report }
    }
    this.softNotified.add(team.teamId)
    const topWorker = this.topWorker(team, report)
    return topWorker
      ? { exceeded: 'soft-first', report, topWorker }
      : { exceeded: 'soft-repeat', report }
  }
}

/** Hard-cap refusal shared by worker_create / worker_send / gui dispatch. */
export function budgetHardRefusal(
  check: TeamBudgetCheck | undefined,
  language: 'en' | 'zh'
): { ok: false; refusal: 'budget_exceeded'; userReport: string } | null {
  if (check?.exceeded !== 'hard') return null
  return {
    ok: false,
    refusal: 'budget_exceeded',
    userReport: language === 'zh'
      ? `团队用量已达硬上限（${check.report.totalTokens}/${check.report.hardTokens} tokens），已拒绝本次操作。`
      : `Team usage hit the hard budget (${check.report.totalTokens}/${check.report.hardTokens} tokens); the operation was refused.`
  }
}

/** Wake-up notice body for the first observed soft-cap crossing. */
export function budgetSoftNoticeDetail(
  check: TeamBudgetCheck,
  language: 'en' | 'zh'
): string {
  return language === 'zh'
    ? `团队用量已达软上限 ${check.report.totalTokens}/${check.report.softTokens} tokens；超过硬上限将拒绝新建与派活。`
    : `Team usage reached the soft budget ${check.report.totalTokens}/${check.report.softTokens} tokens; new workers and dispatches are refused at the hard cap.`
}

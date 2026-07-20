/**
 * [INPUT]: 依赖 CoverageEvaluator、EvidenceStore、ResearchRunRepository 和 research 运行事件/状态类型
 * [OUTPUT]: 对外提供恢复首轮准备、持久化 run 加载和中断 run 续跑准备函数，恢复时重算 Gap 并应用与主循环相同的进展/死循环判定
 * [POS]: research/runtime 的恢复协调器，将重启恢复分支从 ResearchRuntime 主循环中隔离，禁止重试绕过 ResearchProgressGuard
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { CoverageEvaluator } from '../agents/types.js'
import type { ResearchEventInput } from '../core/events.js'
import type { ResearchPlan, ResearchRun, ResearchTask } from '../core/types.js'
import { EvidenceStore } from '../evidence/EvidenceStore.js'
import type { ResearchRunRepository } from '../storage/ResearchRunRepository.js'
import { applyResearchProgressGuard } from './ResearchProgressGuard.js'
import { normalizeGapVerdict } from './ResearchRuntimePolicy.js'

export async function prepareRecoveredResearchRound(input: {
  run: ResearchRun
  plan: ResearchPlan
  evidenceStore: EvidenceStore
  coverageEvaluator: CoverageEvaluator
  roundIndex: number
  nowIso: () => string
  record: (event: ResearchEventInput) => Promise<void>
}): Promise<{ roundIndex: number; tasksForRound: ResearchTask[] }> {
  const { run, plan, evidenceStore, coverageEvaluator, nowIso, record } = input
  let roundIndex = input.roundIndex
  let tasksForRound = plan.tasks.filter((task) => task.status !== 'done' && task.status !== 'cancelled')
  if (tasksForRound.length > 0) return { roundIndex, tasksForRound }

  const evaluatedGap = normalizeGapVerdict(await coverageEvaluator.evaluate({
    runId: run.id,
    brief: run.brief,
    frame: run.frame,
    plan,
    budget: run.budget,
    coverageContract: run.coverageContract,
    roundIndex,
    sources: evidenceStore.listSources(),
    evidenceSpans: evidenceStore.listEvidenceSpans(),
    claims: evidenceStore.listClaims(),
    notes: evidenceStore.listNotes(),
    nowIso: nowIso()
  }))
  const recoveredGap = applyResearchProgressGuard(run.gapVerdicts ?? [], evaluatedGap).verdict
  run.gapVerdicts = [...(run.gapVerdicts ?? []), recoveredGap]
  await record({ type: 'RESEARCH_COMPLETED', taskCount: 0, roundIndex })
  await record({
    type: 'GAP_CHECK_COMPLETED',
    verdict: recoveredGap,
    roundIndex,
    followUpTaskCount: recoveredGap.followUpTasks.length
  })
  if (recoveredGap.status !== 'need_more' && recoveredGap.status !== 'needs_research_repair') {
    return { roundIndex, tasksForRound }
  }

  tasksForRound = recoveredGap.followUpTasks
  for (const task of tasksForRound) {
    if (!plan.tasks.some((existing) => existing.id === task.id)) plan.tasks.push(task)
    await record({ type: 'FOLLOW_UP_TASK_CREATED', task, roundIndex: roundIndex + 1 })
  }
  roundIndex += 1
  return { roundIndex, tasksForRound }
}

export async function loadPersistedResearchRuns(repository: ResearchRunRepository): Promise<ResearchRun[]> {
  return repository.loadRuns()
}

export async function prepareInterruptedResearchRunForResume(
  run: ResearchRun,
  repository: ResearchRunRepository
): Promise<boolean> {
  if (!run.approval?.approvedByUser) return false
  if (['done', 'failed', 'cancelled', 'research_unavailable', 'scoping', 'awaiting_brief_confirm'].includes(run.status)) {
    return false
  }
  run.status = 'planning'
  for (const task of run.plan?.tasks ?? []) {
    if (task.status === 'running') task.status = 'pending'
  }
  await repository.writeRun(run)
  return true
}

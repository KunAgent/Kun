/**
 * [INPUT]: 依赖 CoverageEvaluator、ResearchTaskWorker、EvidenceStore、补证策略和运行持久化回调
 * [OUTPUT]: 对外提供 runVerificationEvidenceRepair，执行 Judge/WritableGate 失败后的进展驱动补证循环，继承 Gap/报告蓝图已穷尽问题，只把未穷尽目标的新增可回答事实、增强来源等级或首个独立复核计为进步，并返回新穷尽问题
 * [POS]: research/runtime 的验证补证协调器，隔离报告质量失败后的研究修复分支；不按空轮次数退出，只在目标问题语义证据没有变化或触发异常安全上限时退出
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { selectTasksByValueOfInformation } from '../agents/HypothesisAgent.js'
import type { CoverageEvaluator, ResearchTaskWorker } from '../agents/types.js'
import type { ResearchEventInput } from '../core/events.js'
import type { QualityVerdict, ResearchPlan, ResearchRun, ResearchTask } from '../core/types.js'
import { validateResearchPlan } from '../core/validation.js'
import type { EvidenceStore } from '../evidence/EvidenceStore.js'
import { eligibleEvidenceSourceCount } from '../evidence/EvidenceEligibility.js'
import {
  availableRepairSourceTypes,
  normalizeGapVerdict,
  verificationEvidenceTasks,
  verificationRepairTargetQuestions
} from './ResearchRuntimePolicy.js'
import { applyResearchProgressGuard } from './ResearchProgressGuard.js'
import { buildSectionEvidenceMap } from './ResearchWritableGate.js'

export type VerificationEvidenceRepairResult = {
  progress: boolean
  exhaustedQuestionIds: string[]
}

export async function runVerificationEvidenceRepair(input: {
  run: ResearchRun
  plan: ResearchPlan
  evidenceStore: EvidenceStore
  verdict: QualityVerdict
  attempt: number
  worker: ResearchTaskWorker
  coverageEvaluator: CoverageEvaluator
  nowIso: () => string
  runTasks: (tasks: ResearchTask[]) => Promise<void>
  record: (event: ResearchEventInput) => Promise<void>
  writeRun: () => Promise<void>
}): Promise<VerificationEvidenceRepairResult> {
  const { run, plan, evidenceStore } = input
  const previouslyExhaustedQuestionIds = exhaustedQuestionIdsForVerificationRepair(run)
  const targetQuestionIds = verificationRepairTargetQuestions(run, input.verdict)
    .map((question) => question.id)
    .filter((questionId) => !previouslyExhaustedQuestionIds.has(questionId))
  const exhausted = (): VerificationEvidenceRepairResult => ({ progress: false, exhaustedQuestionIds: targetQuestionIds })
  let remainingSources = Math.max(0, run.budget.maxSources - eligibleEvidenceSourceCount(evidenceStore.listSources(), evidenceStore.listEvidenceSpans()))
  const sourceTypes = availableRepairSourceTypes(run, input.worker)
  if (remainingSources <= 0 || sourceTypes.length === 0 || targetQuestionIds.length === 0) return exhausted()

  let roundIndex = Math.max(0, ...(run.gapVerdicts ?? []).map((verdict) => verdict.roundIndex)) + 1
  const progressBeforeRepair = verificationRepairProgressFingerprint(run, evidenceStore, targetQuestionIds, input.nowIso())
  const madeEvidenceProgress = () => verificationRepairProgressFingerprint(run, evidenceStore, targetQuestionIds, input.nowIso()) !== progressBeforeRepair
  const attemptedRepairStates = new Set<string>()
  let tasks = verificationEvidenceTasks({
    run,
    verdict: input.verdict,
    attempt: input.attempt,
    roundIndex,
    remainingSources,
    sourceTypes
  })
  while (tasks.length > 0 && remainingSources > 0) {
    const beforeRound = verificationRepairProgressFingerprint(run, evidenceStore, targetQuestionIds, input.nowIso())
    const repairState = verificationRepairState(tasks, beforeRound)
    if (attemptedRepairStates.has(repairState)) {
      return madeEvidenceProgress()
        ? { progress: true, exhaustedQuestionIds: [] }
        : exhausted()
    }
    attemptedRepairStates.add(repairState)
    for (const task of tasks) {
      plan.tasks.push(task)
      await input.record({ type: 'FOLLOW_UP_TASK_CREATED', task, roundIndex })
    }
    validateResearchPlan(plan, run.frame, run.budget.maxSources)
    await input.runTasks(tasks)
    await input.record({ type: 'RESEARCH_COMPLETED', taskCount: tasks.length, roundIndex })
    const afterRound = verificationRepairProgressFingerprint(run, evidenceStore, targetQuestionIds, input.nowIso())
    const noAnsweringProgress = afterRound === beforeRound

    let gapVerdict = normalizeGapVerdict(await input.coverageEvaluator.evaluate({
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
      nowIso: input.nowIso()
    }))
    remainingSources = Math.max(0, run.budget.maxSources - eligibleEvidenceSourceCount(evidenceStore.listSources(), evidenceStore.listEvidenceSpans()))
    if (noAnsweringProgress) {
      gapVerdict = {
        ...gapVerdict,
        status: 'ready_with_limitations',
        stopReason: '本轮没有为目标问题增加新的可回答事实、来源等级或首个独立复核；继续相同检索不会改变结论。',
        followUpTasks: []
      }
    } else if (gapVerdict.status === 'need_more' || gapVerdict.status === 'needs_research_repair') {
      gapVerdict = {
        ...gapVerdict,
        followUpTasks: selectTasksByValueOfInformation(gapVerdict.followUpTasks, run.hypothesisTests ?? [], {
          preset: run.budget.preset,
          maxSources: Math.max(1, remainingSources)
        })
      }
    }
    gapVerdict = applyResearchProgressGuard(run.gapVerdicts ?? [], gapVerdict).verdict
    run.gapVerdicts = [...(run.gapVerdicts ?? []), gapVerdict]
    await input.record({
      type: 'GAP_CHECK_COMPLETED',
      verdict: gapVerdict,
      roundIndex,
      followUpTaskCount: gapVerdict.followUpTasks.length
    })
    await input.writeRun()
    if (noAnsweringProgress) return exhausted()

    if (gapVerdict.status === 'sufficient' || gapVerdict.status === 'ready_with_limitations') {
      if (madeEvidenceProgress()) return { progress: true, exhaustedQuestionIds: [] }
      roundIndex += 1
      tasks = verificationEvidenceTasks({
        run,
        verdict: input.verdict,
        attempt: input.attempt,
        roundIndex,
        remainingSources,
        sourceTypes
      })
      continue
    }
    if (gapVerdict.status !== 'need_more' && gapVerdict.status !== 'needs_research_repair') {
      return madeEvidenceProgress()
        ? { progress: true, exhaustedQuestionIds: [] }
        : exhausted()
    }
    roundIndex += 1
    tasks = gapVerdict.followUpTasks
      .map((task) => ({
        ...task,
        sourceTypes: task.sourceTypes.filter((sourceType) => sourceTypes.includes(sourceType))
      }))
      .filter((task) => task.sourceTypes.length > 0)
      .slice(0, Math.max(1, Math.min(run.budget.maxSubagents, remainingSources)))
  }
  return madeEvidenceProgress()
    ? { progress: true, exhaustedQuestionIds: [] }
    : exhausted()
}

export function exhaustedQuestionIdsForVerificationRepair(run: ResearchRun): Set<string> {
  const questionIds = new Set((run.reportBlueprint?.sections ?? [])
    .filter((section) => section.evidenceMode === 'evidence_gap')
    .flatMap((section) => section.questionIds))
  for (const verdict of run.gapVerdicts ?? []) {
    for (const questionId of verdict.exhaustedQuestionIds ?? []) questionIds.add(questionId)
  }
  const latestGap = run.gapVerdicts?.at(-1)
  if (latestGap?.status === 'unanswerable') {
    for (const coverage of latestGap.coverageByQuestion) {
      if ((coverage.required || coverage.priority === 'high') && !coverage.covered) {
        questionIds.add(coverage.questionId)
      }
    }
  }
  return questionIds
}

function verificationRepairProgressFingerprint(
  run: ResearchRun,
  evidenceStore: EvidenceStore,
  targetQuestionIds: string[],
  nowIso: string
): string {
  const targetIds = new Set(targetQuestionIds)
  const sources = evidenceStore.listSources()
  const spans = evidenceStore.listEvidenceSpans()
  const claims = evidenceStore.listClaims()
  const claimById = new Map(claims.map((claim) => [claim.id, claim]))
  const spanById = new Map(spans.map((span) => [span.id, span]))
  const sourceById = new Map(sources.map((source) => [source.id, source]))
  const sections = buildSectionEvidenceMap({
    run,
    reportContract: run.reportContract,
    coverageContract: run.coverageContract,
    sources,
    evidenceSpans: spans,
    claims,
    notes: evidenceStore.listNotes(),
    nowIso
  }).filter((section) => section.questionIds.some((questionId) => targetIds.has(questionId)))
  return sections.map((section) => {
    const semanticClaims = new Map<string, {
      spanTexts: Set<string>
      sourceIds: Set<string>
      bestReliability: number
    }>()
    for (const claimId of section.claimIds) {
      const claim = claimById.get(claimId)
      if (!claim) continue
      const semanticKey = normalizeFingerprintText(claim.text)
      if (!semanticKey) continue
      const group = semanticClaims.get(semanticKey) ?? {
        spanTexts: new Set<string>(),
        sourceIds: new Set<string>(),
        bestReliability: 0
      }
      const supportingSources = new Set(claim.supportSpanIds
        .map((spanId) => spanById.get(spanId)?.sourceId)
        .filter((sourceId): sourceId is string => Boolean(sourceId)))
      const bestReliability = [...supportingSources]
        .map((sourceId) => reliabilityRank(sourceById.get(sourceId)?.reliability))
        .reduce((best, value) => Math.max(best, value), 0)
      const spanTexts = claim.supportSpanIds
        .map((spanId) => spanById.get(spanId)?.text ?? '')
        .map(normalizeFingerprintText)
        .filter(Boolean)
      spanTexts.forEach((text) => group.spanTexts.add(text))
      supportingSources.forEach((sourceId) => group.sourceIds.add(sourceId))
      group.bestReliability = Math.max(group.bestReliability, bestReliability)
      semanticClaims.set(semanticKey, group)
    }
    const claimSignals = [...semanticClaims.entries()].map(([semanticKey, group]) => [
      semanticKey,
      [...group.spanTexts].sort().join('~'),
      `reliability:${group.bestReliability}`,
      `corroboration:${Math.min(2, group.sourceIds.size)}`
    ].join('::')).sort()
    return [
      section.sectionId,
      section.status,
      section.evidenceMode ?? 'direct',
      ...claimSignals
    ].join('||')
  }).sort().join('##')
}

function verificationRepairState(tasks: ResearchTask[], evidenceFingerprint: string): string {
  const taskFingerprint = tasks
    .map((task) => [
      [...task.questionIds].sort().join(','),
      [...task.sourceTypes].sort().join(',')
    ].join('::'))
    .sort()
    .join('||')
  return `${taskFingerprint}##${evidenceFingerprint}`
}

function reliabilityRank(value: string | undefined): number {
  if (value === 'high') return 3
  if (value === 'medium') return 2
  if (value === 'low') return 1
  return 0
}

function normalizeFingerprintText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/gu, '').replace(/\d+/gu, '#').trim()
}

/**
 * [INPUT]: 依赖连续 ResearchGapVerdict 的合格来源、强证据、claim、必答覆盖和补研任务
 * [OUTPUT]: 对外提供 evaluateResearchProgress 与 applyResearchProgressGuard，只按当前证据门认可的增量计算进展，并按子任务 questionIds/显式范围项独立移除无增量的重复任务、识别相邻或交替检索死循环
 * [POS]: research/runtime 的收敛保护层，替代固定研究轮次和连续空轮次退出条件；弱来源堆积不算进展，其他章节的进展也不能为重复子任务续命
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ResearchGapVerdict, ResearchTask } from '../core/types.js'

export type ResearchProgressAssessment = {
  stalled: boolean
  noProgressTransitions: number
  repeatedTaskTransitions: number
  reason?: string
}

export function evaluateResearchProgress(
  history: ResearchGapVerdict[],
  current: ResearchGapVerdict
): ResearchProgressAssessment {
  const sequence = [...history, current]
  let noProgressTransitions = 0
  let repeatedTaskTransitions = 0

  for (let index = sequence.length - 1; index > 0; index -= 1) {
    const previous = sequence[index - 1]
    const next = sequence[index]
    if (hasMeaningfulEvidenceProgress(previous, next)) break
    noProgressTransitions += 1
  }

  const repeatedFingerprints = repeatedTaskFingerprints(sequence)
  repeatedTaskTransitions = current.followUpTasks.filter((task) => repeatedFingerprints.has(taskFingerprint(task))).length
  const currentSetFingerprint = taskSetFingerprint(current.followUpTasks)
  const noProgressHistory = noProgressTransitions > 0
    ? sequence.slice(Math.max(0, sequence.length - 1 - noProgressTransitions), -1)
    : []
  const repeatedTaskSet = Boolean(currentSetFingerprint) && noProgressHistory.some((verdict) =>
    taskSetFingerprint(verdict.followUpTasks) === currentSetFingerprint
  )
  const everyCurrentTaskRepeated = current.followUpTasks.length > 0 &&
    repeatedTaskTransitions === current.followUpTasks.length

  const repeatedDeadLoop = everyCurrentTaskRepeated || (noProgressTransitions >= 1 && repeatedTaskSet)
  const stalled = repeatedDeadLoop
  return {
    stalled,
    noProgressTransitions,
    repeatedTaskTransitions,
    ...(stalled
      ? {
          reason: '连续补研没有新增满足当前证据门的材料，并且研究任务开始重复或交替回到已执行意图，判定为检索死循环。'
        }
      : {})
  }
}

export function applyResearchProgressGuard(
  history: ResearchGapVerdict[],
  current: ResearchGapVerdict
): { verdict: ResearchGapVerdict; assessment: ResearchProgressAssessment } {
  const knownExhaustedQuestionIds = new Set(history.flatMap((verdict) => verdict.exhaustedQuestionIds ?? []))
  const previouslyExhaustedTasks = current.followUpTasks.filter((task) =>
    task.questionIds.length > 0 && task.questionIds.every((questionId) => knownExhaustedQuestionIds.has(questionId))
  )
  const guardedCurrent: ResearchGapVerdict = previouslyExhaustedTasks.length > 0
    ? {
        ...current,
        followUpTasks: current.followUpTasks.filter((task) => !previouslyExhaustedTasks.includes(task)),
        exhaustedQuestionIds: uniqueQuestionIds([
          ...knownExhaustedQuestionIds,
          ...(current.exhaustedQuestionIds ?? [])
        ])
      }
    : current
  if ((current.status === 'need_more' || current.status === 'needs_research_repair') &&
    current.followUpTasks.length > 0 && guardedCurrent.followUpTasks.length === 0) {
    const assessment: ResearchProgressAssessment = {
      stalled: true,
      noProgressTransitions: 0,
      repeatedTaskTransitions: previouslyExhaustedTasks.length,
      reason: '当前补研任务只包含历史已穷尽问题，继续检索不会改变结论。'
    }
    return {
      verdict: {
        ...guardedCurrent,
        status: 'unanswerable',
        confidence: 'low',
        stopReason: assessment.reason!,
        followUpTasks: []
      },
      assessment
    }
  }
  const assessment = evaluateResearchProgress(history, guardedCurrent)
  if (guardedCurrent.status !== 'need_more' && guardedCurrent.status !== 'needs_research_repair') {
    return { verdict: guardedCurrent, assessment }
  }
  if (!assessment.stalled) {
    const repeatedFingerprints = repeatedTaskFingerprints([...history, guardedCurrent])
    const repeatedTasks = guardedCurrent.followUpTasks.filter((task) => repeatedFingerprints.has(taskFingerprint(task)))
    const followUpTasks = guardedCurrent.followUpTasks.filter((task) => !repeatedFingerprints.has(taskFingerprint(task)))
    if (followUpTasks.length === guardedCurrent.followUpTasks.length && guardedCurrent === current) {
      return { verdict: current, assessment }
    }
    return {
      verdict: {
        ...guardedCurrent,
        stopReason: `${guardedCurrent.stopReason} 已移除 ${current.followUpTasks.length - followUpTasks.length} 个没有合格证据增量的重复检索任务。`,
        followUpTasks,
        exhaustedQuestionIds: uniqueQuestionIds([
          ...(guardedCurrent.exhaustedQuestionIds ?? []),
          ...repeatedTasks.flatMap((task) => task.questionIds)
        ])
      },
      assessment
    }
  }
  return {
    verdict: {
      ...guardedCurrent,
      status: 'unanswerable',
      confidence: 'low',
      stopReason: assessment.reason ?? '补充研究没有产生新的可引用证据，已停止重复检索。',
      followUpTasks: [],
      exhaustedQuestionIds: uniqueQuestionIds([
        ...(guardedCurrent.exhaustedQuestionIds ?? []),
        ...guardedCurrent.followUpTasks.flatMap((task) => task.questionIds)
      ])
    },
    assessment
  }
}

function hasMeaningfulEvidenceProgress(previous: ResearchGapVerdict, current: ResearchGapVerdict): boolean {
  if (current.coverageMatrix.coveredRequiredQuestionCount > previous.coverageMatrix.coveredRequiredQuestionCount) return true
  if (!previous.coverageMatrix.disconfirmingEvidenceCovered && current.coverageMatrix.disconfirmingEvidenceCovered) return true

  const currentQuestionCoverage = new Map(current.coverageByQuestion.map((coverage) => [coverage.questionId, coverage]))
  for (const before of previous.coverageByQuestion.filter((coverage) =>
    (coverage.required || coverage.priority === 'high') && !coverage.covered
  )) {
    const after = currentQuestionCoverage.get(before.questionId)
    if (after && questionCoverageAdvanced(before, after)) return true
  }

  const currentTargets = new Map(current.coverageMatrix.comparisonTargets.map((target) => [target.target, target]))
  for (const before of previous.coverageMatrix.comparisonTargets.filter((target) => !target.covered)) {
    const after = currentTargets.get(before.target)
    if (after?.covered) return true
  }

  const currentRequirements = new Map((current.coverageMatrix.explicitRequirements ?? [])
    .map((requirement) => [requirement.requirementId, requirement]))
  for (const before of (previous.coverageMatrix.explicitRequirements ?? []).filter((requirement) => !requirement.covered)) {
    const after = currentRequirements.get(before.requirementId)
    if (after && requirementCoverageAdvanced(before, after)) return true
  }
  return false
}

function taskSetFingerprint(tasks: ResearchTask[]): string {
  return tasks
    .map(taskFingerprint)
    .filter(Boolean)
    .sort()
    .join('||')
}

function repeatedTaskFingerprints(sequence: ResearchGapVerdict[]): Set<string> {
  if (sequence.length < 2) return new Set()
  const current = sequence.at(-1)
  if (!current) return new Set()
  const previousVerdicts = sequence.slice(0, -1)
  const repeated = new Set<string>()
  for (const task of current.followUpTasks) {
    const fingerprint = taskFingerprint(task)
    const previous = [...previousVerdicts].reverse().find((verdict) =>
      verdict.followUpTasks.some((candidate) => taskFingerprint(candidate) === fingerprint)
    )
    if (previous && !hasMeaningfulTaskProgress(previous, current, task)) repeated.add(fingerprint)
  }
  return repeated
}

function hasMeaningfulTaskProgress(
  previous: ResearchGapVerdict,
  current: ResearchGapVerdict,
  task: ResearchTask
): boolean {
  const questionIds = new Set(task.questionIds)
  const currentQuestions = new Map(current.coverageByQuestion.map((coverage) => [coverage.questionId, coverage]))
  for (const before of previous.coverageByQuestion) {
    if (!questionIds.has(before.questionId) || before.covered) continue
    const after = currentQuestions.get(before.questionId)
    if (after && questionCoverageAdvanced(before, after)) return true
  }

  const currentRequirements = new Map((current.coverageMatrix.explicitRequirements ?? [])
    .map((requirement) => [requirement.requirementId, requirement]))
  for (const before of previous.coverageMatrix.explicitRequirements ?? []) {
    if (before.covered || !taskTargetsRequirement(task, questionIds, before)) continue
    const after = currentRequirements.get(before.requirementId)
    if (after && requirementCoverageAdvanced(before, after)) return true
  }

  return false
}

function questionCoverageAdvanced(
  before: ResearchGapVerdict['coverageByQuestion'][number],
  after: ResearchGapVerdict['coverageByQuestion'][number]
): boolean {
  if (after.covered) return true
  if (after.strongWebSourceCount > before.strongWebSourceCount) return true
  if (before.claimCount < before.requiredClaimCount && after.claimCount > before.claimCount) return true
  if (before.sourceCount < before.requiredSourceCount && after.sourceCount > before.sourceCount) return true
  return false
}

function requirementCoverageAdvanced(
  before: NonNullable<ResearchGapVerdict['coverageMatrix']['explicitRequirements']>[number],
  after: NonNullable<ResearchGapVerdict['coverageMatrix']['explicitRequirements']>[number]
): boolean {
  if (after.covered) return true
  const beforeStrongSourceCount = before.strongSourceCount ?? 0
  if (beforeStrongSourceCount < (before.requiredStrongSourceCount ?? 0) &&
    (after.strongSourceCount ?? 0) > beforeStrongSourceCount) return true
  if (before.sourceCount < (before.requiredSourceCount ?? 0) && after.sourceCount > before.sourceCount) return true
  if (before.claimCount < (before.requiredClaimCount ?? 0) && after.claimCount > before.claimCount) return true
  return false
}

function taskTargetsRequirement(
  task: ResearchTask,
  questionIds: Set<string>,
  requirement: NonNullable<ResearchGapVerdict['coverageMatrix']['explicitRequirements']>[number]
): boolean {
  if ((requirement.questionIds ?? []).some((questionId) => questionIds.has(questionId))) return true
  const normalizedLabel = normalizeFingerprintText(requirement.label)
  if (!normalizedLabel) return false
  return normalizeFingerprintText(task.objective).includes(normalizedLabel)
}

function taskFingerprint(task: ResearchTask): string {
  return [
    normalizeFingerprintText(task.objective),
    [...task.questionIds].sort().join(','),
    task.searchHints.map(normalizeFingerprintText).filter(Boolean).sort().join('|')
  ].join('::')
}

function uniqueQuestionIds(questionIds: string[]): string[] {
  return [...new Set(questionIds.filter(Boolean))]
}

function normalizeFingerprintText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/gu, '').replace(/\d+/gu, '#').trim()
}

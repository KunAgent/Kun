/**
 * [INPUT]: 依赖 ResearchSupervisorInput、ReportContract、ResearchBudget、ResearchFrame 和 validateResearchPlan
 * [OUTPUT]: 对外提供 BasicResearchSupervisor，在异常安全上限内按报告必答章节一对一拆分 subagent，分别记录章节 ID 与章节问题所有权并分配来源预算
 * [POS]: research/agents 的研究主管节点，建立不可混用的章节结构/问题责任边界；maxWorkers 只控制并发，初始计划不再按固定研究轮数切分来源，后续由证据进展决定是否补研
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ResearchSupervisor, ResearchSupervisorInput } from './types.js'
import type { ResearchComplexity, ResearchPlan, ResearchPriority, ResearchQuestion, ResearchTask } from '../core/types.js'
import { validateResearchPlan } from '../core/validation.js'

export class BasicResearchSupervisor implements ResearchSupervisor {
  async createInitialPlan(input: ResearchSupervisorInput): Promise<ResearchPlan> {
    const complexity = estimateResearchComplexity(input)
    const orderedQuestions = orderQuestions(input.frame.coreQuestions)
    const taskSourceFloor = initialTaskSourceFloor(input)
    const taskSlots = decideTaskSlots({
      questionCount: orderedQuestions.length,
      highPriorityQuestionCount: orderedQuestions.filter((question) => question.required || question.priority === 'high').length,
      complexity,
      maxSubagents: input.budget.maxSubagents,
      maxSources: input.budget.maxSources,
      taskSourceFloor,
      requiredSectionCount: input.reportContract?.requiredSections.filter((section) => section.required).length ?? 0
    })
    const groups = groupQuestionsByReportSection(input, orderedQuestions, taskSlots)
    const sourceFloors = groups.map((group) => sourceFloorForGroup(input, group))
    const minimumCoverageBudget = sourceFloors.reduce((sum, value) => sum + value, 0)
    const roundSourceBudget = initialRoundSourceBudget(input.budget.targetSources, input.budget.maxSources, minimumCoverageBudget)
    const sourceBudgets = distributeSourceBudget(roundSourceBudget, sourceFloors)
    const tasks = groups.map((group, index) => buildSupervisorTask(input, group, index, sourceBudgets[index] ?? 1))
    const parallelism = Math.min(input.budget.maxWorkers, input.budget.maxSubagents, Math.max(1, tasks.length))
    const plan: ResearchPlan = {
      id: `plan_${input.runId}`,
      runId: input.runId,
      rationale: [
        `Supervisor 按 ${input.budget.preset} preset 拆分任务。`,
        `复杂度判断：${complexity}。`,
        `并行 subagent 上限：${parallelism}。`,
        `核心主线：${input.frame.coreResearchThread}`
      ].join(' '),
      supervisor: {
        preset: input.budget.preset,
        reasoningEffort: input.budget.reasoningEffort,
        complexity,
        parallelism,
        targetSourceCount: input.budget.targetSources,
        rationale: buildSupervisorRationale(input, complexity, tasks.length)
      },
      tasks,
      createdAt: input.nowIso
    }
    validateResearchPlan(plan, input.frame, input.budget.maxSources)
    return plan
  }
}

function estimateResearchComplexity(input: ResearchSupervisorInput): ResearchComplexity {
  const questionCount = input.frame.coreQuestions.length
  const comparisonSignals = [
    ...(input.frame.alternativesToCompare ?? []),
    input.brief.topic,
    input.frame.centralQuestion,
    input.frame.coreResearchThread
  ].join(' ')
  const hasComparison = (input.frame.alternativesToCompare?.length ?? 0) >= 2
    || /对比|比较|区别|差异|异同|相比|\bversus\b|\bvs\.?\b|\bcompare\b|\bcomparison\b|\bdifference\b/iu.test(comparisonSignals)
  const hasDecision = Boolean(input.frame.decisionToSupport || input.frame.targetUserOrActor || input.frame.coreTask)
  if (input.budget.preset === 'deep' || questionCount >= 5 || (hasComparison && hasDecision)) return 'complex'
  if (input.budget.preset === 'standard' || questionCount >= 3 || hasComparison) return 'moderate'
  return 'simple'
}

function decideTaskSlots(input: {
  questionCount: number
  highPriorityQuestionCount: number
  complexity: ResearchComplexity
  maxSubagents: number
  maxSources: number
  taskSourceFloor: number
  requiredSectionCount: number
}): number {
  const complexityFloor = input.complexity === 'complex' ? 5 : input.complexity === 'moderate' ? 3 : 1
  const desired = Math.max(complexityFloor, input.highPriorityQuestionCount, input.requiredSectionCount)
  const sourceBoundedSlots = Math.max(
    1,
    Math.floor(input.maxSources / Math.max(1, input.taskSourceFloor)),
    Math.min(input.requiredSectionCount, input.maxSources)
  )
  return Math.max(1, Math.min(input.questionCount, input.maxSubagents, sourceBoundedSlots, desired))
}

function orderQuestions(questions: ResearchQuestion[]): ResearchQuestion[] {
  return [
    ...questions.filter((question) => question.required || question.priority === 'high'),
    ...questions.filter((question) => !(question.required || question.priority === 'high'))
  ]
}

type SupervisorTaskGroup = {
  questions: ResearchQuestion[]
  reportSectionIds: string[]
  reportQuestionIds: string[]
  reportSectionTitles: string[]
}

function groupQuestionsByReportSection(
  input: ResearchSupervisorInput,
  questions: ResearchQuestion[],
  taskSlots: number
): SupervisorTaskGroup[] {
  const questionById = new Map(questions.map((question) => [question.id, question]))
  const assignedQuestionIds = new Set<string>()
  const sectionGroups = (input.reportContract?.requiredSections ?? []).flatMap((section) => {
    const sectionQuestions = section.questionIds
      .map((questionId) => questionById.get(questionId))
      .filter((question): question is ResearchQuestion => Boolean(question))
      .filter((question) => !assignedQuestionIds.has(question.id))
    sectionQuestions.forEach((question) => assignedQuestionIds.add(question.id))
    if (sectionQuestions.length === 0) return []
    return [{
      questions: sectionQuestions,
      reportSectionIds: [section.id],
      reportQuestionIds: sectionQuestions.map((question) => question.id),
      reportSectionTitles: [section.title]
    }]
  })
  const umbrellaQuestion = umbrellaQuestionCoveredBySections(input, questions, sectionGroups)
  if (umbrellaQuestion && sectionGroups[0] && !assignedQuestionIds.has(umbrellaQuestion.id)) {
    sectionGroups[0].questions.push(umbrellaQuestion)
    assignedQuestionIds.add(umbrellaQuestion.id)
  }
  const boundaryQuestion = questions.find((question) =>
    !assignedQuestionIds.has(question.id) &&
    !question.required &&
    question.priority !== 'high' &&
    /反例|反证|替代解释|边界|限制|争议|风险|limitations?|counterexamples?|boundar(?:y|ies)|risks?|caveats?/iu.test(question.text)
  )
  const lastSectionGroup = sectionGroups.at(-1)
  if (boundaryQuestion && lastSectionGroup && input.budget.preset !== 'deep') {
    lastSectionGroup.questions.push(boundaryQuestion)
    assignedQuestionIds.add(boundaryQuestion.id)
  }
  const unassignedGroups = questions
    .filter((question) => !assignedQuestionIds.has(question.id))
    .filter((question) => sectionGroups.length === 0 || input.budget.preset === 'deep' || question.required || question.priority === 'high')
    .map((question) => ({
      questions: [question],
      reportSectionIds: [] as string[],
      reportQuestionIds: [] as string[],
      reportSectionTitles: [] as string[]
    }))
  const desiredGroups = [...sectionGroups, ...unassignedGroups]
  const buckets = Array.from(
    { length: Math.max(1, Math.min(taskSlots, desiredGroups.length || 1)) },
    () => ({ questions: [], reportSectionIds: [], reportQuestionIds: [], reportSectionTitles: [] } as SupervisorTaskGroup)
  )
  desiredGroups.forEach((group, index) => {
    const bucket = buckets[index % buckets.length]
    if (!bucket) return
    bucket.questions.push(...group.questions)
    bucket.reportSectionIds.push(...group.reportSectionIds)
    bucket.reportQuestionIds.push(...group.reportQuestionIds)
    bucket.reportSectionTitles.push(...group.reportSectionTitles)
  })
  return buckets
    .filter((group) => group.questions.length > 0)
    .map((group) => ({
      questions: uniqueQuestions(group.questions),
      reportSectionIds: [...new Set(group.reportSectionIds)],
      reportQuestionIds: [...new Set(group.reportQuestionIds)],
      reportSectionTitles: [...new Set(group.reportSectionTitles)]
    }))
}

function umbrellaQuestionCoveredBySections(
  input: ResearchSupervisorInput,
  questions: ResearchQuestion[],
  sectionGroups: SupervisorTaskGroup[]
): ResearchQuestion | undefined {
  if (sectionGroups.length < 2) return undefined
  const central = normalizeQuestionText(input.frame.centralQuestion)
  const umbrella = questions.find((question) => normalizeQuestionText(question.text) === central)
  if (!umbrella) return undefined
  const representedQuestionIds = new Set(sectionGroups.flatMap((group) => group.questions.map((question) => question.id)))
  const requiredChildren = questions.filter((question) =>
    question.id !== umbrella.id &&
    (question.required || question.priority === 'high') &&
    /^在「[^」]+」维度/u.test(question.text)
  )
  if (requiredChildren.length < 2 || !requiredChildren.every((question) => representedQuestionIds.has(question.id))) {
    return undefined
  }
  return umbrella
}

function normalizeQuestionText(value: string): string {
  return value.replace(/[\s？?。.!！]+/gu, '').toLowerCase()
}

function uniqueQuestions(questions: ResearchQuestion[]): ResearchQuestion[] {
  const seen = new Set<string>()
  return questions.filter((question) => {
    if (seen.has(question.id)) return false
    seen.add(question.id)
    return true
  })
}

function initialRoundSourceBudget(targetSources: number, maxSources: number, minimumCoverageBudget: number): number {
  const planned = Math.max(1, Math.min(maxSources, Math.ceil(targetSources * 0.7)))
  return Math.max(1, Math.min(maxSources, Math.max(planned, minimumCoverageBudget)))
}

function distributeSourceBudget(totalSources: number, floors: number[]): number[] {
  const safeFloors = floors.length > 0 ? floors.map((floor) => Math.max(1, floor)) : [1]
  const floorTotal = safeFloors.reduce((sum, floor) => sum + floor, 0)
  if (floorTotal <= totalSources) {
    const budgets = [...safeFloors]
    let remaining = totalSources - floorTotal
    let index = 0
    while (remaining > 0) {
      budgets[index % budgets.length] += 1
      remaining -= 1
      index += 1
    }
    return budgets
  }

  const budgets = safeFloors.map(() => 1)
  let remaining = Math.max(0, totalSources - budgets.length)
  const order = safeFloors
    .map((floor, index) => ({ floor, index }))
    .sort((left, right) => right.floor - left.floor || left.index - right.index)
  while (remaining > 0) {
    let changed = false
    for (const item of order) {
      if (remaining <= 0) break
      if ((budgets[item.index] ?? 1) >= item.floor) continue
      budgets[item.index] += 1
      remaining -= 1
      changed = true
    }
    if (!changed) break
  }
  return budgets
}

function sourceFloorForGroup(input: ResearchSupervisorInput, group: SupervisorTaskGroup): number {
  const questions = group.questions
  const sectionCount = Math.max(1, group.reportSectionIds.length)
  if (isComparisonInput(input)) {
    const perSection = input.budget.preset === 'deep' ? 3 : 2
    return perSection * sectionCount
  }
  const hasRequiredCoverage = questions.some((question) => question.required || question.priority === 'high')
  if (!hasRequiredCoverage) return 1
  if (input.budget.preset === 'deep') return 3
  if (input.budget.preset === 'standard') return 2
  return isComparisonInput(input) ? 2 : 1
}

function initialTaskSourceFloor(input: ResearchSupervisorInput): number {
  if (input.budget.maxSources < 2) return 1
  if (!isComparisonInput(input)) return 1
  return input.budget.preset === 'deep' ? 3 : 2
}

function isComparisonInput(input: ResearchSupervisorInput): boolean {
  return (input.frame.alternativesToCompare?.length ?? 0) >= 2
}

function buildSupervisorTask(
  input: ResearchSupervisorInput,
  group: SupervisorTaskGroup,
  index: number,
  maxSources: number
): ResearchTask {
  const questions = group.questions
  const priority = highestPriority(questions)
  const questionText = questions.map((question) => question.text).join('；')
  const focus = group.reportSectionTitles.length > 0
    ? `负责报告章节「${group.reportSectionTitles.join('」「')}」`
    : taskFocus(index)
  return {
    id: `task_${index + 1}`,
    questionIds: questions.map((question) => question.id),
    ...(group.reportSectionIds.length > 0 ? { reportSectionIds: group.reportSectionIds } : {}),
    ...(group.reportQuestionIds.length > 0 ? { reportQuestionIds: group.reportQuestionIds } : {}),
    objective: `${focus}：${questionText}`,
    expectedEvidence: buildTaskEvidence(input, questions, index, group.reportSectionTitles),
    sourceTypes: input.brief.sourcePolicy.allowedSourceTypes,
    searchHints: buildSearchHints(input, questions, index),
    maxSources,
    priority,
    status: 'pending'
  }
}

function highestPriority(questions: ResearchQuestion[]): ResearchPriority {
  if (questions.some((question) => question.priority === 'high' || question.required)) return 'high'
  if (questions.some((question) => question.priority === 'medium')) return 'medium'
  return 'low'
}

function taskFocus(index: number): string {
  return [
    '界定范围和可比口径',
    '收集关键事实、指标和现状证据',
    '解释形成主线的机制和路径',
    '寻找反证、替代解释和边界条件',
    '综合结论、风险和决策启示'
  ][index] ?? '补充未覆盖的关键证据'
}

function buildTaskEvidence(
  input: ResearchSupervisorInput,
  questions: ResearchQuestion[],
  index: number,
  reportSectionTitles: string[] = []
): string[] {
  const base = input.frame.evidenceNeeded.length > 0 ? input.frame.evidenceNeeded : ['可追溯证据片段']
  const focusEvidence = [
    '定义、范围、可比口径、研究对象边界和主要矛盾。',
    '最新事实、关键指标、时间线、案例或原始数据。',
    '能解释因果链、形成过程、结构关系或作用路径的证据。',
    input.frame.disconfirmingEvidenceNeeded.join('；') || '反例、替代解释、争议和边界条件。',
    '能支撑结论、风险判断和行动建议的证据。'
  ][index] ?? '补充缺口证据。'
  return [...new Set([
    ...(reportSectionTitles.length > 0 ? [`只收集能够支撑报告章节「${reportSectionTitles.join('」「')}」独立结论的证据。`] : []),
    focusEvidence,
    ...questions.map((question) => `回答问题：${question.text}`),
    ...base
  ].filter(Boolean))]
}

function buildSearchHints(input: ResearchSupervisorInput, questions: ResearchQuestion[], index: number): string[] {
  const suffixes = [
    '定义 范围 可比口径',
    '数据 指标 现状 最新',
    '原因 机制 路径 趋势',
    '反例 风险 争议 局限',
    '结论 建议 决策 启示'
  ]
  return [...new Set([
    input.brief.topic,
    input.frame.coreResearchThread,
    input.frame.centralQuestion,
    ...questions.map((question) => question.text),
    ...(input.brief.userClarifications ?? []),
    `${input.brief.topic} ${suffixes[index] ?? '证据 来源'}`
  ].map((hint) => hint.trim()).filter(Boolean))]
}

function buildSupervisorRationale(input: ResearchSupervisorInput, complexity: ResearchComplexity, taskCount: number): string {
  return [
    `根据 ${input.budget.reasoningEffort} 推理档位使用 ${input.budget.preset} research preset。`,
    `Supervisor 判断任务复杂度为 ${complexity}，初始拆成 ${taskCount} 个可并行研究任务。`,
    `研究循环按证据增量和重复任务检测收敛；来源总量上限只用于阻止异常失控。`
  ].join('')
}

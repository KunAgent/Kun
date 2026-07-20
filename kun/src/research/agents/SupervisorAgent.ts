/**
 * [INPUT]: 依赖 PlanAgentInput、ResearchBudget、ResearchFrame 和 validateResearchPlan
 * [OUTPUT]: 对外提供 BasicResearchSupervisor，用 preset 和复杂度生成初始并行研究计划
 * [POS]: research/agents 的主管节点，负责拆 subagent 任务和分配来源预算，不负责搜索或写报告
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ResearchSupervisor, ResearchSupervisorInput } from './types.js'
import type { ResearchComplexity, ResearchPlan, ResearchPriority, ResearchQuestion, ResearchTask } from '../core/types.js'
import { validateResearchPlan } from '../core/validation.js'

export class BasicResearchSupervisor implements ResearchSupervisor {
  async createInitialPlan(input: ResearchSupervisorInput): Promise<ResearchPlan> {
    const complexity = estimateResearchComplexity(input)
    const orderedQuestions = orderQuestions(input.frame.coreQuestions)
    const taskSlots = decideTaskSlots({
      questionCount: orderedQuestions.length,
      highPriorityQuestionCount: orderedQuestions.filter((question) => question.required || question.priority === 'high').length,
      complexity,
      maxSubagents: input.budget.maxSubagents,
      maxSources: input.budget.maxSources
    })
    const groups = groupQuestions(orderedQuestions, taskSlots)
    const roundSourceBudget = initialRoundSourceBudget(input.budget.targetSources, input.budget.maxSources, input.budget.maxResearchRounds)
    const sourceBudgets = distributeSourceBudget(roundSourceBudget, groups.length)
    const tasks = groups.map((questions, index) => buildSupervisorTask(input, questions, index, sourceBudgets[index] ?? 1))
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
        maxResearchRounds: input.budget.maxResearchRounds,
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
  const hasComparison = /对比|比较|versus| vs |竞品|差异|中美|公司|行业|市场|投资|战略/i.test(comparisonSignals)
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
}): number {
  const complexityFloor = input.complexity === 'complex' ? 5 : input.complexity === 'moderate' ? 3 : 1
  const desired = Math.max(complexityFloor, input.highPriorityQuestionCount)
  return Math.max(1, Math.min(input.questionCount, input.maxSubagents, input.maxSources, desired))
}

function orderQuestions(questions: ResearchQuestion[]): ResearchQuestion[] {
  return [
    ...questions.filter((question) => question.required || question.priority === 'high'),
    ...questions.filter((question) => !(question.required || question.priority === 'high'))
  ]
}

function groupQuestions(questions: ResearchQuestion[], taskSlots: number): ResearchQuestion[][] {
  const groups = Array.from({ length: taskSlots }, () => [] as ResearchQuestion[])
  questions.forEach((question, index) => {
    groups[index % taskSlots]?.push(question)
  })
  return groups.filter((group) => group.length > 0)
}

function initialRoundSourceBudget(targetSources: number, maxSources: number, maxResearchRounds: number): number {
  if (maxResearchRounds <= 1) return Math.max(1, Math.min(targetSources, maxSources))
  return Math.max(1, Math.min(maxSources, Math.ceil(targetSources * 0.7)))
}

function distributeSourceBudget(totalSources: number, taskCount: number): number[] {
  const safeTaskCount = Math.max(1, taskCount)
  const perTask = Math.max(1, Math.floor(totalSources / safeTaskCount))
  const remainder = Math.max(0, totalSources - perTask * safeTaskCount)
  return Array.from({ length: safeTaskCount }, (_, index) => perTask + (index < remainder ? 1 : 0))
}

function buildSupervisorTask(
  input: ResearchSupervisorInput,
  questions: ResearchQuestion[],
  index: number,
  maxSources: number
): ResearchTask {
  const priority = highestPriority(questions)
  const questionText = questions.map((question) => question.text).join('；')
  return {
    id: `task_${index + 1}`,
    questionIds: questions.map((question) => question.id),
    objective: `${taskFocus(index)}：${questionText}`,
    expectedEvidence: buildTaskEvidence(input, questions, index),
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

function buildTaskEvidence(input: ResearchSupervisorInput, questions: ResearchQuestion[], index: number): string[] {
  const base = input.frame.evidenceNeeded.length > 0 ? input.frame.evidenceNeeded : ['可追溯证据片段']
  const focusEvidence = [
    '定义、范围、可比口径、研究对象边界和主要矛盾。',
    '最新事实、关键指标、时间线、案例或产品/市场数据。',
    '能解释因果链、用户路径、市场结构或技术路径的证据。',
    input.frame.disconfirmingEvidenceNeeded.join('；') || '反例、替代解释、争议和边界条件。',
    '能支撑结论、风险判断和行动建议的证据。'
  ][index] ?? '补充缺口证据。'
  return [...new Set([
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
    `预算上限为 ${input.budget.maxSources} 个来源，目标来源数为 ${input.budget.targetSources}，最多 ${input.budget.maxResearchRounds} 轮 gap loop。`
  ].join('')
}

/**
 * [INPUT]: 依赖 agents/types 的 PlanAgentInput 和 core/validation 的计划校验
 * [OUTPUT]: 对外提供 BasicPlanAgent，按 frame.coreQuestions 生成兼容旧路径的结构化研究计划
 * [POS]: research/agents 的基础计划器，作为 supervisor 之外的简单 fallback
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { PlanAgent, PlanAgentInput } from './types.js'
import type { ResearchPlan, ResearchPriority, ResearchTask } from '../core/types.js'
import { validateResearchPlan } from '../core/validation.js'

export class BasicPlanAgent implements PlanAgent {
  async createPlan(input: PlanAgentInput): Promise<ResearchPlan> {
    const priorityQuestions = input.frame.coreQuestions.filter((question) => question.required || question.priority === 'high')
    const secondaryQuestions = input.frame.coreQuestions.filter((question) => !(question.required || question.priority === 'high'))
    const plannedQuestions = [...priorityQuestions, ...secondaryQuestions]
    const taskQuestions = plannedQuestions.slice(0, Math.max(1, input.budget.maxSources))
    const perTaskSources = Math.max(1, Math.floor(input.budget.maxSources / taskQuestions.length))
    const remainder = Math.max(0, input.budget.maxSources - perTaskSources * taskQuestions.length)
    const tasks: ResearchTask[] = taskQuestions.map((question, index) => ({
      id: `task_${index + 1}`,
      questionIds: [question.id],
      objective: buildTaskObjective(question.text, index),
      expectedEvidence: buildTaskEvidence(input, question.text, index),
      sourceTypes: input.brief.sourcePolicy.allowedSourceTypes,
      searchHints: buildSearchHints(input, question.text, index),
      maxSources: Math.min(perTaskSources + (index < remainder ? 1 : 0), input.budget.maxSources),
      priority: question.priority as ResearchPriority,
      status: 'pending'
    }))

    const plan: ResearchPlan = {
      id: `plan_${input.runId}`,
      runId: input.runId,
      rationale: `计划围绕核心调研主线展开：${input.frame.coreResearchThread}`,
      tasks,
      createdAt: input.nowIso
    }
    validateResearchPlan(plan, input.frame, input.budget.maxSources)
    return plan
  }
}

function buildTaskObjective(question: string, index: number): string {
  const focus = [
    '界定范围和核心问题',
    '收集事实、指标和现状证据',
    '解释形成主线的机制和路径',
    '寻找反证、替代解释和边界条件',
    '综合结论、风险和下一步建议'
  ][index] ?? '补充关键证据'
  return `${focus}：${question}`
}

function buildTaskEvidence(input: PlanAgentInput, question: string, index: number): string[] {
  const base = input.frame.evidenceNeeded.length > 0 ? input.frame.evidenceNeeded : ['可追溯证据片段']
  const focusEvidence = [
    '定义、范围、可比口径和研究对象边界。',
    '最新事实、关键指标、时间线、案例或原始数据。',
    '能解释因果链、形成过程、结构关系或作用路径的证据。',
    input.frame.disconfirmingEvidenceNeeded.join('；') || '反例、替代解释、争议和边界条件。',
    '能支撑结论、风险判断和行动建议的证据。'
  ][index]
  return [...new Set([focusEvidence, ...base].filter(Boolean))]
}

function buildSearchHints(input: PlanAgentInput, question: string, index: number): string[] {
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
    question,
    ...(input.brief.userClarifications ?? []),
    `${input.brief.topic} ${suffixes[index] ?? '证据 来源'}`
  ].map((hint) => hint.trim()).filter(Boolean))]
}

/**
 * [INPUT]: 依赖 core/types 的 ResearchBudget 与 reasoning effort 类型
 * [OUTPUT]: 对外提供 DeepResearch preset 解析、reasoning effort 归一化和异常安全上限合并函数；standard/deep 默认允许每个必答章节独立 subagent，旧轮次字段只接收不执行也不持久化
 * [POS]: research/core 的运行安全策略层，连接 UI 推理档位和 runtime；来源、调用、token、subagent 与总时限只作为失控保护，不作为普通完成门槛
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { DEFAULT_RESEARCH_BUDGET, type ResearchBudget, type ResearchPreset, type ResearchReasoningEffort } from './types.js'

const RESEARCH_REASONING_EFFORTS = new Set<ResearchReasoningEffort>([
  'auto',
  'off',
  'low',
  'medium',
  'high',
  'max'
])

export const RESEARCH_BUDGET_LIMITS = {
  maxWorkers: 8,
  maxSubagents: 16,
  maxSources: 100,
  maxModelCalls: 128,
  maxTotalTokens: 4_000_000,
  timeoutMs: 4 * 60 * 60 * 1000
} as const

const PRESET_BUDGETS: Record<ResearchPreset, ResearchBudget> = {
  quick: {
    preset: 'quick',
    reasoningEffort: 'medium',
    maxWorkers: 2,
    maxSubagents: 2,
    minSources: 4,
    targetSources: 6,
    maxSources: RESEARCH_BUDGET_LIMITS.maxSources,
    maxModelCalls: RESEARCH_BUDGET_LIMITS.maxModelCalls,
    maxTotalTokens: RESEARCH_BUDGET_LIMITS.maxTotalTokens,
    timeoutMs: RESEARCH_BUDGET_LIMITS.timeoutMs
  },
  standard: DEFAULT_RESEARCH_BUDGET,
  deep: {
    preset: 'deep',
    reasoningEffort: 'max',
    maxWorkers: 4,
    maxSubagents: RESEARCH_BUDGET_LIMITS.maxSubagents,
    minSources: 1,
    targetSources: 30,
    maxSources: RESEARCH_BUDGET_LIMITS.maxSources,
    maxModelCalls: RESEARCH_BUDGET_LIMITS.maxModelCalls,
    maxTotalTokens: RESEARCH_BUDGET_LIMITS.maxTotalTokens,
    timeoutMs: RESEARCH_BUDGET_LIMITS.timeoutMs
  }
}

export function normalizeResearchReasoningEffort(value: unknown): ResearchReasoningEffort {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return RESEARCH_REASONING_EFFORTS.has(normalized as ResearchReasoningEffort)
    ? normalized as ResearchReasoningEffort
    : 'high'
}

export function researchPresetForReasoningEffort(effort: ResearchReasoningEffort): ResearchPreset {
  switch (effort) {
    case 'off':
    case 'low':
    case 'medium':
      return 'quick'
    case 'max':
      return 'deep'
    case 'auto':
    case 'high':
      return 'standard'
    default:
      return assertNever(effort)
  }
}

export function resolveResearchBudget(input: Partial<ResearchBudget> & { isComparisonTopic?: boolean } = {}): ResearchBudget {
  const reasoningEffort = normalizeResearchReasoningEffort(input.reasoningEffort)
  let preset = input.preset ?? researchPresetForReasoningEffort(reasoningEffort)
  if (preset === 'quick' && input.isComparisonTopic) {
    preset = 'standard'
  }
  const base = PRESET_BUDGETS[preset] ?? DEFAULT_RESEARCH_BUDGET
  const {
    maxRounds: _legacyMaxRounds,
    maxResearchRounds: _legacyMaxResearchRounds,
    maxSynthesisRetries: _legacyMaxSynthesisRetries,
    ...activeInput
  } = input
  const merged: ResearchBudget = {
    ...base,
    ...activeInput,
    preset,
    reasoningEffort
  }
  return normalizeBudgetNumbers(merged)
}

export function researchReasoningForStage(
  effort: ResearchReasoningEffort,
  stage: 'scope' | 'worker' | 'writer' | 'judge'
): ResearchReasoningEffort {
  if (stage === 'scope') return 'off'
  if (stage === 'worker') {
    if (effort === 'max') return 'medium'
    if (effort === 'high' || effort === 'auto') return 'low'
    return 'off'
  }
  if (stage === 'judge') {
    return 'off'
  }
  if (stage === 'writer') {
    return 'off'
  }
  if (effort === 'auto') return 'high'
  if (effort === 'off') return 'low'
  return effort
}

function normalizeBudgetNumbers(budget: ResearchBudget): ResearchBudget {
  const maxSources = boundedInteger(budget.maxSources, DEFAULT_RESEARCH_BUDGET.maxSources, RESEARCH_BUDGET_LIMITS.maxSources)
  const minSources = Math.min(
    maxSources,
    boundedInteger(budget.minSources, Math.min(DEFAULT_RESEARCH_BUDGET.minSources, maxSources), RESEARCH_BUDGET_LIMITS.maxSources)
  )
  const targetSources = Math.min(
    maxSources,
    Math.max(minSources, boundedInteger(budget.targetSources, Math.min(DEFAULT_RESEARCH_BUDGET.targetSources, maxSources), RESEARCH_BUDGET_LIMITS.maxSources))
  )
  const maxSubagents = boundedInteger(budget.maxSubagents, DEFAULT_RESEARCH_BUDGET.maxSubagents, RESEARCH_BUDGET_LIMITS.maxSubagents)
  const maxWorkers = Math.min(
    maxSubagents,
    boundedInteger(budget.maxWorkers, DEFAULT_RESEARCH_BUDGET.maxWorkers, RESEARCH_BUDGET_LIMITS.maxWorkers)
  )
  return {
    ...budget,
    maxWorkers,
    maxSubagents,
    minSources,
    targetSources,
    maxSources,
    maxModelCalls: boundedInteger(budget.maxModelCalls, DEFAULT_RESEARCH_BUDGET.maxModelCalls, RESEARCH_BUDGET_LIMITS.maxModelCalls),
    maxTotalTokens: boundedInteger(budget.maxTotalTokens, DEFAULT_RESEARCH_BUDGET.maxTotalTokens, RESEARCH_BUDGET_LIMITS.maxTotalTokens),
    timeoutMs: boundedInteger(budget.timeoutMs, DEFAULT_RESEARCH_BUDGET.timeoutMs, RESEARCH_BUDGET_LIMITS.timeoutMs)
  }
}

function boundedInteger(value: number, fallback: number, maximum: number): number {
  return Number.isInteger(value) && value > 0 ? Math.min(value, maximum) : fallback
}

function assertNever(value: never): never {
  throw new Error(`Unhandled research reasoning effort: ${String(value)}`)
}

/**
 * [INPUT]: 依赖 core/types 的 ResearchBudget 与 reasoning effort 类型
 * [OUTPUT]: 对外提供 DeepResearch preset 解析、reasoning effort 归一化和预算合并函数
 * [POS]: research/core 的预算策略层，连接 UI 推理档位和 runtime 硬预算
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

const PRESET_BUDGETS: Record<ResearchPreset, ResearchBudget> = {
  quick: {
    preset: 'quick',
    reasoningEffort: 'medium',
    maxWorkers: 2,
    maxSubagents: 2,
    maxRounds: 2,
    maxResearchRounds: 1,
    maxSynthesisRetries: 2,
    minSources: 6,
    targetSources: 10,
    maxSources: 15,
    timeoutMs: 4 * 60 * 1000
  },
  standard: DEFAULT_RESEARCH_BUDGET,
  deep: {
    preset: 'deep',
    reasoningEffort: 'max',
    maxWorkers: 6,
    maxSubagents: 8,
    maxRounds: 3,
    maxResearchRounds: 4,
    maxSynthesisRetries: 3,
    minSources: 35,
    targetSources: 70,
    maxSources: 100,
    timeoutMs: 20 * 60 * 1000
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

export function resolveResearchBudget(input: Partial<ResearchBudget> = {}): ResearchBudget {
  const reasoningEffort = normalizeResearchReasoningEffort(input.reasoningEffort)
  const preset = input.preset ?? researchPresetForReasoningEffort(reasoningEffort)
  const base = PRESET_BUDGETS[preset] ?? DEFAULT_RESEARCH_BUDGET
  const merged: ResearchBudget = {
    ...base,
    ...input,
    preset,
    reasoningEffort,
    maxRounds: input.maxRounds ?? input.maxSynthesisRetries ?? base.maxRounds,
    maxResearchRounds: input.maxResearchRounds ?? base.maxResearchRounds,
    maxSynthesisRetries: input.maxSynthesisRetries ?? input.maxRounds ?? base.maxSynthesisRetries
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
  if (effort === 'auto') return 'high'
  if (effort === 'off') return 'low'
  return effort
}

function normalizeBudgetNumbers(budget: ResearchBudget): ResearchBudget {
  const maxSources = positiveInteger(budget.maxSources, DEFAULT_RESEARCH_BUDGET.maxSources)
  const minSources = Math.min(
    maxSources,
    positiveInteger(budget.minSources, Math.min(DEFAULT_RESEARCH_BUDGET.minSources, maxSources))
  )
  const targetSources = Math.min(
    maxSources,
    Math.max(minSources, positiveInteger(budget.targetSources, Math.min(DEFAULT_RESEARCH_BUDGET.targetSources, maxSources)))
  )
  const maxWorkers = positiveInteger(budget.maxWorkers, DEFAULT_RESEARCH_BUDGET.maxWorkers)
  const maxSubagents = Math.max(1, positiveInteger(budget.maxSubagents, maxWorkers))
  const maxSynthesisRetries = positiveInteger(budget.maxSynthesisRetries, positiveInteger(budget.maxRounds, DEFAULT_RESEARCH_BUDGET.maxSynthesisRetries))
  return {
    ...budget,
    maxWorkers,
    maxSubagents,
    maxRounds: positiveInteger(budget.maxRounds, maxSynthesisRetries),
    maxResearchRounds: positiveInteger(budget.maxResearchRounds, DEFAULT_RESEARCH_BUDGET.maxResearchRounds),
    maxSynthesisRetries,
    minSources,
    targetSources,
    maxSources,
    timeoutMs: positiveInteger(budget.timeoutMs, DEFAULT_RESEARCH_BUDGET.timeoutMs)
  }
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function assertNever(value: never): never {
  throw new Error(`Unhandled research reasoning effort: ${String(value)}`)
}

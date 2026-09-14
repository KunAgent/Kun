import type { MemoryRecord } from '../contracts/memory.js'
import { memoryInScope, memoryLifecycleState } from './memory-ranking.js'
import type { SemanticMemoryEvaluationQueryInput } from './semantic-memory-evaluation.js'

export type SemanticMemoryV3EvaluatorInput = {
  query: SemanticMemoryEvaluationQueryInput
  records: readonly MemoryRecord[]
  limit: number
  promptCharacterBudget: number
  nowIso: string
  scopeExcluded: ReadonlySet<string>
  lifecycleExcluded: ReadonlySet<string>
}

export function prepareSemanticMemoryV3EvaluatorInput(input: {
  records: readonly MemoryRecord[]
  query: SemanticMemoryEvaluationQueryInput
  limit: number
  promptCharacterBudget: number
  nowIso: string
}): SemanticMemoryV3EvaluatorInput {
  const scoped = input.records.filter((record) => memoryInScope(record, input.query))
  const lifecycleEligible = scoped.filter((record) => memoryLifecycleState(record, Date.parse(input.nowIso)) === 'active')
  const supersededIds = new Set(lifecycleEligible.flatMap((record) => record.supersedes ? [record.supersedes] : []))
  const eligible = lifecycleEligible
    .filter((record) => !supersededIds.has(record.id))
    .sort((left, right) => left.id.localeCompare(right.id))

  return {
    query: input.query,
    records: eligible,
    limit: input.limit,
    promptCharacterBudget: input.promptCharacterBudget,
    nowIso: input.nowIso,
    scopeExcluded: new Set(input.records.filter((record) => !memoryInScope(record, input.query)).map((record) => record.id)),
    lifecycleExcluded: new Set(scoped.filter((record) => !eligible.includes(record)).map((record) => record.id))
  }
}

import { performance } from 'node:perf_hooks'
import type { MemoryRecord } from '../contracts/memory.js'
import type { MemoryRetrievalFixtureCase } from './memory-retrieval-fixtures.js'

export type MemoryEvaluationMetrics = {
  recallAtK: number
  precisionAtK: number
  meanReciprocalRank: number
  scopeLeaks: number
  selectedCharacters: number
  latencyMs: number
  queryCount: number
}

export async function scoreMemoryRetrievalEvaluation(input: {
  records: readonly MemoryRecord[]
  cases: readonly MemoryRetrievalFixtureCase[]
  retrieve: (query: MemoryRetrievalFixtureCase, records: readonly MemoryRecord[]) => Promise<readonly MemoryRecord[]>
}): Promise<MemoryEvaluationMetrics> {
  let recall = 0
  let precision = 0
  let reciprocalRank = 0
  let scopeLeaks = 0
  let selectedCharacters = 0
  const started = performance.now()

  for (const fixture of input.cases) {
    const selected = await input.retrieve(fixture, input.records)
    const ids = selected.map((record) => record.id)
    const expected = new Set(fixture.expectedIds)
    const relevantSelected = ids.filter((id) => expected.has(id)).length
    recall += expected.size === 0 ? 1 : relevantSelected / expected.size
    precision += ids.length === 0 ? (expected.size === 0 ? 1 : 0) : relevantSelected / ids.length
    const firstRelevant = ids.findIndex((id) => expected.has(id))
    reciprocalRank += expected.size === 0 ? 1 : firstRelevant < 0 ? 0 : 1 / (firstRelevant + 1)
    scopeLeaks += ids.filter((id) => fixture.forbiddenIds.includes(id)).length
    selectedCharacters += selected.reduce((total, record) => total + record.content.length, 0)
  }
  const queryCount = input.cases.length
  return {
    recallAtK: round(recall / queryCount),
    precisionAtK: round(precision / queryCount),
    meanReciprocalRank: round(reciprocalRank / queryCount),
    scopeLeaks,
    selectedCharacters,
    latencyMs: round(performance.now() - started),
    queryCount
  }
}

export function formatMemoryEvaluationReport(input: {
  baseline: MemoryEvaluationMetrics
  foundation: MemoryEvaluationMetrics
  rankingWeights: Readonly<Record<string, number>>
}): string {
  return JSON.stringify({
    dataset: 'checked-in-anonymous-fixtures',
    rankingWeights: input.rankingWeights,
    baseline: input.baseline,
    foundation: input.foundation
  }, null, 2)
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000
}

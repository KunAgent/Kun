import type { MemoryRecord } from '../contracts/memory.js'
import { memoryInScope, memoryLifecycleState } from './memory-ranking.js'
import type { MemoryFeedbackTiebreakerFixture } from './memory-feedback-tiebreaker-contracts.js'

type FixtureCase = MemoryFeedbackTiebreakerFixture['cases'][number]

export type MemoryFeedbackTiebreakerScoredRanking = {
  memoryId: string
}

export type MemoryFeedbackTiebreakerScoredCase = {
  caseId: string
  rankings: MemoryFeedbackTiebreakerScoredRanking[]
  selectedIds: string[]
}

export type MemoryFeedbackTiebreakerCaseMetrics = {
  caseId: string
  pairCorrect?: number
  recallAtK?: number
  precisionAtK?: number
  reciprocalRank?: number
  abstentionCorrect?: number
  explicitForbiddenSelections: number
  authorizationOrLifecycleViolations: number
}

export type MemoryFeedbackTiebreakerMetrics = {
  pairAccuracy: number
  pairCount: number
  recallAtK: number
  precisionAtK: number
  meanReciprocalRank: number
  abstentionAccuracy: number
  explicitForbiddenSelections: number
  authorizationOrLifecycleViolations: number
  rankedCaseCount: number
  noResultCaseCount: number
  caseCount: number
}

const LOCAL_BENEFIT_STRATA = new Set<FixtureCase['stratum']>([
  'confirmed-near-tie',
  'corrected-replacement-near-tie'
])

export function scoreMemoryFeedbackTiebreakerCases(input: {
  fixture: MemoryFeedbackTiebreakerFixture
  results: readonly MemoryFeedbackTiebreakerScoredCase[]
}): { cases: MemoryFeedbackTiebreakerCaseMetrics[]; metrics: MemoryFeedbackTiebreakerMetrics } {
  const casesById = new Map(input.fixture.cases.map((item) => [item.id, item]))
  const records = new Map(input.fixture.records.map((record) => [record.id, record]))
  const nowMs = Date.parse(input.fixture.evaluationNow)
  const cases = input.results.map((result) => {
    const item = casesById.get(result.caseId)
    if (!item) throw new Error(`unknown tiebreaker result case: ${result.caseId}`)
    return scoreCase(item, result, records, nowMs)
  })
  return { cases, metrics: summarize(cases) }
}

function scoreCase(
  item: FixtureCase,
  result: MemoryFeedbackTiebreakerScoredCase,
  records: ReadonlyMap<string, MemoryRecord>,
  nowMs: number
): MemoryFeedbackTiebreakerCaseMetrics {
  const expected = new Set(item.expectedIds)
  const relevantSelected = result.selectedIds.filter((id) => expected.has(id)).length
  const firstRelevant = result.selectedIds.findIndex((id) => expected.has(id))
  const ranked = expected.size > 0
  const pairScores = LOCAL_BENEFIT_STRATA.has(item.stratum)
    ? item.preferredPairs.map((pair) => preferredPairScore(result.rankings, pair))
    : []
  const violations = result.selectedIds.filter((id) => {
    const record = records.get(id)
    return !record || !memoryInScope(record, { workspace: item.workspace }) ||
      memoryLifecycleState(record, nowMs) !== 'active'
  }).length

  return {
    caseId: item.id,
    ...(pairScores.length > 0 ? { pairCorrect: average(pairScores) } : {}),
    ...(ranked ? {
      recallAtK: relevantSelected / expected.size,
      precisionAtK: result.selectedIds.length === 0 ? 0 : relevantSelected / result.selectedIds.length,
      reciprocalRank: firstRelevant < 0 ? 0 : 1 / (firstRelevant + 1)
    } : { abstentionCorrect: result.selectedIds.length === 0 ? 1 : 0 }),
    explicitForbiddenSelections: result.selectedIds.filter((id) => item.forbiddenIds.includes(id)).length,
    authorizationOrLifecycleViolations: violations
  }
}

function preferredPairScore(
  rankings: readonly MemoryFeedbackTiebreakerScoredRanking[],
  pair: FixtureCase['preferredPairs'][number]
): number {
  const preferred = rankings.findIndex((ranking) => ranking.memoryId === pair.preferredId)
  const other = rankings.findIndex((ranking) => ranking.memoryId === pair.otherId)
  if (preferred < 0 || other < 0) return 0
  return preferred < other ? 1 : 0
}

function summarize(cases: readonly MemoryFeedbackTiebreakerCaseMetrics[]): MemoryFeedbackTiebreakerMetrics {
  const pairs = cases.flatMap((item) => item.pairCorrect === undefined ? [] : [item.pairCorrect])
  const ranked = cases.filter((item) => item.recallAtK !== undefined)
  const noResult = cases.filter((item) => item.abstentionCorrect !== undefined)
  return {
    pairAccuracy: round(average(pairs)),
    pairCount: pairs.length,
    recallAtK: round(average(ranked.map((item) => item.recallAtK!))),
    precisionAtK: round(average(ranked.map((item) => item.precisionAtK!))),
    meanReciprocalRank: round(average(ranked.map((item) => item.reciprocalRank!))),
    abstentionAccuracy: round(average(noResult.map((item) => item.abstentionCorrect!))),
    explicitForbiddenSelections: sum(cases.map((item) => item.explicitForbiddenSelections)),
    authorizationOrLifecycleViolations: sum(cases.map((item) => item.authorizationOrLifecycleViolations)),
    rankedCaseCount: ranked.length,
    noResultCaseCount: noResult.length,
    caseCount: cases.length
  }
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

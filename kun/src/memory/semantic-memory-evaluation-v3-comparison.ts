import {
  pairedBootstrapInterval,
  type SemanticMemoryBootstrapInterval
} from './semantic-memory-evaluation-comparison.js'
import type {
  SemanticMemoryEvaluationReport,
  SemanticMemoryQueryResult
} from './semantic-memory-evaluation.js'

export type SemanticMemoryV3PairedComparisonReport = {
  schemaVersion: 3
  reportKind: 'v3-paired-candidate-comparison'
  dataset: SemanticMemoryEvaluationReport['dataset']
  baselineCandidateId: string
  candidateId: string
  results: Array<{
    queryId: string
    split: SemanticMemoryQueryResult['split']
    category: string
    expectedCount: number
    zeroOverlapPositive: boolean
    recallAtKDelta?: number
    precisionAtKDelta?: number
    reciprocalRankDelta?: number
    abstentionCorrectDelta?: number
    falsePositiveSelectionsDelta: number
    explicitForbiddenSelectionsDelta: number
  }>
  metrics: {
    recallAtKDelta: SemanticMemoryBootstrapInterval
    precisionAtKDelta: SemanticMemoryBootstrapInterval
    meanReciprocalRankDelta: SemanticMemoryBootstrapInterval
    zeroOverlapRecallAtKDelta: SemanticMemoryBootstrapInterval
    falsePositiveSelectionsDelta: SemanticMemoryBootstrapInterval
    explicitForbiddenSelectionsDelta: SemanticMemoryBootstrapInterval
    abstentionAccuracyDelta: number
    abstentionSampleSize: number
    zeroOverlapSampleSize: number
  }
}

export function compareSemanticMemoryV3EvaluationReports(input: {
  baseline: SemanticMemoryEvaluationReport
  candidate: SemanticMemoryEvaluationReport
  zeroOverlapQueryIds: ReadonlySet<string>
  bootstrap: {
    method: 'paired-percentile'
    seed: number
    resamples: number
    confidenceLevel: number
  }
}): SemanticMemoryV3PairedComparisonReport {
  assertComparableReports(input.baseline, input.candidate)
  const candidateByQuery = new Map(input.candidate.results.map((result) => [result.queryId, result]))
  for (const queryId of input.zeroOverlapQueryIds) {
    if (!candidateByQuery.has(queryId)) throw new Error(`zero-overlap query is missing from candidate report: ${queryId}`)
  }
  const results = input.baseline.results.map((baseline) => {
    const candidate = candidateByQuery.get(baseline.queryId)
    if (!candidate) throw new Error(`candidate report is missing query: ${baseline.queryId}`)
    if (candidate.expectedCount !== baseline.expectedCount || candidate.category !== baseline.category) {
      throw new Error(`candidate query metadata mismatch: ${baseline.queryId}`)
    }
    return pairedResult(baseline, candidate, input.zeroOverlapQueryIds.has(baseline.queryId))
  })
  const recallDeltas = results.flatMap((result) => result.recallAtKDelta === undefined ? [] : [result.recallAtKDelta])
  const precisionDeltas = results.flatMap((result) => result.precisionAtKDelta === undefined ? [] : [result.precisionAtKDelta])
  const reciprocalRankDeltas = results.flatMap((result) => result.reciprocalRankDelta === undefined ? [] : [result.reciprocalRankDelta])
  const zeroOverlapRecallDeltas = results.flatMap((result) =>
    result.zeroOverlapPositive && result.recallAtKDelta !== undefined ? [result.recallAtKDelta] : []
  )
  const abstentionDeltas = results.flatMap((result) =>
    result.abstentionCorrectDelta === undefined ? [] : [result.abstentionCorrectDelta]
  )
  const falsePositiveDeltas = results.map((result) => result.falsePositiveSelectionsDelta)
  const forbiddenDeltas = results.map((result) => result.explicitForbiddenSelectionsDelta)
  return {
    schemaVersion: 3,
    reportKind: 'v3-paired-candidate-comparison',
    dataset: input.baseline.dataset,
    baselineCandidateId: input.baseline.candidate.id,
    candidateId: input.candidate.candidate.id,
    results,
    metrics: {
      recallAtKDelta: pairedBootstrapInterval(recallDeltas, input.bootstrap),
      precisionAtKDelta: pairedBootstrapInterval(precisionDeltas, input.bootstrap),
      meanReciprocalRankDelta: pairedBootstrapInterval(reciprocalRankDeltas, input.bootstrap),
      zeroOverlapRecallAtKDelta: pairedBootstrapInterval(zeroOverlapRecallDeltas, input.bootstrap),
      falsePositiveSelectionsDelta: pairedBootstrapInterval(falsePositiveDeltas, input.bootstrap),
      explicitForbiddenSelectionsDelta: pairedBootstrapInterval(forbiddenDeltas, input.bootstrap),
      abstentionAccuracyDelta: average(abstentionDeltas),
      abstentionSampleSize: abstentionDeltas.length,
      zeroOverlapSampleSize: zeroOverlapRecallDeltas.length
    }
  }
}

function pairedResult(
  baseline: SemanticMemoryQueryResult,
  candidate: SemanticMemoryQueryResult,
  zeroOverlapPositive: boolean
): SemanticMemoryV3PairedComparisonReport['results'][number] {
  const ranked = baseline.expectedCount > 0
  return {
    queryId: baseline.queryId,
    split: baseline.split,
    category: baseline.category,
    expectedCount: baseline.expectedCount,
    zeroOverlapPositive,
    ...(ranked ? {
      recallAtKDelta: round((candidate.recallAtK ?? 0) - (baseline.recallAtK ?? 0)),
      precisionAtKDelta: round((candidate.precisionAtK ?? 0) - (baseline.precisionAtK ?? 0)),
      reciprocalRankDelta: round((candidate.reciprocalRank ?? 0) - (baseline.reciprocalRank ?? 0))
    } : {
      abstentionCorrectDelta: Number(candidate.abstentionCorrect ?? false) - Number(baseline.abstentionCorrect ?? false)
    }),
    falsePositiveSelectionsDelta: candidate.falsePositiveSelections - baseline.falsePositiveSelections,
    explicitForbiddenSelectionsDelta: candidate.explicitForbiddenSelections - baseline.explicitForbiddenSelections
  }
}

function assertComparableReports(
  baseline: SemanticMemoryEvaluationReport,
  candidate: SemanticMemoryEvaluationReport
): void {
  const fields: Array<keyof SemanticMemoryEvaluationReport['dataset']> = [
    'id', 'recordsSha256', 'queriesSha256', 'scoringVersion', 'evaluationNow', 'limit', 'promptCharacterBudget'
  ]
  const mismatches = fields.filter((field) => baseline.dataset[field] !== candidate.dataset[field])
  if (mismatches.length > 0) throw new Error(`v3 candidate comparison dataset mismatch: ${mismatches.join(', ')}`)
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000
}

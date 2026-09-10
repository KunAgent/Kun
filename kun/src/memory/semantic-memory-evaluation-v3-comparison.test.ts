import { describe, expect, it } from 'vitest'
import type { SemanticMemoryEvaluationReport } from './semantic-memory-evaluation.js'
import { compareSemanticMemoryV3EvaluationReports } from './semantic-memory-evaluation-v3-comparison.js'

describe('semantic Memory v3 paired comparison', () => {
  it('reports aggregate and zero-overlap paired deltas separately', () => {
    const baseline = report('lexical', [
      result('q001', 'cross-lingual-zero-overlap-positive', 1, 0, 0),
      result('q002', 'irrelevant-no-evidence', 0, undefined, undefined, false)
    ])
    const candidate = report('lexical-veto', [
      result('q001', 'cross-lingual-zero-overlap-positive', 1, 1, 1),
      result('q002', 'irrelevant-no-evidence', 0, undefined, undefined, true)
    ])

    const comparisonInput = {
      baseline,
      candidate,
      zeroOverlapQueryIds: new Set(['q001']),
      bootstrap: { method: 'paired-percentile', seed: 7, resamples: 100, confidenceLevel: 0.95 }
    } as const
    const comparison = compareSemanticMemoryV3EvaluationReports(comparisonInput)
    const repeated = compareSemanticMemoryV3EvaluationReports(comparisonInput)

    expect(comparison.metrics.recallAtKDelta.pointEstimate).toBe(1)
    expect(comparison.metrics.precisionAtKDelta.pointEstimate).toBe(1)
    expect(comparison.metrics.precisionAtKDelta.sampleSize).toBe(1)
    expect(comparison.metrics.zeroOverlapRecallAtKDelta.pointEstimate).toBe(1)
    expect(comparison.metrics.falsePositiveSelectionsDelta.pointEstimate).toBe(0)
    expect(comparison.metrics.explicitForbiddenSelectionsDelta.pointEstimate).toBe(0)
    expect(comparison.metrics.abstentionAccuracyDelta).toBe(1)
    expect(comparison.metrics.zeroOverlapSampleSize).toBe(1)
    expect(repeated.metrics).toEqual(comparison.metrics)
  })

  it('rejects mismatched datasets and missing zero-overlap ids', () => {
    const baseline = report('lexical', [result('q001', 'cross-lingual-zero-overlap-positive', 1, 0, 0)])
    const candidate = report('semantic', [result('q001', 'cross-lingual-zero-overlap-positive', 1, 1, 1)])

    expect(() => compareSemanticMemoryV3EvaluationReports({
      baseline: { ...baseline, dataset: { ...baseline.dataset, queriesSha256: 'c'.repeat(64) } },
      candidate,
      zeroOverlapQueryIds: new Set(['q001']),
      bootstrap: { method: 'paired-percentile', seed: 7, resamples: 10, confidenceLevel: 0.95 }
    })).toThrow('dataset mismatch')
    expect(() => compareSemanticMemoryV3EvaluationReports({
      baseline,
      candidate,
      zeroOverlapQueryIds: new Set(['missing']),
      bootstrap: { method: 'paired-percentile', seed: 7, resamples: 10, confidenceLevel: 0.95 }
    })).toThrow('zero-overlap query')
  })
})

function report(candidateId: string, results: SemanticMemoryEvaluationReport['results']): SemanticMemoryEvaluationReport {
  return {
    dataset: {
      id: 'v3-fixture',
      recordsSha256: 'a'.repeat(64),
      queriesSha256: 'b'.repeat(64),
      scoringVersion: 3,
      evaluationNow: '2026-09-01T00:00:00.000Z',
      limit: 5,
      promptCharacterBudget: 8_000
    },
    candidate: {
      id: candidateId,
      kind: 'hybrid',
      version: 'v3-test',
      runtime: 'offline-test',
      license: 'repository',
      parameters: {},
      platforms: ['win32-x64']
    },
    results,
    metrics: {} as SemanticMemoryEvaluationReport['metrics'],
    breakdowns: { split: {}, language: {}, category: {} },
    safetyGatePassed: true,
    networkAttempts: 0,
    fallbackMismatches: 0
  }
}

function result(
  queryId: string,
  category: string,
  expectedCount: number,
  recallAtK?: number,
  reciprocalRank?: number,
  abstentionCorrect?: boolean
): SemanticMemoryEvaluationReport['results'][number] {
  return {
    queryId,
    split: 'development',
    queryLanguage: 'en',
    category,
    expectedCount,
    selectedIds: [],
    ...(expectedCount > 0 ? { recallAtK, precisionAtK: recallAtK, reciprocalRank } : { abstentionCorrect }),
    falsePositiveSelections: 0,
    explicitForbiddenSelections: 0,
    scopeLeaks: 0,
    lifecycleLeaks: 0,
    authorityViolations: 0,
    unknownSelections: 0,
    selectedCharacters: 0,
    eligibleRecordCount: 1,
    latencyMs: 0
  }
}

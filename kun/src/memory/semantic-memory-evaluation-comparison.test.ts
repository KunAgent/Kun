import { describe, expect, it } from 'vitest'
import {
  compareSemanticMemoryEvaluationReports,
  pairedBootstrapInterval,
  SemanticMemoryPairedComparisonReportSchema
} from './semantic-memory-evaluation-comparison.js'
import type {
  SemanticMemoryEvaluationReport,
  SemanticMemoryQueryResult
} from './semantic-memory-evaluation.js'
import {
  createLexicalSemanticMemoryCandidate,
  runSemanticMemoryEvaluation
} from './semantic-memory-evaluation.js'
import { loadSemanticMemoryV2EvaluationDataset } from './semantic-memory-evaluation-v2-dataset.js'

describe('semantic Memory paired comparison', () => {
  it('keeps ranked deltas and abstention deltas in separate populations', () => {
    const baseline = report('baseline', 'lexical', [
      ranked('q1', 0, 0),
      ranked('q2', 0.5, 0.5),
      empty('q3', false)
    ])
    const candidate = report('candidate', 'hybrid', [
      ranked('q1', 0.5, 0.25),
      ranked('q2', 1, 1),
      empty('q3', true)
    ])

    const comparison = compareSemanticMemoryEvaluationReports({
      baseline,
      candidate,
      bootstrap: { method: 'paired-percentile', seed: 17, resamples: 1_000, confidenceLevel: 0.95 }
    })

    expect(comparison.results).toEqual([
      expect.objectContaining({ queryId: 'q1', recallAtKDelta: 0.5, reciprocalRankDelta: 0.25 }),
      expect.objectContaining({ queryId: 'q2', recallAtKDelta: 0.5, reciprocalRankDelta: 0.5 }),
      expect.objectContaining({ queryId: 'q3', abstentionCorrectDelta: 1 })
    ])
    expect(comparison.metrics.recallAtKDelta.sampleSize).toBe(2)
    expect(comparison.metrics.recallAtKDelta.pointEstimate).toBe(0.5)
    expect(comparison.metrics.meanReciprocalRankDelta.pointEstimate).toBe(0.375)
    expect(comparison.metrics.abstentionSampleSize).toBe(1)
    expect(comparison.metrics.abstentionAccuracyDelta).toBe(1)
  })

  it('produces deterministic intervals with recorded bootstrap metadata', () => {
    const options = { method: 'paired-percentile' as const, seed: 20260909, resamples: 10_000, confidenceLevel: 0.95 }
    const first = pairedBootstrapInterval([0.5, 0.5, 0, -0.25], options)
    const second = pairedBootstrapInterval([0.5, 0.5, 0, -0.25], options)

    expect(first).toEqual(second)
    expect(first).toEqual({
      method: 'paired-percentile',
      pointEstimate: 0.1875,
      lowerBound: -0.125,
      upperBound: 0.5,
      confidenceLevel: 0.95,
      seed: 20260909,
      resamples: 10_000,
      sampleSize: 4
    })
  })

  it('returns an explicit zero-sized interval for no ranked queries', () => {
    expect(pairedBootstrapInterval([], {
      method: 'paired-percentile',
      seed: 0,
      resamples: 10,
      confidenceLevel: 0.9
    })).toEqual({
      method: 'paired-percentile',
      pointEstimate: 0,
      lowerBound: 0,
      upperBound: 0,
      confidenceLevel: 0.9,
      seed: 0,
      resamples: 10,
      sampleSize: 0
    })
  })

  it('rejects non-finite deltas and invalid bootstrap options', () => {
    expect(() => pairedBootstrapInterval([Number.NaN], {
      method: 'paired-percentile',
      seed: 1,
      resamples: 10,
      confidenceLevel: 0.95
    })).toThrow('must be finite')
    expect(() => pairedBootstrapInterval([0], {
      method: 'paired-percentile',
      seed: 1,
      resamples: 0,
      confidenceLevel: 0.95
    })).toThrow()
  })

  it('rejects mismatched datasets, queries, and non-lexical baselines', () => {
    const baseline = report('baseline', 'lexical', [ranked('q1', 0, 0)])
    const candidate = report('candidate', 'hybrid', [ranked('q1', 1, 1)])
    const input = {
      baseline,
      candidate,
      bootstrap: { method: 'paired-percentile' as const, seed: 1, resamples: 10, confidenceLevel: 0.95 }
    }

    expect(() => compareSemanticMemoryEvaluationReports({
      ...input,
      candidate: { ...candidate, dataset: { ...candidate.dataset, queriesSha256: 'b'.repeat(64) } }
    })).toThrow('queriesSha256')
    expect(() => compareSemanticMemoryEvaluationReports({
      ...input,
      candidate: report('candidate', 'hybrid', [ranked('q2', 1, 1)])
    })).toThrow('missing q1')
    expect(() => compareSemanticMemoryEvaluationReports({
      ...input,
      baseline: report('baseline', 'semantic', [ranked('q1', 0, 0)])
    })).toThrow('must be lexical')
  })

  it('rejects comparison reports with inconsistent per-query uncertainty fields', () => {
    const invalid = {
      ...compareSemanticMemoryEvaluationReports({
        baseline: report('baseline', 'lexical', [ranked('q1', 0, 0)]),
        candidate: report('candidate', 'hybrid', [ranked('q1', 1, 1)]),
        bootstrap: { method: 'paired-percentile', seed: 1, resamples: 10, confidenceLevel: 0.95 }
      }),
      results: [{
        queryId: 'q1', split: 'development', category: 'test', expectedCount: 1,
        abstentionCorrectDelta: 1
      }]
    }

    expect(() => SemanticMemoryPairedComparisonReportSchema.parse(invalid)).toThrow()
  })

  it('compares two candidates across the complete v2 dataset contract', async () => {
    const dataset = await loadSemanticMemoryV2EvaluationDataset()
    const lexical = createLexicalSemanticMemoryCandidate()
    const echo = {
      ...lexical,
      metadata: { ...lexical.metadata, id: 'lexical-echo', kind: 'hybrid' as const }
    }
    const [baseline, candidate] = await Promise.all([
      runSemanticMemoryEvaluation({ dataset, candidate: lexical, split: 'all' }),
      runSemanticMemoryEvaluation({ dataset, candidate: echo, split: 'all' })
    ])
    const comparison = compareSemanticMemoryEvaluationReports({
      baseline,
      candidate,
      bootstrap: dataset.manifest.bootstrap
    })

    expect(comparison.results).toHaveLength(80)
    expect(comparison.metrics.recallAtKDelta.sampleSize).toBe(71)
    expect(comparison.metrics.recallAtKDelta).toMatchObject({
      pointEstimate: 0,
      lowerBound: 0,
      upperBound: 0,
      resamples: 10_000,
      seed: 20260909
    })
    expect(comparison.metrics.abstentionSampleSize).toBe(9)
  })
})

function ranked(queryId: string, recallAtK: number, reciprocalRank: number): SemanticMemoryQueryResult {
  return result({ queryId, expectedCount: 1, recallAtK, reciprocalRank, precisionAtK: recallAtK })
}

function empty(queryId: string, abstentionCorrect: boolean): SemanticMemoryQueryResult {
  return result({ queryId, expectedCount: 0, abstentionCorrect })
}

function result(overrides: Partial<SemanticMemoryQueryResult>): SemanticMemoryQueryResult {
  return {
    queryId: 'query', split: 'development', queryLanguage: 'en', category: 'test',
    expectedCount: 1, selectedIds: [], falsePositiveSelections: 0,
    explicitForbiddenSelections: 0, scopeLeaks: 0, lifecycleLeaks: 0,
    authorityViolations: 0, unknownSelections: 0, selectedCharacters: 0,
    eligibleRecordCount: 1, latencyMs: 0, ...overrides
  }
}

function report(
  id: string,
  kind: 'lexical' | 'semantic' | 'hybrid',
  results: SemanticMemoryQueryResult[]
): SemanticMemoryEvaluationReport {
  const metrics = {
    queryCount: results.length, rankedQueryCount: 0, emptyExpectedQueryCount: 0,
    recallAtK: 0, precisionAtK: 0, meanReciprocalRank: 0, abstentionAccuracy: 0,
    falsePositiveSelections: 0, explicitForbiddenSelections: 0, scopeLeaks: 0,
    lifecycleLeaks: 0, authorityViolations: 0, unknownSelections: 0,
    selectedCharacters: 0, latencyP50Ms: 0, latencyP95Ms: 0
  }
  return {
    dataset: {
      id: 'dataset', recordsSha256: 'a'.repeat(64), queriesSha256: 'c'.repeat(64),
      scoringVersion: 2, evaluationNow: '2026-09-09T00:00:00.000Z', limit: 5,
      promptCharacterBudget: 2_000
    },
    candidate: { id, kind, version: 'test', runtime: 'test', license: 'test', parameters: {}, platforms: [] },
    results, metrics, breakdowns: { split: {}, language: {}, category: {} },
    safetyGatePassed: true, networkAttempts: 0, fallbackMismatches: 0
  }
}

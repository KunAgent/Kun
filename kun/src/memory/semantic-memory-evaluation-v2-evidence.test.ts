import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  compareSemanticMemoryEvaluationReports
} from './semantic-memory-evaluation-comparison.js'
import {
  createLexicalSemanticMemoryCandidate,
  runSemanticMemoryEvaluation,
  type SemanticMemoryEvaluationReport,
  type SemanticMemoryMetricSummary
} from './semantic-memory-evaluation.js'
import { loadSemanticMemoryV2EvaluationDataset } from './semantic-memory-evaluation-v2-dataset.js'
import {
  DEFAULT_SEMANTIC_MEMORY_V2_DEVELOPMENT_EVIDENCE_PATH,
  loadSemanticMemoryV2DevelopmentEvidence,
  SemanticMemoryV2DevelopmentEvidenceSchema
} from './semantic-memory-evaluation-v2-evidence.js'
import {
  semanticMemoryV2DevelopmentGridConfigurations,
  semanticMemoryV2DevelopmentGridSha256
} from './semantic-memory-evaluation-v2-workflow.js'
import {
  createTerminologyMapSemanticMemoryCandidate,
  loadSemanticMemoryTerminologyMap
} from './semantic-memory-terminology-candidate.js'

describe('semantic Memory v2 development evidence', () => {
  it('records every pre-registered configuration without holdout output', async () => {
    const [dataset, evidence] = await Promise.all([
      loadSemanticMemoryV2EvaluationDataset(),
      loadSemanticMemoryV2DevelopmentEvidence()
    ])
    const configurations = semanticMemoryV2DevelopmentGridConfigurations(dataset.manifest)

    expect(evidence.holdoutResultsEmitted).toBe(false)
    expect(evidence.developmentDecision.holdoutRun).toBe(false)
    expect(evidence.dataset.sourceHashes).toEqual(dataset.sourceHashes)
    expect(evidence.gridSha256).toBe(semanticMemoryV2DevelopmentGridSha256(dataset.manifest))
    expect(evidence.grid.map((entry) => entry.configuration)).toEqual(configurations)
    expect(evidence.grid.every((entry) => entry.metrics.queryCount === 40)).toBe(true)
    expect(evidence.selected).toBeNull()
  })

  it('reproduces lexical and terminology development evidence', async () => {
    const [dataset, terminology, evidence] = await Promise.all([
      loadSemanticMemoryV2EvaluationDataset(),
      loadSemanticMemoryTerminologyMap(),
      loadSemanticMemoryV2DevelopmentEvidence()
    ])
    const lexical = createLexicalSemanticMemoryCandidate()
    const terminologyCandidate = createTerminologyMapSemanticMemoryCandidate({ terminology, lexicalCandidate: lexical })
    const [lexicalReport, terminologyReport] = await Promise.all([
      runSemanticMemoryEvaluation({ dataset, candidate: lexical, split: 'development' }),
      runSemanticMemoryEvaluation({ dataset, candidate: terminologyCandidate, split: 'development' })
    ])
    const comparison = compareSemanticMemoryEvaluationReports({
      baseline: lexicalReport,
      candidate: terminologyReport,
      bootstrap: dataset.manifest.bootstrap
    })

    expect(withoutTiming(lexicalReport.metrics)).toEqual(withoutTiming(evidence.lexical.metrics))
    expect(withoutTiming(terminologyReport.metrics)).toEqual(withoutTiming(evidence.terminologyCandidate.metrics))
    expect(selectedIds(lexicalReport)).toEqual(evidence.lexical.selectedIds)
    expect(selectedIds(terminologyReport)).toEqual(evidence.terminologyCandidate.selectedIds)
    expect(comparison.metrics).toEqual(evidence.terminologyCandidate.comparison)
    expect(evidence.terminology.artifactSha256).toBe(terminology.artifactSha256)
    expect(evidence.lexical.determinism.runHashes).toContain(deterministicReportHash(lexicalReport))
    expect(evidence.terminologyCandidate.determinism.runHashes).toContain(deterministicReportHash(terminologyReport))
  })

  it('records the unchanged E5 identity and a development-only no-candidate result', async () => {
    const evidence = await loadSemanticMemoryV2DevelopmentEvidence()

    expect(evidence.model).toMatchObject({
      id: 'Xenova/multilingual-e5-small',
      revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
      artifactSha256: 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193'
    })
    expect(evidence.offline.networkAttempts).toBe(0)
    expect(evidence.grid.every((entry) => entry.safetyGatePassed)).toBe(true)
    expect(evidence.grid.every((entry) => entry.metrics.abstentionAccuracy === 0)).toBe(true)
    expect(evidence.developmentDecision).toMatchObject({
      status: 'no-candidate',
      failedGateIds: ['empty-result-accuracy'],
      expectedEmptyResultAccuracy: 1,
      observedE5EmptyResultAccuracy: { minimum: 0, maximum: 0 },
      holdoutRun: false
    })
  })

  it('contains no holdout query identifiers or undeclared report fields', async () => {
    const source = await readFile(DEFAULT_SEMANTIC_MEMORY_V2_DEVELOPMENT_EVIDENCE_PATH, 'utf8')
    const parsed = JSON.parse(source) as unknown

    expect(source).not.toMatch(/p2a_v2_q0(?:4[1-9]|[5-7][0-9]|80)_/u)
    expect(() => SemanticMemoryV2DevelopmentEvidenceSchema.parse(parsed)).not.toThrow()
    expect(() => SemanticMemoryV2DevelopmentEvidenceSchema.parse({
      ...(parsed as Record<string, unknown>),
      unexpected: true
    })).toThrow()
  })
})

function selectedIds(report: SemanticMemoryEvaluationReport): Record<string, string[]> {
  return Object.fromEntries(report.results.map((result) => [result.queryId, result.selectedIds]))
}

function withoutTiming(
  metrics: SemanticMemoryMetricSummary
): Omit<SemanticMemoryMetricSummary, 'latencyP50Ms' | 'latencyP95Ms'> {
  const { latencyP50Ms: _p50, latencyP95Ms: _p95, ...deterministic } = metrics
  return deterministic
}

function deterministicReportHash(report: SemanticMemoryEvaluationReport): string {
  const snapshot = {
    candidate: report.candidate,
    results: report.results.map(({ latencyMs: _latency, ...result }) => result),
    metrics: withoutTiming(report.metrics),
    breakdowns: Object.fromEntries(Object.entries(report.breakdowns).map(([name, values]) => [
      name,
      Object.fromEntries(Object.entries(values).map(([key, value]) => [key, withoutTiming(value)]))
    ])),
    safetyGatePassed: report.safetyGatePassed,
    networkAttempts: report.networkAttempts,
    fallbackMismatches: report.fallbackMismatches
  }
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}

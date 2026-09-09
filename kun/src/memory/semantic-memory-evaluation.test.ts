import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { MemoryRecord } from '../contracts/memory.js'
import { DEFAULT_KUN_CAPABILITIES_CONFIG } from '../contracts/capabilities.js'
import { retrieveMemoryRecords } from './memory-retrieval.js'
import {
  createDeterministicLexicalBaseline,
  createLexicalSemanticMemoryCandidate,
  percentile,
  runSemanticMemoryEvaluation,
  type SemanticMemoryCandidate
} from './semantic-memory-evaluation.js'
import { summarizeSemanticMemoryResources } from './semantic-memory-evaluation-resources.js'
import { loadSemanticMemoryEvaluationDataset } from './semantic-memory-evaluation-dataset.js'
import {
  runWithSemanticMemoryNetworkGuard,
  SemanticMemoryNetworkAccessError
} from './semantic-memory-offline-guard.js'

describe('semantic Memory evaluation', () => {
  it('prefilters scope and lifecycle before invoking a candidate', async () => {
    const dataset = await loadSemanticMemoryEvaluationDataset()
    const received = new Map<string, string[]>()
    const candidate = candidateReturning((queryId, records) => {
      received.set(queryId, records.map((record) => record.id))
      return []
    })

    await runSemanticMemoryEvaluation({ dataset, candidate, split: 'development' })

    expect(received.get('p2a_q29_ember_project_scope')).toContain('p2a_a_github_actions')
    expect(received.get('p2a_q29_ember_project_scope')).not.toContain('p2a_a_buildkite')
    expect(received.get('p2a_q29_ember_project_scope')).not.toContain('p2a_b_circle_ci')
    expect(received.get('p2a_q33_superseded_runtime')).not.toContain('p2a_a_node18_old')
    expect(received.get('p2a_q34_disabled_codename')).not.toContain('p2a_a_disabled_codename')
    expect(received.get('p2a_q36_future_region')).not.toContain('p2a_a_future_region')
    expect(received.get('p2a_q37_deleted_product')).not.toContain('p2a_a_deleted_product')
  })

  it('derives safety negatives even when the query labels omit them', async () => {
    const dataset = await loadSemanticMemoryEvaluationDataset()
    const query = dataset.queries.find((item) => item.id === 'p2a_q09_release_lexical')!
    const foreign = dataset.records.find((record) => record.id === 'p2a_b_yarn')!
    const disabled = dataset.records.find((record) => record.id === 'p2a_a_disabled_codename')!
    const report = await runSemanticMemoryEvaluation({
      dataset: { ...dataset, queries: [query] },
      candidate: candidateReturning(() => [foreign, disabled]),
      split: 'development'
    })

    expect(report.metrics.scopeLeaks).toBe(1)
    expect(report.metrics.lifecycleLeaks).toBe(1)
    expect(report.safetyGatePassed).toBe(false)
  })

  it('treats authority changes, unknown selections, and fallback mismatches as unsafe', async () => {
    const dataset = await loadSemanticMemoryEvaluationDataset()
    const query = dataset.queries.find((item) => item.id === 'p2a_q38_injection_reference')!
    const source = dataset.records.find((record) => record.id === 'p2a_a_injection_warning')!
    const changed = { ...source, authority: 'instruction' } as unknown as MemoryRecord
    const unknown = { ...source, id: 'p2a_unknown' }
    const report = await runSemanticMemoryEvaluation({
      dataset: { ...dataset, queries: [query] },
      candidate: candidateReturning(() => [changed, unknown]),
      split: 'development',
      fallbackMismatches: 1
    })

    expect(report.metrics.authorityViolations).toBe(1)
    expect(report.metrics.unknownSelections).toBe(1)
    expect(report.fallbackMismatches).toBe(1)
    expect(report.safetyGatePassed).toBe(false)
  })

  it('keeps abstention out of ranked Recall and MRR', async () => {
    const dataset = await loadSemanticMemoryEvaluationDataset()
    const queries = dataset.queries.filter((query) => query.expectedIds.length === 0)
    const report = await runSemanticMemoryEvaluation({
      dataset: { ...dataset, queries },
      candidate: candidateReturning(() => []),
      split: 'all'
    })

    expect(report.metrics.queryCount).toBe(4)
    expect(report.metrics.rankedQueryCount).toBe(0)
    expect(report.metrics.recallAtK).toBe(0)
    expect(report.metrics.meanReciprocalRank).toBe(0)
    expect(report.metrics.abstentionAccuracy).toBe(1)
  })

  it('matches direct production lexical retrieval on every frozen query', async () => {
    const dataset = await loadSemanticMemoryEvaluationDataset()
    const report = await runSemanticMemoryEvaluation({
      dataset,
      candidate: createLexicalSemanticMemoryCandidate(),
      split: 'all'
    })

    for (const result of report.results) {
      const query = dataset.queries.find((item) => item.id === result.queryId)!
      const direct = retrieveMemoryRecords({
        records: dataset.records,
        request: {
          query: query.query,
          workspace: query.workspace,
          project: query.project,
          limit: dataset.manifest.defaultK,
          promptCharacterBudget: dataset.manifest.promptCharacterBudget
        },
        policy: { ...DEFAULT_KUN_CAPABILITIES_CONFIG.memory, enabled: true },
        mode: 'filesystem-fallback',
        nowIso: dataset.manifest.evaluationNow
      }).records.map((record) => record.id)
      expect(result.selectedIds).toEqual(direct)
    }
    expect(report.safetyGatePassed).toBe(true)
  })

  it('reproduces the checked-in deterministic lexical baseline', async () => {
    const dataset = await loadSemanticMemoryEvaluationDataset()
    const report = await runSemanticMemoryEvaluation({
      dataset,
      candidate: createLexicalSemanticMemoryCandidate(),
      split: 'all'
    })
    const summary = JSON.parse(await readFile(new URL(
      './fixtures/semantic-memory-lexical-baseline-summary.v1.json', import.meta.url
    ), 'utf8')) as Record<string, unknown>
    const fragmentPaths = [
      './fixtures/semantic-memory-lexical-baseline-development-relevance.v1.json',
      './fixtures/semantic-memory-lexical-baseline-development-boundaries.v1.json',
      './fixtures/semantic-memory-lexical-baseline-holdout.v1.json'
    ]
    const fragments = await Promise.all(fragmentPaths.map(async (path) => JSON.parse(
      await readFile(new URL(path, import.meta.url), 'utf8')
    ) as { results: Array<{ queryId: string } & Record<string, unknown>> }))
    const results = fragments.flatMap((fragment) => fragment.results)
      .sort((left, right) => left.queryId.localeCompare(right.queryId))
    const baseline = { ...summary, results }

    expect(createDeterministicLexicalBaseline(report)).toEqual(baseline)
  })

  it('repeats deterministic lexical selections and scores', async () => {
    const dataset = await loadSemanticMemoryEvaluationDataset()
    const runs = await Promise.all(Array.from({ length: 3 }, () => runSemanticMemoryEvaluation({
      dataset,
      candidate: createLexicalSemanticMemoryCandidate(),
      split: 'all'
    })))
    const deterministic = (report: typeof runs[number]) => ({
      results: report.results.map(({ latencyMs: _latencyMs, ...result }) => result),
      metrics: {
        ...report.metrics,
        latencyP50Ms: 0,
        latencyP95Ms: 0
      },
      safetyGatePassed: report.safetyGatePassed
    })

    expect(deterministic(runs[1]!)).toEqual(deterministic(runs[0]!))
    expect(deterministic(runs[2]!)).toEqual(deterministic(runs[0]!))
  })

  it('calculates deterministic nearest-rank percentiles and validates resource samples', () => {
    expect(percentile([], 0.95)).toBe(0)
    expect(percentile([9, 1, 5, 3], 0.5)).toBe(3)
    expect(percentile([9, 1, 5, 3], 0.95)).toBe(9)
    const summary = summarizeSemanticMemoryResources({
      coldReadinessMs: 100,
      warmQueryMs: Array.from({ length: 30 }, (_, index) => index + 1),
      fixtureBuildMs: 20,
      tenThousandRecordBuildMs: 1_000,
      incrementalProjectionMs: 2,
      modelBytes: 100.9,
      indexBytes: 50.8,
      additionalPeakRssBytes: 1_024.7
    })
    expect(summary.warmQueryP50Ms).toBe(15)
    expect(summary.warmQueryP95Ms).toBe(29)
    expect(summary.modelBytes).toBe(100)
    expect(() => summarizeSemanticMemoryResources({ ...summaryToMeasurements(summary), warmQueryMs: [1] }))
      .toThrow('at least 30')
  })

  it('blocks common in-process network entry points and keeps lexical evaluation offline', async () => {
    const dataset = await loadSemanticMemoryEvaluationDataset()
    const guarded = await runWithSemanticMemoryNetworkGuard(() => runSemanticMemoryEvaluation({
      dataset,
      candidate: createLexicalSemanticMemoryCandidate(),
      split: 'development'
    }))

    expect(guarded.networkAttempts).toBe(0)
    await expect(runWithSemanticMemoryNetworkGuard(async () => {
      await fetch('https://example.invalid')
    })).rejects.toBeInstanceOf(SemanticMemoryNetworkAccessError)
  })
})

function candidateReturning(
  retrieve: (queryId: string, records: readonly MemoryRecord[]) => readonly MemoryRecord[]
): SemanticMemoryCandidate {
  return {
    metadata: {
      id: 'test-candidate',
      kind: 'semantic',
      version: 'test',
      runtime: 'test',
      license: 'test-only',
      parameters: {},
      platforms: []
    },
    retrieve: async ({ query, records }) => retrieve(query.id, records)
  }
}

function summaryToMeasurements(summary: ReturnType<typeof summarizeSemanticMemoryResources>) {
  return {
    coldReadinessMs: summary.coldReadinessMs,
    warmQueryMs: Array.from({ length: 30 }, () => summary.warmQueryP50Ms),
    fixtureBuildMs: summary.fixtureBuildMs,
    tenThousandRecordBuildMs: summary.tenThousandRecordBuildMs,
    incrementalProjectionMs: summary.incrementalProjectionMs,
    modelBytes: summary.modelBytes,
    indexBytes: summary.indexBytes,
    additionalPeakRssBytes: summary.additionalPeakRssBytes
  }
}

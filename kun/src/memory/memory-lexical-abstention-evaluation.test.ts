import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  createLexicalSemanticMemoryCandidate,
  runSemanticMemoryEvaluation
} from './semantic-memory-evaluation.js'
import { loadSemanticMemoryV2EvaluationDataset } from './semantic-memory-evaluation-v2-dataset.js'

describe('Memory lexical abstention v2 evaluation', () => {
  it('matches the recorded gated development evidence and regression cases', async () => {
    const dataset = await loadSemanticMemoryV2EvaluationDataset()
    const evidence = JSON.parse(await readFile(new URL(
      './fixtures/memory-lexical-abstention-evaluation.v1.json',
      import.meta.url
    ), 'utf8')) as {
      gated: Record<string, number | boolean>
      regressionQueries: Record<string, string[]>
    }
    const report = await runSemanticMemoryEvaluation({
      dataset,
      candidate: createLexicalSemanticMemoryCandidate({ relevanceMode: 'foundation-v1' }),
      split: 'development'
    })
    const { safetyGatePassed, latencyP50Ms: _p50, latencyP95Ms: _p95, ...expectedMetrics } = evidence.gated
    expect(report.metrics).toMatchObject(expectedMetrics)
    expect(report.metrics.latencyP50Ms).toBeGreaterThan(0)
    expect(report.metrics.latencyP95Ms).toBeGreaterThan(0)
    expect(report.safetyGatePassed).toBe(safetyGatePassed)
    expect(Object.fromEntries(report.results
      .filter((result) => result.queryId in evidence.regressionQueries)
      .map((result) => [result.queryId, result.selectedIds]))).toEqual(evidence.regressionQueries)
  })
})

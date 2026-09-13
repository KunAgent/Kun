import { describe, expect, it } from 'vitest'
import {
  createLexicalSemanticMemoryCandidate,
  runSemanticMemoryEvaluation,
  type SemanticMemoryCandidate
} from './semantic-memory-evaluation.js'
import { loadSemanticMemoryEvaluationDataset } from './semantic-memory-evaluation-dataset.js'
import { loadSemanticMemoryV3EvaluationDataset } from './semantic-memory-evaluation-v3-dataset.js'
import {
  initializeSemanticMemoryEvaluationCandidate,
  SemanticMemoryCandidateUnavailableError,
  type SemanticMemoryCandidateUnavailableReason
} from './semantic-memory-candidate-fallback.js'
import { runWithSemanticMemoryNetworkGuard } from './semantic-memory-offline-guard.js'

describe('semantic Memory candidate fallback', () => {
  it('keeps a successfully initialized evaluation candidate', async () => {
    const primary = testCandidate()
    const result = await initializeSemanticMemoryEvaluationCandidate({
      initialize: async () => primary,
      fallback: createLexicalSemanticMemoryCandidate()
    })

    expect(result).toEqual({ candidate: primary, status: 'ready' })
  })

  it.each([
    'missing',
    'corrupt',
    'unsupported'
  ] satisfies SemanticMemoryCandidateUnavailableReason[])(
    'falls back exactly to lexical results when artifacts are %s',
    async (reason) => {
      await assertLexicalFallback(new SemanticMemoryCandidateUnavailableError(reason))
    }
  )

  it('classifies an unexpected initializer error without exposing its message', async () => {
    const result = await assertLexicalFallback(new Error('D:\\private\\model.onnx failed with token=secret'))

    expect(result.reason).toBe('initialization-failed')
    expect(JSON.stringify(result)).not.toContain('private')
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('keeps the v3 evaluator on the lexical path when the local model is missing', async () => {
    const dataset = await loadSemanticMemoryV3EvaluationDataset()
    const fallback = createLexicalSemanticMemoryCandidate({ relevanceMode: 'foundation-v1' })
    const initialized = await initializeSemanticMemoryEvaluationCandidate({
      initialize: async () => { throw new SemanticMemoryCandidateUnavailableError('missing') },
      fallback
    })

    const report = await runSemanticMemoryEvaluation({
      dataset,
      candidate: initialized.candidate,
      split: 'development'
    })

    expect(initialized).toMatchObject({ status: 'fallback', reason: 'missing' })
    expect(report.dataset.id).toBe('kun-memory-semantic-retrieval-anonymous-v3')
    expect(report.safetyGatePassed).toBe(true)
    expect(report.networkAttempts).toBe(0)
  })
})

async function assertLexicalFallback(error: Error) {
  const dataset = await loadSemanticMemoryEvaluationDataset()
  const lexical = createLexicalSemanticMemoryCandidate()
  const initialized = await initializeSemanticMemoryEvaluationCandidate({
    initialize: async () => { throw error },
    fallback: lexical
  })
  const [expected, actual] = await Promise.all([
    runSemanticMemoryEvaluation({ dataset, candidate: lexical, split: 'development' }),
    runWithSemanticMemoryNetworkGuard(() => runSemanticMemoryEvaluation({
      dataset,
      candidate: initialized.candidate,
      split: 'development'
    }))
  ])

  expect(initialized.status).toBe('fallback')
  expect(actual.value.results.map((result) => result.selectedIds))
    .toEqual(expected.results.map((result) => result.selectedIds))
  expect(actual.value.metrics.scopeLeaks).toBe(0)
  expect(actual.value.metrics.lifecycleLeaks).toBe(0)
  expect(actual.value.metrics.authorityViolations).toBe(0)
  expect(actual.value.metrics.unknownSelections).toBe(0)
  expect(actual.networkAttempts).toBe(0)
  return initialized
}

function testCandidate(): SemanticMemoryCandidate {
  return {
    metadata: {
      id: 'semantic-test',
      kind: 'semantic',
      version: 'test',
      runtime: 'test',
      license: 'test-only',
      parameters: {},
      platforms: []
    },
    retrieve: async () => []
  }
}

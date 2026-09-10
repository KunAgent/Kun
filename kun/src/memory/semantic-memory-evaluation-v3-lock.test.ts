import { describe, expect, it } from 'vitest'
import { loadSemanticMemoryV3EvaluationDataset } from './semantic-memory-evaluation-v3-dataset.js'
import {
  createSemanticMemoryV3HoldoutLock,
  parseSemanticMemoryV3HoldoutLock
} from './semantic-memory-evaluation-v3-lock.js'

describe('semantic Memory v3 holdout lock', () => {
  it('locks the exact dataset, model, candidates, configuration, gates, and bootstrap', async () => {
    const manifest = (await loadSemanticMemoryV3EvaluationDataset()).manifest
    const lock = createSemanticMemoryV3HoldoutLock({
      manifest,
      manifestSha256: 'a0387fff8c0ab3b48135a69baa754c149a71b828cf4271d62144bd9103c94f09',
      model: manifest.candidateIdentity,
      baseline: {
        id: 'kun-memory-lexical-foundation-post-1308',
        version: 'p0-v1-post-1308',
        parameters: { relevanceMode: 'foundation-v1' }
      },
      candidate: {
        id: 'semantic-gated-rrf-v3',
        version: 'v3-evaluator',
        parameters: { fusionMode: 'lexical-veto-margin', marginGap: 0.05 }
      },
      configuration: {
        id: 'v3-gate-0.75-margin-0.05',
        minimumSimilarity: 0.75,
        marginGap: 0.05,
        semanticWeight: 1,
        lexicalWeight: 1,
        rankConstant: 60
      },
      gates: {
        version: 'v3-preregistered-1',
        minimumRecallGainLowerBound: 0.15,
        minimumMrrGainLowerBound: 0.1,
        maximumOverallPrecisionDecline: 0.05,
        maximumZeroOverlapRecallDecline: 0.05,
        safety: {
          scopeLeaks: 0,
          lifecycleLeaks: 0,
          authorityViolations: 0,
          networkAttempts: 0,
          fallbackMismatches: 0
        }
      },
      developmentPassed: true
    })

    expect(parseSemanticMemoryV3HoldoutLock(lock)).toEqual(lock)
    expect(lock.selection.developmentPassed).toBe(true)
    expect(lock.dataset.queriesSha256).toBe(manifest.hashes.queriesSha256)
  })

  it('fails closed when development has not passed or a lock hash is tampered', async () => {
    const manifest = (await loadSemanticMemoryV3EvaluationDataset()).manifest
    const input = {
      manifest,
      manifestSha256: 'a0387fff8c0ab3b48135a69baa754c149a71b828cf4271d62144bd9103c94f09',
      model: manifest.candidateIdentity,
      baseline: { id: 'baseline', version: 'v1', parameters: {} },
      candidate: { id: 'candidate', version: 'v3', parameters: {} },
      configuration: { id: 'config', minimumSimilarity: 0.75, marginGap: 0.05, semanticWeight: 1, lexicalWeight: 1, rankConstant: 60 },
      gates: {
        version: 'v3',
        minimumRecallGainLowerBound: 0,
        minimumMrrGainLowerBound: 0,
        maximumOverallPrecisionDecline: 0.05,
        maximumZeroOverlapRecallDecline: 0.05,
        safety: { scopeLeaks: 0, lifecycleLeaks: 0, authorityViolations: 0, networkAttempts: 0, fallbackMismatches: 0 }
      },
      developmentPassed: false
    } as const

    expect(() => createSemanticMemoryV3HoldoutLock(input)).toThrow('development passes')

    const valid = createSemanticMemoryV3HoldoutLock({ ...input, developmentPassed: true })
    expect(() => parseSemanticMemoryV3HoldoutLock({ ...valid, hashes: { ...valid.hashes, candidate: '0'.repeat(64) } })).toThrow('candidate hash mismatch')
  })
})

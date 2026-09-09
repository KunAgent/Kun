import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  assertSemanticMemoryCandidateMatchesLock,
  evaluateSemanticMemoryDecision,
  semanticMemoryLockedCandidateMetadata
} from './semantic-memory-evaluation-decision.js'
import { loadSemanticMemoryEvaluationDataset } from './semantic-memory-evaluation-dataset.js'

describe('semantic Memory candidate lock', () => {
  it('reconstructs the exact locked candidate metadata', async () => {
    const { manifest } = await loadSemanticMemoryEvaluationDataset()
    const metadata = semanticMemoryLockedCandidateMetadata(manifest)

    expect(() => assertSemanticMemoryCandidateMatchesLock(manifest, metadata)).not.toThrow()
    expect(metadata.parameters).toMatchObject({
      modelId: 'Xenova/multilingual-e5-small',
      minimumSimilarity: 0.8,
      fusionMode: 'semantic-gated-rrf',
      semanticWeight: 1,
      lexicalWeight: 1,
      rankConstant: 60
    })
  })

  it('rejects parameter or artifact drift before a decision run', async () => {
    const { manifest } = await loadSemanticMemoryEvaluationDataset()
    const metadata = semanticMemoryLockedCandidateMetadata(manifest)

    expect(() => assertSemanticMemoryCandidateMatchesLock(manifest, {
      ...metadata,
      parameters: { ...metadata.parameters, minimumSimilarity: 0.79 }
    })).toThrow('parameters')
    expect(() => assertSemanticMemoryCandidateMatchesLock(manifest, {
      ...metadata,
      artifactSha256: '0'.repeat(64)
    })).toThrow('artifactSha256')
  })

  it('derives no-go only from the two failed frozen relevance gates', async () => {
    const { manifest } = await loadSemanticMemoryEvaluationDataset()
    const evidence = JSON.parse(await readFile(new URL(
      './fixtures/semantic-memory-e5-decision.v1.json', import.meta.url
    ), 'utf8'))
    const result = evaluateSemanticMemoryDecision({
      manifest,
      lexical: evidence.lexical,
      candidate: evidence.candidate,
      resources: evidence.resources,
      determinism: evidence.determinism,
      requiredPlatformSupport: evidence.requiredPlatformSupport
    })

    expect(result.decision).toBe(evidence.decision)
    expect(result.failedGateIds).toEqual(evidence.failedGateIds)
    expect(result.gates.filter((gate) => !gate.passed)).toHaveLength(2)
  })

  it('cannot produce go when a mandatory safety gate fails', async () => {
    const { manifest } = await loadSemanticMemoryEvaluationDataset()
    const result = evaluateSemanticMemoryDecision({
      manifest,
      lexical: {
        overall: { precisionAtK: 0 },
        holdout: { recallAtK: 0, meanReciprocalRank: 0 },
        lexicalControlRecallAtK: 1
      },
      candidate: {
        overall: {
          recallAtK: 1,
          precisionAtK: 1,
          meanReciprocalRank: 1,
          abstentionAccuracy: 1,
          scopeLeaks: 1,
          lifecycleLeaks: 0,
          authorityViolations: 0,
          unknownSelections: 0
        },
        holdout: { recallAtK: 1, meanReciprocalRank: 1 },
        lexicalControlRecallAtK: 1,
        networkAttempts: 0,
        fallbackMismatches: 0
      },
      resources: {
        coldReadinessMs: 0,
        warmQueryIterations: 30,
        warmQueryP50Ms: 0,
        warmQueryP95Ms: 0,
        fixtureBuildMs: 0,
        tenThousandRecordBuildMs: 0,
        incrementalProjectionMs: 0,
        modelBytes: 1,
        indexBytes: 1,
        additionalPeakRssBytes: 0
      },
      determinism: { runHashes: ['same', 'same', 'same'], maximumNumericDelta: 0 },
      requiredPlatformSupport: true
    })

    expect(result.decision).toBe('no-go')
    expect(result.failedGateIds).toContain('scope-leaks')
  })
})

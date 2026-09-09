import { describe, expect, it } from 'vitest'
import {
  assertSemanticMemoryCandidateMatchesLock,
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
})

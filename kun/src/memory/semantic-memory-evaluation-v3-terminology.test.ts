import { describe, expect, it } from 'vitest'
import { createLexicalSemanticMemoryCandidate } from './semantic-memory-evaluation.js'
import { createSemanticMemoryV3TerminologyCandidate } from './semantic-memory-evaluation-v3-terminology.js'

describe('semantic Memory v3 terminology candidate', () => {
  it('labels terminology expansion as exploratory and ineligible for primary selection', () => {
    const candidate = createSemanticMemoryV3TerminologyCandidate({
      lexicalCandidate: createLexicalSemanticMemoryCandidate({ relevanceMode: 'foundation-v1' }),
      terminology: {
        schemaVersion: 1,
        mapId: 'kun-memory-terminology-v1',
        status: 'frozen',
        entries: [{ id: 'deploy', terms: ['deploy', 'deployment'] }],
        artifactSha256: 'a'.repeat(64)
      }
    })

    expect(candidate.metadata.parameters).toMatchObject({
      evaluationRole: 'exploratory-only',
      primaryCandidateEligible: false
    })
  })
})

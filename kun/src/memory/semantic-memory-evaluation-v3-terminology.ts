import type { SemanticMemoryCandidate } from './semantic-memory-evaluation.js'
import {
  createTerminologyMapSemanticMemoryCandidate,
  type SemanticMemoryTerminologyMap
} from './semantic-memory-terminology-candidate.js'

export function createSemanticMemoryV3TerminologyCandidate(input: {
  terminology: SemanticMemoryTerminologyMap
  lexicalCandidate: SemanticMemoryCandidate
}): SemanticMemoryCandidate {
  const candidate = createTerminologyMapSemanticMemoryCandidate(input)
  return {
    ...candidate,
    metadata: {
      ...candidate.metadata,
      id: `${candidate.metadata.id}+v3-exploratory`,
      parameters: {
        ...candidate.metadata.parameters,
        evaluationRole: 'exploratory-only',
        primaryCandidateEligible: false
      }
    }
  }
}

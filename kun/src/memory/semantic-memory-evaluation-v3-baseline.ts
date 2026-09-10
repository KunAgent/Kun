import { MEMORY_MIN_CJK_LEXICAL_RELEVANCE } from './memory-ranking.js'
import { createLexicalSemanticMemoryCandidate } from './semantic-memory-evaluation.js'

export const SEMANTIC_MEMORY_V3_LEXICAL_BASELINE_ID = 'kun-memory-lexical-foundation-post-1308'

export function createSemanticMemoryV3LexicalBaselineCandidate() {
  const candidate = createLexicalSemanticMemoryCandidate({ relevanceMode: 'foundation-v1' })
  return {
    ...candidate,
    metadata: {
      ...candidate.metadata,
      id: SEMANTIC_MEMORY_V3_LEXICAL_BASELINE_ID,
      version: 'p0-v1-post-1308',
      parameters: {
        ...candidate.metadata.parameters,
        baselineRevision: '1308',
        cjkLexicalRelevanceFloor: MEMORY_MIN_CJK_LEXICAL_RELEVANCE
      }
    }
  }
}

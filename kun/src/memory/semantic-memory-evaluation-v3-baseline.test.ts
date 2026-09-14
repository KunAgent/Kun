import { describe, expect, it } from 'vitest'
import {
  createSemanticMemoryV3LexicalBaselineCandidate,
  SEMANTIC_MEMORY_V3_LEXICAL_BASELINE_ID
} from './semantic-memory-evaluation-v3-baseline.js'

describe('semantic Memory v3 lexical baseline', () => {
  it('identifies the post-1308 foundation candidate without changing frozen v1/v2 evidence', () => {
    const candidate = createSemanticMemoryV3LexicalBaselineCandidate()

    expect(candidate.metadata).toMatchObject({
      id: SEMANTIC_MEMORY_V3_LEXICAL_BASELINE_ID,
      kind: 'lexical',
      version: 'p0-v1-post-1308',
      parameters: {
        relevanceMode: 'foundation-v1',
        baselineRevision: '1308',
        cjkLexicalRelevanceFloor: 1 / 3
      }
    })
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { MemoryRecord } from '../contracts/memory.js'
import {
  createSemanticMemoryV3SemanticGatedCandidate,
  createSemanticMemoryV3LexicalVetoCandidate,
  passesMarginGate
} from './semantic-memory-v3-candidates.js'
import { MEMORY_RETRIEVAL_FIXTURE_RECORDS } from './memory-retrieval-fixtures.js'
import type { SemanticMemoryCandidate } from './semantic-memory-evaluation.js'

const [first, second, third] = MEMORY_RETRIEVAL_FIXTURE_RECORDS

describe('semantic Memory v3 lexical-veto candidates', () => {
  it('returns only semantic results admitted by lexical retrieval', async () => {
    const lexical = stubCandidate([first!, second!])
    const candidate = createSemanticMemoryV3LexicalVetoCandidate({
      metadata: metadata('lexical-veto'),
      lexicalCandidate: lexical,
      scoreRecords: () => [
        { record: second!, score: 0.9 },
        { record: third!, score: 0.95 },
        { record: first!, score: 0.8 }
      ]
    })

    const selected = await candidate.retrieve(request())

    expect(selected.map((record) => record.id)).toEqual([second!.id, first!.id])
  })

  it('abstains when lexical retrieval returns no admission', async () => {
    const scoreRecords = vi.fn(() => [{ record: first!, score: 0.99 }])
    const candidate = createSemanticMemoryV3LexicalVetoCandidate({
      metadata: metadata('lexical-veto'),
      lexicalCandidate: stubCandidate([]),
      scoreRecords
    })

    await expect(candidate.retrieve(request())).resolves.toEqual([])
    expect(scoreRecords).not.toHaveBeenCalled()
  })

  it('abstains when the top two admitted scores fail the margin', async () => {
    const candidate = createSemanticMemoryV3LexicalVetoCandidate({
      metadata: metadata('lexical-veto-margin'),
      lexicalCandidate: stubCandidate([first!, second!]),
      scoreRecords: () => [
        { record: first!, score: 0.81 },
        { record: second!, score: 0.8 }
      ],
      marginGap: 0.05
    })

    await expect(candidate.retrieve(request())).resolves.toEqual([])
  })

  it('defines a deterministic margin rule for ties and single candidates', () => {
    expect(passesMarginGate([{ record: first!, score: 0.8 }], 0.5)).toBe(true)
    expect(passesMarginGate([
      { record: first!, score: 0.8 },
      { record: second!, score: 0.8 }
    ], 0.01)).toBe(false)
    expect(() => passesMarginGate([], -0.1)).toThrow('marginGap')
  })

  it('keeps the semantic-gated control behavior when lexical retrieval is empty', async () => {
    const candidate = createSemanticMemoryV3SemanticGatedCandidate({
      metadata: metadata('semantic-gated-rrf'),
      lexicalCandidate: stubCandidate([]),
      scoreRecords: () => [
        { record: third!, score: 0.95 },
        { record: first!, score: 0.8 }
      ],
      minimumSimilarity: 0.9,
      semanticWeight: 1,
      lexicalWeight: 1,
      rankConstant: 60
    })

    await expect(candidate.retrieve(request())).resolves.toEqual([third])
    expect(candidate.metadata.parameters).toMatchObject({ fusionMode: 'semantic-gated-rrf' })
  })
})

function metadata(id: string) {
  return {
    id,
    version: 'v3-evaluator',
    runtime: 'offline-test',
    license: 'repository',
    parameters: { modelId: 'multilingual-e5-small-q8' },
    platforms: ['win32-x64']
  }
}

function stubCandidate(records: readonly MemoryRecord[]): SemanticMemoryCandidate {
  return {
    metadata: {
      id: 'kun-memory-lexical-foundation',
      kind: 'lexical',
      version: 'foundation-v1',
      runtime: 'offline-test',
      license: 'repository',
      parameters: { relevanceMode: 'foundation-v1' },
      platforms: ['win32-x64']
    },
    retrieve: async () => records
  }
}

function request() {
  return {
    query: {
      id: 'p2a_v3_q001_test',
      split: 'development' as const,
      queryLanguage: 'en' as const,
      category: 'semantic-paraphrase',
      query: 'Which fact is relevant?',
      expectedIds: [first!.id],
      forbiddenIds: [third!.id],
      rationale: 'Synthetic evaluator request used to test candidate boundaries.'
    },
    records: MEMORY_RETRIEVAL_FIXTURE_RECORDS,
    limit: 2,
    promptCharacterBudget: 10_000,
    nowIso: '2026-09-01T00:00:00.000Z'
  }
}

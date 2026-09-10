import { describe, expect, it } from 'vitest'
import { MemoryRecord, type MemoryRecord as MemoryRecordValue } from '../contracts/memory.js'
import type { SemanticMemoryCandidate } from './semantic-memory-evaluation.js'
import {
  createVectorSemanticMemoryCandidate,
  reciprocalRankFusion,
  type SemanticMemoryEmbeddingProvider
} from './semantic-memory-vector-candidate.js'

describe('semantic Memory vector candidate', () => {
  it('normalizes embeddings, applies prefixes and caches record vectors', async () => {
    const calls: string[][] = []
    const provider = mappedProvider(calls, {
      'passage: alpha': [3, 0],
      'passage: beta': [2, 1],
      'passage: opposite': [-1, 0],
      'query: target': [2, 0]
    })
    const candidate = createCandidate(provider, { minimumSimilarity: 0.5 })
    const records = [record('b', 'beta'), record('a', 'alpha'), record('c', 'opposite')]

    const first = await retrieve(candidate, records)
    const second = await retrieve(candidate, records)

    expect(first.map((item) => item.id)).toEqual(['a', 'b'])
    expect(second.map((item) => item.id)).toEqual(['a', 'b'])
    expect(calls).toEqual([
      ['passage: beta', 'passage: alpha', 'passage: opposite'],
      ['query: target'],
      ['query: target']
    ])
  })

  it('uses record id as a stable semantic tie-breaker', async () => {
    const candidate = createCandidate(mappedProvider([], {
      alpha: [1, 0],
      beta: [1, 0],
      target: [1, 0]
    }), { queryPrefix: '', documentPrefix: '', minimumSimilarity: 0 })

    const selected = await retrieve(candidate, [record('b', 'beta'), record('a', 'alpha')])

    expect(selected.map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('rejects malformed provider output and invalid configuration', async () => {
    const wrongCount: SemanticMemoryEmbeddingProvider = { embed: async () => [] }
    await expect(retrieve(createCandidate(wrongCount), [record('a', 'alpha')]))
      .rejects.toThrow('returned 0 vectors for 1 texts')

    const inconsistent: SemanticMemoryEmbeddingProvider = {
      embed: async (texts) => texts.map((_, index) => index === 0 ? [1, 0] : [1, 0, 0])
    }
    await expect(retrieve(createCandidate(inconsistent), [record('a', 'alpha'), record('b', 'beta')]))
      .rejects.toThrow('inconsistent dimensions')

    expect(() => createCandidate(mappedProvider([], {}), { minimumSimilarity: 2 }))
      .toThrow('between -1 and 1')
  })

  it('fuses ranks deterministically and rejects duplicate ids', () => {
    expect(reciprocalRankFusion({
      rankings: [
        { ids: ['a', 'b', 'c'], weight: 2 },
        { ids: ['b', 'c', 'a'], weight: 1 }
      ],
      rankConstant: 60
    })).toEqual(['a', 'b', 'c'])
    expect(() => reciprocalRankFusion({
      rankings: [{ ids: ['a', 'a'], weight: 1 }],
      rankConstant: 60
    })).toThrow('duplicate id')
  })

  it('combines semantic and lexical rankings without changing the candidate boundary', async () => {
    const lexicalCandidate: SemanticMemoryCandidate = {
      metadata: {
        id: 'lexical-test',
        kind: 'lexical',
        version: 'test',
        runtime: 'test',
        license: 'test-only',
        parameters: {},
        platforms: []
      },
      retrieve: async ({ records }) => [
        records.find((item) => item.id === 'b')!,
        records.find((item) => item.id === 'a')!,
        records.find((item) => item.id === 'c')!
      ]
    }
    const candidate = createCandidate(mappedProvider([], {
      'passage: alpha': [1, 0],
      'passage: beta': [0.8, 0.2],
      'passage: opposite': [-1, 0],
      'query: target': [1, 0]
    }), {
      minimumSimilarity: 0,
      fusion: { lexicalCandidate, semanticWeight: 2, lexicalWeight: 1, rankConstant: 60 }
    })

    const selected = await retrieve(candidate, [
      record('b', 'beta'),
      record('a', 'alpha'),
      record('c', 'opposite')
    ])

    expect(candidate.metadata.kind).toBe('hybrid')
    expect(selected.map((item) => item.id)).toEqual(['a', 'b'])
  })
})

function createCandidate(
  provider: SemanticMemoryEmbeddingProvider,
  overrides: Partial<Parameters<typeof createVectorSemanticMemoryCandidate>[0]> = {}
): SemanticMemoryCandidate {
  return createVectorSemanticMemoryCandidate({
    metadata: {
      id: 'vector-test',
      version: 'test',
      runtime: 'test',
      license: 'test-only',
      dimensions: 2,
      normalization: 'adapter-l2',
      platforms: []
    },
    provider,
    queryPrefix: 'query: ',
    documentPrefix: 'passage: ',
    minimumSimilarity: 0,
    ...overrides
  })
}

function mappedProvider(
  calls: string[][],
  vectors: Readonly<Record<string, readonly number[]>>
): SemanticMemoryEmbeddingProvider {
  return {
    embed: async (texts) => {
      calls.push([...texts])
      return texts.map((text) => vectors[text] ?? [1, 0])
    }
  }
}

function retrieve(candidate: SemanticMemoryCandidate, records: readonly MemoryRecordValue[]) {
  return candidate.retrieve({
    query: {
      id: 'query',
      split: 'development',
      query: 'target',
      queryLanguage: 'en',
      category: 'semantic-paraphrase',
      expectedIds: [],
      forbiddenIds: [],
      rationale: 'test'
    },
    records,
    limit: 5,
    promptCharacterBudget: 2_000,
    nowIso: '2026-09-09T00:00:00.000Z'
  })
}

function record(id: string, content: string): MemoryRecordValue {
  return MemoryRecord.parse({
    id,
    content,
    scope: 'user',
    tags: [],
    confidence: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  })
}

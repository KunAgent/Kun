import { describe, expect, it } from 'vitest'
import { MemoryRecord } from '../contracts/memory.js'
import {
  hasPositiveMemoryRelevance,
  MEMORY_MIN_LEXICAL_RELEVANCE,
  rankMemory
} from './memory-ranking.js'

const nowIso = '2026-08-28T00:00:00.000Z'

describe('Memory lexical abstention ranking gate', () => {
  it('rejects lexical-only matches below the versioned foundation threshold', () => {
    const candidate = rankMemory({
      record: record('weak-match'),
      query: 'unrelated query',
      queryTokens: [],
      lexicalOverride: MEMORY_MIN_LEXICAL_RELEVANCE - 0.001,
      nowMs: Date.parse(nowIso),
      channel: 'filesystem'
    })

    expect(hasPositiveMemoryRelevance(candidate)).toBe(false)
  })

  it('accepts an exact threshold match and preserves type-affinity retrieval', () => {
    const exact = rankMemory({
      record: record('exact-threshold'),
      query: 'unrelated query',
      queryTokens: [],
      lexicalOverride: MEMORY_MIN_LEXICAL_RELEVANCE,
      nowMs: Date.parse(nowIso),
      channel: 'filesystem'
    })
    const typeAffinity = rankMemory({
      record: record('identity-fact', { type: 'fact' }),
      query: 'what is my name',
      queryTokens: [],
      lexicalOverride: 0,
      nowMs: Date.parse(nowIso),
      channel: 'type-affinity'
    })

    expect(hasPositiveMemoryRelevance(exact)).toBe(true)
    expect(typeAffinity.features.typeAffinity).toBeGreaterThan(0)
    expect(hasPositiveMemoryRelevance(typeAffinity)).toBe(true)
  })
})

function record(id: string, overrides: Record<string, unknown> = {}) {
  return MemoryRecord.parse({
    id,
    content: 'anonymous regression memory',
    scope: 'workspace',
    workspace: '/workspace-a',
    tags: [],
    confidence: 1,
    importance: 0.8,
    type: 'fact',
    createdAt: nowIso,
    updatedAt: nowIso,
    observedAt: nowIso,
    ...overrides
  })
}

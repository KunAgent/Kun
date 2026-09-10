import { describe, expect, it } from 'vitest'
import { MemoryRecord } from '../contracts/memory.js'
import {
  hasPositiveMemoryRelevance,
  MEMORY_MIN_CJK_LEXICAL_RELEVANCE,
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

  it('keeps the CJK n-gram floor separate from the English safety threshold', () => {
    const cjk = rankMemory({
      record: record('cjk-match'),
      query: '用户叫什么名字',
      queryTokens: ['c用户', 'c户叫', 'c叫什', 'c什么', 'c么名', 'c名字'],
      lexicalOverride: MEMORY_MIN_CJK_LEXICAL_RELEVANCE,
      nowMs: Date.parse(nowIso),
      channel: 'filesystem'
    })
    const belowCjk = rankMemory({
      record: record('cjk-weak-match'),
      query: '用户叫什么名字',
      queryTokens: [],
      lexicalOverride: MEMORY_MIN_CJK_LEXICAL_RELEVANCE - 0.001,
      nowMs: Date.parse(nowIso),
      channel: 'filesystem'
    })

    expect(hasPositiveMemoryRelevance(cjk, '用户叫什么名字')).toBe(true)
    expect(hasPositiveMemoryRelevance(belowCjk, '用户叫什么名字')).toBe(false)
    expect(hasPositiveMemoryRelevance(cjk, 'What is the production database password?')).toBe(false)
    expect(MEMORY_MIN_CJK_LEXICAL_RELEVANCE).toBeCloseTo(1 / 3)
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

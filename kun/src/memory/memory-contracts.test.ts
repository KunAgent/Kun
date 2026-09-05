import { describe, expect, it } from 'vitest'
import {
  MEMORY_MAX_SOURCE_EXCERPT_CHARS,
  MemoryCreateRequest,
  MemoryRecord,
  MemorySourceEvidence
} from '../contracts/memory.js'
import {
  compareRankedMemories,
  memoryFreshness,
  memoryLifecycleState,
  rankMemory
} from './memory-ranking.js'
import {
  ftsQueryFromTokens,
  memorySearchTokens
} from './memory-search-tokens.js'
import { applyMemoryContextBudget } from './memory-retrieval-trace.js'
import { formatMemoryReferenceBlock } from './memory-context-format.js'

const NOW = Date.parse('2026-08-28T00:00:00.000Z')

describe('memory V2 contracts and pure helpers', () => {
  it('normalizes a legacy record without mutating the input object', () => {
    const legacy = {
      id: 'mem_legacy', content: 'Prefer pnpm', scope: 'user', tags: ['preference'], confidence: 0.9,
      sourceThreadId: 'thread_1', sourceTurnId: 'turn_1',
      createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-02-01T00:00:00.000Z'
    }
    const normalized = MemoryRecord.parse(legacy)
    expect(legacy).not.toHaveProperty('schemaVersion')
    expect(normalized).toMatchObject({
      schemaVersion: 2, type: 'preference', authority: 'reference', importance: 0.5,
      observedAt: '2025-02-01T00:00:00.000Z'
    })
    expect(normalized.sources[0]).toMatchObject({
      threadId: 'thread_1', turnId: 'turn_1', trust: 'legacy'
    })
  })

  it('rejects source evidence that exceeds the documented bound', () => {
    expect(MemorySourceEvidence.safeParse({
      id: 'source', kind: 'web', trust: 'observed', excerpt: 'x'.repeat(MEMORY_MAX_SOURCE_EXCERPT_CHARS + 1)
    }).success).toBe(false)
    expect(MemoryRecord.safeParse({
      ...memory(),
      sources: [
        { id: 'duplicate', kind: 'user', trust: 'explicit-user' },
        { id: 'duplicate', kind: 'file', trust: 'observed' }
      ]
    }).success).toBe(false)
  })

  it('accepts exact import lifecycle fields but rejects conflicting expiry inputs', () => {
    expect(MemoryCreateRequest.parse({
      content: 'Portable disabled memory',
      scope: 'user',
      expiresAt: '2027-01-01T00:00:00.000Z',
      disabled: true
    })).toMatchObject({
      expiresAt: '2027-01-01T00:00:00.000Z',
      disabled: true
    })
    expect(MemoryCreateRequest.safeParse({
      content: 'Conflicting expiry',
      scope: 'user',
      ttlMs: 60_000,
      expiresAt: '2027-01-01T00:00:00.000Z'
    }).success).toBe(false)
  })

  it('treats temporal boundaries independently from confidence', () => {
    const record = memory({ confidence: 1, validFrom: '2026-08-01T00:00:00.000Z', validTo: '2026-08-28T00:00:00.000Z' })
    expect(memoryLifecycleState(record, NOW - 1)).toBe('active')
    expect(memoryLifecycleState(record, NOW)).toBe('expired')
    expect(record.confidence).toBe(1)
    expect(memoryFreshness(record, NOW)).toBeLessThan(1)
  })

  it('bounds CJK tokens and constructs FTS syntax without raw operators', () => {
    const generated = memorySearchTokens('中文检索示例边界限制更多字符', 6)
    expect(generated.tokens).toHaveLength(6)
    expect(generated.truncated).toBe(true)
    const raw = memorySearchTokens('" OR * secret:token', 20)
    const query = ftsQueryFromTokens(raw.tokens)
    expect(query).not.toContain('*')
    expect(query).not.toContain(':')
    expect(query.split(' OR ').every((token) => /^"[\p{L}\p{N}_]+"$/u.test(token))).toBe(true)
  })

  it('keeps ranking and prompt budgeting deterministic', () => {
    const left = rankMemory({ record: memory({ id: 'mem_a' }), query: 'alpha', queryTokens: ['walpha'], nowMs: NOW, lexicalOverride: 0.5 })
    const right = rankMemory({ record: memory({ id: 'mem_b' }), query: 'alpha', queryTokens: ['walpha'], nowMs: NOW, lexicalOverride: 0.5 })
    expect(compareRankedMemories(left, right)).toBeLessThan(0)
    const selected = applyMemoryContextBudget([left, right], 2, 500, NOW)
    expect(selected.records).toHaveLength(1)
    expect(selected.selectedCharacters).toBe(formatMemoryReferenceBlock(selected.records, NOW).length)
    expect(selected.selectedCharacters).toBeLessThanOrEqual(500)
  })
})

function memory(overrides: Record<string, unknown> = {}) {
  return MemoryRecord.parse({
    id: 'mem_test', content: 'alpha memory content', scope: 'user', tags: [], confidence: 0.8,
    importance: 0.5, type: 'fact', authority: 'reference', observedAt: '2025-01-01T00:00:00.000Z',
    sources: [{ id: 'source', kind: 'user', trust: 'explicit-user' }],
    createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides
  })
}

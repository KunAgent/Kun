import { describe, expect, it } from 'vitest'
import { MemoryRecord } from '../contracts/memory.js'
import { prepareSemanticMemoryV3EvaluatorInput } from './semantic-memory-evaluation-v3-boundary.js'

describe('semantic Memory v3 evaluator boundary', () => {
  it('gives every candidate the same authorized, lifecycle-filtered, deterministic input', () => {
    const records = [
      record('b-active', 'workspace-a'),
      record('a-active', 'workspace-a', { supersedes: 'c-old' }),
      record('c-old', 'workspace-a'),
      record('expired', 'workspace-a', { expiresAt: '2026-09-01T00:00:00.000Z' }),
      record('other-workspace', 'workspace-b')
    ]

    const prepared = prepareSemanticMemoryV3EvaluatorInput({
      records,
      query: {
        id: 'p2a_v3_q001_boundary',
        split: 'development',
        queryLanguage: 'en',
        category: 'lexical-control',
        query: 'stable project concept',
        workspace: 'workspace-a',
        expectedIds: ['a-active'],
        forbiddenIds: ['other-workspace']
      },
      limit: 5,
      promptCharacterBudget: 2000,
      nowIso: '2026-09-11T00:00:00.000Z'
    })

    expect(prepared.records.map((record) => record.id)).toEqual(['a-active', 'b-active'])
    expect(prepared.limit).toBe(5)
    expect(prepared.promptCharacterBudget).toBe(2000)
    expect(prepared.scopeExcluded).toEqual(new Set(['other-workspace']))
    expect(prepared.lifecycleExcluded).toEqual(new Set(['c-old', 'expired']))
  })
})

function record(
  id: string,
  workspace: string,
  overrides: { expiresAt?: string; supersedes?: string } = {}
) {
  return MemoryRecord.parse({
    id,
    content: `Anonymous record ${id}`,
    scope: 'workspace',
    workspace,
    tags: ['fixture'],
    confidence: 1,
    importance: 0.8,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    observedAt: '2026-08-20T00:00:00.000Z',
    ...overrides
  })
}

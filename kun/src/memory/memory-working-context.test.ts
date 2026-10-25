import { describe, expect, it } from 'vitest'
import { MemoryRelationAnnotation, MemoryRelationContextRequest } from '../contracts/memory-working-context.js'
import { assembleMemoryRelationContext, formatMemoryRelationAnnotations } from './memory-working-context.js'

const annotation = (n: number) => MemoryRelationAnnotation.parse({
  id: `relation_${n.toString(16).padStart(64, '0')}`, kind: 'contradicts',
  source: { id: 'mem_source', revision: 1 }, target: { id: 'mem_target', revision: 2 },
  reviewedAt: '2026-10-20T00:00:00.000Z'
})

describe('Memory relation context assembly', () => {
  it('is deterministic, deduplicated and independent of review popularity', () => {
    const first = annotation(1)
    const second = annotation(2)
    const a = assembleMemoryRelationContext([second, first, second], 6000, true)
    expect(a).toEqual(assembleMemoryRelationContext([first, second], 6000, true))
    expect(a.annotations.map((item) => item.id)).toEqual([first.id, second.id])
    expect(a.block).toContain('authority="reference"')
    expect(a.block).toContain('contradiction is unresolved')
    expect(a.block).not.toContain('fingerprint')
  })

  it('uses only spare budget, including the full wrapper and provenance', () => {
    const entry = annotation(1)
    const exact = formatMemoryRelationAnnotations([entry]).length
    expect(assembleMemoryRelationContext([entry], exact, true).annotations).toEqual([entry])
    expect(assembleMemoryRelationContext([entry], exact - 1, true)).toMatchObject({
      block: '', annotations: [], omittedByBudget: 1
    })
    const many = assembleMemoryRelationContext(Array.from({ length: 20 }, (_, n) => annotation(n)), 6000, true)
    expect(many.block.length).toBeLessThanOrEqual(1600)
    expect(many.annotations.length).toBeLessThanOrEqual(6)
    expect(many.omittedByBudget + many.annotations.length).toBe(20)
  })

  it('does not fill an empty context and rejects privilege overrides', () => {
    expect(assembleMemoryRelationContext([], 6000, false)).toMatchObject({ block: '', annotations: [] })
    const input = { selected: [], remainingCharacters: 100, purpose: 'preview', access: {} }
    expect(MemoryRelationContextRequest.safeParse(input).success).toBe(true)
    expect(MemoryRelationContextRequest.safeParse({ ...input, access: { all: true } }).success).toBe(false)
    expect(MemoryRelationContextRequest.safeParse({ ...input, remainingCharacters: 6001 }).success).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { MemoryCandidateAssessment } from './memory-distillation.js'
import {
  MemoryDistillationExtractionResponse,
  parseMemoryDistillationExtractionResponse
} from './memory-distillation-runtime.js'

const validCandidate = {
  content: 'User prefers concise answers',
  type: 'preference',
  confidence: 0.9,
  importance: 0.8,
  tags: ['style'],
  sourceIds: ['source-1'],
  durability: 'durable',
  comparisons: [{ memoryId: 'memory-1', relation: 'update', reason: 'Preference changed' }]
}

describe('parseMemoryDistillationExtractionResponse', () => {
  it('keeps a fully valid response unchanged and drops nothing', () => {
    const result = parseMemoryDistillationExtractionResponse({ candidates: [validCandidate] })
    expect(result.dropped).toEqual([])
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.type).toBe('preference')
    expect(result.candidates[0]?.durability).toBe('durable')
    expect(result.candidates[0]?.comparisons).toEqual([
      { memoryId: 'memory-1', relation: 'update', reason: 'Preference changed' }
    ])
  })

  it('normalizes an unknown durability to transient instead of rejecting the batch', () => {
    for (const durability of ['long-term', 'persistent', 'permanent', 'LONG_TERM']) {
      const result = parseMemoryDistillationExtractionResponse({
        candidates: [{ ...validCandidate, durability }]
      })
      expect(result.dropped).toEqual([])
      expect(result.candidates[0]?.durability).toBe('transient')
    }
  })

  it('treats a missing durability as transient', () => {
    const { durability: _omitted, ...withoutDurability } = validCandidate
    const result = parseMemoryDistillationExtractionResponse({ candidates: [withoutDurability] })
    expect(result.candidates[0]?.durability).toBe('transient')
  })

  it('normalizes numeric-string confidence and importance to numbers', () => {
    const result = parseMemoryDistillationExtractionResponse({
      candidates: [{ ...validCandidate, confidence: '0.9', importance: '0.8' }]
    })
    expect(result.dropped).toEqual([])
    expect(result.candidates[0]?.confidence).toBe(0.9)
    expect(result.candidates[0]?.importance).toBe(0.8)
  })

  it('normalizes percentage confidence and importance to the 0-1 range', () => {
    const result = parseMemoryDistillationExtractionResponse({
      candidates: [{ ...validCandidate, confidence: 85, importance: '75%' }]
    })
    expect(result.dropped).toEqual([])
    expect(result.candidates[0]?.confidence).toBe(0.85)
    expect(result.candidates[0]?.importance).toBe(0.75)
  })

  it('drops a candidate whose score is missing or not numeric instead of inventing one', () => {
    const { confidence: _omitted, ...withoutConfidence } = validCandidate
    for (const damaged of [
      withoutConfidence,
      { ...validCandidate, confidence: 'high' },
      { ...validCandidate, importance: null }
    ]) {
      const result = parseMemoryDistillationExtractionResponse({ candidates: [damaged] })
      expect(result.candidates).toEqual([])
      expect(result.dropped).toHaveLength(1)
      expect(result.dropped[0]?.error).toMatch(/confidence|importance/)
    }
  })

  it('drops a candidate whose normalized score stays out of range', () => {
    for (const confidence of [150, -0.5, '120']) {
      const result = parseMemoryDistillationExtractionResponse({
        candidates: [{ ...validCandidate, confidence }]
      })
      expect(result.candidates).toEqual([])
      expect(result.dropped[0]?.error).toContain('confidence')
    }
  })

  it('normalizes an unknown candidate type to fact', () => {
    const result = parseMemoryDistillationExtractionResponse({
      candidates: [{ ...validCandidate, type: 'note' }]
    })
    expect(result.candidates[0]?.type).toBe('fact')
  })

  it('drops a candidate whose comparisons are malformed and reports why', () => {
    const damaged = {
      ...validCandidate,
      content: 'User now lives in Shanghai',
      comparisons: [
        { memoryId: 'memory-1', relation: 'supersede', reason: 'User moved' },
        { memoryId: 'memory-2', relation: 'replace' }
      ]
    }
    const result = parseMemoryDistillationExtractionResponse({ candidates: [damaged] })
    expect(result.candidates).toEqual([])
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0]?.index).toBe(0)
    expect(result.dropped[0]?.error).toContain('comparisons')
  })

  it('keeps a valid supersede comparison intact when a sibling candidate is damaged', () => {
    const damaged = {
      ...validCandidate,
      content: 'User now lives in Shanghai',
      comparisons: [{ memoryId: 'memory-2', relation: 'replace' }]
    }
    const superseding = {
      ...validCandidate,
      comparisons: [{ memoryId: 'memory-1', relation: 'supersede', reason: 'User moved' }]
    }
    const result = parseMemoryDistillationExtractionResponse({
      candidates: [superseding, damaged]
    })
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.comparisons).toEqual([
      { memoryId: 'memory-1', relation: 'supersede', reason: 'User moved' }
    ])
    expect(result.dropped.map((entry) => entry.index)).toEqual([1])
  })

  it('keeps every candidate when only one has an out-of-enum durability', () => {
    const result = parseMemoryDistillationExtractionResponse({
      candidates: [validCandidate, { ...validCandidate, content: 'User works night shifts', durability: 'permanent' }]
    })
    expect(result.dropped).toEqual([])
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates[0]?.durability).toBe('durable')
    expect(result.candidates[1]?.durability).toBe('transient')
  })

  it('drops candidates beyond the limit with a diagnostic instead of failing', () => {
    const candidates = Array.from({ length: 10 }, (_, index) => ({
      ...validCandidate,
      content: `Preference number ${index}`
    }))
    const result = parseMemoryDistillationExtractionResponse({ candidates })
    expect(result.candidates).toHaveLength(8)
    expect(result.dropped.map((entry) => entry.index)).toEqual([8, 9])
  })

  it('still throws on a malformed envelope', () => {
    expect(() => parseMemoryDistillationExtractionResponse(null)).toThrow()
    expect(() => parseMemoryDistillationExtractionResponse({ candidates: 'nope' })).toThrow()
    expect(() => MemoryDistillationExtractionResponse.parse({
      candidates: [{ ...validCandidate, comparisons: [{ memoryId: 'memory-2', relation: 'replace' }] }]
    })).toThrow()
  })

  it('leaves the canonical assessment schema strict', () => {
    const { durability: _durability, comparisons: _comparisons, ...draft } = validCandidate
    expect(() => MemoryCandidateAssessment.parse({
      candidate: draft,
      durability: 'long-term',
      comparisons: []
    })).toThrow()
    expect(() => MemoryCandidateAssessment.parse({
      candidate: { ...draft, confidence: '0.9' },
      durability: 'durable',
      comparisons: []
    })).toThrow()
    expect(MemoryCandidateAssessment.parse({
      candidate: draft,
      durability: 'durable',
      comparisons: []
    }).durability).toBe('durable')
  })
})

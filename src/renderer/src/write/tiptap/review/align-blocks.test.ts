import { describe, expect, it } from 'vitest'
import { alignBlocks } from './align-blocks'

describe('alignBlocks', () => {
  it('returns no chunks for identical sequences', () => {
    expect(alignBlocks(['a', 'b'], ['a', 'b'])).toEqual([])
  })

  it('handles empty documents', () => {
    expect(alignBlocks([], [])).toEqual([])
    expect(alignBlocks([], ['x', 'y'])).toEqual([
      { kind: 'added', next: [0, 1] }
    ])
    expect(alignBlocks(['x'], [])).toEqual([
      { kind: 'removed', prev: [0], anchorNext: 0 }
    ])
  })

  it('marks pure insertions as added', () => {
    expect(alignBlocks(['a', 'c'], ['a', 'b', 'c'])).toEqual([
      { kind: 'added', next: [1] }
    ])
  })

  it('marks pure deletions as removed with the next-side anchor', () => {
    expect(alignBlocks(['a', 'b', 'c'], ['a', 'c'])).toEqual([
      { kind: 'removed', prev: [1], anchorNext: 1 }
    ])
    // Tail deletion anchors at the end of the next doc.
    expect(alignBlocks(['a', 'b'], ['a'])).toEqual([
      { kind: 'removed', prev: [1], anchorNext: 1 }
    ])
  })

  it('pairs similar removed+added blocks as modified', () => {
    const prev = ['the quick brown fox jumps over the lazy dog']
    const next = ['the quick brown fox jumps over the sleepy dog']
    expect(alignBlocks(prev, next)).toEqual([
      { kind: 'modified', prev: 0, next: 0 }
    ])
  })

  it('keeps dissimilar replaced blocks as removed+added', () => {
    const chunks = alignBlocks(
      ['completely unrelated alpha text'],
      ['zzz omega beta gamma delta']
    )
    expect(chunks).toEqual([
      { kind: 'removed', prev: [0], anchorNext: 0 },
      { kind: 'added', next: [0] }
    ])
  })

  it('handles mixed runs: modify one, add one, remove one', () => {
    const prev = [
      'shared start of a paragraph that stays mostly intact',
      'this whole block disappears forever'
    ]
    const next = [
      'shared start of a paragraph that stays mostly intact!',
      'brand new trailing block'
    ]
    const chunks = alignBlocks(prev, next)
    expect(chunks[0]).toEqual({ kind: 'modified', prev: 0, next: 0 })
    expect(chunks.some((c) => c.kind === 'added')).toBe(true)
    expect(chunks.some((c) => c.kind === 'removed')).toBe(true)
  })

  it('reorders equal blocks stay equal (moved unchanged content)', () => {
    // diffArrays may still report move as removed+added; ensure it degrades
    // into remove+add chunks rather than modified (keys are unrelated).
    const chunks = alignBlocks(['a', 'b', 'c'], ['b', 'a', 'c'])
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.every((c) => c.kind !== 'modified')).toBe(true)
  })
})

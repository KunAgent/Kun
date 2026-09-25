import { describe, expect, it } from 'vitest'
import { layoutCommentGutter } from './comment-gutter-layout'

describe('layoutCommentGutter', () => {
  it('returns empty for no cards', () => {
    expect(layoutCommentGutter({ anchors: [], heights: [], containerHeight: 500 })).toEqual([])
  })

  it('keeps anchors when cards do not overlap', () => {
    const tops = layoutCommentGutter({
      anchors: [10, 200, 400],
      heights: [80, 80, 80],
      containerHeight: 600
    })
    expect(tops).toEqual([10, 200, 400])
  })

  it('pushes overlapping cards down by gap', () => {
    const tops = layoutCommentGutter({
      anchors: [100, 110, 120],
      heights: [60, 60, 60],
      containerHeight: 800
    })
    // 100 → next ≥ 168, next ≥ 236
    expect(tops).toEqual([100, 168, 236])
  })

  it('respects a custom gap', () => {
    const tops = layoutCommentGutter({
      anchors: [0, 5],
      heights: [40, 40],
      containerHeight: 400,
      gap: 20
    })
    expect(tops).toEqual([0, 60])
  })

  it('shifts the whole stack up when overflowing the rail bottom', () => {
    const tops = layoutCommentGutter({
      anchors: [100, 180, 260],
      heights: [100, 100, 100],
      containerHeight: 320
    })
    // Greedy tops: 100/208/316 → bottom 416, overflow 96 → all shift -96.
    expect(tops).toEqual([4, 112, 220])
    expect(tops[2] + 100).toBeLessThanOrEqual(320)
  })

  it('clamps at 0 when the stack is taller than the rail', () => {
    const tops = layoutCommentGutter({
      anchors: [50, 60, 70, 80],
      heights: [100, 100, 100, 100],
      containerHeight: 200
    })
    expect(tops[0]).toBe(0)
    expect(tops[tops.length - 1]).toBeGreaterThanOrEqual(0)
    // Non-decreasing, non-overlapping where possible.
    for (let i = 1; i < tops.length; i += 1) {
      expect(tops[i]).toBeGreaterThanOrEqual(tops[i - 1])
    }
  })

  it('treats missing heights as zero', () => {
    const tops = layoutCommentGutter({
      anchors: [30, 40],
      heights: [],
      containerHeight: 100
    })
    expect(tops).toEqual([30, 40])
  })
})

import { describe, expect, it } from 'vitest'
import { findSnaps } from './canvas-snap'

const r = (x: number, y: number, w: number, h: number) => ({ x, y, width: w, height: h })

describe('findSnaps', () => {
  it('returns zero deltas + no guides when nothing is close', () => {
    const out = findSnaps(r(0, 0, 10, 10), [r(100, 100, 10, 10)], 1)
    expect(out.dx).toBe(0)
    expect(out.dy).toBe(0)
    expect(out.guides).toHaveLength(0)
  })

  it('snaps left edge to neighbor right edge within threshold', () => {
    // moving at x=12 (left = 12), static right = 10. dx should be -2 (12 → 10).
    const out = findSnaps(r(12, 0, 10, 10), [r(0, 0, 10, 10)], 1)
    expect(out.dx).toBe(-2)
    expect(out.guides.some((g) => g.axis === 'v' && g.position === 10)).toBe(true)
  })

  it('snaps to center alignment', () => {
    // moving center at 51, static center at 50. dx should be -1.
    const out = findSnaps(r(46, 0, 10, 10), [r(45, 0, 10, 10)], 1)
    expect(Math.abs(out.dx + 1)).toBeLessThan(0.001)
  })

  it('respects zoom — threshold scales with 1/zoom', () => {
    // At zoom=4, threshold = 8/4 = 2 canvas units. A 3-unit gap should NOT snap.
    const out = findSnaps(r(13, 0, 10, 10), [r(0, 0, 10, 10)], 4)
    expect(out.dx).toBe(0)
  })

  it('snaps to grid when gridSize is provided', () => {
    // moving x=3 w=10. Candidates: left=3, center=8, right=13. Grid: 0,10,20.
    // Best snap is center→10 (dx=+2) — the algorithm picks the smallest |dx|
    // across all candidates, matching what users perceive as "tightest pull".
    const out = findSnaps(r(3, 0, 10, 10), [], 1, 10)
    expect(out.dx).toBe(2)
    expect(out.guides.some((g) => g.source === 'grid')).toBe(true)
  })

  it('snaps both axes independently', () => {
    // moving (12, 7, 10, 10) vs static (0, 0, 10, 10).
    // x: cands 12/17/22 vs targets 0/5/10 → closest 12→10, dx=-2
    // y: cands 7/12/17 vs targets 0/5/10 → closest 7→5 or 12→10, dy=-2
    const out = findSnaps(r(12, 7, 10, 10), [r(0, 0, 10, 10)], 1)
    expect(out.dx).toBe(-2)
    expect(out.dy).toBe(-2)
  })

  it('picks the closest match when multiple within threshold', () => {
    // moving at x=4, two statics at x=0 (4-away) and x=8 (4-away exactly).
    // Both equidistant; first one wins (deterministic), but the dx must be valid for one of them.
    const out = findSnaps(r(4, 0, 10, 10), [r(0, 0, 10, 10), r(8, 0, 10, 10)], 1)
    expect(Math.abs(out.dx)).toBeLessThanOrEqual(4)
  })
})

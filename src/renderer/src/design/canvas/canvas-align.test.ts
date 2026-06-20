import { describe, expect, it } from 'vitest'
import { alignShapes, collectiveBounds, distributeShapes } from './canvas-align'
import type { BoundsWithId } from './canvas-align'

const A: BoundsWithId = { id: 'a', x: 0, y: 0, width: 10, height: 10 }
const B: BoundsWithId = { id: 'b', x: 50, y: 30, width: 20, height: 20 }
const C: BoundsWithId = { id: 'c', x: 100, y: 10, width: 30, height: 40 }

describe('alignShapes (no target = collective bbox)', () => {
  it('left aligns to bbox.x', () => {
    const out = alignShapes([A, B, C], 'left')
    expect(out.get('a')).toBeUndefined() // already at x=0 = bbox.x
    expect(out.get('b')).toEqual({ x: 0 })
    expect(out.get('c')).toEqual({ x: 0 })
  })

  it('right aligns to bbox.right - width', () => {
    const bbox = collectiveBounds([A, B, C]) // x=0 w=130
    const out = alignShapes([A, B, C], 'right')
    expect(out.get('a')).toEqual({ x: bbox.x + bbox.width - 10 }) // 120
    expect(out.get('b')).toEqual({ x: bbox.x + bbox.width - 20 }) // 110
    expect(out.get('c')).toBeUndefined()
  })

  it('h-center centers each on bbox vertical center line', () => {
    const bbox = collectiveBounds([A, B, C]) // centerX = 65
    const out = alignShapes([A, B, C], 'h-center')
    expect(out.get('a')).toEqual({ x: 60 }) // 65 - 5
    expect(out.get('b')).toEqual({ x: 55 }) // 65 - 10
    expect(out.get('c')).toEqual({ x: 50 }) // 65 - 15
    expect(bbox.x + bbox.width / 2).toBe(65)
  })

  it('top/bottom mirror left/right on the y axis', () => {
    const topOut = alignShapes([A, B, C], 'top')
    expect(topOut.get('b')).toEqual({ y: 0 })
    const bbox = collectiveBounds([A, B, C]) // y=0 h=50
    const bottomOut = alignShapes([A, B, C], 'bottom')
    expect(bottomOut.get('a')).toEqual({ y: bbox.y + bbox.height - 10 }) // 40
  })
})

describe('alignShapes with explicit target (e.g. parent frame)', () => {
  it('aligns inside the parent rect', () => {
    const target = { x: 200, y: 100, width: 400, height: 300 }
    const out = alignShapes([A], 'h-center', target)
    expect(out.get('a')).toEqual({ x: 200 + 200 - 5 }) // 395
  })
})

describe('distributeShapes', () => {
  it('requires ≥3 shapes', () => {
    expect(distributeShapes([A, B], 'horizontal').size).toBe(0)
  })

  it('horizontal distribution keeps first+last, spaces middle evenly', () => {
    // A at x=0, B at x=50, C at x=100 → step 50, B target = 50 (no change)
    const out = distributeShapes([A, B, C], 'horizontal')
    expect(out.size).toBe(0) // already evenly spaced
  })

  it('repositions middle when off-step', () => {
    const D: BoundsWithId = { id: 'd', x: 80, y: 0, width: 10, height: 10 }
    // sorted: A(0), D(80), C(100). first=0, last=100, step=50. D should move to x=50.
    const out = distributeShapes([A, D, C], 'horizontal')
    expect(out.get('d')).toEqual({ x: 50 })
    expect(out.has('a')).toBe(false)
    expect(out.has('c')).toBe(false)
  })

  it('vertical works the same way', () => {
    const X: BoundsWithId = { id: 'x', x: 0, y: 0, width: 10, height: 10 }
    const Y: BoundsWithId = { id: 'y', x: 0, y: 80, width: 10, height: 10 }
    const Z: BoundsWithId = { id: 'z', x: 0, y: 100, width: 10, height: 10 }
    const out = distributeShapes([X, Y, Z], 'vertical')
    expect(out.get('y')).toEqual({ y: 50 })
  })
})

describe('collectiveBounds', () => {
  it('returns the union bbox', () => {
    expect(collectiveBounds([A, B, C])).toEqual({ x: 0, y: 0, width: 130, height: 50 })
  })
  it('returns zero for empty input', () => {
    expect(collectiveBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})

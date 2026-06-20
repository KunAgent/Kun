import { describe, expect, it } from 'vitest'
import { computeResizedBounds, scaleShapesToBounds } from './canvas-resize'

describe('computeResizedBounds', () => {
  const start = { x: 10, y: 20, width: 100, height: 50 }

  it('grows from the SE corner', () => {
    expect(computeResizedBounds('se', start, 20, 10)).toEqual({
      x: 10,
      y: 20,
      width: 120,
      height: 60
    })
  })

  it('grows from the NW corner — moves origin', () => {
    expect(computeResizedBounds('nw', start, -10, -5)).toEqual({
      x: 0,
      y: 15,
      width: 110,
      height: 55
    })
  })

  it('only changes width on the E edge', () => {
    expect(computeResizedBounds('e', start, 30, 99)).toEqual({
      x: 10,
      y: 20,
      width: 130,
      height: 50
    })
  })

  it('only changes height & y on the N edge', () => {
    expect(computeResizedBounds('n', start, 99, -10)).toEqual({
      x: 10,
      y: 10,
      width: 100,
      height: 60
    })
  })

  it('clamps width/height at 1 instead of flipping', () => {
    const collapsed = computeResizedBounds('se', start, -200, -200)
    expect(collapsed.width).toBe(1)
    expect(collapsed.height).toBe(1)
  })

  it('shift on a corner constrains aspect ratio', () => {
    // start aspect = 2:1. Pull SE corner by big dx, small dy → height follows width
    const out = computeResizedBounds('se', start, 100, 5, true)
    expect(out.width).toBe(200)
    expect(out.height).toBe(100) // 200 / 2
  })

  it('shift is ignored on edge handles', () => {
    const out = computeResizedBounds('e', start, 100, 0, true)
    expect(out).toEqual({ x: 10, y: 20, width: 200, height: 50 })
  })
})

describe('scaleShapesToBounds', () => {
  it('proportionally remaps a single shape inside the bounds', () => {
    const starts = new Map([['a', { x: 10, y: 20, width: 20, height: 10 }]])
    const out = scaleShapesToBounds(
      starts,
      { x: 0, y: 0, width: 100, height: 50 },
      { x: 0, y: 0, width: 200, height: 100 }
    )
    expect(out.get('a')).toEqual({ x: 20, y: 40, width: 40, height: 20 })
  })

  it('preserves relative position when origin moves', () => {
    const starts = new Map([['a', { x: 50, y: 50, width: 10, height: 10 }]])
    const out = scaleShapesToBounds(
      starts,
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 100, y: 100, width: 100, height: 100 }
    )
    expect(out.get('a')).toEqual({ x: 150, y: 150, width: 10, height: 10 })
  })

  it('handles zero-width start as identity scale', () => {
    const starts = new Map([['a', { x: 10, y: 10, width: 5, height: 5 }]])
    const out = scaleShapesToBounds(
      starts,
      { x: 0, y: 0, width: 0, height: 100 },
      { x: 0, y: 0, width: 50, height: 200 }
    )
    expect(out.get('a')?.width).toBe(5)
    expect(out.get('a')?.height).toBe(10) // y scale = 2
  })
})

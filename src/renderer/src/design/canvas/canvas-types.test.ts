import { describe, expect, it } from 'vitest'
import { pointInPolygon, shapeGeometry } from './canvas-types'
import type { CanvasShape } from './canvas-types'

function mockShape(patch: Partial<CanvasShape> = {}): CanvasShape {
  return {
    id: 's',
    type: 'rect',
    name: 's',
    parentId: null,
    frameId: null,
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    fills: [],
    strokes: [],
    cornerRadius: 0,
    children: [],
    ...patch
  }
}

describe('shapeGeometry', () => {
  it('rotation 0: selrect === xywh, points are trivial corners', () => {
    const g = shapeGeometry(mockShape({ x: 10, y: 20, width: 30, height: 40 }))
    expect(g.selrect).toEqual({ x: 10, y: 20, width: 30, height: 40 })
    expect(g.points).toEqual([
      { x: 10, y: 20 },
      { x: 40, y: 20 },
      { x: 40, y: 60 },
      { x: 10, y: 60 }
    ])
  })

  it('rotation 90°: selrect inverts w/h', () => {
    const g = shapeGeometry(mockShape({ x: 0, y: 0, width: 100, height: 50, rotation: 90 }))
    // After 90° around center (50, 25), corners trace a 50×100 box around (50, 25)
    expect(g.selrect.x).toBeCloseTo(25)
    expect(g.selrect.y).toBeCloseTo(-25)
    expect(g.selrect.width).toBeCloseTo(50)
    expect(g.selrect.height).toBeCloseTo(100)
  })

  it('rotation 45° on a square: bbox is sqrt(2)×side', () => {
    const g = shapeGeometry(mockShape({ x: 0, y: 0, width: 100, height: 100, rotation: 45 }))
    expect(g.selrect.width).toBeCloseTo(Math.SQRT2 * 100, 2)
    expect(g.selrect.height).toBeCloseTo(Math.SQRT2 * 100, 2)
  })

  it('center of rotation is the shape center', () => {
    const g = shapeGeometry(mockShape({ x: 0, y: 0, width: 100, height: 100, rotation: 180 }))
    // 180° flips: (0,0) → (100,100), (100,100) → (0,0). Bbox unchanged.
    expect(g.selrect.x).toBeCloseTo(0)
    expect(g.selrect.y).toBeCloseTo(0)
    expect(g.selrect.width).toBeCloseTo(100)
    expect(g.selrect.height).toBeCloseTo(100)
    expect(g.points[0].x).toBeCloseTo(100)
    expect(g.points[0].y).toBeCloseTo(100)
  })
})

describe('pointInPolygon', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 }
  ]

  it('detects an interior point', () => {
    expect(pointInPolygon(5, 5, square)).toBe(true)
  })

  it('rejects an outside point', () => {
    expect(pointInPolygon(15, 5, square)).toBe(false)
    expect(pointInPolygon(-1, 5, square)).toBe(false)
  })

  it('handles diamond-shaped polygon (rotated square)', () => {
    const diamond = [
      { x: 5, y: 0 },
      { x: 10, y: 5 },
      { x: 5, y: 10 },
      { x: 0, y: 5 }
    ]
    expect(pointInPolygon(5, 5, diamond)).toBe(true)
    expect(pointInPolygon(0, 0, diamond)).toBe(false) // outside the diamond
    expect(pointInPolygon(9, 9, diamond)).toBe(false) // corner area outside
  })
})

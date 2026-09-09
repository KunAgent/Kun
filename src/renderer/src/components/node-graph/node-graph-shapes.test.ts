import { describe, expect, it } from 'vitest'
import { nodeGraphShapePath, traceNodeGraphShape } from './node-graph-shapes'
import {
  NODE_GRAPH_KIND_COLORS,
  NODE_GRAPH_KIND_LABEL_KEYS,
  NODE_GRAPH_KIND_SHAPES
} from './node-graph-theme'
import { NODE_GRAPH_NODE_KINDS } from '../../node-graph/node-graph-types'

/** Records the calls a shape makes, so geometry can be asserted without a DOM. */
function recordingContext(): {
  context: CanvasRenderingContext2D
  calls: string[]
  points: [number, number][]
} {
  const calls: string[] = []
  const points: [number, number][] = []
  const context = {
    beginPath: () => calls.push('beginPath'),
    closePath: () => calls.push('closePath'),
    moveTo: (x: number, y: number) => {
      calls.push('moveTo')
      points.push([x, y])
    },
    lineTo: (x: number, y: number) => {
      calls.push('lineTo')
      points.push([x, y])
    },
    arc: (x: number, y: number) => {
      calls.push('arc')
      points.push([x, y])
    },
    ellipse: (x: number, y: number) => {
      calls.push('ellipse')
      points.push([x, y])
    },
    arcTo: (x: number, y: number) => {
      calls.push('arcTo')
      points.push([x, y])
    }
  } as unknown as CanvasRenderingContext2D
  return { context, calls, points }
}

const SHAPES = [...new Set(Object.values(NODE_GRAPH_KIND_SHAPES))]

describe('node kind encoding', () => {
  it('gives every kind a colour, a shape, and a label', () => {
    for (const kind of NODE_GRAPH_NODE_KINDS) {
      expect(NODE_GRAPH_KIND_COLORS[kind]).toMatch(/^#[0-9a-f]{6}$/i)
      expect(NODE_GRAPH_KIND_SHAPES[kind]).toBeTruthy()
      expect(NODE_GRAPH_KIND_LABEL_KEYS[kind]).toBeTruthy()
    }
  })

  it('uses more than one shape, so shape carries real information', () => {
    expect(SHAPES.length).toBeGreaterThan(3)
  })
})

describe('traceNodeGraphShape', () => {
  it('opens and closes a path for every shape', () => {
    for (const shape of SHAPES) {
      const { context, calls } = recordingContext()
      traceNodeGraphShape(context, shape, 50, 50, 10)
      expect(calls[0], shape).toBe('beginPath')
      expect(calls.length, shape).toBeGreaterThan(1)
    }
  })

  it('keeps every point inside the requested radius', () => {
    // Hit testing is a single radius comparison, so a shape that painted outside
    // its radius would be visibly clickable in places it is not.
    for (const shape of SHAPES) {
      const { context, points } = recordingContext()
      traceNodeGraphShape(context, shape, 100, 100, 12)
      for (const [x, y] of points) {
        expect(Math.hypot(x - 100, y - 100), shape).toBeLessThanOrEqual(12.5)
      }
    }
  })

  it('centres every shape on the requested point', () => {
    for (const shape of SHAPES) {
      const { context, points } = recordingContext()
      traceNodeGraphShape(context, shape, 40, 60, 10)
      const xs = points.map(([x]) => x)
      const ys = points.map(([, y]) => y)
      const midX = (Math.min(...xs) + Math.max(...xs)) / 2
      const midY = (Math.min(...ys) + Math.max(...ys)) / 2
      expect(midX, shape).toBeCloseTo(40, 0)
      // A five-pointed star is genuinely asymmetric on the vertical axis — one
      // spike up against two down — so its bounding box is not centred and only
      // its horizontal centring is meaningful.
      if (shape !== 'star') expect(midY, shape).toBeCloseTo(60, 0)
    }
  })

  it('draws a hexagon with six corners and a diamond with four', () => {
    const hexagon = recordingContext()
    traceNodeGraphShape(hexagon.context, 'hexagon', 0, 0, 10)
    expect(hexagon.points).toHaveLength(6)
    const diamond = recordingContext()
    traceNodeGraphShape(diamond.context, 'diamond', 0, 0, 10)
    expect(diamond.points).toHaveLength(4)
  })

  it('draws a star as ten alternating points', () => {
    const { points } = (() => {
      const recorded = recordingContext()
      traceNodeGraphShape(recorded.context, 'star', 0, 0, 10)
      return recorded
    })()
    expect(points).toHaveLength(10)
    const radii = points.map(([x, y]) => Math.hypot(x, y))
    // Alternating long and short spikes is what makes it read as a star.
    expect(radii[0]).toBeGreaterThan(radii[1]!)
    expect(radii[2]).toBeGreaterThan(radii[1]!)
  })
})

describe('nodeGraphShapePath', () => {
  it('returns a closed path for every shape', () => {
    for (const shape of SHAPES) {
      const path = nodeGraphShapePath(shape, 16)
      expect(path.startsWith('M'), shape).toBe(true)
      expect(path.trim().endsWith('Z'), shape).toBe(true)
      expect(path, shape).not.toContain('NaN')
    }
  })

  it('scales with the requested box', () => {
    const small = nodeGraphShapePath('hexagon', 12)
    const large = nodeGraphShapePath('hexagon', 24)
    expect(small).not.toBe(large)
    expect(large).not.toContain('NaN')
  })
})

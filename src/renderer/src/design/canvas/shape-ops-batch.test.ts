import { describe, expect, it, beforeEach } from 'vitest'
import { executeOps } from './shape-ops'
import { useCanvasShapeStore } from './canvas-shape-store'
import { useCanvasUndoStore } from './canvas-undo-store'
import { useCanvasSelectionStore } from './canvas-selection-store'
import { useDesignSystemStore } from './design-system-store'
import { setScreenArtifactFactory } from './screen-artifact-bridge'
import { createEmptyDocument, type CanvasShape } from './canvas-types'

beforeEach(() => {
  useCanvasShapeStore.getState().loadDocument(createEmptyDocument())
  useCanvasUndoStore.getState().clear()
  useCanvasSelectionStore.getState().clearSelection()
  useDesignSystemStore.getState().resetSystem()
})

function getShape(id: string): CanvasShape {
  return useCanvasShapeStore.getState().getShape(id) as CanvasShape
}
function addRect(x: number, y: number, w = 100, h = 80, parentId?: string): string {
  const op = parentId
    ? { op: 'add' as const, shape: { type: 'rect' as const, x, y, width: w, height: h }, parentId }
    : { op: 'add' as const, shape: { type: 'rect' as const, x, y, width: w, height: h } }
  return executeOps([op]).affectedIds[0]
}

describe('grid', () => {
  it('lays a frame’s children out on a grid by cell size + gaps', () => {
    const frame = executeOps([
      { op: 'add', shape: { type: 'frame', name: 'Grid', x: 0, y: 0, width: 500, height: 500 } }
    ]).affectedIds[0]
    const ids = [0, 1, 2, 3].map((i) => addRect(i * 7, i * 7, 100, 80, frame))
    const r = executeOps([{ op: 'grid', id: frame, cols: 2, rowGap: 10, colGap: 10 }])
    expect(r.ok).toBe(true)
    const pos = ids.map((id) => [getShape(id).x, getShape(id).y])
    // cellW 100 + colGap 10 = 110 step; cellH 80 + rowGap 10 = 90 step
    expect(pos).toEqual([
      [0, 0],
      [110, 0],
      [0, 90],
      [110, 90]
    ])
  })
})

describe('stack', () => {
  it('wraps shapes in an auto-layout container and reflows them', () => {
    const a = addRect(0, 0, 50, 50)
    const b = addRect(200, 0, 50, 50)
    const r = executeOps([{ op: 'stack', ids: [a, b], direction: 'horizontal', gap: 10 }])
    expect(r.ok).toBe(true)
    const sa = getShape(a)
    const sb = getShape(b)
    expect(sa.parentId).toBe(sb.parentId)
    const container = getShape(sa.parentId as string)
    expect(container.layout?.direction).toBe('horizontal')
    // horizontal row: b sits one width + gap to the right of a, regardless of padding
    expect(sb.x - sa.x).toBe(sa.width + 10)
  })
})

describe('bulk-edit', () => {
  it('applies a style to every shape matching a type filter', () => {
    const r1 = addRect(0, 0)
    const r2 = addRect(120, 0)
    const e = executeOps([{ op: 'add', shape: { type: 'ellipse', x: 0, y: 120, width: 50, height: 50 } }])
      .affectedIds[0]
    const red = { fills: [{ type: 'solid' as const, color: '#ff0000', opacity: 1 }] }
    const r = executeOps([{ op: 'bulk-edit', filter: { type: 'rect' }, set: red }])
    expect(r.ok).toBe(true)
    expect(r.affectedIds.sort()).toEqual([r1, r2].sort())
    expect(getShape(r1).fills[0]).toEqual(red.fills[0])
    expect(getShape(e).fills[0]).not.toEqual(red.fills[0])
  })

  it('targets token-bound shapes via boundToken', () => {
    executeOps([{ op: 'define-token', name: 'brand/primary', kind: 'color', value: '#111' }])
    const bound1 = addRect(0, 0)
    const bound2 = addRect(120, 0)
    const free = addRect(240, 0)
    executeOps([{ op: 'apply-token', ids: [bound1, bound2], prop: 'fill', token: 'brand/primary' }])
    const r = executeOps([
      { op: 'bulk-edit', filter: { boundToken: 'brand/primary' }, set: { cornerRadius: 8 } }
    ])
    expect(r.ok).toBe(true)
    expect(getShape(bound1).cornerRadius).toBe(8)
    expect(getShape(bound2).cornerRadius).toBe(8)
    expect(getShape(free).cornerRadius).toBe(0)
  })

  it('reports when the filter matches nothing', () => {
    addRect(0, 0)
    const r = executeOps([{ op: 'bulk-edit', filter: { type: 'image' }, set: { opacity: 0.5 } }])
    expect(r.ok).toBe(false)
    expect(r.errors[0].code).toBe('INVALID_OP')
  })
})

describe('apply-theme + recolor', () => {
  it('apply-theme rebinds token-bound props to themed tokens and re-resolves', () => {
    executeOps([{ op: 'define-token', name: 'light/bg', kind: 'color', value: '#ffffff' }])
    executeOps([{ op: 'define-token', name: 'dark/bg', kind: 'color', value: '#000000' }])
    const r = addRect(0, 0)
    executeOps([{ op: 'apply-token', ids: [r], prop: 'fill', token: 'light/bg' }])
    executeOps([{ op: 'apply-theme', ids: [r], remap: { 'light/bg': 'dark/bg' } }])
    expect(getShape(r).fills[0]).toEqual({ type: 'solid', color: '#000000', opacity: 1 })
    expect(getShape(r).tokenBindings).toEqual({ fill: 'dark/bg' })
  })

  it('recolor swaps exact hex fills across a subtree', () => {
    const r = addRect(0, 0) // default fill #d9d9d9
    executeOps([{ op: 'recolor', ids: [r], mapping: { '#d9d9d9': '#ff0000' } }])
    const fill = getShape(r).fills[0]
    expect(fill.type === 'solid' && fill.color).toBe('#ff0000')
  })
})

describe('responsive-reflow', () => {
  it('resizes a frame to a device preset', () => {
    const f = executeOps([
      { op: 'add', shape: { type: 'frame', x: 0, y: 0, width: 1280, height: 800 } }
    ]).affectedIds[0]
    executeOps([{ op: 'responsive-reflow', frameId: f, device: 'mobile' }])
    const frame = getShape(f)
    expect(frame.width).toBe(390)
    expect(frame.height).toBe(844)
    expect(frame.devicePreset).toBe('mobile')
  })
})

describe('variant-matrix', () => {
  it('tiles base × devices × themes, reflowing + theming each cell', () => {
    executeOps([{ op: 'define-token', name: 'light/bg', kind: 'color', value: '#ffffff' }])
    executeOps([{ op: 'define-token', name: 'dark/bg', kind: 'color', value: '#000000' }])
    const base = executeOps([
      { op: 'add', shape: { type: 'frame', name: 'Screen', x: 0, y: 0, width: 1280, height: 800 } }
    ]).affectedIds[0]
    const child = addRect(20, 20, 100, 60, base)
    executeOps([{ op: 'apply-token', ids: [child], prop: 'fill', token: 'light/bg' }])

    const before = new Set(useCanvasShapeStore.getState().getAllShapeIds())
    const r = executeOps([
      {
        op: 'variant-matrix',
        baseId: base,
        devices: ['mobile', 'desktop'],
        themes: [
          { name: 'light', remap: {} },
          { name: 'dark', remap: { 'light/bg': 'dark/bg' } }
        ],
        at: { x: 0, y: 2000 }
      }
    ])
    expect(r.ok).toBe(true)
    const newShapes = useCanvasShapeStore
      .getState()
      .getAllShapeIds()
      .filter((id) => !before.has(id))
      .map(getShape)
    // 2 devices × 2 themes = 4 cells
    expect(newShapes.filter((s) => s.type === 'frame')).toHaveLength(4)
    const darkChildren = newShapes.filter(
      (s) => s.type === 'rect' && s.fills[0]?.type === 'solid' && s.fills[0].color === '#000000'
    )
    expect(darkChildren).toHaveLength(2) // dark theme × 2 devices
  })
})

describe('add-screens', () => {
  it('creates N HTML screens in one op, laid out in a row', () => {
    setScreenArtifactFactory((name) => `art_${name}`)
    const r = executeOps([
      {
        op: 'add-screens',
        specs: [{ name: 'Home' }, { name: 'Search' }, { name: 'Profile', devicePreset: 'mobile' }]
      }
    ])
    expect(r.ok).toBe(true)
    expect(r.affectedIds).toHaveLength(3)
    const shapes = r.affectedIds.map(getShape)
    expect(shapes.every((s) => Boolean(s.htmlArtifactId))).toBe(true)
    const xs = shapes.map((s) => s.x)
    expect(new Set(xs).size).toBe(3) // distinct x positions (row layout)
    setScreenArtifactFactory(null as unknown as (name: string) => string | null)
  })
})

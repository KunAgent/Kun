import { describe, expect, it, vi } from 'vitest'
import {
  annotationBounds,
  hitTestAnnotations,
  paintAnnotation,
  resizeAnnotation,
  translateAnnotation
} from './image-annotation-geometry'
import {
  commitAnnotationHistory,
  createAnnotationHistory,
  undoAnnotationHistory
} from './image-annotation-history'
import {
  createDefaultToolStyles,
  patchAnnotationStyle,
  patchToolStyle,
  type AnnotationOp
} from './image-annotation-model'

const rect: Extract<AnnotationOp, { kind: 'rect' }> = {
  id: 'rect-1',
  kind: 'rect',
  color: '#ef4444',
  opacity: 0.6,
  width: 3,
  dash: 'dashed',
  from: { x: 10, y: 20 },
  to: { x: 110, y: 80 }
}

const arrow: Extract<AnnotationOp, { kind: 'arrow' }> = {
  id: 'arrow-1',
  kind: 'arrow',
  color: '#3b82f6',
  opacity: 1,
  width: 2,
  dash: 'solid',
  arrowhead: 'arrow',
  from: { x: 0, y: 0 },
  to: { x: 100, y: 100 }
}

describe('image annotation styles', () => {
  it('derives defaults from the flattened canvas edge', () => {
    expect(createDefaultToolStyles(1280)).toMatchObject({
      pen: { width: 4 },
      arrow: { width: 4, arrowhead: 'arrow' },
      text: { fontSize: 53, fontFamily: 'sans', fontWeight: 500 }
    })
    expect(createDefaultToolStyles(320).text.fontSize).toBe(18)
  })

  it('remembers style changes independently by tool', () => {
    const initial = createDefaultToolStyles(800)
    const arrows = patchToolStyle(initial, 'arrow', { width: 9, dash: 'dotted' })
    const text = patchToolStyle(arrows, 'text', { fontFamily: 'serif', fontSize: 72 })

    expect(text.arrow).toMatchObject({ width: 9, dash: 'dotted' })
    expect(text.pen).toEqual(initial.pen)
    expect(text.text).toMatchObject({ fontFamily: 'serif', fontSize: 72 })
  })

  it('clamps editable style ranges', () => {
    expect(patchAnnotationStyle(rect, { width: 99, opacity: 0 })).toMatchObject({
      width: 24,
      opacity: 0.1
    })
  })
})

describe('image annotation geometry', () => {
  it('hits the topmost annotation in reverse paint order', () => {
    expect(hitTestAnnotations([rect, arrow], { x: 50, y: 50 }, 5)).toBe('arrow-1')
    expect(hitTestAnnotations([rect], { x: 50, y: 50 }, 5)).toBe('rect-1')
    expect(hitTestAnnotations([rect], { x: 200, y: 200 }, 5)).toBeNull()
  })

  it('moves and resizes annotations without mutating the original', () => {
    expect(translateAnnotation(arrow, 5, -10)).toMatchObject({
      from: { x: 5, y: -10 },
      to: { x: 105, y: 90 }
    })
    expect(arrow.from).toEqual({ x: 0, y: 0 })
    expect(resizeAnnotation(arrow, 'end', { x: 140, y: 60 })).toMatchObject({
      to: { x: 140, y: 60 }
    })
    expect(annotationBounds(resizeAnnotation(rect, 'nw', { x: 30, y: 40 }))).toEqual({
      x: 30,
      y: 40,
      width: 80,
      height: 40
    })
  })

  it('renders opacity and dash style through Canvas 2D', () => {
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      setLineDash: vi.fn(),
      strokeRect: vi.fn()
    } as unknown as CanvasRenderingContext2D

    paintAnnotation(context, rect)

    expect(context.globalAlpha).toBe(0.6)
    expect(context.setLineDash).toHaveBeenCalledWith([9, 6])
    expect(context.strokeRect).toHaveBeenCalledWith(10, 20, 100, 60)
  })
})

describe('image annotation history', () => {
  it('undoes a committed object edit as one snapshot', () => {
    const initial = createAnnotationHistory([rect])
    const moved = translateAnnotation(rect, 20, 10)
    const committed = commitAnnotationHistory(initial, [moved])

    expect(committed.past).toHaveLength(1)
    expect(undoAnnotationHistory(committed).present).toEqual([rect])
  })
})

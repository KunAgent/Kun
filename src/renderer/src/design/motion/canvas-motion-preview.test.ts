import { describe, expect, it } from 'vitest'
import { createDefaultShape, createEmptyDocument, type CanvasShape } from '../canvas/canvas-types'
import { applyMotionPreset } from './canvas-motion-mutations'
import {
  applyCanvasMotionTarget,
  projectCanvasMotionObjects,
  resolveCanvasMotionPortalStyle,
  resetCanvasMotionTarget,
  resolveCanvasMotionPreviewValues
} from './canvas-motion-preview'

class FakeMotionElement {
  readonly style: Record<string, string> = {}
  private readonly attributes = new Map<string, string>()

  constructor(kind: 'svg' | 'selection' | 'portal') {
    this.attributes.set('data-canvas-motion-kind', kind)
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }
}

function motionShape(): CanvasShape {
  return {
    ...createDefaultShape('rect', 10, 20),
    id: 'moving-card',
    width: 100,
    height: 50,
    rotation: 10,
    opacity: 0.75
  }
}

describe('canvas motion preview targets', () => {
  it('layers native SVG motion outside the persisted static transform and resets it', () => {
    const shape = motionShape()
    const element = new FakeMotionElement('svg')
    const values = resolveCanvasMotionPreviewValues(shape, {
      x: 30,
      y: 50,
      rotation: 45,
      scaleX: 2,
      scaleY: 0.5,
      opacity: 0.25
    })

    applyCanvasMotionTarget(element as unknown as SVGElement, shape, values, 4)

    expect(element.getAttribute('transform')).toBe(
      'matrix(1.454122 1.331335 -0.102607 0.593758 -2.63005 -31.599172)'
    )
    expect(element.getAttribute('opacity')).toBe('0.25')

    resetCanvasMotionTarget(element as unknown as SVGElement, shape)

    expect(element.getAttribute('transform')).toBeNull()
    expect(element.getAttribute('opacity')).toBe('0.75')
  })

  it('converts portal translation to screen pixels while preserving absolute rotation', () => {
    const shape = motionShape()
    const element = new FakeMotionElement('portal')
    const values = resolveCanvasMotionPreviewValues(shape, {
      x: 30,
      y: 50,
      rotation: 45,
      scaleX: 2,
      scaleY: 0.5,
      opacity: 0.25
    })

    applyCanvasMotionTarget(element as unknown as HTMLElement, shape, values, 1.5)

    expect(element.style).toMatchObject({
      transform: 'translate(30px, 45px) rotate(45deg) scale(2, 0.5)',
      transformOrigin: 'center',
      opacity: '0.25'
    })

    resetCanvasMotionTarget(element as unknown as HTMLElement, shape)

    expect(element.style).toMatchObject({
      transform: 'rotate(10deg)',
      transformOrigin: 'center',
      opacity: '0.75'
    })
  })

  it('keeps selection projection opacity separate and removes its transient transform', () => {
    const shape = motionShape()
    const element = new FakeMotionElement('selection')
    element.setAttribute('opacity', 'selection-owned')

    applyCanvasMotionTarget(
      element as unknown as SVGElement,
      shape,
      resolveCanvasMotionPreviewValues(shape, { x: 12, opacity: 0.1 }),
      1
    )

    expect(element.getAttribute('transform')).toBe('matrix(1 0 0 1 2 0)')
    expect(element.getAttribute('opacity')).toBe('selection-owned')

    resetCanvasMotionTarget(element as unknown as SVGElement, shape)
    expect(element.getAttribute('transform')).toBeNull()
    expect(element.getAttribute('opacity')).toBe('selection-owned')
  })

  it('falls back from non-finite projections and clamps preview opacity', () => {
    const shape = motionShape()

    expect(resolveCanvasMotionPreviewValues(shape, {
      x: Number.NaN,
      y: Number.POSITIVE_INFINITY,
      opacity: 3
    })).toEqual({
      x: 10,
      y: 20,
      rotation: 10,
      scaleX: 1,
      scaleY: 1,
      opacity: 1
    })
  })

  it('projects animated parent and child geometry for selection and hit testing', () => {
    const document = createEmptyDocument()
    const frame = {
      ...createDefaultShape('frame', 0, 0),
      id: 'frame',
      parentId: document.rootId,
      children: ['child']
    }
    const child = {
      ...createDefaultShape('rect', 10, 20),
      id: 'child',
      parentId: frame.id,
      frameId: frame.id
    }
    document.objects[document.rootId] = { ...document.objects[document.rootId], children: [frame.id] }
    document.objects[frame.id] = frame
    document.objects[child.id] = child
    document.motion = applyMotionPreset(
      document.motion,
      document,
      frame.id,
      [frame.id, child.id],
      'move',
      { direction: 'right', distance: 100, durationMs: 100 }
    )

    const projected = projectCanvasMotionObjects(document, frame.id, 0)
    expect(projected.frame.x).toBeCloseTo(100)
    expect(projected.child.x).toBeCloseTo(210)

    const withGesture = projectCanvasMotionObjects(document, frame.id, 0, {
      child: { x: 130 }
    })
    expect(withGesture.child.x).toBeCloseTo(230)
    expect(document.objects.child.x).toBe(10)
  })

  it('applies ancestor motion and opacity to a portal child', () => {
    const document = createEmptyDocument()
    const frame = {
      ...createDefaultShape('frame', 0, 0),
      id: 'frame',
      opacity: 0.5,
      parentId: document.rootId,
      children: ['portal']
    }
    const portal = {
      ...createDefaultShape('frame', 10, 20),
      id: 'portal',
      opacity: 0.8,
      parentId: frame.id,
      frameId: frame.id
    }
    document.objects[document.rootId] = { ...document.objects[document.rootId], children: [frame.id] }
    document.objects[frame.id] = frame
    document.objects[portal.id] = portal
    document.motion = applyMotionPreset(
      document.motion,
      document,
      frame.id,
      [frame.id],
      'move',
      { direction: 'right', distance: 100, durationMs: 100 }
    )

    expect(resolveCanvasMotionPortalStyle(document, portal, frame.id, 0, 2)).toMatchObject({
      opacity: 0.4,
      transform: 'translate(200px, 0px)',
      transformOrigin: 'center'
    })
  })

  it('scales a portal around its center without introducing translation drift', () => {
    const document = createEmptyDocument()
    const frame = {
      ...createDefaultShape('frame', 0, 0),
      id: 'frame',
      parentId: document.rootId,
      children: ['portal']
    }
    const portal = {
      ...createDefaultShape('frame', 100, 40),
      id: 'portal',
      width: 100,
      height: 60,
      parentId: frame.id,
      frameId: frame.id
    }
    document.objects[document.rootId] = { ...document.objects[document.rootId], children: [frame.id] }
    document.objects[frame.id] = frame
    document.objects[portal.id] = portal
    document.motion = applyMotionPreset(
      document.motion,
      document,
      frame.id,
      [portal.id],
      'scale',
      { scaleFrom: 2, durationMs: 100 }
    )

    expect(resolveCanvasMotionPortalStyle(document, portal, frame.id, 0, 2)).toMatchObject({
      transform: 'scale(2, 2)',
      transformOrigin: 'center'
    })
  })

  it('recomputes offset motion from the current base geometry', () => {
    const document = createEmptyDocument()
    const frame = {
      ...createDefaultShape('frame', 0, 0),
      id: 'frame',
      parentId: document.rootId,
      children: ['child']
    }
    const child = {
      ...createDefaultShape('rect', 10, 20),
      id: 'child',
      parentId: frame.id,
      frameId: frame.id
    }
    document.objects[document.rootId] = { ...document.objects[document.rootId], children: [frame.id] }
    document.objects[frame.id] = frame
    document.objects[child.id] = child
    document.motion = applyMotionPreset(document.motion, document, frame.id, [child.id], 'move', {
      direction: 'left', distance: 30, durationMs: 100
    })
    document.objects[child.id] = { ...child, x: 50 }

    expect(projectCanvasMotionObjects(document, frame.id, 0).child.x).toBeCloseTo(20)
    expect(projectCanvasMotionObjects(document, frame.id, 100).child.x).toBeCloseTo(50)
  })
})

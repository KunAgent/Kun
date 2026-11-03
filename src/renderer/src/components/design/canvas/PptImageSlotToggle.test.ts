import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultShape, createEmptyDocument, type CanvasShape } from '../../../design/canvas/canvas-types'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { PptImageSlotToggle } from './PptImageSlotToggle'

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key })
}))

const ref = { workflowId: 'ppt_1', childId: 'child_1', slideId: 's1', revision: 1, role: 'annotation' as const }

function loadShapes(shapes: CanvasShape[]): void {
  const document = createEmptyDocument()
  const root = document.objects[document.rootId]!
  for (const shape of shapes) {
    document.objects[shape.id] = { ...shape, parentId: root.id }
    root.children.push(shape.id)
  }
  useCanvasShapeStore.getState().loadDocument(document)
}

function shape(id: string, name: string, slot: boolean): CanvasShape {
  return { ...createDefaultShape('rect', 0, 0), id, name, ...(slot ? { pptReviewRef: ref } : {}) }
}

function visibility(): Record<string, boolean> {
  const objects = useCanvasShapeStore.getState().document.objects
  return { slot: objects.slot!.visible, other: objects.other!.visible }
}

afterEach(() => {
  useCanvasShapeStore.getState().resetDocument()
})

describe('PptImageSlotToggle', () => {
  it('stays hidden without slot overlays', () => {
    loadShapes([shape('other', 'note', false)])
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(createElement(PptImageSlotToggle))
    })
    expect(renderer.toJSON()).toBeNull()
  })

  it('shows and hides every slot overlay without touching other shapes', () => {
    loadShapes([shape('slot', 'ppt-review:ppt_1:s1:slot:0:frame', true), shape('other', 'note', false)])
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(createElement(PptImageSlotToggle))
    })
    const button = renderer.root.findByProps({ 'data-testid': 'ppt-image-slot-toggle' })
    expect(button.props['aria-pressed']).toBe(true)
    act(() => button.props.onClick())
    expect(visibility()).toEqual({ slot: false, other: true })
    act(() => renderer.root.findByProps({ 'data-testid': 'ppt-image-slot-toggle' }).props.onClick())
    expect(visibility()).toEqual({ slot: true, other: true })
  })
})

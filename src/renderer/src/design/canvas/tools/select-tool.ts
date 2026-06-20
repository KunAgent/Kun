import { useCanvasSelectionStore } from '../canvas-selection-store'
import { useCanvasShapeStore } from '../canvas-shape-store'
import { useCanvasUndoStore } from '../canvas-undo-store'
import { hitTest, hitTestAll } from '../canvas-hit-test'
import type { CanvasPointerEvent, CanvasToolHandler } from './tool-types'

type DragMode = 'none' | 'move' | 'marquee'

export function createSelectTool(): CanvasToolHandler {
  let dragMode: DragMode = 'none'
  let dragStartX = 0
  let dragStartY = 0
  let dragShapeStartPositions: Map<string, { x: number; y: number }> = new Map()

  return {
    cursor: 'default',

    onPointerDown(e: CanvasPointerEvent) {
      const doc = useCanvasShapeStore.getState().document
      const selection = useCanvasSelectionStore.getState()
      const hitId = hitTest(doc, e.canvasX, e.canvasY)

      if (hitId) {
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          selection.toggle(hitId)
        } else if (!selection.selectedIds.has(hitId)) {
          selection.select([hitId])
        }

        dragMode = 'move'
        dragStartX = e.canvasX
        dragStartY = e.canvasY
        dragShapeStartPositions = new Map()
        const ids = useCanvasSelectionStore.getState().selectedIds
        for (const id of ids) {
          const shape = doc.objects[id]
          if (shape) dragShapeStartPositions.set(id, { x: shape.x, y: shape.y })
        }
      } else {
        if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
          selection.clearSelection()
        }
        dragMode = 'marquee'
        dragStartX = e.canvasX
        dragStartY = e.canvasY
        selection.setMarquee({ x: e.canvasX, y: e.canvasY, width: 0, height: 0 })
      }
    },

    onPointerMove(e: CanvasPointerEvent) {
      if (dragMode === 'move') {
        const dx = e.canvasX - dragStartX
        const dy = e.canvasY - dragStartY
        const store = useCanvasShapeStore.getState()
        for (const [id, start] of dragShapeStartPositions) {
          store.updateShape(id, { x: start.x + dx, y: start.y + dy }, true)
        }
      } else if (dragMode === 'marquee') {
        const x = Math.min(dragStartX, e.canvasX)
        const y = Math.min(dragStartY, e.canvasY)
        const width = Math.abs(e.canvasX - dragStartX)
        const height = Math.abs(e.canvasY - dragStartY)
        useCanvasSelectionStore.getState().setMarquee({ x, y, width, height })
      } else {
        const doc = useCanvasShapeStore.getState().document
        const hoverId = hitTest(doc, e.canvasX, e.canvasY)
        useCanvasSelectionStore.getState().setHoverTarget(hoverId)
      }
    },

    onPointerUp(e: CanvasPointerEvent) {
      if (dragMode === 'move') {
        const dx = e.canvasX - dragStartX
        const dy = e.canvasY - dragStartY
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          const patches = []
          for (const [id, start] of dragShapeStartPositions) {
            patches.push({
              id,
              before: { x: start.x, y: start.y },
              after: { x: start.x + dx, y: start.y + dy }
            })
          }
          if (patches.length > 0) {
            useCanvasUndoStore.getState().pushChange({ patches })
          }
        }
      } else if (dragMode === 'marquee') {
        const marquee = useCanvasSelectionStore.getState().marqueeRect
        if (marquee && marquee.width > 2 && marquee.height > 2) {
          const doc = useCanvasShapeStore.getState().document
          const hits = hitTestAll(doc, marquee)
          if (hits.length > 0) {
            useCanvasSelectionStore.getState().select(hits)
          }
        }
        useCanvasSelectionStore.getState().setMarquee(null)
      }

      dragMode = 'none'
      dragShapeStartPositions = new Map()
    }
  }
}

import { useCanvasSelectionStore } from '../canvas-selection-store'
import { useCanvasShapeStore } from '../canvas-shape-store'
import { useCanvasViewportStore } from '../canvas-viewport-store'
import { createDefaultShape } from '../canvas-types'
import type { CanvasPointerEvent, CanvasToolHandler } from './tool-types'

export function createRectTool(): CanvasToolHandler {
  let drawing = false
  let startX = 0
  let startY = 0
  let previewId: string | null = null

  return {
    cursor: 'crosshair',

    onPointerDown(e: CanvasPointerEvent) {
      drawing = true
      startX = e.canvasX
      startY = e.canvasY

      const shape = createDefaultShape('rect', e.canvasX, e.canvasY)
      shape.width = 0
      shape.height = 0
      previewId = shape.id
      useCanvasShapeStore.getState().addShape(shape)
      useCanvasSelectionStore.getState().select([shape.id])
    },

    onPointerMove(e: CanvasPointerEvent) {
      if (!drawing || !previewId) return
      let x = Math.min(startX, e.canvasX)
      let y = Math.min(startY, e.canvasY)
      let w = Math.abs(e.canvasX - startX)
      let h = Math.abs(e.canvasY - startY)

      if (e.shiftKey) {
        const side = Math.max(w, h)
        w = side
        h = side
        if (e.canvasX < startX) x = startX - side
        if (e.canvasY < startY) y = startY - side
      }

      useCanvasShapeStore.getState().updateShape(previewId, { x, y, width: w, height: h }, true)
    },

    onPointerUp() {
      if (!drawing || !previewId) return
      drawing = false

      const shape = useCanvasShapeStore.getState().getShape(previewId)
      if (shape && shape.width < 2 && shape.height < 2) {
        useCanvasShapeStore.getState().updateShape(previewId, { width: 100, height: 100 }, true)
      }

      useCanvasViewportStore.getState().setActiveTool('select')
      previewId = null
    }
  }
}

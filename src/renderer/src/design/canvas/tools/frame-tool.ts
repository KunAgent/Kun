import { useCanvasSelectionStore } from '../canvas-selection-store'
import { useCanvasShapeStore } from '../canvas-shape-store'
import { useCanvasViewportStore } from '../canvas-viewport-store'
import { createDefaultShape } from '../canvas-types'
import type { CanvasPointerEvent, CanvasToolHandler } from './tool-types'

export function createFrameTool(): CanvasToolHandler {
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

      const shape = createDefaultShape('frame', e.canvasX, e.canvasY)
      shape.width = 0
      shape.height = 0
      previewId = shape.id
      useCanvasShapeStore.getState().addShape(shape)
      useCanvasSelectionStore.getState().select([shape.id])
    },

    onPointerMove(e: CanvasPointerEvent) {
      if (!drawing || !previewId) return
      const x = Math.min(startX, e.canvasX)
      const y = Math.min(startY, e.canvasY)
      const w = Math.abs(e.canvasX - startX)
      const h = Math.abs(e.canvasY - startY)
      useCanvasShapeStore.getState().updateShape(previewId, { x, y, width: w, height: h }, true)
    },

    onPointerUp() {
      if (!drawing || !previewId) return
      drawing = false

      const shape = useCanvasShapeStore.getState().getShape(previewId)
      if (shape && shape.width < 2 && shape.height < 2) {
        useCanvasShapeStore.getState().updateShape(previewId, { width: 360, height: 640 }, true)
      }

      useCanvasViewportStore.getState().setActiveTool('select')
      previewId = null
    }
  }
}

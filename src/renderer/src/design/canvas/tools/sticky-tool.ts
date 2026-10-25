import { useCanvasSelectionStore } from '../canvas-selection-store'
import { useCanvasViewportStore } from '../canvas-viewport-store'
import { createStickyShape, STICKY_HEIGHT, STICKY_WIDTH } from '../canvas-sticky'
import type { CanvasPointerEvent, CanvasToolHandler } from './tool-types'
import { addShapeForCreation, commitCreatedShapeUndo, type CreatedShapeUndo } from './creation-undo'

/** One click drops a note centered on the pointer and starts editing it. */
export function createStickyTool(): CanvasToolHandler {
  let creationUndo: CreatedShapeUndo | null = null
  let createdId: string | null = null

  return {
    cursor: 'crosshair',

    onPointerDown(e: CanvasPointerEvent) {
      const shape = createStickyShape(e.canvasX - STICKY_WIDTH / 2, e.canvasY - STICKY_HEIGHT / 2)
      creationUndo = addShapeForCreation(shape)
      createdId = shape.id
      useCanvasSelectionStore.getState().select([shape.id])
    },

    onPointerMove() {},

    onPointerUp() {
      if (!createdId) return
      useCanvasSelectionStore.getState().setEditing(createdId)
      useCanvasViewportStore.getState().setActiveTool('select')
      commitCreatedShapeUndo(creationUndo, 'create-sticky')
      creationUndo = null
      createdId = null
    }
  }
}

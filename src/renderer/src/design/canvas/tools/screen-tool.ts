import { useCanvasSelectionStore } from '../canvas-selection-store'
import { useCanvasShapeStore } from '../canvas-shape-store'
import { useCanvasViewportStore } from '../canvas-viewport-store'
import { createHtmlFrameShape, DEVICE_DIMENSIONS } from '../canvas-types'
import { getScreenArtifactFactory, getScreenCreationFactory } from '../screen-artifact-bridge'
import { defaultDevicePresetForDesignTarget, defaultFrameSizeForDesignTarget } from '../../design-context'
import { useDesignWorkspaceStore } from '../../design-workspace-store'
import type { CanvasPointerEvent, CanvasToolHandler } from './tool-types'
import { computeSnappedCreateShapeBounds } from './create-shape-bounds'
import { addShapeForCreation, commitCreatedShapeUndo, type CreatedShapeUndo } from './creation-undo'

export function createScreenTool(): CanvasToolHandler {
  let drawing = false
  let startX = 0
  let startY = 0
  let previewId: string | null = null
  let creationUndo: CreatedShapeUndo | null = null
  let clickCreateSize = defaultFrameSizeForDesignTarget('web')

  return {
    cursor: 'crosshair',

    onPointerDown(e: CanvasPointerEvent) {
      const creationFactory = getScreenCreationFactory()
      drawing = true
      startX = e.canvasX
      startY = e.canvasY

      const designTarget = useDesignWorkspaceStore.getState().designContext.designTarget
      const chosenPreset = useCanvasViewportStore.getState().screenDevicePreset
      const devicePreset = chosenPreset ?? defaultDevicePresetForDesignTarget(designTarget)
      clickCreateSize = chosenPreset ? DEVICE_DIMENSIONS[chosenPreset] : defaultFrameSizeForDesignTarget(designTarget)
      const factory = getScreenArtifactFactory()
      const artifactId = creationFactory ? '__screen_preview__' : factory?.('Screen') ?? null
      if (!artifactId) {
        drawing = false
        return
      }
      const shape = createHtmlFrameShape('Screen', e.canvasX, e.canvasY, artifactId, devicePreset)
      if (creationFactory) {
        delete shape.htmlArtifactId
        delete shape.embeddedArtifact
      }
      shape.width = 0
      shape.height = 0
      previewId = shape.id
      creationUndo = creationFactory ? null : addShapeForCreation(shape)
      if (creationFactory) useCanvasShapeStore.getState().addShape(shape, undefined, { skipUndo: true })
      useCanvasSelectionStore.getState().select([shape.id])
    },

    onPointerMove(e: CanvasPointerEvent) {
      if (!drawing || !previewId) return
      const bounds = computeSnappedCreateShapeBounds(startX, startY, e, previewId)
      useCanvasShapeStore.getState().updateShape(previewId, bounds, true)
    },

    onPointerUp() {
      if (!drawing || !previewId) return
      drawing = false

      const shape = useCanvasShapeStore.getState().getShape(previewId)
      const clickCreated = Boolean(shape && shape.width < 2 && shape.height < 2)
      if (shape && clickCreated) {
        useCanvasShapeStore.getState().updateShape(previewId, clickCreateSize, true)
      }
      const finalShape = useCanvasShapeStore.getState().getShape(previewId)
      const creationFactory = getScreenCreationFactory()
      if (creationFactory && finalShape) {
        useCanvasShapeStore.getState().deleteShape(previewId, { skipUndo: true })
        const created = creationFactory({
          name: finalShape.name || 'Screen',
          x: finalShape.x,
          y: finalShape.y,
          width: finalShape.width,
          height: finalShape.height,
          devicePreset: finalShape.devicePreset ?? defaultDevicePresetForDesignTarget(
            useDesignWorkspaceStore.getState().designContext.designTarget
          ),
          preparePreview: true,
          // A drag-drawn frame locks the drawn WIDTH as an explicit user sizing
          // (so board sync won't reset it to the default device size), while
          // the height keeps following rendered content — matching the
          // horizontal-resize semantics in SelectionOverlay. Click-create keeps
          // the default target size and stays fully content-driven ('auto').
          sizeMode: clickCreated ? 'auto' : 'manual-width-auto-height'
        })
        if (created) useCanvasSelectionStore.getState().select([created.shapeId])
      }

      useCanvasViewportStore.getState().setActiveTool('select')
      useCanvasSelectionStore.getState().setSnapGuides([])
      if (!creationFactory) commitCreatedShapeUndo(creationUndo, 'create-screen')
      previewId = null
      creationUndo = null
    }
  }
}

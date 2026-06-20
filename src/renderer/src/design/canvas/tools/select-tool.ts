import { useCanvasSelectionStore } from '../canvas-selection-store'
import { useCanvasShapeStore } from '../canvas-shape-store'
import { useCanvasUndoStore } from '../canvas-undo-store'
import { useCanvasViewportStore } from '../canvas-viewport-store'
import { hitTest, hitTestAll, getSelectionBounds } from '../canvas-hit-test'
import { findSnaps } from '../canvas-snap'
import type { Rect } from '../canvas-types'
import type { CanvasPointerEvent, CanvasToolHandler } from './tool-types'

type DragMode = 'none' | 'move' | 'marquee'

export function createSelectTool(): CanvasToolHandler {
  let dragMode: DragMode = 'none'
  let dragStartX = 0
  let dragStartY = 0
  let dragShapeStartPositions: Map<string, { x: number; y: number; width: number; height: number }> = new Map()
  let dragCollectiveStart: Rect | null = null

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
          if (shape) {
            dragShapeStartPositions.set(id, {
              x: shape.x,
              y: shape.y,
              width: shape.width,
              height: shape.height
            })
          }
        }
        dragCollectiveStart = getSelectionBounds(doc.objects, ids)
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
        let dx = e.canvasX - dragStartX
        let dy = e.canvasY - dragStartY

        // Apply snap based on the collective bbox if snap is enabled.
        const viewport = useCanvasViewportStore.getState()
        if (viewport.snapEnabled && dragCollectiveStart) {
          const moving: Rect = {
            x: dragCollectiveStart.x + dx,
            y: dragCollectiveStart.y + dy,
            width: dragCollectiveStart.width,
            height: dragCollectiveStart.height
          }
          const doc = useCanvasShapeStore.getState().document
          const staticShapes: Rect[] = []
          for (const id of Object.keys(doc.objects)) {
            if (id === doc.rootId) continue
            if (dragShapeStartPositions.has(id)) continue
            const s = doc.objects[id]
            staticShapes.push({ x: s.x, y: s.y, width: s.width, height: s.height })
          }
          const gridSize = viewport.gridVisible ? 10 : null
          const snap = findSnaps(moving, staticShapes, viewport.getZoom(), gridSize)
          dx += snap.dx
          dy += snap.dy
          useCanvasSelectionStore.getState().setSnapGuides(snap.guides)
        }

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

    onPointerUp(_e: CanvasPointerEvent) {
      if (dragMode === 'move') {
        const doc = useCanvasShapeStore.getState().document
        const patches: { id: string; before: { x: number; y: number }; after: { x: number; y: number } }[] = []
        for (const [id, start] of dragShapeStartPositions) {
          const end = doc.objects[id]
          if (!end) continue
          if (end.x !== start.x || end.y !== start.y) {
            patches.push({
              id,
              before: { x: start.x, y: start.y },
              after: { x: end.x, y: end.y }
            })
          }
        }
        if (patches.length > 0) {
          useCanvasUndoStore.getState().pushChange({ patches, label: 'move' })
        }
        useCanvasSelectionStore.getState().setSnapGuides([])
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
      dragCollectiveStart = null
    }
  }
}

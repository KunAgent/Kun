import { useCanvasSelectionStore } from '../canvas-selection-store'
import { useCanvasShapeStore, withDescendants } from '../canvas-shape-store'
import { useCanvasUndoStore } from '../canvas-undo-store'
import {
  beginAutoKeyCanvasGesture,
  commitActiveAutoKeyCanvasGesture,
  commitAutoKeyCanvasGesture,
  endAutoKeyCanvasGesture,
  hasActiveAutoKeyCanvasGesture
} from '../../motion/canvas-motion-auto-key'
import { projectCanvasMotionObjects } from '../../motion/canvas-motion-preview'
import { useCanvasMotionStore } from '../../motion/canvas-motion-store'
import { useCanvasViewportStore } from '../canvas-viewport-store'
import { hitTest, hitTestAll, getSelectionBounds } from '../canvas-hit-test'
import { findSnaps } from '../canvas-snap'
import {
  filterEditableRootShapeIds,
  filterEditableShapeIds,
  isShapeEffectivelyVisible
} from '../canvas-editability'
import { shapeGeometry, type CanvasDocument, type CanvasShape, type Rect } from '../canvas-types'
import type { ShapePatch } from '../canvas-undo-store'
import type { CanvasPointerEvent, CanvasToolHandler } from './tool-types'

type DragMode = 'none' | 'move' | 'marquee'
type MarqueeMode = 'replace' | 'add' | 'subtract'
type DragAxisLock = 'none' | 'x' | 'y'
const ALT_DUPLICATE_DRAG_THRESHOLD_PX = 3

export function createSelectTool(): CanvasToolHandler {
  let dragMode: DragMode = 'none'
  let dragStartX = 0
  let dragStartY = 0
  let dragStartClientX = 0
  let dragStartClientY = 0
  let dragShapeStartPositions: Map<string, { x: number; y: number; width: number; height: number }> = new Map()
  let dragCollectiveStart: Rect | null = null
  let dragCreatedPatches: ShapePatch[] = []
  let dragSelectionBefore: string[] | null = null
  let altDuplicatePending = false
  let marqueeMode: MarqueeMode = 'replace'

  return {
    cursor: 'default',

    onPointerDown(e: CanvasPointerEvent) {
      const baseDocument = useCanvasShapeStore.getState().document
      const doc = motionInteractionDocument(baseDocument)
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
        dragStartClientX = e.clientX
        dragStartClientY = e.clientY
        dragShapeStartPositions = new Map()
        dragCreatedPatches = []
        dragSelectionBefore = null
        altDuplicatePending = e.altKey

        const currentDoc = useCanvasShapeStore.getState().document
        const moveState = captureMoveState(currentDoc, motionInteractionDocument(currentDoc).objects)
        dragShapeStartPositions = moveState.shapeStartPositions
        dragCollectiveStart = moveState.collectiveStart
        if (!e.altKey) beginAutoKeyCanvasGesture(useCanvasSelectionStore.getState().selectedIds)
      } else {
        marqueeMode = e.altKey ? 'subtract' : e.shiftKey || e.metaKey || e.ctrlKey ? 'add' : 'replace'
        if (marqueeMode === 'replace') {
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
        if (altDuplicatePending) {
          const movedPx = Math.hypot(e.clientX - dragStartClientX, e.clientY - dragStartClientY)
          if (movedPx < ALT_DUPLICATE_DRAG_THRESHOLD_PX) return
          endAutoKeyCanvasGesture()
          const duplicateResult = duplicateCurrentSelection()
          altDuplicatePending = false
          if (duplicateResult.clonedRootIds.length > 0) {
            dragCreatedPatches = duplicateResult.patches
            dragSelectionBefore = duplicateResult.selectionBefore
            useCanvasSelectionStore.getState().select(duplicateResult.clonedRootIds)
            const clonedDoc = useCanvasShapeStore.getState().document
            const moveState = captureMoveState(clonedDoc, motionInteractionDocument(clonedDoc).objects)
            dragShapeStartPositions = moveState.shapeStartPositions
            dragCollectiveStart = moveState.collectiveStart
          }
        }

        const constrained = constrainDragDelta(e.canvasX - dragStartX, e.canvasY - dragStartY, e.shiftKey)
        let dx = constrained.dx
        let dy = constrained.dy

        // Apply snap based on the collective bbox if snap is enabled.
        const viewport = useCanvasViewportStore.getState()
        if (viewport.snapEnabled && dragCollectiveStart) {
          const moving: Rect = {
            x: dragCollectiveStart.x + dx,
            y: dragCollectiveStart.y + dy,
            width: dragCollectiveStart.width,
            height: dragCollectiveStart.height
          }
          const doc = motionInteractionDocument(useCanvasShapeStore.getState().document)
          const staticShapes = collectVisibleSnapTargets(doc, dragShapeStartPositions)
          const gridSize = viewport.gridVisible ? 10 : null
          const snap = findSnaps(moving, staticShapes, viewport.getZoom(), gridSize)
          if (constrained.axis !== 'y') dx += snap.dx
          if (constrained.axis !== 'x') dy += snap.dy
          useCanvasSelectionStore.getState().setSnapGuides(
            filterSnapGuidesForAxisLock(snap.guides, constrained.axis)
          )
        }

        const store = useCanvasShapeStore.getState()
        const motionGestureActive = hasActiveAutoKeyCanvasGesture()
        const gestureStartValues = useCanvasMotionStore.getState().gestureStartValues
        for (const [id, start] of dragShapeStartPositions) {
          if (motionGestureActive && !gestureStartValues[id]) continue
          store.updateShape(id, { x: start.x + dx, y: start.y + dy }, true)
        }
      } else if (dragMode === 'marquee') {
        const x = Math.min(dragStartX, e.canvasX)
        const y = Math.min(dragStartY, e.canvasY)
        const width = Math.abs(e.canvasX - dragStartX)
        const height = Math.abs(e.canvasY - dragStartY)
        useCanvasSelectionStore.getState().setMarquee({ x, y, width, height })
      } else {
        const doc = motionInteractionDocument(useCanvasShapeStore.getState().document)
        const hoverId = hitTest(doc, e.canvasX, e.canvasY)
        useCanvasSelectionStore.getState().setHoverTarget(hoverId)
      }
    },

    onPointerUp(_e: CanvasPointerEvent) {
      if (dragMode === 'move') {
        const motionCommitted = commitActiveAutoKeyCanvasGesture(
          dragCreatedPatches.length > 0 ? 'duplicate-move' : 'move'
        )
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
        const allPatches = [...dragCreatedPatches, ...patches]
        if (!motionCommitted && allPatches.length > 0) {
          const label = dragCreatedPatches.length > 0 ? 'duplicate-move' : 'move'
          if (!commitAutoKeyCanvasGesture(allPatches, label, dragSelectionBefore ?? undefined)) {
            useCanvasUndoStore.getState().pushChange({
              patches: allPatches,
              label,
              ...(dragSelectionBefore ? { selectionBefore: dragSelectionBefore } : {})
            })
          }
        }
        useCanvasSelectionStore.getState().setSnapGuides([])
        endAutoKeyCanvasGesture()
      } else if (dragMode === 'marquee') {
        const marquee = useCanvasSelectionStore.getState().marqueeRect
        if (marquee && marquee.width > 2 && marquee.height > 2) {
          const doc = motionInteractionDocument(useCanvasShapeStore.getState().document)
          const hits = hitTestAll(doc, marquee)
          const nextSelection = resolveMarqueeSelection(doc, hits, marqueeMode)
          if (nextSelection) {
            useCanvasSelectionStore.getState().select(nextSelection)
          }
        }
        useCanvasSelectionStore.getState().setMarquee(null)
      }

      dragMode = 'none'
      dragShapeStartPositions = new Map()
      dragCollectiveStart = null
      dragCreatedPatches = []
      dragSelectionBefore = null
      altDuplicatePending = false
      marqueeMode = 'replace'
    }
  }
}

function collectVisibleSnapTargets(
  doc: CanvasDocument,
  movingShapes: ReadonlyMap<string, unknown>
): Rect[] {
  const targets: Rect[] = []
  for (const id of Object.keys(doc.objects)) {
    if (id === doc.rootId) continue
    if (movingShapes.has(id)) continue
    if (!isShapeEffectivelyVisible(doc.objects, id)) continue
    targets.push(shapeGeometry(doc.objects[id]).selrect)
  }
  return targets
}

function constrainDragDelta(dx: number, dy: number, shiftKey: boolean): { dx: number; dy: number; axis: DragAxisLock } {
  if (!shiftKey) return { dx, dy, axis: 'none' }
  if (Math.abs(dx) >= Math.abs(dy)) return { dx, dy: 0, axis: 'x' }
  return { dx: 0, dy, axis: 'y' }
}

function filterSnapGuidesForAxisLock<T extends { axis: 'h' | 'v' }>(
  guides: T[],
  axis: DragAxisLock
): T[] {
  if (axis === 'x') return guides.filter((guide) => guide.axis === 'v')
  if (axis === 'y') return guides.filter((guide) => guide.axis === 'h')
  return guides
}

function resolveMarqueeSelection(
  doc: CanvasDocument,
  hits: string[],
  mode: MarqueeMode
): string[] | null {
  if (hits.length === 0) return null

  const current = useCanvasSelectionStore.getState().selectedIds
  if (mode === 'add') {
    return filterEditableRootShapeIds(doc, [...current, ...hits])
  }

  if (mode === 'subtract') {
    const removing = new Set(hits)
    return filterEditableRootShapeIds(
      doc,
      [...current].filter((id) => !removing.has(id))
    )
  }

  return filterEditableRootShapeIds(doc, hits)
}

function motionInteractionDocument(document: CanvasDocument): CanvasDocument {
  const state = useCanvasMotionStore.getState()
  if (!state.open || !state.activeFrameId) return document
  const objects = projectCanvasMotionObjects(
    document,
    state.activeFrameId,
    state.currentTimeMs,
    state.gestureOverrides
  )
  return objects === document.objects ? document : { ...document, objects }
}

function captureMoveState(
  doc: CanvasDocument,
  interactionObjects: Record<string, CanvasShape> = doc.objects
): {
  shapeStartPositions: Map<string, { x: number; y: number; width: number; height: number }>
  collectiveStart: Rect | null
} {
  const shapeStartPositions = new Map<string, { x: number; y: number; width: number; height: number }>()
  const ids = new Set(filterEditableShapeIds(doc, useCanvasSelectionStore.getState().selectedIds))
  // Move the selection AND its descendants: children store absolute coords,
  // so a frame no longer drags its contents along via the parent transform.
  for (const id of withDescendants(doc.objects, ids)) {
    const shape = doc.objects[id]
    if (shape) {
      shapeStartPositions.set(id, {
        x: shape.x,
        y: shape.y,
        width: shape.width,
        height: shape.height
      })
    }
  }
  // Snap against the user-visible selection bbox only (a frame's bbox already
  // encloses its children), not the expanded descendant set.
  return { shapeStartPositions, collectiveStart: getSelectionBounds(interactionObjects, ids) }
}

function duplicateCurrentSelection(): {
  clonedRootIds: string[]
  patches: ShapePatch[]
  selectionBefore: string[]
} {
  const shapeStore = useCanvasShapeStore.getState()
  const selection = useCanvasSelectionStore.getState()
  const docBefore = shapeStore.document
  const sourceRootIds = filterEditableRootShapeIds(docBefore, selection.selectedIds)
  const selectionBefore = Array.from(selection.selectedIds)
  if (sourceRootIds.length === 0) {
    return { clonedRootIds: [], patches: [], selectionBefore }
  }

  const parentChildrenBefore = new Map<string, string[]>()
  for (const id of sourceRootIds) {
    const parentId = docBefore.objects[id]?.parentId
    if (parentId && !parentChildrenBefore.has(parentId)) {
      parentChildrenBefore.set(parentId, [...(docBefore.objects[parentId]?.children ?? [])])
    }
  }

  const clonedRootIds: string[] = []
  for (const id of sourceRootIds) {
    const cloneId = useCanvasShapeStore.getState().duplicateShape(id, { skipUndo: true })
    if (cloneId) clonedRootIds.push(cloneId)
  }

  if (clonedRootIds.length === 0) {
    return { clonedRootIds: [], patches: [], selectionBefore }
  }

  const docAfter = useCanvasShapeStore.getState().document
  const patches: ShapePatch[] = []
  for (const cloneId of clonedRootIds) {
    for (const id of withDescendants(docAfter.objects, [cloneId])) {
      const shape = docAfter.objects[id]
      if (shape) patches.push({ id, before: {}, after: { ...shape } as Partial<CanvasShape> })
    }
  }
  for (const [parentId, childrenBefore] of parentChildrenBefore) {
    const parent = docAfter.objects[parentId]
    if (parent) {
      patches.push({
        id: parentId,
        before: { children: childrenBefore },
        after: { children: parent.children }
      })
    }
  }

  return { clonedRootIds, patches, selectionBefore }
}

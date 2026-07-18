import type { ShapePatch } from '../canvas/canvas-undo-store'
import { filterEditableRootShapeIds } from '../canvas/canvas-editability'
import { useCanvasUndoStore } from '../canvas/canvas-undo-store'
import { useCanvasShapeStore } from '../canvas/canvas-shape-store'
import { useCanvasMotionStore } from './canvas-motion-store'
import { evaluateMotionTarget } from './evaluator'
import { resolveOwningMotionFrameId } from './model'
import type { CanvasMotionProjection } from './canvas-motion-types'

const AUTO_KEY_SHAPE_FIELDS = new Set(['x', 'y', 'rotation', 'opacity'])

export function shouldAutoKeyCanvasGesture(patches: readonly ShapePatch[]): boolean {
  const state = useCanvasMotionStore.getState()
  if (!state.open || !state.autoKey || state.playing || state.currentTimeMs <= 0 || !state.activeFrameId) {
    return false
  }
  // Structural create/delete patches (for example Alt-drag duplicate) must keep
  // their existing shape transaction; replaying them through updateShape would
  // target objects that the rollback intentionally removed.
  if (patches.some((patch) => Object.keys(patch.before).length === 0 || Object.keys(patch.after).length === 0)) {
    return false
  }
  if (patches.some((patch) => 'width' in patch.after || 'height' in patch.after)) return false
  return patches.some((patch) => Object.keys(patch.after).some((key) => AUTO_KEY_SHAPE_FIELDS.has(key)))
}

export function beginAutoKeyCanvasGesture(ids: Iterable<string>): boolean {
  const state = useCanvasMotionStore.getState()
  if (!state.open || !state.autoKey || state.playing || state.currentTimeMs <= 0 || !state.activeFrameId) {
    return false
  }
  const document = useCanvasShapeStore.getState().document
  const timeline = document.motion?.timelines[state.activeFrameId]
  const values: Record<string, CanvasMotionProjection> = {}
  for (const id of filterEditableRootShapeIds(document, ids)) {
    const shape = document.objects[id]
    if (!shape || resolveOwningMotionFrameId(document, id) !== state.activeFrameId) continue
    const projection = timeline ? evaluateMotionTarget(timeline, id, state.currentTimeMs, {
      x: shape.x,
      y: shape.y,
      rotation: shape.rotation,
      scaleX: 1,
      scaleY: 1,
      opacity: shape.opacity
    }) : {}
    values[id] = {
      x: projection.x ?? shape.x,
      y: projection.y ?? shape.y,
      rotation: projection.rotation ?? shape.rotation,
      opacity: projection.opacity ?? shape.opacity
    }
  }
  if (Object.keys(values).length === 0) return false
  state.beginGesturePreview(values)
  return true
}

export function endAutoKeyCanvasGesture(): void {
  useCanvasMotionStore.getState().clearGesturePreview()
}

export function hasActiveAutoKeyCanvasGesture(): boolean {
  return Object.keys(useCanvasMotionStore.getState().gestureOverrides).length > 0
}

export function commitActiveAutoKeyCanvasGesture(label: string): boolean {
  const state = useCanvasMotionStore.getState()
  const entries = Object.entries(state.gestureOverrides)
  if (entries.length === 0) return false
  const store = useCanvasShapeStore.getState()
  useCanvasUndoStore.getState().withGroup(label, () => {
    for (const [id, projection] of entries) {
      const start = state.gestureStartValues[id] ?? {}
      const patch = Object.fromEntries(
        Object.entries(projection).filter(([property, value]) =>
          typeof value === 'number' &&
          Number.isFinite(value) &&
          value !== start[property as keyof CanvasMotionProjection]
        )
      ) as Partial<import('../canvas/canvas-types').CanvasShape>
      if (Object.keys(patch).length > 0) store.updateShape(id, patch, false)
    }
  })
  endAutoKeyCanvasGesture()
  return true
}

/**
 * Pointer tools preview against base shapes with skipUndo. At pointer-up, roll
 * those temporary values back and replay the final patches through updateShape
 * so supported properties become one grouped Auto-key edit.
 */
export function commitAutoKeyCanvasGesture(
  patches: ShapePatch[],
  label: string,
  _selectionBefore?: string[]
): boolean {
  if (hasActiveAutoKeyCanvasGesture()) return commitActiveAutoKeyCanvasGesture(label)
  if (!shouldAutoKeyCanvasGesture(patches)) return false
  const store = useCanvasShapeStore.getState()
  store.applyPatches(patches, 'undo')
  const eligibleIds = new Set(filterEditableRootShapeIds(
    store.document,
    patches.map((patch) => patch.id)
  ))
  useCanvasUndoStore.getState().withGroup(label, () => {
    for (const patch of patches) {
      if (eligibleIds.has(patch.id)) store.updateShape(patch.id, patch.after, false)
    }
  })
  endAutoKeyCanvasGesture()
  return true
}

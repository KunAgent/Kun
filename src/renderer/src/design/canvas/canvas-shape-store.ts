import { create } from 'zustand'
import type { CanvasMotionDocument } from '../motion/canvas-motion-types'
import {
  createEmptyMotionDocument,
  normalizeMotionDocument,
  pruneMotionDocument,
  resolveOwningMotionFrameId
} from '../motion/model'
import { useCanvasMotionStore } from '../motion/canvas-motion-store'
import { applyAutoKey } from '../motion/canvas-motion-mutations'
import type { CanvasDocument, CanvasShape } from './canvas-types'
import { createEmptyDocument, createShapeId, isArtifactFrame, ROOT_SHAPE_ID } from './canvas-types'
import { useCanvasUndoStore } from './canvas-undo-store'
import type { CanvasChange, MotionPatch, ShapePatch } from './canvas-undo-store'
import { useCanvasSelectionStore } from './canvas-selection-store'
import type { DesignOperationJournalEntry } from '../graph/design-graph-types'
import { appendOperationJournalEntryToCanvasDocument } from '../graph/canvas-operation-journal'
import {
  applyDomSourceBindingsToCanvasDocument,
  type DomSourceBindingOptions
} from '../code-binding/dom-source-adapter'

type ShapeState = {
  document: CanvasDocument
  documentKey: string | null

  loadDocument: (doc: CanvasDocument, documentKey?: string | null) => void
  resetDocument: () => void
  getShape: (id: string) => CanvasShape | undefined
  getChildren: (parentId: string) => CanvasShape[]
  getAllShapeIds: () => string[]

  addShape: (shape: CanvasShape, parentId?: string, options?: { skipUndo?: boolean }) => void
  updateShape: (id: string, patch: Partial<CanvasShape>, skipUndo?: boolean) => void
  deleteShape: (id: string, options?: { skipUndo?: boolean }) => void
  reorderShape: (id: string, newIndex: number) => void
  reparentShape: (id: string, newParentId: string, index?: number) => void
  duplicateShape: (id: string, options?: { skipUndo?: boolean }) => string | null

  setMotionDocument: (
    motion: CanvasMotionDocument,
    label?: string,
    selectionBefore?: string[]
  ) => void
  updateMotion: (
    updater: (motion: CanvasMotionDocument) => CanvasMotionDocument,
    label?: string,
    selectionBefore?: string[]
  ) => void
  applyPatches: (patches: ShapePatch[], direction: 'undo' | 'redo') => void
  applyChange: (change: CanvasChange, direction: 'undo' | 'redo') => void
  appendOperationJournalEntry: (entry: DesignOperationJournalEntry) => void
  syncDomSourceBindings: (options: DomSourceBindingOptions) => void
  undo: () => void
  redo: () => void
}

function makeUniqueName(
  objects: Record<string, CanvasShape>,
  parentId: string,
  desiredName: string
): string {
  const parent = objects[parentId]
  if (!parent) return desiredName
  const siblings = parent.children.map((cid) => objects[cid]?.name).filter(Boolean) as string[]
  if (!siblings.includes(desiredName)) return desiredName
  // Strip trailing number to find base
  const match = desiredName.match(/^(.*?)(?:\s+(\d+))?$/)
  const base = match?.[1]?.trim() || desiredName
  let n = 2
  while (siblings.includes(`${base} ${n}`)) n++
  return `${base} ${n}`
}

export function collectDescendants(objects: Record<string, CanvasShape>, id: string): string[] {
  const shape = objects[id]
  if (!shape) return []
  const result: string[] = []
  for (const childId of shape.children) {
    result.push(childId)
    result.push(...collectDescendants(objects, childId))
  }
  return result
}

/**
 * Expand a set of shape ids to include all their descendants (deduped).
 * Used by move/drag so dragging a frame carries its children — since children
 * store ABSOLUTE coords, they no longer follow the parent's transform for free.
 */
export function withDescendants(
  objects: Record<string, CanvasShape>,
  ids: Iterable<string>
): string[] {
  const out = new Set<string>()
  for (const id of ids) {
    out.add(id)
    for (const descendant of collectDescendants(objects, id)) out.add(descendant)
  }
  return [...out]
}

function applyShapePatches(
  source: Record<string, CanvasShape>,
  patches: ShapePatch[],
  direction: 'undo' | 'redo'
): Record<string, CanvasShape> {
  const objects = { ...source }
  // Undo must walk patches in reverse so chained changes (e.g. add A, then
  // update A) revert in the opposite order they were applied.
  const ordered = direction === 'undo' ? [...patches].reverse() : patches
  for (const patch of ordered) {
    const values = direction === 'undo' ? patch.before : patch.after
    if (Object.keys(values).length === 0) {
      // Empty before = the patch created the shape (undo deletes it).
      // Empty after  = the patch deleted the shape (redo deletes it).
      delete objects[patch.id]
    } else if (objects[patch.id]) {
      objects[patch.id] = { ...objects[patch.id], ...values }
    } else {
      objects[patch.id] = values as CanvasShape
    }
  }
  return objects
}

function sameMotionDocument(left: CanvasMotionDocument, right: CanvasMotionDocument): boolean {
  if (left === right) return true
  // Canonical motion documents have deterministic object/track/keyframe order.
  // Comparing their bounded serialized form avoids no-op undo entries while
  // keeping the mutation API immutable and simple.
  return JSON.stringify(left) === JSON.stringify(right)
}

function preserveMotionReferenceWhenUnchanged(
  before: CanvasMotionDocument,
  candidate: CanvasMotionDocument
): CanvasMotionDocument {
  return sameMotionDocument(before, candidate) ? before : candidate
}

function deepCloneShape(
  objects: Record<string, CanvasShape>,
  id: string,
  newParentId: string | null,
  newFrameId: string | null
): { clones: CanvasShape[]; rootId: string } {
  const shape = objects[id]
  if (!shape) return { clones: [], rootId: '' }
  const newId = createShapeId()
  const childFrameId = shape.type === 'frame' ? newId : newFrameId
  const clonedChildren: string[] = []
  const allClones: CanvasShape[] = []

  for (const childId of shape.children) {
    const result = deepCloneShape(objects, childId, newId, childFrameId)
    clonedChildren.push(result.rootId)
    allClones.push(...result.clones)
  }

  const clone: CanvasShape = {
    ...shape,
    id: newId,
    name: `${shape.name} copy`,
    parentId: newParentId,
    frameId: newFrameId,
    children: clonedChildren
  }
  delete clone.htmlArtifactId
  delete clone.embeddedArtifact
  allClones.push(clone)
  return { clones: allClones, rootId: newId }
}

export const useCanvasShapeStore = create<ShapeState>((set, get) => ({
  document: createEmptyDocument(),
  documentKey: null,

  loadDocument: (doc, documentKey = null) => {
    useCanvasUndoStore.getState().clear()
    // A same-key late disk load/merge is not a workspace switch; preserving
    // transient authoring state avoids collapsing the dock while the current
    // document is still settling. Null keys carry no identity, so treat them
    // conservatively as a switch.
    if (documentKey === null || documentKey !== get().documentKey) {
      useCanvasMotionStore.getState().reset()
    }
    const motion = pruneMotionDocument(doc.motion, doc)
    set({ document: { ...doc, motion }, documentKey })
  },

  resetDocument: () => {
    useCanvasUndoStore.getState().clear()
    useCanvasMotionStore.getState().reset()
    set({ document: createEmptyDocument(), documentKey: null })
  },

  getShape: (id) => get().document.objects[id],

  getChildren: (parentId) => {
    const { objects } = get().document
    const parent = objects[parentId]
    if (!parent) return []
    return parent.children.map((cid) => objects[cid]).filter(Boolean)
  },

  getAllShapeIds: () => {
    const { objects, rootId } = get().document
    return Object.keys(objects).filter((id) => id !== rootId)
  },

  addShape: (shape, parentId, options) => {
    const pid = parentId ?? get().document.rootId
    const patches: ShapePatch[] = []

    set((s) => {
      const objects = { ...s.document.objects }
      const parent = objects[pid]
      if (!parent) return s
      if (isArtifactFrame(parent) || (isArtifactFrame(shape) && pid !== s.document.rootId)) return s

      // Make name unique among siblings so layers panel + AI naming stays unambiguous.
      const uniqueName = makeUniqueName(objects, pid, shape.name)
      const placed = { ...shape, name: uniqueName, parentId: pid }
      if (parent.type === 'frame' && pid !== s.document.rootId) {
        placed.frameId = pid
      }

      objects[shape.id] = placed
      const children =
        pid === s.document.rootId && !isArtifactFrame(placed)
          ? [
              ...parent.children.filter((childId) => !isArtifactFrame(objects[childId])),
              shape.id,
              ...parent.children.filter((childId) => isArtifactFrame(objects[childId]))
            ]
          : [...parent.children, shape.id]
      objects[pid] = { ...parent, children }

      patches.push(
        { id: shape.id, before: {}, after: { ...placed } },
        {
          id: pid,
          before: { children: parent.children },
          after: { children: objects[pid].children }
        }
      )

      return { document: { ...s.document, objects } }
    })

    if (!options?.skipUndo) {
      useCanvasUndoStore.getState().pushChange({ patches, label: 'add-shape' })
    }
  },

  updateShape: (id, patch, skipUndo) => {
    const patches: ShapePatch[] = []
    let motionPatch: MotionPatch | undefined

    set((s) => {
      const shape = s.document.objects[id]
      if (!shape) return s

      let effectivePatch = patch
      let nextMotion = s.document.motion ?? createEmptyMotionDocument()
      const motionState = useCanvasMotionStore.getState()
      if (skipUndo && motionState.gestureStartValues[id]) {
        const gesturePatch: Partial<Record<'x' | 'y' | 'rotation' | 'opacity', number>> = {}
        const remainingPatch: Partial<CanvasShape> = { ...effectivePatch }
        for (const property of ['x', 'y', 'rotation', 'opacity'] as const) {
          const value = effectivePatch[property]
          if (typeof value === 'number' && Number.isFinite(value)) {
            gesturePatch[property] = value
            delete remainingPatch[property]
          }
        }
        if (Object.keys(gesturePatch).length > 0) {
          motionState.applyGesturePreviewPatch(id, gesturePatch, {
            x: shape.x,
            y: shape.y,
            rotation: shape.rotation,
            opacity: shape.opacity
          })
          effectivePatch = remainingPatch
        }
      }
      const autoKeyActive =
        !skipUndo &&
        motionState.open &&
        motionState.autoKey &&
        !motionState.playing &&
        motionState.currentTimeMs > 0 &&
        Boolean(motionState.activeFrameId)
      if (
        autoKeyActive &&
        motionState.activeFrameId &&
        resolveOwningMotionFrameId(s.document, id) !== motionState.activeFrameId
      ) return s
      if (autoKeyActive && motionState.activeFrameId) {
        const autoKeyResult = applyAutoKey(
          nextMotion,
          s.document,
          motionState.activeFrameId,
          id,
          motionState.currentTimeMs,
          patch
        )
        effectivePatch = autoKeyResult.shapePatch
        const normalized = preserveMotionReferenceWhenUnchanged(
          nextMotion,
          pruneMotionDocument(normalizeMotionDocument(autoKeyResult.motion), s.document)
        )
        if (normalized !== nextMotion) {
          motionPatch = { before: nextMotion, after: normalized }
          nextMotion = normalized
        }
      }

      const before: Partial<CanvasShape> = {}
      const after: Partial<CanvasShape> = {}
      for (const key of Object.keys(effectivePatch) as (keyof CanvasShape)[]) {
        if (effectivePatch[key] !== shape[key]) {
          ;(before as Record<string, unknown>)[key] = shape[key]
          ;(after as Record<string, unknown>)[key] = effectivePatch[key]
        }
      }
      if (Object.keys(after).length === 0 && !motionPatch) return s

      const objects = Object.keys(after).length > 0
        ? { ...s.document.objects, [id]: { ...shape, ...effectivePatch } }
        : s.document.objects
      if (Object.keys(after).length > 0) patches.push({ id, before, after })
      return { document: { ...s.document, objects, motion: nextMotion } }
    })

    if (!skipUndo && (patches.length > 0 || motionPatch)) {
      useCanvasUndoStore.getState().pushChange({ patches, motionPatch })
    }
  },

  deleteShape: (id, options) => {
    if (id === get().document.rootId) return
    const patches: ShapePatch[] = []
    let motionPatch: MotionPatch | undefined

    set((s) => {
      const objects = { ...s.document.objects }
      const shape = objects[id]
      if (!shape) return s

      const descendants = collectDescendants(objects, id)
      const allToRemove = [id, ...descendants]

      for (const rid of allToRemove) {
        const removed = objects[rid]
        if (removed) {
          patches.push({ id: rid, before: { ...removed }, after: {} })
          delete objects[rid]
        }
      }

      if (shape.parentId && objects[shape.parentId]) {
        const parent = objects[shape.parentId]
        const oldChildren = parent.children
        const newChildren = oldChildren.filter((c) => c !== id)
        objects[shape.parentId] = { ...parent, children: newChildren }
        patches.push({
          id: shape.parentId,
          before: { children: oldChildren },
          after: { children: newChildren }
        })
      }

      const nextDocument = { ...s.document, objects }
      const beforeMotion = s.document.motion ?? createEmptyMotionDocument()
      const afterMotion = preserveMotionReferenceWhenUnchanged(
        beforeMotion,
        pruneMotionDocument(beforeMotion, nextDocument)
      )
      if (afterMotion !== beforeMotion) motionPatch = { before: beforeMotion, after: afterMotion }
      return { document: { ...nextDocument, motion: afterMotion } }
    })

    if (!options?.skipUndo) {
      useCanvasUndoStore.getState().pushChange({ patches, motionPatch, label: 'delete-shape' })
    }
  },

  reorderShape: (id, newIndex) => {
    set((s) => {
      const shape = s.document.objects[id]
      if (!shape?.parentId) return s
      const parent = s.document.objects[shape.parentId]
      if (!parent) return s

      const oldChildren = parent.children
      const filtered = oldChildren.filter((c) => c !== id)
      let ordered: string[]
      if (shape.parentId === s.document.rootId) {
        // Embedded HTML/SVG frames are DOM portals rendered above the base SVG
        // scene. Keep their document order in a dedicated top portal layer so
        // Canvas root order never promises a cross-layer z-order we cannot draw.
        const normal = filtered.filter((childId) => !isArtifactFrame(s.document.objects[childId]))
        const portals = filtered.filter((childId) => isArtifactFrame(s.document.objects[childId]))
        if (isArtifactFrame(shape)) {
          const index = Math.max(0, Math.min(portals.length, newIndex - normal.length))
          portals.splice(index, 0, id)
        } else {
          const index = Math.max(0, Math.min(normal.length, newIndex))
          normal.splice(index, 0, id)
        }
        ordered = [...normal, ...portals]
      } else {
        const clamped = Math.max(0, Math.min(filtered.length, newIndex))
        filtered.splice(clamped, 0, id)
        ordered = filtered
      }

      const objects = {
        ...s.document.objects,
        [shape.parentId]: { ...parent, children: ordered }
      }

      useCanvasUndoStore.getState().pushChange({
        patches: [
          {
            id: shape.parentId,
            before: { children: oldChildren },
            after: { children: ordered }
          }
        ]
      })

      return { document: { ...s.document, objects } }
    })
  },

  reparentShape: (id, newParentId, index) => {
    const patches: ShapePatch[] = []
    let motionPatch: MotionPatch | undefined
    set((s) => {
      const shape = s.document.objects[id]
      if (!shape?.parentId) return s
      const oldParent = s.document.objects[shape.parentId]
      const newParent = s.document.objects[newParentId]
      if (!oldParent || !newParent) return s
      if (id === newParentId) return s
      if (isArtifactFrame(newParent)) return s
      if (isArtifactFrame(shape) && newParentId !== s.document.rootId) return s

      const objects = { ...s.document.objects }
      const oldChildren = oldParent.children.filter((c) => c !== id)
      objects[shape.parentId] = { ...oldParent, children: oldChildren }

      const newChildren = [...newParent.children]
      const insertAt = index ?? newChildren.length
      newChildren.splice(insertAt, 0, id)
      objects[newParentId] = { ...newParent, children: newChildren }

      objects[id] = { ...shape, parentId: newParentId }

      patches.push(
        {
          id,
          before: { parentId: shape.parentId },
          after: { parentId: newParentId }
        },
        {
          id: shape.parentId,
          before: { children: oldParent.children },
          after: { children: oldChildren }
        },
        {
          id: newParentId,
          before: { children: newParent.children },
          after: { children: newChildren }
        }
      )

      const nextDocument = { ...s.document, objects }
      const beforeMotion = s.document.motion ?? createEmptyMotionDocument()
      const afterMotion = preserveMotionReferenceWhenUnchanged(
        beforeMotion,
        pruneMotionDocument(beforeMotion, nextDocument)
      )
      if (afterMotion !== beforeMotion) motionPatch = { before: beforeMotion, after: afterMotion }
      return { document: { ...nextDocument, motion: afterMotion } }
    })
    useCanvasUndoStore.getState().pushChange({ patches, motionPatch, label: 'reparent-shape' })
  },

  duplicateShape: (id, options) => {
    const s = get()
    const shape = s.document.objects[id]
    if (!shape?.parentId) return null

    const { clones, rootId } = deepCloneShape(s.document.objects, id, shape.parentId, shape.frameId)
    if (clones.length === 0) return null

    const patches: ShapePatch[] = []
    const objects = { ...s.document.objects }

    for (const clone of clones) {
      objects[clone.id] = clone
      patches.push({ id: clone.id, before: {}, after: { ...clone } })
    }

    const parent = objects[shape.parentId]
    if (parent) {
      const oldChildren = parent.children
      const newChildren = [...oldChildren, rootId]
      objects[shape.parentId] = { ...parent, children: newChildren }
      patches.push({
        id: shape.parentId,
        before: { children: oldChildren },
        after: { children: newChildren }
      })
    }

    set({ document: { ...s.document, objects } })
    if (!options?.skipUndo) {
      useCanvasUndoStore.getState().pushChange({ patches })
    }
    return rootId
  },

  setMotionDocument: (motion, label = 'update-motion', selectionBefore) => {
    const before = get().document.motion ?? createEmptyMotionDocument()
    const after = preserveMotionReferenceWhenUnchanged(
      before,
      pruneMotionDocument(normalizeMotionDocument(motion), get().document)
    )
    if (after === before) return
    set((state) => ({ document: { ...state.document, motion: after } }))
    useCanvasUndoStore.getState().pushChange({
      patches: [],
      motionPatch: { before, after },
      label,
      selectionBefore
    })
  },

  updateMotion: (updater, label = 'update-motion', selectionBefore) => {
    const before = get().document.motion ?? createEmptyMotionDocument()
    const after = updater(before)
    get().setMotionDocument(after, label, selectionBefore)
  },

  applyPatches: (patches, direction) => {
    set((s) => ({
      document: {
        ...s.document,
        objects: applyShapePatches(s.document.objects, patches, direction)
      }
    }))
  },

  applyChange: (change, direction) => {
    set((state) => {
      const objects = applyShapePatches(state.document.objects, change.patches, direction)
      const motion = change.motionPatch
        ? direction === 'undo'
          ? change.motionPatch.before
          : change.motionPatch.after
        : state.document.motion
      return { document: { ...state.document, objects, motion } }
    })
  },

  appendOperationJournalEntry: (entry) => {
    set((s) => ({
      document: appendOperationJournalEntryToCanvasDocument(s.document, entry)
    }))
  },

  syncDomSourceBindings: (options) => {
    if (options.matches.length === 0) return
    const scopeDesignObjectIds = options.scopeDesignObjectIds ?? [
      ...new Set(options.matches.map((match) => match.designObjectId))
    ]
    set((s) => ({
      document: applyDomSourceBindingsToCanvasDocument(s.document, {
        ...options,
        scopeDesignObjectIds
      })
    }))
  },

  undo: () => {
    const change = useCanvasUndoStore.getState().undo()
    if (!change) return
    get().applyChange(change, 'undo')
    useCanvasSelectionStore.getState().select(change.selectionBefore)
  },

  redo: () => {
    const change = useCanvasUndoStore.getState().redo()
    if (!change) return
    get().applyChange(change, 'redo')
    useCanvasSelectionStore.getState().select(change.selectionAfter)
  }
}))

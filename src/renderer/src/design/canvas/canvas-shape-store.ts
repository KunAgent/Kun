import { create } from 'zustand'
import type { CanvasDocument, CanvasShape } from './canvas-types'
import { createEmptyDocument, createShapeId, ROOT_SHAPE_ID } from './canvas-types'
import { useCanvasUndoStore } from './canvas-undo-store'
import type { ShapePatch } from './canvas-undo-store'
import { useCanvasSelectionStore } from './canvas-selection-store'

type ShapeState = {
  document: CanvasDocument

  loadDocument: (doc: CanvasDocument) => void
  resetDocument: () => void
  getShape: (id: string) => CanvasShape | undefined
  getChildren: (parentId: string) => CanvasShape[]
  getAllShapeIds: () => string[]

  addShape: (shape: CanvasShape, parentId?: string) => void
  updateShape: (id: string, patch: Partial<CanvasShape>, skipUndo?: boolean) => void
  deleteShape: (id: string) => void
  reorderShape: (id: string, newIndex: number) => void
  reparentShape: (id: string, newParentId: string, index?: number) => void
  duplicateShape: (id: string) => string | null

  applyPatches: (patches: ShapePatch[], direction: 'undo' | 'redo') => void
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

function collectDescendants(objects: Record<string, CanvasShape>, id: string): string[] {
  const shape = objects[id]
  if (!shape) return []
  const result: string[] = []
  for (const childId of shape.children) {
    result.push(childId)
    result.push(...collectDescendants(objects, childId))
  }
  return result
}

function deepCloneShape(
  objects: Record<string, CanvasShape>,
  id: string,
  newParentId: string | null
): { clones: CanvasShape[]; rootId: string } {
  const shape = objects[id]
  if (!shape) return { clones: [], rootId: '' }
  const newId = createShapeId()
  const clonedChildren: string[] = []
  const allClones: CanvasShape[] = []

  for (const childId of shape.children) {
    const result = deepCloneShape(objects, childId, newId)
    clonedChildren.push(result.rootId)
    allClones.push(...result.clones)
  }

  const clone: CanvasShape = {
    ...shape,
    id: newId,
    name: `${shape.name} copy`,
    parentId: newParentId,
    children: clonedChildren
  }
  allClones.push(clone)
  return { clones: allClones, rootId: newId }
}

export const useCanvasShapeStore = create<ShapeState>((set, get) => ({
  document: createEmptyDocument(),

  loadDocument: (doc) => {
    useCanvasUndoStore.getState().clear()
    set({ document: doc })
  },

  resetDocument: () => {
    useCanvasUndoStore.getState().clear()
    set({ document: createEmptyDocument() })
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

  addShape: (shape, parentId) => {
    const pid = parentId ?? get().document.rootId
    const patches: ShapePatch[] = []

    set((s) => {
      const objects = { ...s.document.objects }
      const parent = objects[pid]
      if (!parent) return s

      // Make name unique among siblings so layers panel + AI naming stays unambiguous.
      const uniqueName = makeUniqueName(objects, pid, shape.name)
      const placed = { ...shape, name: uniqueName, parentId: pid }
      if (parent.type === 'frame' && pid !== s.document.rootId) {
        placed.frameId = pid
      }

      objects[shape.id] = placed
      objects[pid] = { ...parent, children: [...parent.children, shape.id] }

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

    useCanvasUndoStore.getState().pushChange({ patches, label: 'add-shape' })
  },

  updateShape: (id, patch, skipUndo) => {
    const patches: ShapePatch[] = []

    set((s) => {
      const shape = s.document.objects[id]
      if (!shape) return s

      const before: Partial<CanvasShape> = {}
      const after: Partial<CanvasShape> = {}
      for (const key of Object.keys(patch) as (keyof CanvasShape)[]) {
        if (patch[key] !== shape[key]) {
          ;(before as Record<string, unknown>)[key] = shape[key]
          ;(after as Record<string, unknown>)[key] = patch[key]
        }
      }
      if (Object.keys(after).length === 0) return s

      patches.push({ id, before, after })
      const objects = { ...s.document.objects, [id]: { ...shape, ...patch } }
      return { document: { ...s.document, objects } }
    })

    if (!skipUndo && patches.length > 0) {
      useCanvasUndoStore.getState().pushChange({ patches })
    }
  },

  deleteShape: (id) => {
    if (id === get().document.rootId) return
    const patches: ShapePatch[] = []

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

      return { document: { ...s.document, objects } }
    })

    useCanvasUndoStore.getState().pushChange({ patches })
  },

  reorderShape: (id, newIndex) => {
    set((s) => {
      const shape = s.document.objects[id]
      if (!shape?.parentId) return s
      const parent = s.document.objects[shape.parentId]
      if (!parent) return s

      const oldChildren = parent.children
      const filtered = oldChildren.filter((c) => c !== id)
      const clamped = Math.max(0, Math.min(filtered.length, newIndex))
      filtered.splice(clamped, 0, id)

      const objects = {
        ...s.document.objects,
        [shape.parentId]: { ...parent, children: filtered }
      }

      useCanvasUndoStore.getState().pushChange({
        patches: [
          {
            id: shape.parentId,
            before: { children: oldChildren },
            after: { children: filtered }
          }
        ]
      })

      return { document: { ...s.document, objects } }
    })
  },

  reparentShape: (id, newParentId, index) => {
    set((s) => {
      const shape = s.document.objects[id]
      if (!shape?.parentId) return s
      const oldParent = s.document.objects[shape.parentId]
      const newParent = s.document.objects[newParentId]
      if (!oldParent || !newParent) return s
      if (id === newParentId) return s

      const objects = { ...s.document.objects }
      const oldChildren = oldParent.children.filter((c) => c !== id)
      objects[shape.parentId] = { ...oldParent, children: oldChildren }

      const newChildren = [...newParent.children]
      const insertAt = index ?? newChildren.length
      newChildren.splice(insertAt, 0, id)
      objects[newParentId] = { ...newParent, children: newChildren }

      objects[id] = { ...shape, parentId: newParentId }

      const patches: ShapePatch[] = [
        { id, before: { parentId: shape.parentId }, after: { parentId: newParentId } },
        { id: shape.parentId, before: { children: oldParent.children }, after: { children: oldChildren } },
        { id: newParentId, before: { children: newParent.children }, after: { children: newChildren } }
      ]
      useCanvasUndoStore.getState().pushChange({ patches })

      return { document: { ...s.document, objects } }
    })
  },

  duplicateShape: (id) => {
    const s = get()
    const shape = s.document.objects[id]
    if (!shape?.parentId) return null

    const { clones, rootId } = deepCloneShape(s.document.objects, id, shape.parentId)
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
    useCanvasUndoStore.getState().pushChange({ patches })
    return rootId
  },

  applyPatches: (patches, direction) => {
    set((s) => {
      const objects = { ...s.document.objects }
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
      return { document: { ...s.document, objects } }
    })
  },

  undo: () => {
    const change = useCanvasUndoStore.getState().undo()
    if (!change) return
    get().applyPatches(change.patches, 'undo')
    useCanvasSelectionStore.getState().select(change.selectionBefore)
  },

  redo: () => {
    const change = useCanvasUndoStore.getState().redo()
    if (!change) return
    get().applyPatches(change.patches, 'redo')
    useCanvasSelectionStore.getState().select(change.selectionAfter)
  }
}))

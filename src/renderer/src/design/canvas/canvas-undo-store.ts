import { create } from 'zustand'
import type { CanvasMotionDocument } from '../motion/canvas-motion-types'
import type { CanvasShape } from './canvas-types'
import { useCanvasSelectionStore } from './canvas-selection-store'

export type ShapePatch = {
  id: string
  before: Partial<CanvasShape>
  after: Partial<CanvasShape>
}

export type MotionPatch = {
  before: CanvasMotionDocument
  after: CanvasMotionDocument
}

export type CanvasChange = {
  patches: ShapePatch[]
  /** Immutable document-level motion snapshot before and after the change. */
  motionPatch?: MotionPatch
  /** Set when produced inside a `withGroup` — merged from multiple `pushChange` calls. */
  groupId?: string
  /** Human-readable name, useful for debugging and (future) undo menu. */
  label?: string
  /** Selection BEFORE the change; restored on undo. */
  selectionBefore: string[]
  /** Selection AFTER the change; restored on redo. */
  selectionAfter: string[]
}

const MAX_UNDO = 50

type UndoState = {
  undoStack: CanvasChange[]
  redoStack: CanvasChange[]
  /** Non-null while inside `withGroup` — incoming patches are buffered instead of stacked. */
  activeGroupId: string | null
  activeGroupLabel: string | null
  pendingPatches: ShapePatch[]
  pendingMotionPatch: MotionPatch | null
  pendingSelectionBefore: string[]

  pushChange: (input: {
    patches: ShapePatch[]
    motionPatch?: MotionPatch
    label?: string
    /** Override the captured selection-before (default = current selection). */
    selectionBefore?: string[]
  }) => void
  /** Wrap a multi-step mutation so the whole thing becomes one undo entry. Nested calls reuse the outer group. */
  withGroup: <T>(label: string, fn: () => T) => T
  undo: () => CanvasChange | null
  redo: () => CanvasChange | null
  clear: () => void
}

let groupCounter = 0
function makeGroupId(): string {
  return `g_${++groupCounter}`
}

function currentSelection(): string[] {
  return Array.from(useCanvasSelectionStore.getState().selectedIds)
}

export const useCanvasUndoStore = create<UndoState>((set, get) => ({
  undoStack: [],
  redoStack: [],
  activeGroupId: null,
  activeGroupLabel: null,
  pendingPatches: [],
  pendingMotionPatch: null,
  pendingSelectionBefore: [],

  pushChange: (input) => {
    const motionPatch =
      input.motionPatch?.before === input.motionPatch?.after ? undefined : input.motionPatch
    if (input.patches.length === 0 && !motionPatch) return

    const state = get()

    if (state.activeGroupId !== null) {
      // Inside a group — buffer and let withGroup flush at close. Motion groups
      // preserve the first `before` and the final `after`, just like a pointer
      // gesture should undo from its final sample in one step.
      const pendingMotionPatch = motionPatch
        ? state.pendingMotionPatch
          ? {
              before: state.pendingMotionPatch.before,
              after: motionPatch.after
            }
          : motionPatch
        : state.pendingMotionPatch
      set({
        pendingPatches: [...state.pendingPatches, ...input.patches],
        pendingMotionPatch
      })
      return
    }

    const selAfter = currentSelection()
    const selBefore = input.selectionBefore ?? selAfter
    const change: CanvasChange = {
      patches: input.patches,
      motionPatch,
      label: input.label,
      selectionBefore: selBefore,
      selectionAfter: selAfter
    }
    set((s) => ({
      undoStack: [...s.undoStack.slice(-MAX_UNDO + 1), change],
      redoStack: []
    }))
  },

  withGroup: (label, fn) => {
    const state = get()
    if (state.activeGroupId !== null) {
      // Nested call — reuse the outer group. Patches still buffer into it.
      return fn()
    }

    const groupId = makeGroupId()
    const selBefore = currentSelection()
    set({
      activeGroupId: groupId,
      activeGroupLabel: label,
      pendingPatches: [],
      pendingMotionPatch: null,
      pendingSelectionBefore: selBefore
    })

    try {
      return fn()
    } finally {
      const finalState = get()
      if (finalState.activeGroupId === groupId) {
        if (finalState.pendingPatches.length > 0 || finalState.pendingMotionPatch) {
          const selAfter = currentSelection()
          const change: CanvasChange = {
            patches: finalState.pendingPatches,
            motionPatch: finalState.pendingMotionPatch ?? undefined,
            groupId,
            label,
            selectionBefore: finalState.pendingSelectionBefore,
            selectionAfter: selAfter
          }
          set((s) => ({
            undoStack: [...s.undoStack.slice(-MAX_UNDO + 1), change],
            redoStack: [],
            activeGroupId: null,
            activeGroupLabel: null,
            pendingPatches: [],
            pendingMotionPatch: null,
            pendingSelectionBefore: []
          }))
        } else {
          set({
            activeGroupId: null,
            activeGroupLabel: null,
            pendingPatches: [],
            pendingMotionPatch: null,
            pendingSelectionBefore: []
          })
        }
      }
    }
  },

  undo: () => {
    const { undoStack } = get()
    if (undoStack.length === 0) return null
    const change = undoStack[undoStack.length - 1]
    set((s) => ({
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, change]
    }))
    return change
  },

  redo: () => {
    const { redoStack } = get()
    if (redoStack.length === 0) return null
    const change = redoStack[redoStack.length - 1]
    set((s) => ({
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack, change]
    }))
    return change
  },

  clear: () =>
    set({
      undoStack: [],
      redoStack: [],
      activeGroupId: null,
      activeGroupLabel: null,
      pendingPatches: [],
      pendingMotionPatch: null,
      pendingSelectionBefore: []
    })
}))

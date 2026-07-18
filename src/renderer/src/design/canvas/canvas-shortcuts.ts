import { useCanvasViewportStore } from './canvas-viewport-store'
import { useCanvasShapeStore, withDescendants } from './canvas-shape-store'
import { useCanvasSelectionStore } from './canvas-selection-store'
import { pasteClipboardImageToCanvas } from './canvas-image-import'
import { filterEditableRootShapeIds, filterEditableShapeIds } from './canvas-editability'
import { useCanvasUndoStore } from './canvas-undo-store'
import { executeOps, type ShapeOp } from './shape-ops'
import { isArtifactFrame, type CanvasDocument, type CanvasTool } from './canvas-types'
import { zoomCanvasToContent, zoomCanvasToEditableSelection } from './canvas-focus'
import { useCanvasMotionStore } from '../motion/canvas-motion-store'
import {
  copyCanvasSelectionToClipboard,
  cutCanvasSelectionToClipboard,
  hasCanvasShapeClipboard,
  pasteCanvasShapeClipboard
} from './canvas-clipboard'

/**
 * Workspace root cached at attach time so the global keyboard handler can
 * persist pasted images to disk without threading workspaceRoot through every
 * key event. CanvasViewport sets/clears this when it mounts/unmounts the
 * listener so we never paste against a stale workspace.
 */
let pasteWorkspaceRoot: string | null = null
let temporaryHandReturnTool: CanvasTool | null = null
export function setCanvasPasteWorkspaceRoot(workspaceRoot: string | null): void {
  pasteWorkspaceRoot = workspaceRoot && workspaceRoot.trim() ? workspaceRoot.trim() : null
}

const KEY_TO_TOOL: Record<string, CanvasTool> = {
  v: 'select',
  r: 'rect',
  o: 'ellipse',
  t: 'text',
  f: 'frame',
  i: 'image',
  a: 'arrow',
  l: 'line',
  p: 'draw',
  h: 'hand'
}

function editableSelection(): string[] {
  const doc = useCanvasShapeStore.getState().document
  return filterEditableShapeIds(doc, useCanvasSelectionStore.getState().selectedIds)
}

function editableSelectionRoots(): string[] {
  const doc = useCanvasShapeStore.getState().document
  return filterEditableRootShapeIds(doc, useCanvasSelectionStore.getState().selectedIds)
}

function groupByParent(doc: CanvasDocument, ids: readonly string[]): Map<string, string[]> {
  const byParent = new Map<string, string[]>()
  for (const id of ids) {
    const parentId = doc.objects[id]?.parentId
    if (!parentId) continue
    const list = byParent.get(parentId) ?? []
    list.push(id)
    byParent.set(parentId, list)
  }
  for (const [parentId, list] of byParent) {
    const order = doc.objects[parentId]?.children ?? []
    list.sort((a, b) => order.indexOf(a) - order.indexOf(b))
  }
  return byParent
}

function reorderSelection(action: 'front' | 'back' | 'forward' | 'backward'): boolean {
  const doc = useCanvasShapeStore.getState().document
  const byParent = groupByParent(doc, editableSelectionRoots())
  const ops: ShapeOp[] = []
  for (const [parentId, ids] of byParent) {
    const order = doc.objects[parentId]?.children ?? []
    ids.sort((a, b) => {
      const diff = order.indexOf(a) - order.indexOf(b)
      return action === 'front' || action === 'backward' ? diff : -diff
    })
    for (const id of ids) ops.push({ op: 'reorder', id, action })
  }
  if (ops.length > 0) executeOps(ops, `shortcut-reorder-${action}`)
  return true
}

function groupSelection(): boolean {
  const doc = useCanvasShapeStore.getState().document
  const roots = editableSelectionRoots()
  // HTML/SVG previews are root-level DOM portals. Keep the selection intact and
  // consume the shortcut instead of sending an invalid group op that would
  // clear selection or detach the preview from canvas geometry.
  if (roots.some((id) => {
    const shape = doc.objects[id]
    return Boolean(shape && isArtifactFrame(shape))
  })) return true
  const byParent = groupByParent(doc, roots)
  const ops: ShapeOp[] = []
  for (const ids of byParent.values()) {
    if (ids.length >= 2) ops.push({ op: 'group', ids })
  }
  if (ops.length > 0) {
    executeOps(ops, 'shortcut-group', {
      selectAfter: (affectedIds) => {
        const objects = useCanvasShapeStore.getState().document.objects
        return affectedIds.filter((id) => objects[id]?.type === 'group')
      }
    })
  }
  return true
}

function ungroupSelection(): boolean {
  const doc = useCanvasShapeStore.getState().document
  const ops: ShapeOp[] = editableSelectionRoots()
    .filter((id) => doc.objects[id]?.type === 'group')
    .map((id) => ({ op: 'ungroup', id }))
  if (ops.length > 0) {
    executeOps(ops, 'shortcut-ungroup', {
      selectAfter: (affectedIds) => {
        const objects = useCanvasShapeStore.getState().document.objects
        return affectedIds.filter((id) => Boolean(objects[id]))
      }
    })
  }
  return true
}

function duplicateSelection(): boolean {
  const roots = editableSelectionRoots()
  if (roots.length === 0) return true

  const clonedIds: string[] = []
  useCanvasUndoStore.getState().withGroup('shortcut-duplicate', () => {
    const store = useCanvasShapeStore.getState()
    for (const id of roots) {
      const cloneId = store.duplicateShape(id)
      if (cloneId) clonedIds.push(cloneId)
    }
    if (clonedIds.length > 0) {
      useCanvasSelectionStore.getState().select(clonedIds)
    }
  })
  return true
}

export function handleCanvasKeyDown(e: KeyboardEvent): boolean {
  const meta = e.metaKey || e.ctrlKey
  const shift = e.shiftKey
  const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) return false

  const key = e.key.toLowerCase()

  if (meta && key === 'z') {
    e.preventDefault()
    if (shift) {
      useCanvasShapeStore.getState().redo()
    } else {
      useCanvasShapeStore.getState().undo()
    }
    return true
  }

  if (meta && key === 'a') {
    e.preventDefault()
    const doc = useCanvasShapeStore.getState().document
    const root = doc.objects[doc.rootId]
    if (root) useCanvasSelectionStore.getState().selectAll(filterEditableShapeIds(doc, root.children))
    return true
  }

  if (meta && key === 'c') {
    e.preventDefault()
    copyCanvasSelectionToClipboard()
    return true
  }

  if (meta && key === 'x') {
    e.preventDefault()
    cutCanvasSelectionToClipboard()
    return true
  }

  if (meta && key === 'v') {
    e.preventDefault()
    if (hasCanvasShapeClipboard()) {
      pasteCanvasShapeClipboard()
      return true
    }
    const vbox = useCanvasViewportStore.getState().vbox
    void pasteClipboardImageToCanvas({
      vbox,
      ...(pasteWorkspaceRoot ? { workspaceRoot: pasteWorkspaceRoot } : {})
    })
    return true
  }

  if (meta && key === 'd') {
    e.preventDefault()
    return duplicateSelection()
  }

  if (meta && key === 'g') {
    e.preventDefault()
    return shift ? ungroupSelection() : groupSelection()
  }

  if (meta && (key === '[' || key === ']')) {
    e.preventDefault()
    if (key === ']') return reorderSelection(shift ? 'front' : 'forward')
    return reorderSelection(shift ? 'back' : 'backward')
  }

  if (!meta && (key === 'delete' || key === 'backspace')) {
    e.preventDefault()
    const { clearSelection } = useCanvasSelectionStore.getState()
    for (const id of editableSelectionRoots()) {
      useCanvasShapeStore.getState().deleteShape(id)
    }
    clearSelection()
    return true
  }

  if (!meta && key.startsWith('arrow')) {
    e.preventDefault()
    const step = shift ? 10 : 1
    const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0
    const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0
    const roots = editableSelectionRoots()
    if (roots.length === 0) return true

    useCanvasUndoStore.getState().withGroup('nudge', () => {
      const store = useCanvasShapeStore.getState()
      const motion = useCanvasMotionStore.getState()
      const autoKeyNudge = motion.open && motion.autoKey && !motion.playing &&
        motion.currentTimeMs > 0 && Boolean(motion.activeFrameId)
      const ids = autoKeyNudge ? roots : withDescendants(store.document.objects, roots)
      for (const id of ids) {
        const shape = store.document.objects[id]
        if (shape) store.updateShape(id, {
          ...(dx ? { x: shape.x + dx } : {}),
          ...(dy ? { y: shape.y + dy } : {})
        })
      }
    })
    return true
  }

  if (!meta && KEY_TO_TOOL[key]) {
    e.preventDefault()
    temporaryHandReturnTool = null
    useCanvasViewportStore.getState().setActiveTool(KEY_TO_TOOL[key])
    return true
  }

  if (key === ' ' && !meta) {
    e.preventDefault()
    const currentTool = useCanvasViewportStore.getState().activeTool
    if (currentTool !== 'hand' && !temporaryHandReturnTool) {
      temporaryHandReturnTool = currentTool
    }
    useCanvasViewportStore.getState().setActiveTool('hand')
    return true
  }

  if (key === 'escape') {
    e.preventDefault()
    temporaryHandReturnTool = null
    useCanvasSelectionStore.getState().clearSelection()
    useCanvasViewportStore.getState().setActiveTool('select')
    return true
  }

  // Zoom: Cmd/Ctrl + / Cmd/Ctrl -
  if (meta && (key === '=' || key === '+')) {
    e.preventDefault()
    const s = useCanvasViewportStore.getState()
    const cx = s.vbox.x + s.vbox.width / 2
    const cy = s.vbox.y + s.vbox.height / 2
    s.zoomTo(1.2, { x: cx, y: cy })
    return true
  }
  if (meta && key === '-') {
    e.preventDefault()
    const s = useCanvasViewportStore.getState()
    const cx = s.vbox.x + s.vbox.width / 2
    const cy = s.vbox.y + s.vbox.height / 2
    s.zoomTo(1 / 1.2, { x: cx, y: cy })
    return true
  }

  // Shift+0 → zoom to 100%
  if (shift && !meta && key === '0') {
    e.preventDefault()
    useCanvasViewportStore.getState().resetView()
    return true
  }

  // Shift+1 → zoom to fit all
  if (shift && !meta && key === '1') {
    e.preventDefault()
    zoomCanvasToContent()
    return true
  }

  // Shift+2 → zoom to selection
  if (shift && !meta && key === '2') {
    e.preventDefault()
    zoomCanvasToEditableSelection()
    return true
  }

  return false
}

export function handleCanvasKeyUp(e: KeyboardEvent): void {
  if (e.key === ' ') {
    const tool = useCanvasViewportStore.getState().activeTool
    const restoreTool = temporaryHandReturnTool
    temporaryHandReturnTool = null
    if (restoreTool && tool === 'hand') {
      useCanvasViewportStore.getState().setActiveTool(restoreTool)
    }
  }
}

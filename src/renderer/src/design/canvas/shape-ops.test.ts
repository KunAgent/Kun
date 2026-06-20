import { describe, expect, it, beforeEach } from 'vitest'
import { executeOps } from './shape-ops'
import { useCanvasShapeStore } from './canvas-shape-store'
import { useCanvasUndoStore } from './canvas-undo-store'
import { useCanvasSelectionStore } from './canvas-selection-store'
import { createEmptyDocument } from './canvas-types'

beforeEach(() => {
  useCanvasShapeStore.getState().loadDocument(createEmptyDocument())
  useCanvasUndoStore.getState().clear()
  useCanvasSelectionStore.getState().clearSelection()
})

describe('executeOps validation', () => {
  it('rejects an op with unknown discriminator', () => {
    const result = executeOps([{ op: 'noSuchOp' }])
    expect(result.ok).toBe(false)
    expect(result.errors[0].code).toBe('INVALID_OP')
  })

  it('rejects an add op with missing required shape.type', () => {
    const result = executeOps([{ op: 'add', shape: {} }])
    expect(result.ok).toBe(false)
    expect(result.errors[0].code).toBe('INVALID_OP')
  })
})

describe('executeOps execution', () => {
  it('add op creates a shape and returns its id', () => {
    const r = executeOps([{ op: 'add', shape: { type: 'rect', x: 0, y: 0, width: 50, height: 50 } }])
    expect(r.ok).toBe(true)
    expect(r.affectedIds).toHaveLength(1)
    const added = useCanvasShapeStore.getState().document.objects[r.affectedIds[0]]
    expect(added?.type).toBe('rect')
    expect(added?.width).toBe(50)
  })

  it('add + update is one undo entry (atomic batch)', () => {
    const initial = useCanvasUndoStore.getState().undoStack.length
    const r = executeOps([
      { op: 'add', shape: { type: 'rect', x: 0, y: 0, width: 10, height: 10 } }
    ])
    // The first batch becomes one undo entry
    expect(useCanvasUndoStore.getState().undoStack.length).toBe(initial + 1)

    const id = r.affectedIds[0]
    const r2 = executeOps([
      { op: 'update', id, patch: { x: 100 } },
      { op: 'update', id, patch: { y: 200 } }
    ])
    expect(r2.ok).toBe(true)
    // Two updates wrapped in one batch = one new undo entry
    expect(useCanvasUndoStore.getState().undoStack.length).toBe(initial + 2)
  })

  it('update on missing shape returns a structured error with suggestion', () => {
    const r = executeOps([{ op: 'update', id: 'nope', patch: { x: 5 } }])
    expect(r.ok).toBe(false)
    expect(r.errors[0].code).toBe('SHAPE_NOT_FOUND')
    expect(r.errors[0].suggestion).toBeDefined()
  })

  it('move op shifts multiple shapes by dx/dy', () => {
    const r1 = executeOps([
      { op: 'add', shape: { type: 'rect', x: 0, y: 0, width: 10, height: 10 } },
      { op: 'add', shape: { type: 'rect', x: 50, y: 50, width: 10, height: 10 } }
    ])
    const [a, b] = r1.affectedIds
    const r2 = executeOps([{ op: 'move', ids: [a, b], dx: 5, dy: 5 }])
    expect(r2.ok).toBe(true)
    const doc = useCanvasShapeStore.getState().document
    expect(doc.objects[a].x).toBe(5)
    expect(doc.objects[b].x).toBe(55)
  })

  it('align op repositions multiple shapes', () => {
    const r1 = executeOps([
      { op: 'add', shape: { type: 'rect', x: 0, y: 0, width: 10, height: 10 } },
      { op: 'add', shape: { type: 'rect', x: 50, y: 30, width: 20, height: 20 } }
    ])
    const [a, b] = r1.affectedIds
    const r2 = executeOps([{ op: 'align', ids: [a, b], axis: 'top' }])
    expect(r2.ok).toBe(true)
    const doc = useCanvasShapeStore.getState().document
    expect(doc.objects[a].y).toBe(doc.objects[b].y)
  })

  it('distribute requires ≥3 shapes', () => {
    const r1 = executeOps([
      { op: 'add', shape: { type: 'rect', x: 0, y: 0, width: 10, height: 10 } },
      { op: 'add', shape: { type: 'rect', x: 50, y: 0, width: 10, height: 10 } }
    ])
    const [a, b] = r1.affectedIds
    // Schema gate: distribute with 2 ids fails validation
    const r2 = executeOps([{ op: 'distribute', ids: [a, b], axis: 'horizontal' }])
    expect(r2.ok).toBe(false)
    expect(r2.errors[0].code).toBe('INVALID_OP')
  })

  it('delete removes the shape and reports the affected id', () => {
    const r1 = executeOps([{ op: 'add', shape: { type: 'rect', x: 0, y: 0, width: 10, height: 10 } }])
    const id = r1.affectedIds[0]
    const r2 = executeOps([{ op: 'delete', id }])
    expect(r2.ok).toBe(true)
    expect(useCanvasShapeStore.getState().document.objects[id]).toBeUndefined()
  })
})

describe('addShape unique naming', () => {
  it('renames duplicates with " 2", " 3" etc. under the same parent', () => {
    executeOps([{ op: 'add', shape: { type: 'rect', name: 'Card', x: 0, y: 0, width: 10, height: 10 } }])
    executeOps([{ op: 'add', shape: { type: 'rect', name: 'Card', x: 0, y: 0, width: 10, height: 10 } }])
    executeOps([{ op: 'add', shape: { type: 'rect', name: 'Card', x: 0, y: 0, width: 10, height: 10 } }])
    const doc = useCanvasShapeStore.getState().document
    const root = doc.objects[doc.rootId]
    const names = root.children.map((cid) => doc.objects[cid].name)
    expect(names).toEqual(['Card', 'Card 2', 'Card 3'])
  })
})

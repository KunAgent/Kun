import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyDocument, createHtmlFrameShape, createSvgFrameShape } from './canvas-types'
import { handleCanvasKeyDown, handleCanvasKeyUp } from './canvas-shortcuts'
import { useCanvasSelectionStore } from './canvas-selection-store'
import { useCanvasShapeStore } from './canvas-shape-store'
import { useCanvasUndoStore } from './canvas-undo-store'
import { executeOps } from './shape-ops'
import { filterEditableRootShapeIds } from './canvas-editability'
import { useCanvasViewportStore } from './canvas-viewport-store'
import { clearCanvasShapeClipboard } from './canvas-clipboard'
import { useCanvasMotionStore } from '../motion/canvas-motion-store'

beforeEach(() => {
  useCanvasShapeStore.getState().loadDocument(createEmptyDocument())
  useCanvasUndoStore.getState().clear()
  useCanvasSelectionStore.getState().clearSelection()
  useCanvasViewportStore.getState().setContainerSize(1000, 500)
  useCanvasViewportStore.getState().resetView()
  useCanvasViewportStore.getState().setActiveTool('select')
  useCanvasMotionStore.getState().reset()
  clearCanvasShapeClipboard()
})

it('Auto-key nudge animates only the selected root instead of its descendants', () => {
  const { frameId, childId } = addFrameWithChild()
  useCanvasSelectionStore.getState().select([frameId])
  const motion = useCanvasMotionStore.getState()
  motion.setOpen(true)
  motion.setActiveFrameId(frameId)
  motion.setCurrentTimeMs(500)
  motion.setAutoKey(true)

  handleCanvasKeyDown(eventFor('ArrowRight'))

  const document = useCanvasShapeStore.getState().document
  expect(document.objects[frameId].x).toBe(0)
  expect(document.objects[childId].x).toBe(24)
  expect(document.motion?.timelines[frameId].tracks.map((track) => track.targetShapeId)).toEqual([frameId])
})

function eventFor(
  key: string,
  opts: Partial<Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'shiftKey'>> = {}
): KeyboardEvent {
  return {
    key,
    metaKey: opts.metaKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    target: { tagName: 'div' },
    preventDefault: vi.fn()
  } as unknown as KeyboardEvent
}

function addRect(x: number): string {
  return executeOps([
    { op: 'add', shape: { type: 'rect', x, y: 0, width: 80, height: 80 } }
  ]).affectedIds[0]
}

function addFrameWithChild(): { frameId: string; childId: string } {
  const frameId = executeOps([
    { op: 'add', shape: { type: 'frame', x: 0, y: 0, width: 200, height: 160 } }
  ]).affectedIds[0]
  const childId = executeOps([
    {
      op: 'add',
      parentId: frameId,
      shape: { type: 'rect', x: 24, y: 24, width: 80, height: 44 }
    }
  ]).affectedIds[0]
  return { frameId, childId }
}

function addHtmlFrame(): string {
  const shape = createHtmlFrameShape('Login Screen', 0, 0, 'artifact-login', 'mobile')
  useCanvasShapeStore.getState().addShape(shape)
  return shape.id
}

function rootChildren(): string[] {
  const doc = useCanvasShapeStore.getState().document
  return doc.objects[doc.rootId].children
}

describe('canvas keyboard shortcuts', () => {
  it('nudge moves editable selection and skips locked shapes', () => {
    const editable = addRect(0)
    const locked = addRect(120)
    useCanvasShapeStore.getState().updateShape(locked, { locked: true })
    useCanvasSelectionStore.getState().select([editable, locked])
    useCanvasUndoStore.getState().clear()

    expect(handleCanvasKeyDown(eventFor('ArrowRight'))).toBe(true)

    const doc = useCanvasShapeStore.getState().document
    expect(doc.objects[editable].x).toBe(1)
    expect(doc.objects[locked].x).toBe(120)
    expect(useCanvasUndoStore.getState().undoStack).toHaveLength(1)
  })

  it('shift nudge moves by ten canvas units', () => {
    const editable = addRect(0)
    useCanvasSelectionStore.getState().select([editable])
    useCanvasUndoStore.getState().clear()

    handleCanvasKeyDown(eventFor('ArrowDown', { shiftKey: true }))

    expect(useCanvasShapeStore.getState().document.objects[editable].y).toBe(10)
  })

  it('delete preserves locked and hidden selected shapes', () => {
    const editable = addRect(0)
    const locked = addRect(120)
    const hidden = addRect(240)
    const store = useCanvasShapeStore.getState()
    store.updateShape(locked, { locked: true })
    store.updateShape(hidden, { visible: false })
    useCanvasSelectionStore.getState().select([editable, locked, hidden])

    handleCanvasKeyDown(eventFor('Delete'))

    const doc = useCanvasShapeStore.getState().document
    expect(doc.objects[editable]).toBeUndefined()
    expect(doc.objects[locked]).toBeDefined()
    expect(doc.objects[hidden]).toBeDefined()
  })

  it('duplicate skips locked selected shapes', () => {
    const editable = addRect(0)
    const locked = addRect(120)
    useCanvasShapeStore.getState().updateShape(locked, { locked: true })
    useCanvasSelectionStore.getState().select([editable, locked])
    useCanvasUndoStore.getState().clear()

    handleCanvasKeyDown(eventFor('d', { metaKey: true }))

    const doc = useCanvasShapeStore.getState().document
    const selected = Array.from(useCanvasSelectionStore.getState().selectedIds)
    expect(selected).toHaveLength(1)
    expect(selected[0]).not.toBe(editable)
    expect(selected[0]).not.toBe(locked)
    expect(doc.objects[selected[0]]).toMatchObject({ name: 'Rect copy', x: 0, y: 0 })
    expect(doc.objects[locked]).toBeDefined()
    expect(useCanvasUndoStore.getState().undoStack).toHaveLength(1)

    const shapes = useCanvasShapeStore.getState().getAllShapeIds().map((id) => useCanvasShapeStore.getState().getShape(id))
    expect(shapes.filter((shape) => shape?.name.startsWith('Rect')).length).toBe(3)
  })

  it('cmd+d duplicates editable roots as one undoable selected block', () => {
    const a = addRect(0)
    const b = addRect(120)
    const grouped = executeOps([{ op: 'group', ids: [a, b] }])
    const docBefore = useCanvasShapeStore.getState().document
    const groupId = grouped.affectedIds.find((id) => docBefore.objects[id]?.type === 'group')!
    useCanvasSelectionStore.getState().select([groupId, a])
    useCanvasUndoStore.getState().clear()

    handleCanvasKeyDown(eventFor('d', { metaKey: true }))

    let doc = useCanvasShapeStore.getState().document
    const selected = Array.from(useCanvasSelectionStore.getState().selectedIds)
    expect(selected).toHaveLength(1)
    const cloneGroupId = selected[0]
    expect(cloneGroupId).not.toBe(groupId)
    expect(doc.objects[groupId].children).toEqual([a, b])
    expect(doc.objects[cloneGroupId].type).toBe('group')
    expect(doc.objects[cloneGroupId].children).toHaveLength(2)
    expect(rootChildren().filter((id) => doc.objects[id]?.type === 'group')).toHaveLength(2)
    expect(useCanvasUndoStore.getState().undoStack).toHaveLength(1)

    useCanvasShapeStore.getState().undo()
    doc = useCanvasShapeStore.getState().document
    expect(doc.objects[cloneGroupId]).toBeUndefined()
    expect(Array.from(useCanvasSelectionStore.getState().selectedIds)).toEqual([groupId, a])

    useCanvasShapeStore.getState().redo()
    doc = useCanvasShapeStore.getState().document
    expect(doc.objects[cloneGroupId]).toBeDefined()
    expect(Array.from(useCanvasSelectionStore.getState().selectedIds)).toEqual([cloneGroupId])
  })

  it('cmd+d rewrites frame ownership inside duplicated frame subtrees', () => {
    const { frameId, childId } = addFrameWithChild()
    useCanvasSelectionStore.getState().select([frameId])

    handleCanvasKeyDown(eventFor('d', { metaKey: true }))

    const doc = useCanvasShapeStore.getState().document
    const cloneFrameId = Array.from(useCanvasSelectionStore.getState().selectedIds)[0]
    const cloneChildId = doc.objects[cloneFrameId].children[0]

    expect(cloneFrameId).not.toBe(frameId)
    expect(cloneChildId).not.toBe(childId)
    expect(doc.objects[cloneFrameId]).toMatchObject({ type: 'frame', frameId: null })
    expect(doc.objects[cloneChildId]).toMatchObject({
      parentId: cloneFrameId,
      frameId: cloneFrameId
    })
  })

  it('cmd+d does not duplicate a linked html artifact id', () => {
    const frameId = addHtmlFrame()
    useCanvasSelectionStore.getState().select([frameId])

    handleCanvasKeyDown(eventFor('d', { metaKey: true }))

    const doc = useCanvasShapeStore.getState().document
    const cloneFrameId = Array.from(useCanvasSelectionStore.getState().selectedIds)[0]

    expect(cloneFrameId).not.toBe(frameId)
    expect(doc.objects[frameId].htmlArtifactId).toBe('artifact-login')
    expect(doc.objects[cloneFrameId]).toMatchObject({
      type: 'frame',
      name: 'Login Screen copy',
      devicePreset: 'mobile'
    })
    expect(doc.objects[cloneFrameId].htmlArtifactId).toBeUndefined()
  })

  it('cmd+c/v pastes a copied selection subtree as one undoable change', () => {
    const { frameId, childId } = addFrameWithChild()
    useCanvasSelectionStore.getState().select([frameId])
    useCanvasUndoStore.getState().clear()

    expect(handleCanvasKeyDown(eventFor('c', { metaKey: true }))).toBe(true)
    expect(handleCanvasKeyDown(eventFor('v', { metaKey: true }))).toBe(true)

    let doc = useCanvasShapeStore.getState().document
    const pastedFrameId = Array.from(useCanvasSelectionStore.getState().selectedIds)[0]
    expect(pastedFrameId).not.toBe(frameId)
    expect(doc.objects[pastedFrameId]).toMatchObject({
      type: 'frame',
      name: 'Frame copy',
      x: 24,
      y: 24,
      parentId: doc.rootId
    })
    const pastedChildId = doc.objects[pastedFrameId].children[0]
    expect(pastedChildId).not.toBe(childId)
    expect(doc.objects[pastedChildId]).toMatchObject({
      type: 'rect',
      x: 48,
      y: 48,
      parentId: pastedFrameId,
      frameId: pastedFrameId
    })
    expect(useCanvasUndoStore.getState().undoStack).toHaveLength(1)

    useCanvasShapeStore.getState().undo()
    doc = useCanvasShapeStore.getState().document
    expect(doc.objects[pastedFrameId]).toBeUndefined()
    expect(doc.objects[pastedChildId]).toBeUndefined()
    expect(Array.from(useCanvasSelectionStore.getState().selectedIds)).toEqual([frameId])

    useCanvasShapeStore.getState().redo()
    doc = useCanvasShapeStore.getState().document
    expect(doc.objects[pastedFrameId]).toBeDefined()
    expect(doc.objects[pastedChildId]).toBeDefined()
    expect(Array.from(useCanvasSelectionStore.getState().selectedIds)).toEqual([pastedFrameId])
  })

  it('cmd+c/v pastes linked html frames as plain frames', () => {
    const frameId = addHtmlFrame()
    useCanvasSelectionStore.getState().select([frameId])

    expect(handleCanvasKeyDown(eventFor('c', { metaKey: true }))).toBe(true)
    expect(handleCanvasKeyDown(eventFor('v', { metaKey: true }))).toBe(true)

    const doc = useCanvasShapeStore.getState().document
    const pastedFrameId = Array.from(useCanvasSelectionStore.getState().selectedIds)[0]

    expect(pastedFrameId).not.toBe(frameId)
    expect(doc.objects[frameId].htmlArtifactId).toBe('artifact-login')
    expect(doc.objects[pastedFrameId]).toMatchObject({
      type: 'frame',
      name: 'Login Screen copy',
      devicePreset: 'mobile',
      x: 24,
      y: 24
    })
    expect(doc.objects[pastedFrameId].htmlArtifactId).toBeUndefined()
  })

  it('cmd+x/v keeps the html artifact link when moving a linked frame', () => {
    const frameId = addHtmlFrame()
    useCanvasSelectionStore.getState().select([frameId])

    expect(handleCanvasKeyDown(eventFor('x', { metaKey: true }))).toBe(true)
    expect(useCanvasShapeStore.getState().document.objects[frameId]).toBeUndefined()
    expect(handleCanvasKeyDown(eventFor('v', { metaKey: true }))).toBe(true)

    const doc = useCanvasShapeStore.getState().document
    const pastedFrameId = Array.from(useCanvasSelectionStore.getState().selectedIds)[0]

    expect(pastedFrameId).not.toBe(frameId)
    expect(doc.objects[pastedFrameId]).toMatchObject({
      type: 'frame',
      name: 'Login Screen copy',
      devicePreset: 'mobile',
      htmlArtifactId: 'artifact-login'
    })
  })

  it('cmd+x cuts editable roots to the shape clipboard as one undoable change', () => {
    const { frameId, childId } = addFrameWithChild()
    useCanvasSelectionStore.getState().select([frameId, childId])
    useCanvasUndoStore.getState().clear()

    expect(handleCanvasKeyDown(eventFor('x', { metaKey: true }))).toBe(true)

    let doc = useCanvasShapeStore.getState().document
    expect(doc.objects[frameId]).toBeUndefined()
    expect(doc.objects[childId]).toBeUndefined()
    expect(Array.from(useCanvasSelectionStore.getState().selectedIds)).toEqual([])
    expect(useCanvasUndoStore.getState().undoStack).toHaveLength(1)

    expect(handleCanvasKeyDown(eventFor('v', { metaKey: true }))).toBe(true)

    doc = useCanvasShapeStore.getState().document
    const pastedFrameId = Array.from(useCanvasSelectionStore.getState().selectedIds)[0]
    const pastedChildId = doc.objects[pastedFrameId].children[0]
    expect(pastedFrameId).not.toBe(frameId)
    expect(doc.objects[pastedFrameId]).toMatchObject({
      type: 'frame',
      x: 24,
      y: 24,
      parentId: doc.rootId,
      frameId: null
    })
    expect(doc.objects[pastedChildId]).toMatchObject({
      parentId: pastedFrameId,
      frameId: pastedFrameId
    })

    useCanvasShapeStore.getState().undo()
    doc = useCanvasShapeStore.getState().document
    expect(doc.objects[pastedFrameId]).toBeUndefined()
    expect(Array.from(useCanvasSelectionStore.getState().selectedIds)).toEqual([])

    useCanvasShapeStore.getState().undo()
    doc = useCanvasShapeStore.getState().document
    expect(doc.objects[frameId]).toBeDefined()
    expect(doc.objects[childId]).toBeDefined()
    expect(Array.from(useCanvasSelectionStore.getState().selectedIds)).toEqual([frameId, childId])
  })

  it('cmd+x skips locked and hidden selected shapes', () => {
    const editable = addRect(0)
    const locked = addRect(120)
    const hidden = addRect(240)
    const store = useCanvasShapeStore.getState()
    store.updateShape(locked, { locked: true })
    store.updateShape(hidden, { visible: false })
    useCanvasSelectionStore.getState().select([editable, locked, hidden])
    useCanvasUndoStore.getState().clear()

    expect(handleCanvasKeyDown(eventFor('x', { metaKey: true }))).toBe(true)

    const doc = useCanvasShapeStore.getState().document
    expect(doc.objects[editable]).toBeUndefined()
    expect(doc.objects[locked]).toBeDefined()
    expect(doc.objects[hidden]).toBeDefined()
    expect(useCanvasUndoStore.getState().undoStack).toHaveLength(1)
  })

  it('cmd+c normalizes selected ancestors before pasting', () => {
    const { frameId, childId } = addFrameWithChild()
    useCanvasSelectionStore.getState().select([frameId, childId])

    handleCanvasKeyDown(eventFor('c', { metaKey: true }))
    handleCanvasKeyDown(eventFor('v', { metaKey: true }))

    const doc = useCanvasShapeStore.getState().document
    const frameIds = rootChildren().filter((id) => doc.objects[id]?.type === 'frame')
    expect(frameIds).toHaveLength(2)
    const pastedFrameId = frameIds.find((id) => id !== frameId)!
    expect(doc.objects[pastedFrameId].children).toHaveLength(1)
    expect(rootChildren()).not.toContain(childId)
  })

  it('editable root filtering removes selected descendants and locked shapes', () => {
    const a = addRect(0)
    const b = addRect(120)
    const locked = addRect(240)
    const grouped = executeOps([{ op: 'group', ids: [a, b] }])
    const docBefore = useCanvasShapeStore.getState().document
    const groupId = grouped.affectedIds.find((id) => docBefore.objects[id]?.type === 'group')!
    useCanvasShapeStore.getState().updateShape(locked, { locked: true })

    expect(filterEditableRootShapeIds(useCanvasShapeStore.getState().document, [groupId, a, locked])).toEqual([
      groupId
    ])
  })

  it('select all only selects editable top-level layers', () => {
    const editable = addRect(0)
    const locked = addRect(120)
    const hidden = addRect(240)
    const store = useCanvasShapeStore.getState()
    store.updateShape(locked, { locked: true })
    store.updateShape(hidden, { visible: false })

    handleCanvasKeyDown(eventFor('a', { metaKey: true }))

    expect(Array.from(useCanvasSelectionStore.getState().selectedIds)).toEqual([editable])
  })

  it('cmd+g groups editable siblings, selects the new group, and preserves undo selection', () => {
    const a = addRect(0)
    const b = addRect(120)
    const locked = addRect(240)
    useCanvasShapeStore.getState().updateShape(locked, { locked: true })
    useCanvasSelectionStore.getState().select([a, b, locked])
    useCanvasUndoStore.getState().clear()

    expect(handleCanvasKeyDown(eventFor('g', { metaKey: true }))).toBe(true)

    let doc = useCanvasShapeStore.getState().document
    const groupId = Array.from(useCanvasSelectionStore.getState().selectedIds)[0]
    expect(doc.objects[groupId].type).toBe('group')
    expect(doc.objects[groupId].children).toEqual([a, b])
    expect(doc.objects[locked].parentId).toBe(doc.rootId)
    expect(useCanvasUndoStore.getState().undoStack).toHaveLength(1)

    useCanvasShapeStore.getState().undo()
    doc = useCanvasShapeStore.getState().document
    expect(doc.objects[groupId]).toBeUndefined()
    expect(Array.from(useCanvasSelectionStore.getState().selectedIds)).toEqual([a, b, locked])

    useCanvasShapeStore.getState().redo()
    doc = useCanvasShapeStore.getState().document
    expect(doc.objects[groupId].type).toBe('group')
    expect(Array.from(useCanvasSelectionStore.getState().selectedIds)).toEqual([groupId])
  })

  it('cmd+g leaves a selection containing an SVG artifact portal at the root', () => {
    const svg = createSvgFrameShape('Motion', 0, 0, 'svg-artifact')
    useCanvasShapeStore.getState().addShape(svg)
    const rect = addRect(120)
    useCanvasSelectionStore.getState().select([svg.id, rect])
    useCanvasUndoStore.getState().clear()

    expect(handleCanvasKeyDown(eventFor('g', { metaKey: true }))).toBe(true)

    const document = useCanvasShapeStore.getState().document
    expect(document.objects[svg.id].parentId).toBe(document.rootId)
    expect(Array.from(useCanvasSelectionStore.getState().selectedIds)).toEqual([svg.id, rect])
    expect(useCanvasUndoStore.getState().undoStack).toHaveLength(0)
  })

  it('cmd+shift+g ungroups selected groups and selects their children', () => {
    const a = addRect(0)
    const b = addRect(120)
    const grouped = executeOps([{ op: 'group', ids: [a, b] }])
    const docBefore = useCanvasShapeStore.getState().document
    const groupId = grouped.affectedIds.find((id) => docBefore.objects[id]?.type === 'group')!
    useCanvasSelectionStore.getState().select([groupId])
    useCanvasUndoStore.getState().clear()

    expect(handleCanvasKeyDown(eventFor('g', { metaKey: true, shiftKey: true }))).toBe(true)

    const doc = useCanvasShapeStore.getState().document
    expect(doc.objects[groupId]).toBeUndefined()
    expect(doc.objects[a].parentId).toBe(doc.rootId)
    expect(doc.objects[b].parentId).toBe(doc.rootId)
    expect(Array.from(useCanvasSelectionStore.getState().selectedIds)).toEqual([a, b])
  })

  it('cmd+bracket reorders selected layers as a stable block', () => {
    const a = addRect(0)
    const b = addRect(120)
    const c = addRect(240)
    const d = addRect(360)
    useCanvasSelectionStore.getState().select([b, c])
    useCanvasUndoStore.getState().clear()

    expect(handleCanvasKeyDown(eventFor(']', { metaKey: true }))).toBe(true)

    expect(rootChildren()).toEqual([a, d, b, c])
    expect(useCanvasUndoStore.getState().undoStack).toHaveLength(1)
  })

  it('layer ordering shortcuts skip locked selected layers', () => {
    const a = addRect(0)
    const locked = addRect(120)
    const c = addRect(240)
    const d = addRect(360)
    useCanvasShapeStore.getState().updateShape(locked, { locked: true })
    useCanvasSelectionStore.getState().select([locked, c])
    useCanvasUndoStore.getState().clear()

    handleCanvasKeyDown(eventFor(']', { metaKey: true }))

    expect(rootChildren()).toEqual([a, locked, d, c])
  })

  it('space temporarily switches to hand and restores the previous tool on keyup', () => {
    useCanvasViewportStore.getState().setActiveTool('rect')

    expect(handleCanvasKeyDown(eventFor(' '))).toBe(true)
    expect(useCanvasViewportStore.getState().activeTool).toBe('hand')

    handleCanvasKeyUp(eventFor(' '))
    expect(useCanvasViewportStore.getState().activeTool).toBe('rect')
  })

  it('space does not restore when hand was explicitly selected', () => {
    useCanvasViewportStore.getState().setActiveTool('hand')

    expect(handleCanvasKeyDown(eventFor(' '))).toBe(true)
    handleCanvasKeyUp(eventFor(' '))

    expect(useCanvasViewportStore.getState().activeTool).toBe('hand')
  })

  it('keeps a manually chosen tool if it changes while space is held', () => {
    useCanvasViewportStore.getState().setActiveTool('text')

    handleCanvasKeyDown(eventFor(' '))
    expect(useCanvasViewportStore.getState().activeTool).toBe('hand')
    handleCanvasKeyDown(eventFor('a'))
    handleCanvasKeyUp(eventFor(' '))

    expect(useCanvasViewportStore.getState().activeTool).toBe('arrow')
  })

  it('shift+1 fits visible canvas content instead of hidden far-away layers', () => {
    addRect(0)
    const hidden = addRect(5000)
    useCanvasShapeStore.getState().updateShape(hidden, { visible: false })

    expect(handleCanvasKeyDown(eventFor('1', { shiftKey: true }))).toBe(true)

    const vbox = useCanvasViewportStore.getState().vbox
    expect(vbox.width).toBeLessThan(300)
    expect(vbox.x).toBeLessThan(0)
    expect(vbox.x + vbox.width).toBeGreaterThan(80)
    expect(vbox.x + vbox.width).toBeLessThan(300)
  })

  it('shift+2 zooms to editable selection roots and skips locked selections', () => {
    const { frameId, childId } = addFrameWithChild()
    const locked = addRect(5000)
    useCanvasShapeStore.getState().updateShape(locked, { locked: true })
    useCanvasSelectionStore.getState().select([frameId, childId, locked])

    expect(handleCanvasKeyDown(eventFor('2', { shiftKey: true }))).toBe(true)

    const vbox = useCanvasViewportStore.getState().vbox
    expect(vbox.width).toBeLessThan(600)
    expect(vbox.x).toBeLessThan(0)
    expect(vbox.x + vbox.width).toBeGreaterThan(200)
    expect(vbox.x + vbox.width).toBeLessThan(400)
  })
})

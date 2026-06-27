import { describe, expect, it } from 'vitest'
import { snapshotCanvas } from './canvas-snapshot'
import { createDefaultShape, createEmptyDocument } from './canvas-types'

describe('snapshotCanvas', () => {
  it('returns empty for a fresh document', () => {
    const snap = snapshotCanvas(createEmptyDocument())
    expect(snap.shapeCount).toBe(0)
    expect(snap.shapes).toEqual([])
  })

  it('lists shapes with name + bbox + parentName', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const rect = createDefaultShape('rect', 10, 20)
    rect.name = 'My Rect'
    rect.width = 30
    rect.height = 40
    doc.objects[rect.id] = { ...rect, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [rect.id] }

    const snap = snapshotCanvas(doc)
    expect(snap.shapeCount).toBe(1)
    expect(snap.shapes[0]).toMatchObject({
      id: rect.id,
      name: 'My Rect',
      type: 'rect',
      x: 10,
      y: 20,
      w: 30,
      h: 40,
      parentName: null
    })
  })

  it('rotation is included only when non-zero', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const flat = createDefaultShape('rect', 0, 0)
    const rotated = createDefaultShape('rect', 0, 0)
    rotated.rotation = 45
    doc.objects[flat.id] = { ...flat, parentId: doc.rootId }
    doc.objects[rotated.id] = { ...rotated, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [flat.id, rotated.id] }

    const snap = snapshotCanvas(doc)
    expect(snap.shapes[0]).not.toHaveProperty('rotation')
    expect(snap.shapes[1].rotation).toBe(45)
  })

  it('text shapes include textContent (truncated)', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const text = createDefaultShape('text', 0, 0)
    text.textContent = 'hello world'
    doc.objects[text.id] = { ...text, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [text.id] }

    const snap = snapshotCanvas(doc)
    expect(snap.shapes[0].textContent).toBe('hello world')
  })

  it('flags selected shapes so "this panel" resolves to an id', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const a = createDefaultShape('frame', 0, 0)
    const b = createDefaultShape('frame', 0, 0)
    doc.objects[a.id] = { ...a, parentId: doc.rootId }
    doc.objects[b.id] = { ...b, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [a.id, b.id] }

    const snap = snapshotCanvas(doc, new Set([b.id]))
    expect(snap.shapes[0]).not.toHaveProperty('selected')
    expect(snap.shapes[1].selected).toBe(true)
  })

  it('flags AI image holders (only when set)', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const plain = createDefaultShape('image', 0, 0)
    const holder = createDefaultShape('image', 0, 0)
    holder.aiImageHolder = true
    doc.objects[plain.id] = { ...plain, parentId: doc.rootId }
    doc.objects[holder.id] = { ...holder, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [plain.id, holder.id] }

    const snap = snapshotCanvas(doc)
    expect(snap.shapes[0]).not.toHaveProperty('aiImageHolder')
    expect(snap.shapes[1].aiImageHolder).toBe(true)
  })

  it('includes imageUrl for filled image shapes and omits it for empty holders', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const filled = createDefaultShape('image', 0, 0)
    filled.imageUrl = '.deepseekgui-images/pic.png'
    const empty = createDefaultShape('image', 0, 0)
    doc.objects[filled.id] = { ...filled, parentId: doc.rootId }
    doc.objects[empty.id] = { ...empty, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [filled.id, empty.id] }

    const snap = snapshotCanvas(doc)
    expect(snap.shapes[0].imageUrl).toBe('.deepseekgui-images/pic.png')
    expect(snap.shapes[1]).not.toHaveProperty('imageUrl')
    // Empty shape must not be flagged as aiImageHolder when not selected.
    expect(snap.shapes[1]).not.toHaveProperty('aiImageHolder')
  })

  it('skips imageUrl on shapes whose imageUrl is a data: URL (safety-net against leaked base64)', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const dataUrlShape = createDefaultShape('image', 0, 0)
    dataUrlShape.imageUrl = 'data:image/png;base64,AAAA'
    const filledShape = createDefaultShape('image', 0, 0)
    filledShape.imageUrl = '.deepseekgui-images/img-x.png'
    doc.objects[dataUrlShape.id] = { ...dataUrlShape, parentId: doc.rootId }
    doc.objects[filledShape.id] = { ...filledShape, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [dataUrlShape.id, filledShape.id] }

    const snap = snapshotCanvas(doc)
    const dataShape = snap.shapes.find((s) => s.id === dataUrlShape.id)
    const filled = snap.shapes.find((s) => s.id === filledShape.id)
    expect(dataShape).not.toHaveProperty('imageUrl')
    expect(filled?.imageUrl).toBe('.deepseekgui-images/img-x.png')
    expect(JSON.stringify(snap)).not.toContain('data:image/png;base64')
  })

  it('flags a selected data: URL image as a holder so neither rule strands the LLM', () => {
    // When persistence fails, an image shape can carry a data: URL imageUrl.
    // The snapshot drops the imageUrl (safety-net) — without this flag the
    // LLM would see an image shape with NEITHER imageUrl NOR aiImageHolder
    // and have no rule to follow. Selected data: URL images become holders so
    // the fill rule fires (generate fresh from text).
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const dataUrlImg = createDefaultShape('image', 0, 0)
    dataUrlImg.imageUrl = 'data:image/png;base64,AAAA'
    doc.objects[dataUrlImg.id] = { ...dataUrlImg, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [dataUrlImg.id] }

    const selected = snapshotCanvas(doc, new Set([dataUrlImg.id]))
    expect(selected.shapes[0].aiImageHolder).toBe(true)
    expect(selected.shapes[0]).not.toHaveProperty('imageUrl')

    // Not selected: the data: URL image stays a passive background shape; no
    // imageUrl in the snapshot but also no holder flag — neither rule fires,
    // which is correct (the user wasn't pointing at it).
    const unselected = snapshotCanvas(doc)
    expect(unselected.shapes[0]).not.toHaveProperty('aiImageHolder')
    expect(unselected.shapes[0]).not.toHaveProperty('imageUrl')
  })

  it('includes a compact style digest (fill/stroke/fontColor/cornerRadius) when set', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const rect = createDefaultShape('rect', 0, 0)
    rect.fills = [{ type: 'solid', color: '#3b82d8', opacity: 1 }]
    rect.strokes = [{ color: '#111827', width: 2, opacity: 1, position: 'inside' }]
    rect.cornerRadius = 8
    const text = createDefaultShape('text', 0, 0)
    text.fontColor = '#0a0a0a'
    doc.objects[rect.id] = { ...rect, parentId: doc.rootId }
    doc.objects[text.id] = { ...text, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [rect.id, text.id] }

    const snap = snapshotCanvas(doc)
    expect(snap.shapes[0]).toMatchObject({ fill: '#3b82d8', stroke: '#111827/2', cornerRadius: 8 })
    expect(snap.shapes[1].fontColor).toBe('#0a0a0a')
  })

  it('omits stroke when it is invisible (width 0 or opacity 0)', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const rect = createDefaultShape('rect', 0, 0)
    rect.strokes = [{ color: '#000000', width: 0, opacity: 1, position: 'inside' }]
    doc.objects[rect.id] = { ...rect, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [rect.id] }

    expect(snapshotCanvas(doc).shapes[0]).not.toHaveProperty('stroke')
  })

  it('auto-flags a selected empty box as a holder, but not when unselected or filled', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const emptyImg = createDefaultShape('image', 0, 0)
    const filledImg = createDefaultShape('image', 0, 0)
    filledImg.imageUrl = '.deepseekgui-images/pic.png'
    doc.objects[emptyImg.id] = { ...emptyImg, parentId: doc.rootId }
    doc.objects[filledImg.id] = { ...filledImg, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [emptyImg.id, filledImg.id] }

    // Both selected: the empty box becomes an implicit slot; the filled one does not.
    const selected = snapshotCanvas(doc, new Set([emptyImg.id, filledImg.id]))
    expect(selected.shapes[0].aiImageHolder).toBe(true)
    expect(selected.shapes[1]).not.toHaveProperty('aiImageHolder')

    // Nothing selected: an empty box is NOT auto-flagged, so asking for an image
    // elsewhere won't fill stray empty boxes.
    const none = snapshotCanvas(doc)
    expect(none.shapes[0]).not.toHaveProperty('aiImageHolder')
  })
})

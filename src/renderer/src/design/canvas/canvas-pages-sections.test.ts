import { beforeEach, describe, expect, it } from 'vitest'
import { activePageIdOf, addPage, claimUnpagedShapes, deletePage, duplicatePage, listPages, switchPage } from './canvas-pages'
import { createSectionFromShapes, moveSection, removeSection, toggleSectionCollapsed } from './canvas-sections'
import { parseCanvasDocument, serializeCanvasDocument } from './canvas-persistence'
import { useCanvasShapeStore } from './canvas-shape-store'
import { buildStickyKunPrompt, stickyAddressesKun, createStickyShape, resolveStickyTarget, stickyMentionsKun } from './canvas-sticky'
import { createDefaultShape, createEmptyDocument, createHtmlFrameShape } from './canvas-types'

function seed(): { rect: string; frame: string } {
  const doc = createEmptyDocument()
  const rect = createDefaultShape('rect', 0, 0)
  const frame = createHtmlFrameShape('Home', 400, 0, 'artifact-1', 'desktop')
  doc.objects[rect.id] = { ...rect, parentId: doc.rootId }
  doc.objects[frame.id] = { ...frame, parentId: doc.rootId }
  doc.objects[doc.rootId] = { ...doc.objects[doc.rootId], children: [rect.id, frame.id] }
  useCanvasShapeStore.getState().loadDocument(doc, 'test-doc')
  return { rect: rect.id, frame: frame.id }
}

const objects = () => useCanvasShapeStore.getState().document.objects

describe('canvas pages', () => {
  beforeEach(() => { useCanvasShapeStore.getState().resetDocument() })

  it('hides other pages and restores them without touching user-hidden shapes', () => {
    const { rect, frame } = seed()
    useCanvasShapeStore.getState().updateShape(rect, { visible: false }, true)
    const second = addPage()
    expect(activePageIdOf(useCanvasShapeStore.getState().document)).toBe(second)
    expect(objects()[frame].visible).toBe(false)
    switchPage(listPages(useCanvasShapeStore.getState().document)[0].id)
    expect(objects()[frame].visible).toBe(true)
    expect(objects()[rect].visible).toBe(false)
  })

  it('assigns shapes that appear later to the open page', () => {
    seed()
    const second = addPage()
    const added = createDefaultShape('rect', 10, 10)
    useCanvasShapeStore.getState().addShape(added)
    claimUnpagedShapes()
    expect(objects()[added.id].pageId).toBe(second)
  })

  it('does not copy artifact frames when duplicating a page and keeps them when deleting another page', () => {
    const { frame } = seed()
    const first = listPages(useCanvasShapeStore.getState().document)[0].id
    const copy = duplicatePage(first)!
    const doc = useCanvasShapeStore.getState().document
    const copiedFrames = Object.values(doc.objects).filter((shape) => shape.htmlArtifactId === 'artifact-1')
    expect(copiedFrames).toHaveLength(1)
    expect(deletePage(copy)).toBe(true)
    expect(objects()[frame]).toBeDefined()
    expect(deletePage(first)).toBe(false)
  })

  it('round-trips pages through persistence', () => {
    const { rect } = seed()
    addPage()
    const parsed = parseCanvasDocument(serializeCanvasDocument(useCanvasShapeStore.getState().document))!
    expect(parsed.pages).toHaveLength(2)
    expect(parsed.activePageId).toBe(useCanvasShapeStore.getState().document.activePageId)
    expect(parsed.pageHidden).toContain(rect)
  })
})

describe('canvas sections', () => {
  beforeEach(() => { useCanvasShapeStore.getState().resetDocument() })

  it('collapses members and restores only what it hid', () => {
    const { rect, frame } = seed()
    useCanvasShapeStore.getState().updateShape(rect, { visible: false }, true)
    const id = createSectionFromShapes([rect, frame], 'Flow')!
    toggleSectionCollapsed(id)
    expect(objects()[frame].visible).toBe(false)
    toggleSectionCollapsed(id)
    expect(objects()[frame].visible).toBe(true)
    expect(objects()[rect].visible).toBe(false)
  })

  it('moves members together and survives a reload', () => {
    const { rect, frame } = seed()
    const id = createSectionFromShapes([rect, frame], 'Flow')!
    moveSection(id, 50, 20)
    expect(objects()[frame].x).toBe(450)
    expect(objects()[rect].y).toBe(20)
    const parsed = parseCanvasDocument(serializeCanvasDocument(useCanvasShapeStore.getState().document))!
    expect(parsed.sections?.[0]).toMatchObject({ title: 'Flow', memberIds: [rect, frame] })
    removeSection(id)
    expect(useCanvasShapeStore.getState().document.sections).toBeUndefined()
  })
})

describe('canvas stickies', () => {
  it('detects @Kun and builds a prompt about the nearest screen', () => {
    expect(stickyMentionsKun('@kun tighten the header')).toBe(true)
    expect(stickyMentionsKun('email kunal@example')).toBe(false)
    const doc = createEmptyDocument()
    const near = createHtmlFrameShape('Near', 0, 0, 'a1', 'desktop')
    const far = createHtmlFrameShape('Far', 4000, 0, 'a2', 'desktop')
    const note = createStickyShape(1300, 100)
    note.textContent = '@Kun tighten the header'
    for (const shape of [near, far, note]) doc.objects[shape.id] = { ...shape, parentId: doc.rootId }
    const target = resolveStickyTarget(doc, note.id)
    expect(target?.id).toBe(near.id)
    expect(buildStickyKunPrompt({ text: note.textContent, targetName: target?.name })).toContain('"Near"')
  })

  it('reopens a stored in-flight note as a draft', () => {
    const doc = createEmptyDocument()
    const note = createStickyShape(0, 0)
    note.sticky = { color: 'blue', status: 'sent' }
    doc.objects[note.id] = { ...note, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...doc.objects[doc.rootId], children: [note.id] }
    const parsed = parseCanvasDocument(serializeCanvasDocument(doc))!
    expect(parsed.objects[note.id].sticky).toEqual({ color: 'blue', status: 'draft' })
  })

  it('treats a note attached to an element as a request and targets that element\'s screen', () => {
    const doc = createEmptyDocument()
    const screen = createHtmlFrameShape('Home', 0, 0, 'a1', 'desktop')
    const other = createHtmlFrameShape('Other', 3000, 0, 'a2', 'desktop')
    const note = createStickyShape(2900, 0)
    note.textContent = 'tighten this up'
    note.sticky = { ...note.sticky!, anchorId: screen.id }
    for (const shape of [screen, other, note]) doc.objects[shape.id] = { ...shape, parentId: doc.rootId }
    expect(stickyAddressesKun(note)).toBe(true)
    expect(resolveStickyTarget(doc, note.id)?.id).toBe(screen.id)
    expect(buildStickyKunPrompt({ text: 'tighten this up', anchorName: 'Hero', targetName: 'Home' })).toContain('"Hero"')
  })
})

import { useCanvasSelectionStore } from './canvas-selection-store'
import { useCanvasShapeStore } from './canvas-shape-store'
import type { CanvasDocument, CanvasPage, CanvasShape } from './canvas-types'

const FIRST_PAGE_ID = 'page-1'

let pageCounter = 0
function createPageId(): string {
  return `page-${Date.now().toString(36)}${(++pageCounter).toString(36)}`
}

export function parseCanvasPages(
  parsed: Record<string, unknown>,
  objects: CanvasDocument['objects']
): Pick<CanvasDocument, 'pages' | 'activePageId' | 'pageHidden'> {
  if (!Array.isArray(parsed.pages)) return {}
  const pages: CanvasPage[] = []
  for (const entry of parsed.pages.slice(0, 100)) {
    if (!entry || typeof entry !== 'object') continue
    const value = entry as Record<string, unknown>
    if (typeof value.id !== 'string' || !value.id || pages.some((page) => page.id === value.id)) continue
    pages.push({ id: value.id, name: typeof value.name === 'string' ? value.name.slice(0, 80) : '' })
  }
  if (pages.length === 0) return {}
  const activePageId = pages.some((page) => page.id === parsed.activePageId)
    ? (parsed.activePageId as string)
    : pages[0].id
  const pageHidden = Array.isArray(parsed.pageHidden)
    ? parsed.pageHidden.filter((id): id is string => typeof id === 'string' && Boolean(objects[id]))
    : []
  return { pages, activePageId, ...(pageHidden.length > 0 ? { pageHidden } : {}) }
}

/** The document's pages; a document without any reads as one unnamed page. */
export function listPages(doc: CanvasDocument): CanvasPage[] {
  return doc.pages && doc.pages.length > 0 ? doc.pages : [{ id: FIRST_PAGE_ID, name: '' }]
}

export function activePageIdOf(doc: CanvasDocument): string {
  const pages = listPages(doc)
  return pages.find((page) => page.id === doc.activePageId)?.id ?? pages[0].id
}

function pageOfShape(doc: CanvasDocument, shape: CanvasShape): string {
  return shape.pageId && listPages(doc).some((page) => page.id === shape.pageId)
    ? shape.pageId
    : listPages(doc)[0].id
}

function rootChildren(doc: CanvasDocument): CanvasShape[] {
  const root = doc.objects[doc.rootId]
  return (root?.children ?? []).map((id) => doc.objects[id]).filter((shape): shape is CanvasShape => Boolean(shape))
}

export function pageShapeCount(doc: CanvasDocument, pageId: string): number {
  return rootChildren(doc).filter((shape) => pageOfShape(doc, shape) === pageId).length
}

function withMaterializedPages(doc: CanvasDocument): CanvasDocument {
  if (doc.pages && doc.pages.length > 0) return doc
  return { ...doc, pages: listPages(doc), activePageId: FIRST_PAGE_ID }
}

/**
 * Root shapes that appeared without a page (agent output, artifact sync) belong
 * to the page that is open now. Only runs once a document actually has pages.
 */
export function claimUnpagedShapes(): void {
  const doc = useCanvasShapeStore.getState().document
  if (!doc.pages || doc.pages.length === 0) return
  const active = activePageIdOf(doc)
  const orphans = rootChildren(doc).filter((shape) => !shape.pageId || !doc.pages!.some((p) => p.id === shape.pageId))
  if (orphans.length === 0) return
  useCanvasShapeStore.setState((state) => {
    const objects = { ...state.document.objects }
    for (const shape of orphans) objects[shape.id] = { ...objects[shape.id], pageId: active }
    return { document: { ...state.document, objects } }
  })
}

/** Shows only the shapes of `pageId`; user-hidden shapes stay hidden. */
export function switchPage(pageId: string): void {
  const store = useCanvasShapeStore.getState()
  let doc = withMaterializedPages(store.document)
  if (!doc.pages!.some((page) => page.id === pageId)) return
  if (activePageIdOf(doc) === pageId && doc === store.document) return
  const objects = { ...doc.objects }
  const hidden = new Set(doc.pageHidden ?? [])
  const outgoing = activePageIdOf(doc)
  for (const shape of rootChildren(doc)) {
    const owner = shape.pageId && doc.pages!.some((page) => page.id === shape.pageId) ? shape.pageId : outgoing
    const next: CanvasShape = { ...shape, pageId: owner }
    if (owner === pageId) {
      if (hidden.has(shape.id)) {
        next.visible = true
        hidden.delete(shape.id)
      }
    } else if (next.visible) {
      next.visible = false
      hidden.add(shape.id)
    }
    objects[shape.id] = next
  }
  doc = { ...doc, objects, activePageId: pageId, pageHidden: [...hidden] }
  if (doc.pageHidden!.length === 0) delete doc.pageHidden
  useCanvasShapeStore.setState({ document: doc })
  useCanvasSelectionStore.getState().clearSelection()
}

export function addPage(): string {
  const store = useCanvasShapeStore.getState()
  const doc = withMaterializedPages(store.document)
  const id = createPageId()
  useCanvasShapeStore.setState({ document: { ...doc, pages: [...doc.pages!, { id, name: '' }] } })
  switchPage(id)
  return id
}

export function renamePage(pageId: string, name: string): void {
  const doc = useCanvasShapeStore.getState().document
  if (!doc.pages) return
  useCanvasShapeStore.setState({
    document: { ...doc, pages: doc.pages.map((page) => (page.id === pageId ? { ...page, name: name.trim().slice(0, 80) } : page)) }
  })
}

/**
 * Copies the plain shapes of a page onto a new page. Screens and SVG boards are
 * not copied: each is bound to one artifact, and two frames on one artifact
 * would be reconciled away.
 */
export function duplicatePage(pageId: string): string | null {
  const store = useCanvasShapeStore.getState()
  const doc = withMaterializedPages(store.document)
  const source = doc.pages!.find((page) => page.id === pageId)
  if (!source) return null
  const sourceName = source.name
  const copyableIds = rootChildren(doc)
    .filter((shape) => pageOfShape(doc, shape) === pageId && !shape.embeddedArtifact && !shape.htmlArtifactId && !shape.runningApp)
    .map((shape) => shape.id)
  const id = createPageId()
  useCanvasShapeStore.setState({
    document: { ...doc, pages: [...doc.pages!, { id, name: sourceName ? `${sourceName} 2` : '' }] }
  })
  switchPage(id)
  const created: string[] = []
  for (const shapeId of copyableIds) {
    const copyId = useCanvasShapeStore.getState().duplicateShape(shapeId, { skipUndo: true })
    if (copyId) created.push(copyId)
  }
  useCanvasShapeStore.setState((state) => {
    const objects = { ...state.document.objects }
    for (const copyId of created) {
      const original = objects[copyId]
      if (original) objects[copyId] = { ...original, pageId: id, visible: true }
    }
    return { document: { ...state.document, objects } }
  })
  return id
}

/** Deletes a page and every shape on it. The last page cannot be deleted. */
export function deletePage(pageId: string): boolean {
  const store = useCanvasShapeStore.getState()
  const doc = store.document
  const pages = listPages(doc)
  if (pages.length <= 1 || !pages.some((page) => page.id === pageId)) return false
  const index = pages.findIndex((page) => page.id === pageId)
  const fallback = pages[index === 0 ? 1 : index - 1].id
  if (activePageIdOf(doc) === pageId) switchPage(fallback)
  const latest = useCanvasShapeStore.getState().document
  const doomed = rootChildren(latest).filter((shape) => pageOfShape(latest, shape) === pageId).map((shape) => shape.id)
  for (const id of doomed) useCanvasShapeStore.getState().deleteShape(id, { skipUndo: true })
  useCanvasShapeStore.setState((state) => ({
    document: {
      ...state.document,
      pages: (state.document.pages ?? []).filter((page) => page.id !== pageId),
      pageHidden: (state.document.pageHidden ?? []).filter((id) => !doomed.includes(id))
    }
  }))
  return true
}

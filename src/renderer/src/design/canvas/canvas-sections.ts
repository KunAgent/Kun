import { useCanvasShapeStore } from './canvas-shape-store'
import { useCanvasUndoStore } from './canvas-undo-store'
import type { CanvasDocument, CanvasSection, Rect } from './canvas-types'

let sectionCounter = 0
function createSectionId(): string {
  return `sec_${Date.now().toString(36)}_${(++sectionCounter).toString(36)}`
}

export function parseCanvasSections(raw: unknown, objects: CanvasDocument['objects']): CanvasSection[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const sections: CanvasSection[] = []
  for (const entry of raw.slice(0, 200)) {
    if (!entry || typeof entry !== 'object') continue
    const value = entry as Record<string, unknown>
    if (typeof value.id !== 'string' || !value.id || !Array.isArray(value.memberIds)) continue
    const memberIds = value.memberIds.filter((id): id is string => typeof id === 'string' && Boolean(objects[id]))
    if (memberIds.length === 0) continue
    const bounds = value.collapsedBounds as Record<string, unknown> | undefined
    const collapsedBounds = bounds &&
      [bounds.x, bounds.y, bounds.width, bounds.height].every((n) => typeof n === 'number' && Number.isFinite(n))
      ? (bounds as unknown as Rect)
      : undefined
    const collapsed = value.collapsed === true && Boolean(collapsedBounds)
    sections.push({
      id: value.id,
      title: typeof value.title === 'string' ? value.title.slice(0, 120) : '',
      memberIds,
      ...(collapsed ? { collapsed: true, collapsedBounds } : {}),
      ...(collapsed && Array.isArray(value.hiddenByCollapse)
        ? { hiddenByCollapse: value.hiddenByCollapse.filter((id): id is string => typeof id === 'string' && memberIds.includes(id)) }
        : {})
    })
  }
  return sections.length > 0 ? sections : undefined
}

/** Union bounds of the section's members that still exist. */
export function sectionBounds(doc: CanvasDocument, section: CanvasSection): Rect | null {
  if (section.collapsed && section.collapsedBounds) return section.collapsedBounds
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const id of section.memberIds) {
    const shape = doc.objects[id]
    if (!shape) continue
    minX = Math.min(minX, shape.x)
    minY = Math.min(minY, shape.y)
    maxX = Math.max(maxX, shape.x + shape.width)
    maxY = Math.max(maxY, shape.y + shape.height)
  }
  if (!Number.isFinite(minX)) return null
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function commitSections(update: (sections: CanvasSection[], doc: CanvasDocument) => CanvasSection[]): void {
  useCanvasShapeStore.setState((state) => {
    const sections = update(state.document.sections ?? [], state.document)
    const document = { ...state.document }
    if (sections.length > 0) document.sections = sections
    else delete document.sections
    return { document }
  })
}

/** Wraps root-level shapes in a new section; a shape belongs to one section only. */
export function createSectionFromShapes(shapeIds: string[], title: string): string | null {
  const doc = useCanvasShapeStore.getState().document
  const memberIds = shapeIds.filter((id) => {
    const shape = doc.objects[id]
    return Boolean(shape) && shape.parentId === doc.rootId
  })
  if (memberIds.length === 0) return null
  const id = createSectionId()
  commitSections((sections) => [
    ...sections
      .map((section) => ({ ...section, memberIds: section.memberIds.filter((m) => !memberIds.includes(m)) }))
      .filter((section) => section.memberIds.length > 0),
    { id, title, memberIds }
  ])
  return id
}

export function renameSection(sectionId: string, title: string): void {
  commitSections((sections) => sections.map((s) => (s.id === sectionId ? { ...s, title: title.trim().slice(0, 120) } : s)))
}

export function removeSection(sectionId: string): void {
  const doc = useCanvasShapeStore.getState().document
  const section = doc.sections?.find((s) => s.id === sectionId)
  if (section?.collapsed) toggleSectionCollapsed(sectionId)
  commitSections((sections) => sections.filter((s) => s.id !== sectionId))
}

export function toggleSectionCollapsed(sectionId: string): void {
  const store = useCanvasShapeStore.getState()
  const section = store.document.sections?.find((s) => s.id === sectionId)
  if (!section) return
  if (section.collapsed) {
    for (const id of section.hiddenByCollapse ?? []) {
      if (store.document.objects[id]) store.updateShape(id, { visible: true }, true)
    }
    commitSections((sections) =>
      sections.map((s) => {
        if (s.id !== sectionId) return s
        const { collapsed: _c, hiddenByCollapse: _h, collapsedBounds: _b, ...rest } = s
        return rest
      })
    )
    return
  }
  const bounds = sectionBounds(store.document, section)
  if (!bounds) return
  const hidden = section.memberIds.filter((id) => store.document.objects[id]?.visible)
  for (const id of hidden) store.updateShape(id, { visible: false }, true)
  commitSections((sections) =>
    sections.map((s) => (s.id === sectionId ? { ...s, collapsed: true, hiddenByCollapse: hidden, collapsedBounds: bounds } : s))
  )
}

/** Moves every member (and the frozen bounds of a collapsed section) as one undo step. */
export function moveSection(sectionId: string, dx: number, dy: number): void {
  const store = useCanvasShapeStore.getState()
  const section = store.document.sections?.find((s) => s.id === sectionId)
  if (!section || (dx === 0 && dy === 0)) return
  useCanvasUndoStore.getState().withGroup('move-section', () => {
    for (const id of section.memberIds) {
      const shape = useCanvasShapeStore.getState().document.objects[id]
      if (shape) useCanvasShapeStore.getState().updateShape(id, { x: shape.x + dx, y: shape.y + dy })
    }
  })
  if (section.collapsed && section.collapsedBounds) {
    const b = section.collapsedBounds
    commitSections((sections) =>
      sections.map((s) => (s.id === sectionId ? { ...s, collapsedBounds: { ...b, x: b.x + dx, y: b.y + dy } } : s))
    )
  }
}

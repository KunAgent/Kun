import type { CanvasDocument, CanvasShape, Rect } from './canvas-types'
import { pointInPolygon, shapeGeometry } from './canvas-types'

function shapeHits(shape: CanvasShape, px: number, py: number): boolean {
  if (!shape.visible || shape.locked) return false
  const geom = shapeGeometry(shape)
  // selrect early-out (axis-aligned coarse filter)
  const s = geom.selrect
  if (px < s.x || px > s.x + s.width || py < s.y || py > s.y + s.height) return false
  // For unrotated shapes the selrect IS the shape — the coarse check above was exact.
  if (!shape.rotation) return true
  return pointInPolygon(px, py, geom.points)
}

function hitTestChildren(
  objects: Record<string, CanvasShape>,
  parentId: string,
  px: number,
  py: number
): string | null {
  const parent = objects[parentId]
  if (!parent) return null

  for (let i = parent.children.length - 1; i >= 0; i--) {
    const childId = parent.children[i]
    const child = objects[childId]
    if (!child || !child.visible) continue

    if (child.children.length > 0) {
      const deepHit = hitTestChildren(objects, childId, px, py)
      if (deepHit) return deepHit
    }

    if (shapeHits(child, px, py)) return childId
  }

  return null
}

export function hitTest(doc: CanvasDocument, px: number, py: number): string | null {
  return hitTestChildren(doc.objects, doc.rootId, px, py)
}

function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x + a.width >= b.x &&
    a.x <= b.x + b.width &&
    a.y + a.height >= b.y &&
    a.y <= b.y + b.height
  )
}

export function hitTestAll(doc: CanvasDocument, rect: Rect): string[] {
  const result: string[] = []
  const { objects, rootId } = doc

  function walk(parentId: string): void {
    const parent = objects[parentId]
    if (!parent) return
    for (const childId of parent.children) {
      const child = objects[childId]
      if (!child || !child.visible || childId === rootId) continue
      const geom = shapeGeometry(child)
      if (rectsIntersect(geom.selrect, rect)) {
        result.push(childId)
      }
      if (child.children.length > 0) walk(childId)
    }
  }

  walk(rootId)
  return result
}

export function getSelectionBounds(
  objects: Record<string, CanvasShape>,
  ids: Set<string>
): Rect | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let found = false

  for (const id of ids) {
    const shape = objects[id]
    if (!shape) continue
    found = true
    // Use the rotated bounding box so a multi-select around a rotated rect
    // reports the actual visual extent.
    const sel = shapeGeometry(shape).selrect
    if (sel.x < minX) minX = sel.x
    if (sel.y < minY) minY = sel.y
    if (sel.x + sel.width > maxX) maxX = sel.x + sel.width
    if (sel.y + sel.height > maxY) maxY = sel.y + sel.height
  }

  if (!found) return null
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

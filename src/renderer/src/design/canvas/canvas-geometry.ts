import type { CanvasShape, Point, Rect, ShapeGeometry } from './canvas-types'

export function shapeBounds(shape: CanvasShape): Rect {
  return { x: shape.x, y: shape.y, width: shape.width, height: shape.height }
}

function rotatePoint(px: number, py: number, cx: number, cy: number, rad: number): Point {
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = px - cx
  const dy = py - cy
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
}

/** Compute rotated geometry on the fly. ≤200 shapes × 60Hz is trivial; not worth caching. */
export function shapeGeometry(shape: CanvasShape): ShapeGeometry {
  const { x, y, width, height, rotation } = shape
  if (!rotation) {
    return {
      selrect: { x, y, width, height },
      points: [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + height },
        { x, y: y + height }
      ]
    }
  }
  const cx = x + width / 2
  const cy = y + height / 2
  const rad = (rotation * Math.PI) / 180
  const points: [Point, Point, Point, Point] = [
    rotatePoint(x, y, cx, cy, rad),
    rotatePoint(x + width, y, cx, cy, rad),
    rotatePoint(x + width, y + height, cx, cy, rad),
    rotatePoint(x, y + height, cx, cy, rad)
  ]
  let minX = points[0].x, minY = points[0].y, maxX = points[0].x, maxY = points[0].y
  for (let i = 1; i < 4; i++) {
    if (points[i].x < minX) minX = points[i].x
    if (points[i].x > maxX) maxX = points[i].x
    if (points[i].y < minY) minY = points[i].y
    if (points[i].y > maxY) maxY = points[i].y
  }
  return {
    points,
    selrect: { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
  }
}

/** Even-odd point-in-polygon (works for any simple polygon including the 4-point rotated bbox). */
export function pointInPolygon(px: number, py: number, polygon: Point[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x
    const yi = polygon[i].y
    const xj = polygon[j].x
    const yj = polygon[j].y
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

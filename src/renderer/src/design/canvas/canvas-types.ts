export type ShapeType = 'rect' | 'ellipse' | 'text' | 'image' | 'frame' | 'group'

export type Fill = {
  type: 'solid'
  color: string
  opacity: number
}

export type StrokePosition = 'center' | 'inside' | 'outside'

export type Stroke = {
  color: string
  width: number
  opacity: number
  position: StrokePosition
}

export type CanvasShape = {
  id: string
  type: ShapeType
  name: string
  parentId: string | null
  frameId: string | null
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  visible: boolean
  locked: boolean
  fills: Fill[]
  strokes: Stroke[]
  cornerRadius: number | [number, number, number, number]
  children: string[]
  textContent?: string
  fontSize?: number
  fontFamily?: string
  fontWeight?: number
  textAlign?: 'left' | 'center' | 'right'
  lineHeight?: number
  fontColor?: string
  imageUrl?: string
  clipContent?: boolean
}

export type CanvasDocument = {
  version: 1
  rootId: string
  objects: Record<string, CanvasShape>
}

export type CanvasTool = 'select' | 'rect' | 'ellipse' | 'text' | 'frame' | 'image' | 'hand'

export type Rect = { x: number; y: number; width: number; height: number }

export type Point = { x: number; y: number }

/**
 * Rotated shape geometry, computed lazily from x/y/w/h/rotation (not persisted).
 * `points` are the 4 rotated corners in clockwise order from top-left (nw → ne → se → sw).
 * `selrect` is the axis-aligned bounding box that contains all 4 rotated corners.
 * When rotation === 0, selrect === { x, y, width, height } and points are the trivial corners.
 */
export type ShapeGeometry = {
  selrect: Rect
  points: [Point, Point, Point, Point]
}

export type ViewBox = { x: number; y: number; width: number; height: number }

export const ROOT_SHAPE_ID = '__root__'

export const DEFAULT_FILL: Fill = { type: 'solid', color: '#d9d9d9', opacity: 1 }
export const DEFAULT_FRAME_FILL: Fill = { type: 'solid', color: '#ffffff', opacity: 1 }
export const DEFAULT_TEXT_COLOR = '#000000'

let _counter = 0
export function createShapeId(): string {
  return `s_${Date.now().toString(36)}_${(++_counter).toString(36)}`
}

export function createDefaultShape(type: ShapeType, x: number, y: number): CanvasShape {
  const id = createShapeId()
  const base: CanvasShape = {
    id,
    type,
    name: type.charAt(0).toUpperCase() + type.slice(1),
    parentId: null,
    frameId: null,
    x,
    y,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    fills: [{ ...DEFAULT_FILL }],
    strokes: [],
    cornerRadius: 0,
    children: []
  }
  switch (type) {
    case 'frame':
      base.name = 'Frame'
      base.width = 360
      base.height = 640
      base.fills = [{ ...DEFAULT_FRAME_FILL }]
      base.clipContent = true
      break
    case 'text':
      base.name = 'Text'
      base.width = 200
      base.height = 24
      base.fills = []
      base.textContent = 'Text'
      base.fontSize = 16
      base.fontFamily = 'Inter, system-ui, sans-serif'
      base.fontWeight = 400
      base.textAlign = 'left'
      base.lineHeight = 1.5
      base.fontColor = DEFAULT_TEXT_COLOR
      break
    case 'ellipse':
      base.name = 'Ellipse'
      break
    case 'image':
      base.name = 'Image'
      base.fills = []
      break
    case 'group':
      base.name = 'Group'
      base.fills = []
      break
  }
  return base
}

export function createEmptyDocument(): CanvasDocument {
  const root: CanvasShape = {
    id: ROOT_SHAPE_ID,
    type: 'frame',
    name: 'Root',
    parentId: null,
    frameId: null,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    fills: [],
    strokes: [],
    cornerRadius: 0,
    children: []
  }
  return { version: 1, rootId: ROOT_SHAPE_ID, objects: { [ROOT_SHAPE_ID]: root } }
}

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

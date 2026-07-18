import type { DesignCodeBinding } from '../code-binding/code-binding-types'
import type { DesignOperationJournalEntry } from '../graph/design-graph-types'
import {
  CANVAS_MOTION_VERSION,
  type CanvasMotionDocument
} from '../motion/canvas-motion-types'

export type ShapeType =
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'image'
  | 'frame'
  | 'group'
  | 'arrow'
  | 'line'
  | 'draw'

export type SolidFill = {
  type: 'solid'
  color: string
  opacity: number
}

/** One color stop of a gradient fill. `offset` is 0..1 along the gradient axis. */
export type GradientStop = {
  offset: number
  color: string
  /** Per-stop alpha, 0..1. Defaults to 1 when omitted. */
  opacity?: number
}

/**
 * A linear or radial gradient fill. For `linear`, `angle` is in degrees measured
 * clockwise from the positive X axis (0 = left→right, 90 = top→bottom). For
 * `radial`, the gradient is centered with a radius covering the shape.
 */
export type GradientFill = {
  type: 'linear' | 'radial'
  stops: GradientStop[]
  /** Linear only: direction in degrees. Defaults to 90 (top→bottom). */
  angle?: number
  /** Overall fill opacity, 0..1. */
  opacity: number
}

export type Fill = SolidFill | GradientFill

export function isSolidFill(fill: Fill): fill is SolidFill {
  return fill.type === 'solid'
}

export function isGradientFill(fill: Fill): fill is GradientFill {
  return fill.type === 'linear' || fill.type === 'radial'
}

/**
 * The representative color of a fill — its solid color, or the first gradient
 * stop. Lets renderers, the snapshot digest and the properties panel keep a
 * single "primary color" notion without branching on the fill kind everywhere.
 */
export function fillColor(fill: Fill | undefined): string | null {
  if (!fill) return null
  if (isSolidFill(fill)) return fill.color
  return fill.stops[0]?.color ?? null
}

export type StrokePosition = 'center' | 'inside' | 'outside'

/** Excalidraw-style line dash style. */
export type StrokeDash = 'solid' | 'dashed' | 'dotted'

export type Stroke = {
  color: string
  width: number
  opacity: number
  position: StrokePosition
  dash?: StrokeDash
}

/** Endpoint decoration for linear shapes (arrow/line). `none` = bare end. */
export type Arrowhead = 'none' | 'arrow' | 'triangle' | 'circle' | 'bar' | 'diamond'

/**
 * A drop/inner shadow effect. Multiple shadows stack (painted in array order).
 * `drop` casts outside the shape, `inner` insets it. Rendered as an SVG filter.
 */
export type Shadow = {
  type?: 'drop' | 'inner'
  x: number
  y: number
  blur: number
  /** Grows/shrinks the shadow before blurring. Defaults to 0. */
  spread?: number
  color: string
  opacity: number
}

/** CSS mix-blend-mode values the canvas understands. */
export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'

export type AutoLayoutDirection = 'horizontal' | 'vertical'
/** Distribution of children along the layout's main axis. */
export type AutoLayoutPrimaryAlign = 'start' | 'center' | 'end' | 'space-between'
/** Alignment of children across the layout's counter axis. */
export type AutoLayoutCounterAlign = 'start' | 'center' | 'end'

/**
 * Auto-layout (flex-style) config on a `frame`/`group`. When present, the
 * layout engine repositions direct children in a row/column with consistent
 * gap + padding, so the agent stops hand-computing coordinates. Children keep
 * absolute coords in the document — the engine writes those coords; nothing
 * about rendering/hit-testing changes.
 */
export type AutoLayout = {
  direction: AutoLayoutDirection
  gap: number
  paddingTop: number
  paddingRight: number
  paddingBottom: number
  paddingLeft: number
  primaryAlign?: AutoLayoutPrimaryAlign
  counterAlign?: AutoLayoutCounterAlign
}

/** How a shape's edges track its parent frame when the frame is resized. */
export type HConstraint = 'left' | 'right' | 'left-right' | 'center' | 'scale'
export type VConstraint = 'top' | 'bottom' | 'top-bottom' | 'center' | 'scale'
export type Constraints = { h: HConstraint; v: VConstraint }

export type CanvasAgentNoteKind = 'critique' | 'decision' | 'todo' | 'question' | 'rationale'
export type CanvasAgentNoteSeverity = 'info' | 'warning' | 'error'
export type CanvasAgentNoteSource = 'agent' | 'critic' | 'repair' | 'user' | 'system'

export type CanvasAgentNote = {
  kind: CanvasAgentNoteKind
  body: string
  source?: CanvasAgentNoteSource
  severity?: CanvasAgentNoteSeverity
  targetIds?: string[]
  directionId?: string
  createdAt?: string
  resolved?: boolean
}

export type CanvasRunningAppFrameStatus = 'unknown' | 'reachable' | 'unreachable'

export type CanvasRunningAppFrame = {
  url: string
  title?: string
  routePath?: string
  sourceFile?: string
  componentName?: string
  capturedAt?: string
  status?: CanvasRunningAppFrameStatus
}

export type CanvasEmbeddedArtifact = {
  id: string
  kind: 'html' | 'svg'
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
  /** Stacked drop/inner shadows. Painted in array order. */
  shadows?: Shadow[]
  /** CSS mix-blend-mode for compositing this shape over what's behind it. */
  blendMode?: BlendMode
  /** Flex-style auto-layout for direct children (frame/group only). */
  layout?: AutoLayout
  /** Resize behaviour relative to the parent frame. */
  constraints?: Constraints
  /**
   * Design-token bindings: shape property → token name (e.g.
   * `{ "fill": "brand/primary" }`). Written by the `apply-token` op so editing
   * the token later re-resolves every bound shape. See design-system-types.
   */
  tokenBindings?: Record<string, string>
  /** Agent/critic/decision metadata for whiteboard text notes. */
  agentNote?: CanvasAgentNote
  /**
   * Component instance back-reference (only on an instance's ROOT shape): which
   * component def it was stamped from, at what version, and the per-instance slot
   * overrides. Lets `update-component` re-materialize instances while preserving
   * their overrides, and `detach` cut the link. See design-system-types.
   */
  componentId?: string
  componentVersion?: number
  /** Named component variant applied to this instance root. */
  componentVariant?: string
  overrides?: Record<string, unknown>
  textContent?: string
  fontSize?: number
  fontFamily?: string
  fontWeight?: number
  textAlign?: 'left' | 'center' | 'right'
  lineHeight?: number
  fontColor?: string
  imageUrl?: string
  /**
   * Marks this shape as an AI image holder — an empty slot the design agent
   * fills on request (the in-process equivalent of cowart's `cowartAiImageHolder`
   * frame). Holders are filled in place (`update` its imageUrl); empty frame/rect
   * holders are converted to image shapes so the slot and picture stay one object.
   * Survives in the AI snapshot so the agent knows which panels are waiting for a
   * picture.
   */
  aiImageHolder?: boolean
  clipContent?: boolean
  /** First-class file artifact rendered over this frame. */
  embeddedArtifact?: CanvasEmbeddedArtifact
  /** @deprecated Read for legacy canvas documents; new code should use embeddedArtifact. */
  htmlArtifactId?: string
  /** Running app portal frame, usually a localhost route captured for Onlook-style code binding. */
  runningApp?: CanvasRunningAppFrame
  devicePreset?: DevicePreset
  /** Linear shapes: endpoint decorations. Defaults — arrow: end `arrow`; line: none. */
  arrowheadStart?: Arrowhead
  arrowheadEnd?: Arrowhead
  /**
   * Linear shapes (`arrow`/`line`/`draw`): polyline vertices RELATIVE to (x, y).
   * x/y/width/height stay the axis-aligned bounding box of these points so the
   * box-based selection/move/snap machinery keeps working unchanged.
   */
  points?: Point[]
}

/**
 * version 1 → 2: child x/y switched from parent-relative to ABSOLUTE canvas
 * coords (one convention shared by render, hit-test, selection, the AI
 * snapshot). v1 docs are flattened on load — see canvas-persistence.
 */
export type CanvasDocument = {
  version: 2
  rootId: string
  objects: Record<string, CanvasShape>
  motion?: CanvasMotionDocument
  graph?: CanvasDocumentGraphMetadata
  operationJournal?: DesignOperationJournalEntry[]
  codeBindings?: DesignCodeBinding[]
}

export type CanvasDocumentGraphMetadata = {
  version: 1
  projectId?: string
  updatedAt?: string
  lastJournalEntryId?: string
}

export type DevicePreset = 'mobile' | 'tablet' | 'desktop'

export function isHtmlFrame(shape: CanvasShape): boolean {
  const reference = embeddedArtifactOf(shape)
  return shape.type === 'frame' && reference?.kind === 'html'
}

export function isSvgFrame(shape: CanvasShape): boolean {
  const reference = embeddedArtifactOf(shape)
  return shape.type === 'frame' && reference?.kind === 'svg'
}

export function isArtifactFrame(shape: CanvasShape): boolean {
  return shape.type === 'frame' && embeddedArtifactOf(shape) !== null
}

export function embeddedArtifactOf(shape: CanvasShape): CanvasEmbeddedArtifact | null {
  if (shape.embeddedArtifact?.id) return shape.embeddedArtifact
  return shape.htmlArtifactId ? { id: shape.htmlArtifactId, kind: 'html' } : null
}

export function isRunningAppFrame(shape: CanvasShape): boolean {
  return shape.type === 'frame' && Boolean(shape.runningApp?.url)
}

export function isCanvasPortalFrame(shape: CanvasShape): boolean {
  return isHtmlFrame(shape) || isRunningAppFrame(shape)
}

/**
 * An *empty* box that should count as an implicit AI image slot: when the user
 * selects one and asks for a picture, the design agent fills it in place — no
 * need to explicitly mark it with `aiImageHolder`. An `image` with no picture,
 * and a childless `frame`/`rect` are the placeholders people draw where a
 * generated image should go. Artifact frames (HTML or SVG) and running apps
 * are never slots — they already carry externally rendered content.
 */
export function isImplicitImageSlot(shape: CanvasShape): boolean {
  switch (shape.type) {
    case 'image':
      return !shape.imageUrl
    case 'frame':
      return !isArtifactFrame(shape) && !isRunningAppFrame(shape) && shape.children.length === 0
    case 'rect':
      return shape.children.length === 0
    default:
      return false
  }
}

export type CanvasTool =
  | 'select'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'frame'
  | 'screen'
  | 'image'
  | 'arrow'
  | 'line'
  | 'draw'
  | 'hand'

export type CanvasShapePreset = 'diagram'

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

export function createDefaultShape(
  type: ShapeType,
  x: number,
  y: number,
  preset?: CanvasShapePreset
): CanvasShape {
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
    case 'arrow':
    case 'line':
    case 'draw':
      base.name = type === 'arrow' ? 'Arrow' : type === 'line' ? 'Line' : 'Draw'
      base.fills = []
      base.strokes = [{ color: '#1e1e1e', width: 2, opacity: 1, position: 'center', dash: 'solid' }]
      base.points = []
      if (type === 'arrow') base.arrowheadEnd = 'arrow'
      break
  }
  if (preset === 'diagram') applyDiagramShapeDefaults(base)
  return base
}

/**
 * Excalidraw-inspired defaults for the Code whiteboard. `currentColor` keeps
 * strokes and labels legible in both themes and survives SVG export through the
 * export root's explicit color style.
 */
export function applyDiagramShapeDefaults(shape: CanvasShape): CanvasShape {
  switch (shape.type) {
    case 'rect':
      shape.fills = []
      shape.strokes = [{ color: 'currentColor', width: 2, opacity: 1, position: 'center', dash: 'solid' }]
      shape.cornerRadius = 16
      break
    case 'ellipse':
      shape.fills = []
      shape.strokes = [{ color: 'currentColor', width: 2, opacity: 1, position: 'center', dash: 'solid' }]
      break
    case 'frame':
      shape.fills = []
      shape.strokes = [{ color: 'currentColor', width: 1.5, opacity: 0.7, position: 'center', dash: 'dashed' }]
      shape.cornerRadius = 16
      break
    case 'text':
      shape.fontColor = 'currentColor'
      break
    case 'arrow':
    case 'line':
    case 'draw':
      shape.strokes = [{ color: 'currentColor', width: 2, opacity: 1, position: 'center', dash: 'solid' }]
      break
  }
  return shape
}

const DEVICE_DIMENSIONS: Record<DevicePreset, { width: number; height: number }> = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 }
}

export function createHtmlFrameShape(
  name: string,
  x: number,
  y: number,
  artifactId: string,
  preset: DevicePreset = 'desktop'
): CanvasShape {
  const dims = DEVICE_DIMENSIONS[preset]
  const shape = createDefaultShape('frame', x, y)
  shape.name = name
  shape.width = dims.width
  shape.height = dims.height
  shape.htmlArtifactId = artifactId
  shape.embeddedArtifact = { id: artifactId, kind: 'html' }
  shape.devicePreset = preset
  return shape
}

export function createSvgFrameShape(
  name: string,
  x: number,
  y: number,
  artifactId: string,
  width = 640,
  height = 480
): CanvasShape {
  const shape = createDefaultShape('frame', x, y)
  shape.name = name
  shape.width = Math.max(64, width)
  shape.height = Math.max(64, height)
  shape.embeddedArtifact = { id: artifactId, kind: 'svg' }
  shape.clipContent = true
  return shape
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
  return {
    version: 2,
    rootId: ROOT_SHAPE_ID,
    objects: { [ROOT_SHAPE_ID]: root },
    motion: { version: CANVAS_MOTION_VERSION, timelines: {} }
  }
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

import type { NodeGraphSettings } from '../../node-graph/node-graph-settings'
import type { NodeGraphView } from '../../node-graph/node-graph-filter'
import type { NodeGraphEdge, NodeGraphNode } from '../../node-graph/node-graph-types'
import type { SimulationNode } from '../../node-graph/node-graph-simulation'
import {
  NODE_GRAPH_KIND_COLORS,
  NODE_GRAPH_KIND_SHAPES,
  nodeGraphRadius,
  type NodeGraphCanvasTheme
} from './node-graph-theme'
import { traceNodeGraphShape } from './node-graph-shapes'
import {
  NODE_GRAPH_HOVER_LIFT,
  type NodeGraphMotionFrame
} from '../../node-graph/node-graph-animation'

export type NodeGraphCamera = {
  /** World coordinate at the canvas center. */
  x: number
  y: number
  scale: number
}

export type NodeGraphPaintInput = {
  context: CanvasRenderingContext2D
  width: number
  height: number
  view: NodeGraphView
  positions: ReadonlyMap<string, SimulationNode>
  camera: NodeGraphCamera
  settings: NodeGraphSettings
  theme: NodeGraphCanvasTheme
  /** Drives the selection ring only; the dimming focus comes from `motion`. */
  selectedNodeId: string | null
  /** Neighbors of the hovered or selected node, dimmed differently. */
  highlighted: ReadonlySet<string>
  /** Nodes on the active shortest path, drawn on top of everything. */
  pathNodeIds: ReadonlySet<string>
  pathEdgeIds: ReadonlySet<string>
  /** Localized singular kind name, prefixed to a node's label. */
  kindLabel: (kind: NodeGraphNode['kind']) => string
  /** Localized relationship name drawn along an edge. */
  edgeLabel: (kind: NodeGraphEdge['kind']) => string
  /** Backing-store scale, needed to restore the transform after rotating text. */
  pixelRatio: number
  /** Kun style: mascot artwork in place of the coloured silhouettes. */
  kunStyle: boolean
  /** Decoded icon for a kind, or null when it has none or has not loaded. */
  nodeIcon: (kind: NodeGraphNode['kind']) => CanvasImageSource | null
  /** This frame's animation values. */
  motion: NodeGraphMotionFrame
}

const MIN_PAINTED_RADIUS = 1.2
/** Alpha an unrelated node falls to while something else has focus. */
const DIMMED_ALPHA = 0.22
/** Alpha an unrelated edge falls to. Lower, so the highlighted path reads first. */
const DIMMED_EDGE_ALPHA = 0.12
/** Dash pattern of a flowing edge, in screen pixels. */
const FLOW_DASH: readonly [number, number] = [6, 6]
const EDGE_LABEL_MIN_SCALE = 0.75
const EDGE_LABEL_MIN_LENGTH = 64

/**
 * Side of an icon's square, as a multiple of the node radius.
 *
 * The square is inscribed in the hit circle, exactly like `roundedSquare`'s
 * outline: hit testing is a single radius comparison, so an icon drawn to the
 * full diameter would show artwork in corners that cannot be clicked.
 */
export const KUN_NODE_ICON_BOX = Math.SQRT2

/**
 * Below this painted radius an icon is a few pixels wide and reads as noise, so
 * the silhouette takes over — the same trade the label fade already makes.
 */
export const KUN_NODE_ICON_MIN_RADIUS = 3

export const NODE_GRAPH_MIN_SCALE = 0.08
export const NODE_GRAPH_MAX_SCALE = 6

export function clampNodeGraphScale(scale: number): number {
  return Math.min(NODE_GRAPH_MAX_SCALE, Math.max(NODE_GRAPH_MIN_SCALE, scale))
}

export function worldToScreen(
  x: number,
  y: number,
  camera: NodeGraphCamera,
  width: number,
  height: number
): { x: number; y: number } {
  return {
    x: (x - camera.x) * camera.scale + width / 2,
    y: (y - camera.y) * camera.scale + height / 2
  }
}

export function screenToWorld(
  x: number,
  y: number,
  camera: NodeGraphCamera,
  width: number,
  height: number
): { x: number; y: number } {
  return {
    x: (x - width / 2) / camera.scale + camera.x,
    y: (y - height / 2) / camera.scale + camera.y
  }
}

export type NodeGraphPoint = { x: number; y: number }

/**
 * Ratio between client pixels and this element's own CSS pixels.
 *
 * The shell applies `body { zoom: var(--ds-ui-scale) }`, and under CSS zoom
 * `getBoundingClientRect()` reports zoom-multiplied client pixels while
 * `clientWidth` and every CSS length inside the element stay in unscaled
 * layout pixels. Measuring the ratio covers any zoomed ancestor without having
 * to know which one applied it, and yields exactly 1 when nothing is zoomed.
 */
export function nodeGraphZoomFactor(clientWidth: number, layoutWidth: number): number {
  if (!(layoutWidth > 0) || !Number.isFinite(clientWidth) || !Number.isFinite(layoutWidth)) return 1
  const zoom = clientWidth / layoutWidth
  return zoom > 0 && Number.isFinite(zoom) ? zoom : 1
}

/**
 * Converts a pointer event's client coordinates into the element's own CSS
 * pixel space, which is the space the canvas paints in.
 */
export function nodeGraphLayoutPoint(
  client: NodeGraphPoint,
  origin: { left: number; top: number },
  zoom: number
): NodeGraphPoint {
  const factor = zoom > 0 && Number.isFinite(zoom) ? zoom : 1
  return { x: (client.x - origin.left) / factor, y: (client.y - origin.top) / factor }
}

/**
 * World-space delta from the pointer to the node center at grab time.
 *
 * Without it a grabbed node snaps its center onto the pointer, so pressing
 * anywhere but the exact center of a node teleports it out from under the
 * cursor.
 */
export function nodeGraphGrabOffset(node: NodeGraphPoint, world: NodeGraphPoint): NodeGraphPoint {
  return { x: node.x - world.x, y: node.y - world.y }
}

/** Where a grabbed node belongs once the pointer reaches `world`. */
export function nodeGraphDragPosition(
  world: NodeGraphPoint,
  offset: NodeGraphPoint
): NodeGraphPoint {
  return { x: world.x + offset.x, y: world.y + offset.y }
}

/**
 * Radius the painter actually draws for a node, in screen pixels. The hit test
 * uses the same value so the clickable handle is exactly the visible circle.
 */
export function paintedNodeRadius(degree: number, nodeSize: number, scale: number): number {
  return Math.max(MIN_PAINTED_RADIUS, nodeGraphRadius(degree, nodeSize) * scale)
}

/**
 * Nearest node whose painted circle contains the screen point.
 *
 * There is deliberately no tolerance ring: a halo around each node swallows
 * clicks on nearby links and on empty canvas, so a drag could start without the
 * pointer ever being on a node. Zoom in to grab a node that is drawn small.
 */
export function nodeGraphHitTest(input: {
  screenX: number
  screenY: number
  width: number
  height: number
  view: NodeGraphView
  positions: ReadonlyMap<string, SimulationNode>
  camera: NodeGraphCamera
  nodeSize: number
}): string | null {
  let best: string | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const node of input.view.nodes) {
    const position = input.positions.get(node.id)
    if (!position) continue
    const screen = worldToScreen(position.x, position.y, input.camera, input.width, input.height)
    const radius = paintedNodeRadius(
      input.view.degrees.get(node.id) ?? 0,
      input.nodeSize,
      input.camera.scale
    )
    const distance = Math.hypot(screen.x - input.screenX, screen.y - input.screenY)
    if (distance <= radius && distance < bestDistance) {
      best = node.id
      bestDistance = distance
    }
  }
  return best
}

function colorFor(
  nodeId: string,
  kind: keyof typeof NODE_GRAPH_KIND_COLORS,
  view: NodeGraphView
): string {
  return view.groupColors.get(nodeId) ?? NODE_GRAPH_KIND_COLORS[kind]
}

/**
 * Camera that frames every node with a margin. Without this the only way back
 * from a stray pan is to hunt for the graph, which is the single most common
 * way users get lost in a node-link view.
 */
export function fitNodeGraphCamera(
  positions: readonly { x: number; y: number }[],
  width: number,
  height: number
): NodeGraphCamera {
  if (positions.length === 0 || width <= 0 || height <= 0) {
    return { x: 0, y: 0, scale: 1 }
  }
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const position of positions) {
    minX = Math.min(minX, position.x)
    maxX = Math.max(maxX, position.x)
    minY = Math.min(minY, position.y)
    maxY = Math.max(maxY, position.y)
  }
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  // A single node, or a perfectly vertical/horizontal line, has zero extent on
  // an axis; the floor keeps the division finite instead of yielding Infinity.
  const spanX = Math.max(maxX - minX, 1)
  const spanY = Math.max(maxY - minY, 1)
  const margin = 0.86
  const scale = clampNodeGraphScale(
    Math.min((width * margin) / spanX, (height * margin) / spanY)
  )
  return { x: centerX, y: centerY, scale }
}

export function paintNodeGraph(input: NodeGraphPaintInput): void {
  const { context, width, height, view, positions, camera, settings, theme } = input
  context.save()
  context.fillStyle = theme.background
  context.fillRect(0, 0, width, height)
  // Taken from the motion frame rather than the live pointer: the node losing
  // focus has to stay lit while the dimming recedes, or it flashes dark on the
  // way out.
  const focused = input.motion.focus
  const dimming = focused !== null
  paintEdges(input, focused, dimming)
  // Labels are drawn after every node so a small node's circle never covers a
  // neighbour's text, matching how Obsidian layers the graph.
  const labelled: { node: (typeof view.nodes)[number]; x: number; y: number; radius: number }[] = []
  for (const node of view.nodes) {
    const position = positions.get(node.id)
    if (!position) continue
    const screen = worldToScreen(position.x, position.y, camera, width, height)
    const isFocus = node.id === focused
    const entry = input.motion.entry(node.id)
    const base = paintedNodeRadius(
      view.degrees.get(node.id) ?? 0, settings.nodeSize, camera.scale
    )
    // Entry scales the node up into place; hover lifts the focused one so the
    // pointer gets a target that visibly answers back.
    const lift = isFocus ? 1 + NODE_GRAPH_HOVER_LIFT * input.motion.hover : 1
    const radius = Math.max(MIN_PAINTED_RADIUS, base * entry * lift)
    if (
      screen.x < -radius - 40 || screen.x > width + radius + 40 ||
      screen.y < -radius - 40 || screen.y > height + radius + 40
    ) continue
    const isNeighbor = input.highlighted.has(node.id)
    const onPath = input.pathNodeIds.has(node.id)
    const pathActive = input.pathNodeIds.size > 0
    const related = !dimming || isFocus || isNeighbor
    context.globalAlpha = entry * (onPath
      ? 1
      : pathActive
        ? lerp(1, 0.16, input.motion.dim)
        : related ? 1 : lerp(1, DIMMED_ALPHA, input.motion.dim))
    if (isFocus && input.motion.hover > 0.01 && radius > 2) {
      paintHoverHalo(context, screen.x, screen.y, radius, theme.accent, input.motion.hover)
    }
    const icon = input.kunStyle && radius >= KUN_NODE_ICON_MIN_RADIUS
      ? input.nodeIcon(node.kind)
      : null
    if (icon) {
      paintNodeIcon(context, icon, screen.x, screen.y, radius)
    } else {
      const fill = colorFor(node.id, node.kind, view)
      traceNodeGraphShape(context, NODE_GRAPH_KIND_SHAPES[node.kind], screen.x, screen.y, radius)
      context.fillStyle = fill
      context.fill()
      // A hairline in the surface colour separates touching nodes without adding
      // a second hue to read.
      if (radius > 3) {
        context.lineWidth = Math.max(0.6, radius * 0.12)
        context.strokeStyle = theme.background
        context.stroke()
      }
    }
    if (onPath || node.id === input.selectedNodeId) {
      // Selection reads as a detached halo rather than a thicker outline, so it
      // survives on a node whose own colour is close to the accent. Around an
      // icon it is a circle: the artwork has no silhouette to echo.
      const ringRadius = radius + Math.max(2.5, radius * 0.5)
      if (icon) {
        context.beginPath()
        context.arc(screen.x, screen.y, ringRadius, 0, Math.PI * 2)
      } else {
        traceNodeGraphShape(
          context,
          NODE_GRAPH_KIND_SHAPES[node.kind],
          screen.x,
          screen.y,
          ringRadius
        )
      }
      context.lineWidth = Math.max(1.5, 2 * camera.scale)
      context.strokeStyle = onPath ? theme.accent : theme.ring
      context.stroke()
    }
    labelled.push({ node, x: screen.x, y: screen.y, radius })
  }
  paintLabels(input, labelled, focused, dimming)
  context.restore()
}

/**
 * Draws an icon centred on the node, in a square inscribed in the hit circle.
 *
 * `nodeGraphIconBox` is the shared geometry so the hit test, the painter and the
 * tests cannot disagree about how much of the node the artwork covers.
 */
function paintNodeIcon(
  context: CanvasRenderingContext2D,
  icon: CanvasImageSource,
  x: number,
  y: number,
  radius: number
): void {
  const side = nodeGraphIconBox(radius)
  context.drawImage(icon, x - side / 2, y - side / 2, side, side)
}

/** Side of the square an icon occupies at a given painted radius. */
export function nodeGraphIconBox(radius: number): number {
  return radius * KUN_NODE_ICON_BOX
}

/** Blends `from` towards `to` by `t`, used to ease the dimming in and out. */
export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

/**
 * The soft ring that answers a hover.
 *
 * A radial gradient rather than a stroke, so it reads as light around the node
 * instead of a second outline competing with the selection ring — which is a
 * stroke, and has to stay distinguishable from this.
 */
function paintHoverHalo(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  strength: number
): void {
  const outer = radius * 2.1
  if (typeof context.createRadialGradient !== 'function') return
  const gradient = context.createRadialGradient(x, y, radius * 0.7, x, y, outer)
  gradient.addColorStop(0, withAlpha(color, 0.42 * strength))
  gradient.addColorStop(1, withAlpha(color, 0))
  const previous = context.globalAlpha
  context.globalAlpha = previous
  context.fillStyle = gradient
  context.beginPath()
  context.arc(x, y, outer, 0, Math.PI * 2)
  context.fill()
  context.globalAlpha = previous
}

/**
 * Applies an alpha to a theme colour.
 *
 * The tokens resolve to hex or to `rgb()`/`oklch()` depending on the theme, and
 * canvas gradients need an explicit alpha, so both forms are handled and
 * anything unrecognised falls back to the colour untouched.
 */
export function withAlpha(color: string, alpha: number): string {
  const value = color.trim()
  const clamped = Math.max(0, Math.min(1, alpha))
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)
  if (hex) {
    const digits = hex[1]!
    const full = digits.length === 3 ? digits.replace(/./g, (d) => d + d) : digits
    const r = parseInt(full.slice(0, 2), 16)
    const g = parseInt(full.slice(2, 4), 16)
    const b = parseInt(full.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${clamped})`
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(value)
  if (rgb) {
    const parts = rgb[1]!.split(/[,/]/).map((part) => part.trim()).filter(Boolean)
    if (parts.length >= 3) return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${clamped})`
  }
  // `color-mix` keeps oklch and every other modern space working without this
  // function having to parse it.
  return `color-mix(in srgb, ${value} ${Math.round(clamped * 100)}%, transparent)`
}

function paintEdges(
  input: NodeGraphPaintInput,
  focused: string | null,
  dimming: boolean
): void {
  const { context, width, height, view, positions, camera, settings, theme } = input
  context.lineCap = 'round'
  for (const edge of view.edges) {
    const from = positions.get(edge.from)
    const to = positions.get(edge.to)
    if (!from || !to) continue
    const start = worldToScreen(from.x, from.y, camera, width, height)
    const end = worldToScreen(to.x, to.y, camera, width, height)
    const onPath = input.pathEdgeIds.has(edge.id)
    const touchesFocus = focused !== null && (edge.from === focused || edge.to === focused)
    const pathActive = input.pathEdgeIds.size > 0
    // An edge is only as present as its dimmer end, so a link never outlives the
    // node it hangs off during the entry animation.
    const entry = Math.min(input.motion.entry(edge.from), input.motion.entry(edge.to))
    context.globalAlpha = entry * (onPath
      ? 1
      : pathActive
        ? lerp(1, 0.08, input.motion.dim)
        : !dimming || touchesFocus ? 1 : lerp(1, DIMMED_EDGE_ALPHA, input.motion.dim))
    context.strokeStyle = onPath ? theme.accent : touchesFocus ? theme.linkStrong : theme.link
    // `link` edges are the wikilink layer; containment is drawn thinner so the
    // structural scaffold never reads louder than the actual references.
    const weight = edge.kind === 'link' ? 1.35 : edge.kind === 'contains' ? 0.7 : 1
    context.lineWidth = onPath
      ? Math.max(1.6, settings.linkThickness * 2.6 * camera.scale)
      : Math.max(0.35, settings.linkThickness * weight * camera.scale)
    // Dashes march from source to target, so a highlighted link also says which
    // way it points — the arrowheads are optional, this is not.
    const flowing = (onPath || touchesFocus) && input.motion.flow !== 0
    if (flowing) {
      context.setLineDash([...FLOW_DASH])
      context.lineDashOffset = -input.motion.flow
    }
    context.beginPath()
    context.moveTo(start.x, start.y)
    context.lineTo(end.x, end.y)
    context.stroke()
    if (flowing) {
      context.setLineDash([])
      context.lineDashOffset = 0
    }
    if (settings.showArrows) paintArrow(context, start, end, camera.scale, settings.linkThickness)
  }
  context.globalAlpha = 1
  if (settings.showEdgeLabels) paintEdgeLabels(input, focused, dimming)
}

/**
 * Relationship names along the links.
 *
 * Drawn in a second pass so a label is never buried under a later line, and
 * only once the view is zoomed enough for the text to be legible — otherwise a
 * dense graph turns into a wall of overlapping words.
 */
function paintEdgeLabels(
  input: NodeGraphPaintInput,
  focused: string | null,
  dimming: boolean
): void {
  const { context, width, height, view, positions, camera, theme } = input
  if (camera.scale < EDGE_LABEL_MIN_SCALE) return
  context.save()
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.font = `${Math.max(8, Math.min(12, 9 * Math.sqrt(camera.scale)))}px system-ui, sans-serif`
  for (const edge of view.edges) {
    const from = positions.get(edge.from)
    const to = positions.get(edge.to)
    if (!from || !to) continue
    const start = worldToScreen(from.x, from.y, camera, width, height)
    const end = worldToScreen(to.x, to.y, camera, width, height)
    const span = Math.hypot(end.x - start.x, end.y - start.y)
    // Too short to hold a word without colliding with both endpoints.
    if (span < EDGE_LABEL_MIN_LENGTH) continue
    const onPath = input.pathEdgeIds.has(edge.id)
    const touchesFocus = focused !== null && (edge.from === focused || edge.to === focused)
    context.globalAlpha = onPath ? 1 : dimming && !touchesFocus ? 0.18 : 0.62
    const midX = (start.x + end.x) / 2
    const midY = (start.y + end.y) / 2
    let angle = Math.atan2(end.y - start.y, end.x - start.x)
    // Keep text upright: past vertical, read the edge the other way.
    if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI
    const text = edge.label?.trim() || input.edgeLabel(edge.kind)
    context.translate(midX, midY)
    context.rotate(angle)
    // A short ground behind the text keeps the line from striking through it.
    const textWidth = context.measureText(text).width
    context.fillStyle = theme.background
    context.fillRect(-textWidth / 2 - 3, -7, textWidth + 6, 14)
    context.fillStyle = theme.textMuted
    context.fillText(text, 0, 0)
    context.setTransform(input.pixelRatio, 0, 0, input.pixelRatio, 0, 0)
  }
  context.restore()
  context.globalAlpha = 1
}

function paintArrow(
  context: CanvasRenderingContext2D,
  start: { x: number; y: number },
  end: { x: number; y: number },
  scale: number,
  thickness: number
): void {
  const angle = Math.atan2(end.y - start.y, end.x - start.x)
  const size = Math.max(3, 4 * thickness * scale)
  const tipX = end.x - Math.cos(angle) * size
  const tipY = end.y - Math.sin(angle) * size
  context.beginPath()
  context.moveTo(tipX, tipY)
  context.lineTo(
    tipX - Math.cos(angle - Math.PI / 7) * size,
    tipY - Math.sin(angle - Math.PI / 7) * size
  )
  context.lineTo(
    tipX - Math.cos(angle + Math.PI / 7) * size,
    tipY - Math.sin(angle + Math.PI / 7) * size
  )
  context.closePath()
  context.fill()
}

function paintLabels(
  input: NodeGraphPaintInput,
  labelled: { node: NodeGraphView['nodes'][number]; x: number; y: number; radius: number }[],
  focused: string | null,
  dimming: boolean
): void {
  const { context, camera, settings, theme } = input
  // Obsidian's text fade threshold: below it labels vanish entirely, above it
  // they ramp in, so a zoomed-out overview stays readable as shapes alone.
  const fade = camera.scale - settings.textFadeThreshold
  const alwaysLabelled = new Set(input.pathNodeIds)
  if (focused) alwaysLabelled.add(focused)
  if (fade <= 0 && alwaysLabelled.size === 0) return
  const opacity = Math.min(1, Math.max(0, fade / 0.5))
  context.textAlign = 'center'
  context.textBaseline = 'top'
  context.font = `${Math.max(9, Math.min(15, 11 * Math.sqrt(camera.scale)))}px system-ui, sans-serif`
  for (const item of labelled) {
    const forced = alwaysLabelled.has(item.node.id)
    if (!forced && opacity <= 0.02) continue
    const isNeighbor = input.highlighted.has(item.node.id)
    const base = forced ? 1 : opacity
    // Labels ride the same dim curve as their nodes; snapping them alone reads
    // as a flicker against everything else easing.
    context.globalAlpha = input.motion.entry(item.node.id) * (
      !dimming || forced || isNeighbor ? base : base * lerp(1, 0.2, input.motion.dim)
    )
    const top = item.y + item.radius + 4
    context.fillStyle = theme.textFaint
    context.fillText(input.kindLabel(item.node.kind), item.x, top, 180)
    context.fillStyle = forced ? theme.text : theme.textMuted
    context.fillText(item.node.label, item.x, top + 11, 190)
  }
  context.globalAlpha = 1
}

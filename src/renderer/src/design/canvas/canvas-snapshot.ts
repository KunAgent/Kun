/**
 * Token-economic canvas snapshot for the AI. Drops transform matrices and other
 * rendering noise and uses parent NAMES instead of opaque ids so the AI can
 * reason about layer structure in human terms — but DOES carry a compact color
 * digest (primary fill / stroke / fontColor / cornerRadius) so a visual agent
 * can match the existing palette and styling instead of guessing.
 *
 * The id is still included so the AI can target shapes precisely in ShapeOps.
 */
import {
  embeddedArtifactOf,
  fillColor,
  isArtifactFrame,
  isImplicitImageSlot,
  shapeGeometry
} from './canvas-types'
import type { CanvasAgentNote, CanvasDocument, CanvasShape, Point, Rect } from './canvas-types'
import {
  getCanvasDocumentContentBounds,
  placeRectInViewportAvoiding
} from './canvas-placement'
import type { DesignArtifact } from '../design-types'
import { buildDesignGraphFromCanvasDocument } from '../graph/design-graph-from-canvas'
import { summarizeCanvasOperationJournal } from '../graph/canvas-operation-journal'
import { groupDesignArtifacts } from '../design-artifact-actions'
import {
  buildDesignDirectionManagerModel,
  summarizeDirectionForAgent
} from '../directions/direction-manager'
import {
  summarizeCodeBindingsForSnapshot,
  type CanvasCodeBindingSnapshot
} from '../code-binding/code-binding-summary'
import {
  buildCanvasMotionSummary,
  type CanvasMotionSummary
} from './canvas-motion-summary'

export type CanvasSnapshotShape = {
  id: string
  name: string
  type: CanvasShape['type']
  x: number
  y: number
  w: number
  h: number
  rotation?: number
  parentName: string | null
  textContent?: string
  embeddedArtifact?: { id: string; kind: 'html' | 'svg' }
  /** @deprecated Legacy HTML-only artifact reference. */
  htmlArtifactId?: string
  /** True when this shape is in the user's current selection (what "this"/"here" refers to). */
  selected?: boolean
  /** True when the shape intersects the user's current visible canvas viewport. */
  inView?: boolean
  /** True when the shape is close to the selected shapes, preserving local context on large boards. */
  nearSelection?: boolean
  /**
   * True when this shape is an AI image slot the agent should fill on request —
   * either explicitly marked (`aiImageHolder`) or an empty box the user has
   * currently selected (auto-detected, so no manual marking is needed).
   */
  aiImageHolder?: boolean
  /**
   * Workspace-relative path of the picture already in this image shape
   * (e.g. `.deepseekgui-images/img-….png`). Present only on `image` shapes
   * that have been filled — empty image holders omit it. The agent passes
   * this path back into `generate_image` as `reference_image_paths` when the
   * user asks to edit/restyle/redo the existing picture.
   */
  imageUrl?: string

  /** Primary fill color (hex) when the shape has a visible fill. */
  fill?: string
  /** Running app portal metadata for Onlook-style live code canvas frames. */
  runningApp?: {
    url: string
    title?: string
    routePath?: string
    sourceFile?: string
    componentName?: string
    status?: string
  }
  /** Gradient summary (e.g. `linear 90deg #a→#b`) for gradient-filled shapes. */
  gradient?: string
  /** Primary stroke as `color/width` (e.g. `#111827/1`) when visibly stroked. */
  stroke?: string
  /** Text color (hex) for text shapes. */
  fontColor?: string
  /** Corner radius in px when rounded. */
  cornerRadius?: number
  /** Compact shadow summary (e.g. `0/4 b8`) when the shape has a shadow. */
  shadow?: string
  /** CSS mix-blend-mode when not normal. */
  blendMode?: string
  /** Auto-layout summary (e.g. `row gap12 pad16`) on laid-out frames/groups. */
  layout?: string
  /** Design-token bindings (prop → token name) so the agent sees what's already systematized. */
  tokenBindings?: Record<string, string>
  /** Agent/critic/decision metadata for whiteboard notes. The note body is carried by textContent. */
  agentNote?: {
    kind: CanvasAgentNote['kind']
    source?: CanvasAgentNote['source']
    severity?: CanvasAgentNote['severity']
    targetIds?: string[]
    directionId?: string
    resolved?: boolean
    createdAt?: string
  }

  /** Linear shapes only: vertices in ABSOLUTE canvas coords. */
  points?: Point[]
  /** Linear shapes only: number of vertices omitted from `points` to keep the snapshot compact. */
  pointsOmitted?: number
}

const SNAPSHOT_MAX_POINTS_PER_SHAPE = 48
const SNAPSHOT_DEFAULT_SCREEN_WIDTH = 1280
const SNAPSHOT_DEFAULT_SCREEN_HEIGHT = 800
const SNAPSHOT_RECOMMENDED_SLOT_COUNT = 3

/**
 * Compact, token-cheap style summary: only the primary visible fill/stroke plus
 * fontColor/cornerRadius, and only when present. Lets the agent reuse the real
 * palette ("match the same blue", "restyle to fit") instead of guessing blind.
 */
type StyleDigest = {
  fill?: string
  /** Gradient fills only: `linear 90deg #a→#b` so the agent can match/extend them. */
  gradient?: string
  stroke?: string
  fontColor?: string
  cornerRadius?: number
  /** Compact effect summary, e.g. `shadow 0/4 b8` so the agent reuses the elevation. */
  shadow?: string
  blendMode?: string
  /** Auto-layout summary, e.g. `row gap12 pad16` — present on laid-out frames. */
  layout?: string
}

function styleDigest(s: CanvasShape): StyleDigest {
  const out: StyleDigest = {}
  const fill = s.fills?.find((f) => f.opacity > 0)
  if (fill) {
    if (fill.type === 'solid') {
      out.fill = fill.color
    } else {
      const dir = fill.type === 'linear' ? `linear ${round(fill.angle ?? 90)}deg` : 'radial'
      out.gradient = `${dir} ${fill.stops.map((st) => st.color).join('→')}`
      const primary = fillColor(fill)
      if (primary) out.fill = primary
    }
  }
  const stroke = s.strokes?.find((st) => st.opacity > 0 && st.width > 0)
  if (stroke) out.stroke = `${stroke.color}/${round(stroke.width)}`
  if (s.fontColor) out.fontColor = s.fontColor
  if (typeof s.cornerRadius === 'number' && s.cornerRadius > 0) out.cornerRadius = round(s.cornerRadius)
  if (s.shadows && s.shadows.length > 0) {
    const sh = s.shadows[0]
    out.shadow = `${sh.type === 'inner' ? 'inner ' : ''}${round(sh.x)}/${round(sh.y)} b${round(sh.blur)}`
  }
  if (s.blendMode && s.blendMode !== 'normal') out.blendMode = s.blendMode
  if (s.layout) {
    const dir = s.layout.direction === 'horizontal' ? 'row' : 'col'
    out.layout = `${dir} gap${round(s.layout.gap)} pad${round(s.layout.paddingTop)}`
  }
  return out
}

function sampledAbsolutePoints(shape: CanvasShape): Pick<CanvasSnapshotShape, 'points' | 'pointsOmitted'> {
  const points = shape.points ?? []
  if (points.length === 0) return {}
  const max = SNAPSHOT_MAX_POINTS_PER_SHAPE
  const source = points.length <= max
    ? points
    : Array.from({ length: max }, (_, index) => {
        const sourceIndex = Math.round((index * (points.length - 1)) / (max - 1))
        return points[sourceIndex]
      })
  return {
    points: source.map((p) => ({ x: round(shape.x + p.x), y: round(shape.y + p.y) })),
    ...(points.length > source.length ? { pointsOmitted: points.length - source.length } : {})
  }
}

function compactAgentNote(note: CanvasAgentNote | undefined): CanvasSnapshotShape['agentNote'] | undefined {
  if (!note) return undefined
  return {
    kind: note.kind,
    ...(note.source ? { source: note.source } : {}),
    ...(note.severity ? { severity: note.severity } : {}),
    ...(note.targetIds && note.targetIds.length > 0 ? { targetIds: note.targetIds } : {}),
    ...(note.directionId ? { directionId: note.directionId } : {}),
    ...(note.resolved === true ? { resolved: true } : {}),
    ...(note.createdAt ? { createdAt: note.createdAt } : {})
  }
}

export type CanvasSnapshot = {
  shapeCount: number
  shapes: CanvasSnapshotShape[]
  graph?: CanvasSnapshotGraphSummary
  codeBindings?: CanvasCodeBindingSnapshot
  /** Bounded canonical Motion timelines with stable frame/track/keyframe ids. */
  motion?: CanvasMotionSummary
  /**
   * Whiteboard placement guide for screen creation: the current viewport, whole
   * board bounds, occupied artifact frames and safe suggested slots for new screens.
   */
  placement?: CanvasPlacementGuide
  /** When `maxShapes` truncated the result, how many shapes were dropped. */
  omitted?: number
}

export type CanvasSnapshotGraphSummary = {
  projectId: string
  objectCount: number
  rootObjectCount: number
  directionCount: number
  updatedAt?: string
  lastJournalEntryId?: string
  directions?: Array<{
    id: string
    name: string
    status: string
    objectCount: number
    screenCount?: number
    prototypeLinkCount?: number
    implementedCount?: number
    uniqueScreens?: string[]
  }>
  recentOperations?: Array<{
    label: string
    status: string
    operationTypes: string[]
    affectedCount: number
    errorCount: number
  }>
}

export type CanvasPlacementRect = {
  x: number
  y: number
  w: number
  h: number
}

export type CanvasPlacementFrame = CanvasPlacementRect & {
  id: string
  name: string
  artifactId?: string
  artifactKind?: 'html' | 'svg'
  htmlArtifactId?: string
}

export type CanvasPlacementSlot = CanvasPlacementRect & {
  label: string
  reason: string
}

export type CanvasPlacementGuide = {
  empty: boolean
  viewBox?: CanvasPlacementRect
  contentBounds?: CanvasPlacementRect
  selectedBounds?: CanvasPlacementRect
  occupiedFrames: CanvasPlacementFrame[]
  defaultScreen: { w: number; h: number }
  recommendedSlots: CanvasPlacementSlot[]
}

/**
 * Options to keep big-document snapshots token-cheap:
 * - `rootFrameId` scopes the walk to one frame's subtree (the active screen)
 *   instead of the whole canvas.
 * - `maxShapes` caps how many shapes are emitted; the overflow count is reported
 *   as `omitted` so the agent knows the view is partial.
 */
export type SnapshotOptions = {
  rootFrameId?: string
  maxShapes?: number
  viewBox?: Rect
  selectedNeighborPadding?: number
  defaultScreenSize?: { width: number; height: number }
  projectId?: string
  artifacts?: DesignArtifact[]
}

function normalizeSnapshotScreenSize(size: SnapshotOptions['defaultScreenSize']): { width: number; height: number } {
  const width =
    typeof size?.width === 'number' && Number.isFinite(size.width) && size.width > 0
      ? size.width
      : SNAPSHOT_DEFAULT_SCREEN_WIDTH
  const height =
    typeof size?.height === 'number' && Number.isFinite(size.height) && size.height > 0
      ? size.height
      : SNAPSHOT_DEFAULT_SCREEN_HEIGHT
  return { width, height }
}

export function snapshotCanvas(
  doc: CanvasDocument,
  selectedIds?: ReadonlySet<string>,
  opts?: SnapshotOptions
): CanvasSnapshot {
  const { objects, rootId } = doc
  const shapes: CanvasSnapshotShape[] = []
  const seen = new Set<string>()
  const startId = opts?.rootFrameId && objects[opts.rootFrameId] ? opts.rootFrameId : rootId
  const startName = startId === rootId ? null : (objects[startId]?.name ?? null)
  const viewBox = opts?.viewBox
  const selectedNeighborPadding = opts?.selectedNeighborPadding ?? 240
  const defaultScreenSize = normalizeSnapshotScreenSize(opts?.defaultScreenSize)
  const graph = buildSnapshotGraphSummary(doc, opts)
  const codeBindings = summarizeCodeBindingsForSnapshot(doc, selectedIds)
  const motion = buildCanvasMotionSummary(doc, { preferredFrameId: startId })
  const selectedBounds = selectedIds && selectedIds.size > 0
    ? selectionBounds(objects, selectedIds, selectedNeighborPadding)
    : null

  function walk(parentId: string, parentName: string | null): void {
    const parent = objects[parentId]
    if (!parent) return
    for (const childId of parent.children) {
      if (seen.has(childId)) continue
      seen.add(childId)
      const s = objects[childId]
      if (!s) continue
      const selected = selectedIds?.has(s.id) ?? false
      const selrect = shapeGeometry(s).selrect
      const inView = viewBox ? rectsIntersect(selrect, viewBox) : false
      const nearSelection = !selected && selectedBounds ? rectsIntersect(selrect, selectedBounds) : false
      // A selected empty box is an implicit slot — the user shouldn't have to
      // mark it for the agent to fill it on request. A selected image whose
      // imageUrl is a data: URL is also effectively unreferenceable (the
      // snapshot drops data: URLs to avoid base64 blowing the prompt), so we
      // flag it as a holder too — otherwise the model would see neither
      // imageUrl nor aiImageHolder and have no rule to follow.
      const isUnreferenceableImage =
        s.type === 'image' && typeof s.imageUrl === 'string' && s.imageUrl.startsWith('data:')
      const isHolder =
        Boolean(s.aiImageHolder) || (selected && (isImplicitImageSlot(s) || isUnreferenceableImage))
      shapes.push({
        id: s.id,
        name: s.name,
        type: s.type,
        x: round(s.x),
        y: round(s.y),
        w: round(s.width),
        h: round(s.height),
        ...(s.rotation ? { rotation: round(s.rotation) } : {}),
        parentName,
        ...(s.textContent ? { textContent: s.textContent.slice(0, 120) } : {}),
        ...(s.embeddedArtifact ? { embeddedArtifact: { ...s.embeddedArtifact } } : {}),
        ...(s.htmlArtifactId ? { htmlArtifactId: s.htmlArtifactId } : {}),
        ...(s.runningApp
          ? {
              runningApp: {
                url: s.runningApp.url,
                ...(s.runningApp.title ? { title: s.runningApp.title } : {}),
                ...(s.runningApp.routePath ? { routePath: s.runningApp.routePath } : {}),
                ...(s.runningApp.sourceFile ? { sourceFile: s.runningApp.sourceFile } : {}),
                ...(s.runningApp.componentName ? { componentName: s.runningApp.componentName } : {}),
                ...(s.runningApp.status ? { status: s.runningApp.status } : {})
              }
            }
          : {}),
        ...(s.imageUrl && !s.imageUrl.startsWith('data:') ? { imageUrl: s.imageUrl } : {}),
        ...styleDigest(s),
        ...(s.tokenBindings && Object.keys(s.tokenBindings).length > 0
          ? { tokenBindings: s.tokenBindings }
          : {}),
        ...(s.agentNote ? { agentNote: compactAgentNote(s.agentNote) } : {}),
        ...(selected ? { selected: true } : {}),
        ...(inView ? { inView: true } : {}),
        ...(nearSelection ? { nearSelection: true } : {}),
        ...(isHolder ? { aiImageHolder: true } : {}),
        ...sampledAbsolutePoints(s)
      })
      if (s.children.length > 0) walk(s.id, s.name)
    }
  }

  walk(startId, startName)

  const max = opts?.maxShapes
  if (typeof max === 'number' && shapes.length > max) {
    const omitted = shapes.length - max
    const prioritized = shapes
      .map((shape, index) => ({ shape, index }))
      .sort((a, b) => snapshotPriority(a.shape) - snapshotPriority(b.shape) || a.index - b.index)
      .slice(0, max)
      .map((entry) => entry.shape)
    return {
      shapeCount: shapes.length,
      shapes: prioritized,
      graph,
      ...(codeBindings ? { codeBindings } : {}),
      ...(motion ? { motion } : {}),
      ...(viewBox ? { placement: buildPlacementGuide(doc, selectedIds, viewBox, defaultScreenSize) } : {}),
      omitted
    }
  }
  return {
    shapeCount: shapes.length,
    shapes,
    graph,
    ...(codeBindings ? { codeBindings } : {}),
    ...(motion ? { motion } : {}),
    ...(viewBox ? { placement: buildPlacementGuide(doc, selectedIds, viewBox, defaultScreenSize) } : {})
  }
}

function buildSnapshotGraphSummary(
  doc: CanvasDocument,
  opts: SnapshotOptions | undefined
): CanvasSnapshotGraphSummary {
  const projectId = opts?.projectId ?? doc.graph?.projectId ?? 'canvas'
  const graph = buildDesignGraphFromCanvasDocument(doc, {
    projectId,
    artifacts: opts?.artifacts,
    updatedAt: doc.graph?.updatedAt
  })
  const groupedArtifacts = opts?.artifacts ? groupDesignArtifacts(opts.artifacts) : null
  const directionManager = groupedArtifacts
    ? buildDesignDirectionManagerModel(groupedArtifacts.directions, groupedArtifacts.archivedDirections)
    : null
  const managerDirections = new Map(
    (directionManager?.directions ?? []).map(summarizeDirectionForAgent).map((direction) => [direction.id, direction])
  )
  const graphDirectionIds = new Set(Object.keys(graph.directions))
  const graphDirections = Object.values(graph.directions)
    .map((direction) => {
      const managed = managerDirections.get(direction.id)
      return {
        id: direction.id,
        name: direction.name,
        status: direction.status,
        objectCount: direction.objectIds.length,
        ...(managed
          ? {
              screenCount: managed.screenCount,
              prototypeLinkCount: managed.prototypeLinkCount,
              implementedCount: managed.implementedCount,
              ...(managed.uniqueScreens ? { uniqueScreens: managed.uniqueScreens } : {})
            }
          : {})
      }
    })
  const managerOnlyDirections = Array.from(managerDirections.values())
    .filter((direction) => !graphDirectionIds.has(direction.id))
    .map((direction) => ({
      id: direction.id,
      name: direction.name,
      status: direction.status,
      objectCount: 0,
      screenCount: direction.screenCount,
      prototypeLinkCount: direction.prototypeLinkCount,
      implementedCount: direction.implementedCount,
      ...(direction.uniqueScreens ? { uniqueScreens: direction.uniqueScreens } : {})
    }))
  const directions = [...graphDirections, ...managerOnlyDirections].slice(0, 8)
  const recentOperations = summarizeCanvasOperationJournal(doc)
  return {
    projectId,
    objectCount: Object.keys(graph.objects).length,
    rootObjectCount: graph.rootObjectIds.length,
    directionCount: Math.max(Object.keys(graph.directions).length, managerDirections.size),
    ...(doc.graph?.updatedAt ? { updatedAt: doc.graph.updatedAt } : {}),
    ...(doc.graph?.lastJournalEntryId ? { lastJournalEntryId: doc.graph.lastJournalEntryId } : {}),
    ...(directions.length > 0 ? { directions } : {}),
    ...(recentOperations.length > 0 ? { recentOperations } : {})
  }
}

function buildPlacementGuide(
  doc: CanvasDocument,
  selectedIds: ReadonlySet<string> | undefined,
  viewBox: Rect,
  defaultScreenSize: { width: number; height: number }
): CanvasPlacementGuide {
  const occupiedFrames = Object.values(doc.objects)
    .filter((shape): shape is CanvasShape => Boolean(shape) && shape.visible !== false && isArtifactFrame(shape))
    .map((shape) => {
      const reference = embeddedArtifactOf(shape)
      return {
        id: shape.id,
        name: shape.name,
        ...(reference ? { artifactId: reference.id, artifactKind: reference.kind } : {}),
        ...(reference?.kind === 'html' ? { htmlArtifactId: reference.id } : {}),
        ...compactRect(shapeGeometry(shape).selrect)
      }
    })
    .sort((a, b) => a.y - b.y || a.x - b.x || a.name.localeCompare(b.name))
  const occupiedRects = occupiedFrames.map(expandPlacementRect)
  const recommendedSlots: CanvasPlacementSlot[] = []
  for (let index = 0; index < SNAPSHOT_RECOMMENDED_SLOT_COUNT; index += 1) {
    const rect = placeRectInViewportAvoiding(
      defaultScreenSize,
      viewBox,
      [...occupiedRects, ...recommendedSlots.map(expandPlacementRect)]
    )
    recommendedSlots.push({
      label: index === 0 ? 'next' : `next-${index + 1}`,
      reason: index === 0
        ? 'Best empty slot near the current viewport.'
        : 'Alternative empty slot if creating multiple screens.',
      ...compactRect(rect)
    })
  }
  const rawSelectedBounds = selectedIds && selectedIds.size > 0
    ? selectionBounds(doc.objects, selectedIds, 0)
    : null
  const contentBounds = getCanvasDocumentContentBounds(doc)
  return {
    empty: occupiedFrames.length === 0 && !contentBounds,
    viewBox: compactRect(viewBox),
    ...(contentBounds ? { contentBounds: compactRect(contentBounds) } : {}),
    ...(rawSelectedBounds ? { selectedBounds: compactRect(rawSelectedBounds) } : {}),
    occupiedFrames,
    defaultScreen: { w: round(defaultScreenSize.width), h: round(defaultScreenSize.height) },
    recommendedSlots
  }
}

function compactRect(rect: Rect): CanvasPlacementRect {
  return {
    x: round(rect.x),
    y: round(rect.y),
    w: round(rect.width),
    h: round(rect.height)
  }
}

function expandPlacementRect(rect: CanvasPlacementRect): Rect {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.w,
    height: rect.h
  }
}

function selectionBounds(
  objects: Record<string, CanvasShape>,
  selectedIds: ReadonlySet<string>,
  padding: number
): Rect | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let found = false
  for (const id of selectedIds) {
    const shape = objects[id]
    if (!shape) continue
    const selrect = shapeGeometry(shape).selrect
    minX = Math.min(minX, selrect.x)
    minY = Math.min(minY, selrect.y)
    maxX = Math.max(maxX, selrect.x + selrect.width)
    maxY = Math.max(maxY, selrect.y + selrect.height)
    found = true
  }
  if (!found) return null
  const safePadding = Math.max(0, padding)
  return {
    x: minX - safePadding,
    y: minY - safePadding,
    width: maxX - minX + safePadding * 2,
    height: maxY - minY + safePadding * 2
  }
}

function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x + a.width >= b.x &&
    a.x <= b.x + b.width &&
    a.y + a.height >= b.y &&
    a.y <= b.y + b.height
  )
}

function snapshotPriority(shape: CanvasSnapshotShape): number {
  if (shape.selected) return 0
  if (shape.nearSelection) return 1
  if (shape.inView) return 2
  return 3
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

export function snapshotToCompactJson(snapshot: CanvasSnapshot): string {
  return JSON.stringify(snapshot, null, 2)
}

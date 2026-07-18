import { createSelectTool } from '../../../../design/canvas/tools/select-tool'
import { createRectTool } from '../../../../design/canvas/tools/rect-tool'
import { createEllipseTool } from '../../../../design/canvas/tools/ellipse-tool'
import { createTextTool } from '../../../../design/canvas/tools/text-tool'
import { createFrameTool } from '../../../../design/canvas/tools/frame-tool'
import { createHandTool } from '../../../../design/canvas/tools/hand-tool'
import { createScreenTool } from '../../../../design/canvas/tools/screen-tool'
import { createAiImageTool } from '../../../../design/canvas/tools/ai-image-tool'
import { createArrowTool, createLineTool } from '../../../../design/canvas/tools/linear-tool'
import { createDrawTool } from '../../../../design/canvas/tools/draw-tool'
import type { CanvasToolHandler } from '../../../../design/canvas/tools/tool-types'
import type { CanvasDocument, CanvasTool, Rect, ViewBox } from '../../../../design/canvas/canvas-types'
import { embeddedArtifactOf, isHtmlFrame, shapeBounds, shapeGeometry } from '../../../../design/canvas/canvas-types'
import type { CanvasMotionDocument } from '../../../../design/motion/canvas-motion-types'
import { createEmptyMotionDocument } from '../../../../design/motion/model'

const CANVAS_VIEWPORT_STORAGE_PREFIX = 'kun.design.canvasViewport'
const IMAGE_ANNOTATION_ACTION_WIDTH = 112
const IMAGE_ANNOTATION_ACTION_HEIGHT = 30
const IMAGE_ANNOTATION_ACTION_GAP = 10
const IMAGE_ANNOTATION_ACTION_MARGIN = 8

export function shouldRenderDesignArtifactOverlays(surface: 'design' | 'code'): boolean {
  return surface === 'design'
}

export function shouldRenderCanvasMinimap(surface: 'design' | 'code'): boolean {
  return surface === 'design'
}

export function shouldSyncCanvasHtmlFrames(
  surface: 'design' | 'code',
  syncHtmlScreens: boolean
): boolean {
  return surface === 'design' && syncHtmlScreens
}

export function shouldOpenImageAnnotation(
  surface: 'design' | 'code',
  shape: CanvasDocument['objects'][string] | undefined
): boolean {
  return (surface === 'design' || surface === 'code') && shape?.type === 'image' && Boolean(shape.imageUrl)
}

export type SelectedImageAnnotationAction = {
  shapeId: string
  left: number
  top: number
  width: number
  height: number
  placement: 'above' | 'below'
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.max(min, Math.min(max, value))
}

export function resolveSelectedImageAnnotationAction(
  surface: 'design' | 'code',
  doc: CanvasDocument,
  selectedIds: ReadonlySet<string>,
  viewport: {
    vbox: ViewBox
    containerWidth: number
    containerHeight: number
  }
): SelectedImageAnnotationAction | null {
  if (selectedIds.size !== 1) return null
  const shapeId = selectedIds.values().next().value
  if (!shapeId) return null
  const shape = doc.objects[shapeId]
  if (!shape?.visible || !shouldOpenImageAnnotation(surface, shape)) return null
  if (viewport.vbox.width <= 0 || viewport.vbox.height <= 0) return null
  if (viewport.containerWidth <= 0 || viewport.containerHeight <= 0) return null

  const bounds = shapeGeometry(shape).selrect
  // The SVG uses its default preserveAspectRatio="xMidYMid meet" behavior.
  // Mirror its uniform scale and centered letterboxing so this HTML overlay
  // stays attached to the selected image in non-matching viewport ratios.
  const scale = Math.min(
    viewport.containerWidth / viewport.vbox.width,
    viewport.containerHeight / viewport.vbox.height
  )
  const offsetX = (viewport.containerWidth - viewport.vbox.width * scale) / 2
  const offsetY = (viewport.containerHeight - viewport.vbox.height * scale) / 2
  const shapeLeft = offsetX + (bounds.x - viewport.vbox.x) * scale
  const shapeTop = offsetY + (bounds.y - viewport.vbox.y) * scale
  const shapeRight = offsetX + (bounds.x + bounds.width - viewport.vbox.x) * scale
  const shapeBottom = offsetY + (bounds.y + bounds.height - viewport.vbox.y) * scale
  if (
    shapeRight < 0 ||
    shapeLeft > viewport.containerWidth ||
    shapeBottom < 0 ||
    shapeTop > viewport.containerHeight
  ) {
    return null
  }
  const minLeft = IMAGE_ANNOTATION_ACTION_MARGIN
  const maxLeft = viewport.containerWidth - IMAGE_ANNOTATION_ACTION_WIDTH - IMAGE_ANNOTATION_ACTION_MARGIN
  const left = clamp(shapeRight - IMAGE_ANNOTATION_ACTION_WIDTH, minLeft, maxLeft)

  let placement: SelectedImageAnnotationAction['placement'] = 'above'
  let top = shapeTop - IMAGE_ANNOTATION_ACTION_HEIGHT - IMAGE_ANNOTATION_ACTION_GAP
  if (top < IMAGE_ANNOTATION_ACTION_MARGIN) {
    placement = 'below'
    top = shapeBottom + IMAGE_ANNOTATION_ACTION_GAP
  }
  top = clamp(
    top,
    IMAGE_ANNOTATION_ACTION_MARGIN,
    viewport.containerHeight - IMAGE_ANNOTATION_ACTION_HEIGHT - IMAGE_ANNOTATION_ACTION_MARGIN
  )

  return {
    shapeId,
    left: Math.round(left),
    top: Math.round(top),
    width: IMAGE_ANNOTATION_ACTION_WIDTH,
    height: IMAGE_ANNOTATION_ACTION_HEIGHT,
    placement
  }
}

export function shouldToggleHtmlFrameInteractiveOnDoubleClick(
  surface: 'design' | 'code',
  shape: CanvasDocument['objects'][string] | undefined
): boolean {
  return shouldRenderDesignArtifactOverlays(surface) && Boolean(shape && isHtmlFrame(shape))
}

export function resolveCanvasDesignSystemBaseDir(
  baseDir: string | undefined,
  designSystemBaseDir: string | undefined
): string | undefined {
  return designSystemBaseDir ?? baseDir
}

function targetInside(root: HTMLElement | null, target: unknown): boolean {
  if (!root || !target) return false
  try {
    return root.contains(target as Node)
  } catch {
    return false
  }
}

export function shouldHandleCanvasKeyboardEvent(
  surface: 'design' | 'code',
  eventTarget: EventTarget | null,
  root: HTMLElement | null,
  activeElement?: Element | null
): boolean {
  const eventElement = eventTarget as (EventTarget & { closest?: (selector: string) => Element | null }) | null
  if (eventElement && typeof eventElement.closest === 'function' && eventElement.closest('[data-motion-timeline]')) {
    return false
  }
  if (surface === 'design') return true
  const active = activeElement ?? (typeof document !== 'undefined' ? document.activeElement : null)
  return targetInside(root, eventTarget) || targetInside(root, active)
}

export function canvasViewportStorageKey(workspaceRoot: string, artifactId: string, baseDir?: string): string {
  return [
    CANVAS_VIEWPORT_STORAGE_PREFIX,
    encodeURIComponent(workspaceRoot),
    encodeURIComponent(baseDir ?? ''),
    encodeURIComponent(artifactId)
  ].join(':')
}

function isViewBox(value: unknown): value is ViewBox {
  if (!value || typeof value !== 'object') return false
  const box = value as Partial<ViewBox>
  return (
    typeof box.x === 'number' &&
    typeof box.y === 'number' &&
    typeof box.width === 'number' &&
    typeof box.height === 'number' &&
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.width) &&
    Number.isFinite(box.height) &&
    box.width > 0 &&
    box.height > 0
  )
}

export function readStoredCanvasViewport(key: string): ViewBox | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return isViewBox(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function writeStoredCanvasViewport(key: string, vbox: ViewBox): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.setItem(key, JSON.stringify(vbox))
  } catch {
    // Ignore private-mode/quota failures; view persistence is best-effort.
  }
}

export function boundsForShapeIds(doc: CanvasDocument, ids: readonly string[]): Rect | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let found = false
  for (const id of ids) {
    const shape = doc.objects[id]
    if (!shape) continue
    const bounds = shapeBounds(shape)
    found = true
    minX = Math.min(minX, bounds.x)
    minY = Math.min(minY, bounds.y)
    maxX = Math.max(maxX, bounds.x + bounds.width)
    maxY = Math.max(maxY, bounds.y + bounds.height)
  }
  if (!found) return null
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
}

export function filterShapeIdsPresentInDocument(
  doc: CanvasDocument,
  ids: Iterable<string>
): string[] {
  return [...ids].filter((id) => Boolean(doc.objects[id]))
}

export function resolveCanvasSelectionAfterDocumentSync(
  doc: CanvasDocument,
  state: {
    selectedIds: Iterable<string>
    editingId: string | null
    hoverTargetId: string | null
  }
): {
  selectedIds: string[]
  editingId: string | null
  hoverTargetId: string | null
} {
  return {
    selectedIds: filterShapeIdsPresentInDocument(doc, state.selectedIds),
    editingId: state.editingId && doc.objects[state.editingId] ? state.editingId : null,
    hoverTargetId: state.hoverTargetId && doc.objects[state.hoverTargetId] ? state.hoverTargetId : null
  }
}

export function resolveHtmlFrameOverlayInteractionState(
  doc: CanvasDocument,
  selectedIds: ReadonlySet<string>,
  state: {
    interactiveId: string | null
    editingId: string | null
    overlayAvailable?: boolean
    mountableFrameIds?: ReadonlySet<string>
  }
): {
  interactiveId: string | null
  editingId: string | null
} {
  if (state.overlayAvailable === false) {
    return { interactiveId: null, editingId: null }
  }
  const canKeep = (id: string | null): id is string => {
    if (!id || !selectedIds.has(id)) return false
    if (state.mountableFrameIds && !state.mountableFrameIds.has(id)) return false
    const shape = doc.objects[id]
    return Boolean(shape?.visible && isHtmlFrame(shape))
  }
  return {
    interactiveId: canKeep(state.interactiveId) ? state.interactiveId : null,
    editingId: canKeep(state.editingId) ? state.editingId : null
  }
}

export function shouldResetCanvasTransientInteractionAfterDocumentSync(
  removedShapeIds: readonly string[]
): boolean {
  return removedShapeIds.length > 0
}

function cloneCanvasDocument(doc: CanvasDocument): CanvasDocument {
  const objects: CanvasDocument['objects'] = {}
  for (const [id, shape] of Object.entries(doc.objects)) {
    objects[id] = { ...shape, children: [...shape.children] }
  }
  return { ...doc, objects }
}

function liveShapeShouldReplaceLoaded(
  liveShape: CanvasDocument['objects'][string],
  loadedShape: CanvasDocument['objects'][string] | undefined
): boolean {
  if (!loadedShape) return true
  const liveArtifact = embeddedArtifactOf(liveShape)
  const loadedArtifact = embeddedArtifactOf(loadedShape)
  return Boolean(
    liveArtifact &&
      (liveArtifact.id !== loadedArtifact?.id || liveArtifact.kind !== loadedArtifact.kind)
  )
}

function mergeLoadedMotionWithLiveChanges(
  loaded: CanvasMotionDocument | undefined,
  live: CanvasMotionDocument | undefined,
  initial: CanvasMotionDocument | undefined
): { motion: CanvasMotionDocument; changed: boolean } {
  const loadedMotion = loaded ?? createEmptyMotionDocument()
  const liveTimelines = live?.timelines ?? {}
  const initialTimelines = initial?.timelines ?? {}
  const timelineKeys = new Set([
    ...Object.keys(liveTimelines),
    ...Object.keys(initialTimelines)
  ])
  let timelines: CanvasMotionDocument['timelines'] | null = null
  for (const frameId of timelineKeys) {
    const liveTimeline = liveTimelines[frameId]
    if (liveTimeline === initialTimelines[frameId]) continue
    if (!timelines) timelines = { ...loadedMotion.timelines }
    if (liveTimeline) timelines[frameId] = liveTimeline
    else delete timelines[frameId]
  }
  return timelines
    ? { motion: { version: 1, timelines }, changed: true }
    : { motion: loadedMotion, changed: false }
}

export function mergeLoadedCanvasDocumentWithLiveChanges(
  loaded: CanvasDocument,
  live: CanvasDocument,
  initial: CanvasDocument
): CanvasDocument {
  if (live === initial) return loaded
  const liveRoot = live.objects[live.rootId]
  const motionMerge = mergeLoadedMotionWithLiveChanges(loaded.motion, live.motion, initial.motion)
  if ((!liveRoot || liveRoot.children.length === 0) && !motionMerge.changed) return loaded

  const next = cloneCanvasDocument(loaded)
  const nextRoot = next.objects[next.rootId]
  if (!nextRoot) return loaded

  let changed = motionMerge.changed
  if (motionMerge.changed) next.motion = motionMerge.motion
  const copyLiveSubtree = (id: string): void => {
    const liveShape = live.objects[id]
    if (!liveShape) return
    const loadedShape = next.objects[id]
    if (liveShapeShouldReplaceLoaded(liveShape, loadedShape)) {
      next.objects[id] = { ...liveShape, children: [...liveShape.children] }
      changed = true
    }
    for (const childId of liveShape.children) copyLiveSubtree(childId)
  }

  const rootChildren = [...nextRoot.children]
  for (const childId of liveRoot.children) {
    copyLiveSubtree(childId)
    if (!rootChildren.includes(childId) && next.objects[childId]) {
      rootChildren.push(childId)
      changed = true
    }
  }

  if (!changed) return loaded
  next.objects[next.rootId] = { ...nextRoot, children: rootChildren }
  return next
}

const toolFactories: Record<CanvasTool, () => CanvasToolHandler> = {
  select: createSelectTool,
  rect: createRectTool,
  ellipse: createEllipseTool,
  text: createTextTool,
  frame: createFrameTool,
  screen: createScreenTool,
  image: createAiImageTool,
  arrow: createArrowTool,
  line: createLineTool,
  draw: createDrawTool,
  hand: createHandTool
}

export function createCanvasTool(tool: CanvasTool, surface: 'design' | 'code'): CanvasToolHandler {
  if (tool === 'image') return createAiImageTool({ openAssistant: surface === 'design' })
  if (surface === 'code') {
    switch (tool) {
      case 'rect': return createRectTool('diagram')
      case 'ellipse': return createEllipseTool('diagram')
      case 'text': return createTextTool('diagram')
      case 'frame': return createFrameTool('diagram')
      case 'arrow': return createArrowTool('diagram')
      case 'line': return createLineTool('diagram')
      case 'draw': return createDrawTool('diagram')
    }
  }
  return toolFactories[tool]()
}

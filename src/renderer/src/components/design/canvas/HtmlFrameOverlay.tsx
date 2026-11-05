import { useEffect, useMemo, type ReactElement } from 'react'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { useCanvasViewportStore } from '../../../design/canvas/canvas-viewport-store'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import {
  isCanvasPortalFrame,
  isHtmlFrame,
  isRunningAppFrame,
  type CanvasDocument,
  type CanvasShape,
  type Rect
} from '../../../design/canvas/canvas-types'
import type { DesignHtmlElementContext } from '../../../design/design-composer-context'
import { ScreenOverlay } from './html-frame/HtmlFrameScreenOverlay'
import { htmlFrameOverlayCanMountAtZoom } from './html-frame/html-frame-helpers'
import { useHtmlFrameThumbnails } from './html-frame/use-html-frame-thumbnails'
import { selectHtmlFramePreviewBudget, HTML_FRAME_OVERVIEW_ZOOM } from './html-frame/html-frame-preview-budget'
import { RunningAppFrameOverlay } from './RunningAppFrameOverlay'
import { useCanvasMotionStore } from '../../../design/motion/canvas-motion-store'

export {
  HTML_FRAME_CONTENT_SIZE_QUERY,
  buildHtmlFrameScrollbarSuppressionScript,
  executeHtmlFrameWebviewScript,
  htmlFrameAllowsWidthAutoGrow,
  htmlFrameDrawingActive,
  htmlFrameOverlayCanMountAtZoom,
  htmlFrameOverlayPointerEvents,
  htmlFramePreviewAsyncEpochMatches,
  htmlFrameShouldApplyScrollbarSuppression,
  htmlFrameShouldPromotePreviewToReady,
  htmlFrameShouldSuppressDocumentScrollbars,
  htmlFrameWebviewCanvasStyle,
  htmlFrameWebviewPartition,
  resolveHtmlFrameMeasurementDecision,
  shouldAutoResizeHtmlFrame,
  shouldRenderHtmlFrameWebview
} from './html-frame/html-frame-helpers'
export type { HtmlFrameMeasurementDecision } from './html-frame/html-frame-helpers'

const MAX_ACTIVE_WEBVIEWS = 10

export type HtmlFrameCanvasScreenTransform = {
  scale: number
  offsetX: number
  offsetY: number
}

export function htmlFrameCanvasScreenTransform({
  vbox,
  containerWidth,
  containerHeight
}: {
  vbox: Rect
  containerWidth: number
  containerHeight: number
}): HtmlFrameCanvasScreenTransform {
  const safeVboxWidth = Number.isFinite(vbox.width) && vbox.width > 0 ? vbox.width : 1
  const safeVboxHeight = Number.isFinite(vbox.height) && vbox.height > 0 ? vbox.height : 1
  const safeContainerWidth = Number.isFinite(containerWidth) && containerWidth > 0 ? containerWidth : 1
  const safeContainerHeight = Number.isFinite(containerHeight) && containerHeight > 0 ? containerHeight : 1
  const scale = Math.min(safeContainerWidth / safeVboxWidth, safeContainerHeight / safeVboxHeight)
  return {
    scale,
    offsetX: (safeContainerWidth - safeVboxWidth * scale) / 2,
    offsetY: (safeContainerHeight - safeVboxHeight * scale) / 2
  }
}

export function htmlFrameCanvasRectToScreenRect(
  shape: Pick<CanvasShape, 'x' | 'y' | 'width' | 'height'>,
  vbox: Rect,
  transform: HtmlFrameCanvasScreenTransform
): Rect {
  return {
    x: transform.offsetX + (shape.x - vbox.x) * transform.scale,
    y: transform.offsetY + (shape.y - vbox.y) * transform.scale,
    width: shape.width * transform.scale,
    height: shape.height * transform.scale
  }
}

export function htmlFramesInCanvasPaintOrder(document: CanvasDocument): CanvasShape[] {
  return canvasPortalFramesInCanvasPaintOrder(document).filter(isHtmlFrame)
}

export function canvasPortalFramesInCanvasPaintOrder(document: CanvasDocument): CanvasShape[] {
  const frames: CanvasShape[] = []
  const visit = (id: string): void => {
    const shape = document.objects[id]
    if (!shape || !shape.visible) return
    if (id !== document.rootId && isCanvasPortalFrame(shape)) {
      frames.push(shape)
      return
    }
    for (const childId of shape.children) visit(childId)
  }
  for (const childId of document.objects[document.rootId]?.children ?? []) visit(childId)
  return frames
}

export function htmlFrameIntersectsViewport(shape: CanvasShape, vbox: Rect): boolean {
  const right = shape.x + shape.width
  const bottom = shape.y + shape.height
  const vRight = vbox.x + vbox.width
  const vBottom = vbox.y + vbox.height
  return right > vbox.x && shape.x < vRight && bottom > vbox.y && shape.y < vBottom
}

export function selectHtmlFramesForOverlay(
  framesInPaintOrder: CanvasShape[],
  selectedIds: ReadonlySet<string>,
  maxActive: number = MAX_ACTIVE_WEBVIEWS
): CanvasShape[] {
  const priority = framesInPaintOrder
    .map((shape, index) => ({
      shape,
      index,
      selected: selectedIds.has(shape.id) ? 1 : 0
    }))
    .sort((a, b) => b.selected - a.selected || b.index - a.index)
    .slice(0, Math.max(0, maxActive))
  const mountedIds = new Set(priority.map((item) => item.shape.id))
  return framesInPaintOrder.filter((shape) => mountedIds.has(shape.id))
}

function hasMotionTargetAncestor(
  document: CanvasDocument,
  shapeId: string,
  targetIds: ReadonlySet<string>
): boolean {
  const visited = new Set<string>()
  let currentId: string | null = shapeId
  while (currentId && currentId !== document.rootId && !visited.has(currentId)) {
    if (targetIds.has(currentId)) return true
    visited.add(currentId)
    currentId = document.objects[currentId]?.parentId ?? null
  }
  return false
}

type Props = {
  workspaceRoot: string
  readOnly?: boolean
  interactiveId: string | null
  onToggleInteractive: (shapeId: string) => void
  onUseElementAsContext?: (context: DesignHtmlElementContext | null, promptSeed?: string) => void
}

export function HtmlFrameOverlay({
  workspaceRoot,
  readOnly = false,
  interactiveId,
  onToggleInteractive,
  onUseElementAsContext,
}: Props): ReactElement {
  const document = useCanvasShapeStore((s) => s.document)
  const objects = document.objects
  const vbox = useCanvasViewportStore((s) => s.vbox)
  const containerWidth = useCanvasViewportStore((s) => s.containerWidth)
  const containerHeight = useCanvasViewportStore((s) => s.containerHeight)
  const activeTool = useCanvasViewportStore((s) => s.activeTool)
  const selectedIds = useCanvasSelectionStore((s) => s.selectedIds)
  const motionOpen = useCanvasMotionStore((state) => state.open)
  const motionFrameId = useCanvasMotionStore((state) => state.activeFrameId)

  const canvasScreenTransform = useMemo(() => htmlFrameCanvasScreenTransform({
    vbox,
    containerWidth,
    containerHeight
  }), [containerHeight, containerWidth, vbox])
  const zoom = canvasScreenTransform.scale
  const panning = activeTool === 'hand'

  const portalFrames = useMemo(() => {
    return canvasPortalFramesInCanvasPaintOrder(document)
  }, [document])
  const motionTargetIds = useMemo(() => new Set(
    motionOpen && motionFrameId
      ? (document.motion?.timelines[motionFrameId]?.tracks ?? []).map((track) => track.targetShapeId)
      : []
  ), [document.motion, motionFrameId, motionOpen])

  // Mount priority favors selected/topmost frames, then we render in paint order
  // so the DOM overlay matches the SVG canvas stacking order.
  const visibleFrames = useMemo(() => {
    const priorityIds = new Set(selectedIds)
    if (interactiveId) priorityIds.add(interactiveId)
    const candidates = portalFrames.filter((shape) => {
      const motionRelevant = motionOpen && hasMotionTargetAncestor(document, shape.id, motionTargetIds)
      if (motionRelevant) priorityIds.add(shape.id)
      return motionRelevant || htmlFrameIntersectsViewport(shape, vbox)
    })
    return { candidates, priorityIds }
  }, [document, interactiveId, motionOpen, motionTargetIds, portalFrames, selectedIds, vbox])
  const { thumbnails, onCapture } = useHtmlFrameThumbnails(visibleFrames.candidates, workspaceRoot)
  const pendingIds = new Set([...thumbnails].filter(([, entry]) => entry.pending).map(([id]) => id))
  const { liveIds, captureIds } = selectHtmlFramePreviewBudget(
    visibleFrames.candidates.filter((shape) => shape.width * zoom >= 20 && shape.height * zoom >= 20),
    visibleFrames.priorityIds,
    pendingIds,
    zoom
  )

  const selectedIdsKey = useMemo(() => [...selectedIds].sort().join(','), [selectedIds])
  const paintIndexById = useMemo(() => new Map(
    (document.objects[document.rootId]?.children ?? []).map((id, index) => [id, index + 1])
  ), [document])

  useEffect(() => {
    onUseElementAsContext?.(null)
  }, [onUseElementAsContext, selectedIdsKey])

  if (portalFrames.length === 0 || !htmlFrameOverlayCanMountAtZoom(zoom)) return <></>

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {visibleFrames.candidates.map((shape) => {
        const screenRect = htmlFrameCanvasRectToScreenRect(shape, vbox, canvasScreenTransform)
        const active = selectedIds.has(shape.id)
        const live = liveIds.has(shape.id)
        const capturing = captureIds.has(shape.id)
        const thumbnail = thumbnails.get(shape.id)
        if (!live && !capturing) {
          return (
            <div
              key={shape.id}
              className="absolute overflow-hidden rounded border border-ds-border bg-ds-card"
              style={{ left: screenRect.x, top: screenRect.y, width: screenRect.width, height: screenRect.height,
                zIndex: paintIndexById.get(shape.id) ?? 1 }}
              data-canvas-thumbnail={shape.id}
              title={shape.name}
            >
              {thumbnail?.image ? (
                <img src={thumbnail.image} alt={shape.name} draggable={false} className="h-full w-full" />
              ) : (
                <div className="flex h-full items-center justify-center overflow-hidden p-1 text-[10px] text-ds-muted">
                  <span className="truncate">{shape.name}</span>
                </div>
              )}
            </div>
          )
        }

        if (isRunningAppFrame(shape)) {
          return (
            <RunningAppFrameOverlay
              key={shape.id}
              shape={shape}
              screenX={screenRect.x}
              screenY={screenRect.y}
              screenWidth={screenRect.width}
              screenHeight={screenRect.height}
              zIndex={paintIndexById.get(shape.id) ?? 1}
              zoom={zoom}
              active={active}
              interactive={!readOnly && interactiveId === shape.id}
              panning={panning || readOnly}
              onDoubleClick={readOnly ? () => undefined : onToggleInteractive}
            />
          )
        }

        return (
          <ScreenOverlay
            key={shape.id}
            shape={shape}
            workspaceRoot={workspaceRoot}
            screenX={screenRect.x}
            screenY={screenRect.y}
            screenWidth={screenRect.width}
            screenHeight={screenRect.height}
            zIndex={paintIndexById.get(shape.id) ?? 1}
            zoom={zoom}
            active={active}
            interactive={!readOnly && live && interactiveId === shape.id}
            panning={panning || readOnly || !live || zoom < HTML_FRAME_OVERVIEW_ZOOM}
            onToggleInteractive={readOnly ? undefined : onToggleInteractive}
            onUseElementAsContext={readOnly ? undefined : onUseElementAsContext}
            canvasReadOnly={readOnly || !live}
            captureOnly={!live}
            captureKey={thumbnail?.pending ? thumbnail.key : undefined}
            onCapture={onCapture}
          />
        )
      })}
    </div>
  )
}

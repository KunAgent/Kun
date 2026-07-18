import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import type { CanvasDocument, CanvasShape, Rect } from '../../../design/canvas/canvas-types'
import { ROOT_SHAPE_ID, isHtmlFrame } from '../../../design/canvas/canvas-types'
import { shapeGeometry } from '../../../design/canvas/canvas-types'
import { useDesignWorkspaceStore } from '../../../design/design-workspace-store'
import { getSelectionBounds } from '../../../design/canvas/canvas-hit-test'
import {
  computeResizedBounds,
  scaleShapesToBounds,
  type ResizeHandle,
  type ShapeBoundsLike
} from '../../../design/canvas/canvas-resize'
import { angleFromPivot, computeRotation } from '../../../design/canvas/canvas-rotate'
import { findResizeSnaps, type SnapGuide } from '../../../design/canvas/canvas-snap'
import { BOARD_HTML_FRAME_MIN_HEIGHT } from '../../../design/canvas/canvas-placement'
import { useCanvasShapeStore, withDescendants } from '../../../design/canvas/canvas-shape-store'
import { useCanvasUndoStore } from '../../../design/canvas/canvas-undo-store'
import {
  beginAutoKeyCanvasGesture,
  commitActiveAutoKeyCanvasGesture,
  commitAutoKeyCanvasGesture,
  endAutoKeyCanvasGesture
} from '../../../design/motion/canvas-motion-auto-key'
import { useCanvasMotionStore } from '../../../design/motion/canvas-motion-store'
import { projectCanvasMotionObjects } from '../../../design/motion/canvas-motion-preview'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import { useCanvasViewportStore } from '../../../design/canvas/canvas-viewport-store'
import { useDesignAssistantStore } from '../../../design/design-assistant-store'
import { filterEditableShapeIds } from '../../../design/canvas/canvas-editability'
import { defaultFrameSizeForDesignTarget } from '../../../design/design-context'
import type { DesignArtifact } from '../../../design/design-types'
import { LinearPointEditor } from './LinearPointEditor'

const HANDLE_SIZE = 7
const ROTATE_HANDLE_SIZE = 24
const ROTATE_HANDLE_OFFSET = 28
const ROTATE_HANDLE_DOT_RADIUS = 5
const SELECTION_COLOR = '#6557ff'

type ResizeDragState = {
  handle: ResizeHandle
  startBounds: Rect
  startClientX: number
  startClientY: number
  shapeStarts: Map<string, ShapeBoundsLike>
}

type RotateDragState = {
  pivotX: number
  pivotY: number
  startAngleFromPivot: number
  shapeStartRotations: Map<string, number>
}

export function applyPendingHtmlFrameAspectResize({
  handle,
  bounds,
  shape,
  artifact,
  parallelStatus,
  designTarget,
  singleSelection
}: {
  handle: ResizeHandle
  bounds: ShapeBoundsLike
  shape: CanvasShape | undefined
  artifact: DesignArtifact | undefined
  parallelStatus?: 'queued' | 'running' | 'done' | 'failed'
  designTarget: unknown
  singleSelection: boolean
}): ShapeBoundsLike {
  if (!singleSelection) return bounds
  if (handle !== 'e' && handle !== 'w') return bounds
  if (!shape || !isHtmlFrame(shape) || artifact?.kind !== 'html') return bounds
  const generating =
    artifact.previewStatus === 'pending' || parallelStatus === 'queued' || parallelStatus === 'running'
  if (!generating) return bounds
  const targetSize = defaultFrameSizeForDesignTarget(designTarget)
  const aspectHeight = Math.round(bounds.width * (targetSize.height / targetSize.width))
  return { ...bounds, height: Math.max(BOARD_HTML_FRAME_MIN_HEIGHT, aspectHeight) }
}

function SelectionOverlayInner({
  selectedIds,
  hoverTargetId,
  marqueeRect,
  snapGuides,
  objects,
  zoom,
  viewBox
}: {
  selectedIds: Set<string>
  hoverTargetId: string | null
  marqueeRect: Rect | null
  snapGuides: SnapGuide[]
  objects: Record<string, CanvasShape>
  zoom: number
  viewBox: { x: number; y: number; width: number; height: number }
}) {
  const { t } = useTranslation('common')
  const motionEditingAtPlayhead = useCanvasMotionStore(
    (state) => state.open && state.currentTimeMs > 0
  )
  const sw = 1.25 / Math.max(zoom, 0.01)
  const hs = HANDLE_SIZE / zoom
  const rs = ROTATE_HANDLE_SIZE / zoom
  const ro = ROTATE_HANDLE_OFFSET / zoom
  const rr = ROTATE_HANDLE_DOT_RADIUS / zoom
  const handleRadius = 1.5 / zoom

  const resizeStateRef = useRef<ResizeDragState | null>(null)
  const rotateStateRef = useRef<RotateDragState | null>(null)

  // AI-affected glow: render a transient cyan outline around shapes the most
  // recent AI message touched, fades after ~800ms.
  const aiAffectedIds = useDesignAssistantStore((s) => s.lastAiAffectedIds)
  const aiActionAt = useDesignAssistantStore((s) => s.lastAiActionAt)
  const [aiGlowVisible, setAiGlowVisible] = useState(false)
  useEffect(() => {
    if (!aiActionAt || aiAffectedIds.length === 0) {
      setAiGlowVisible(false)
      return
    }
    setAiGlowVisible(true)
    const timer = setTimeout(() => setAiGlowVisible(false), 900)
    return () => clearTimeout(timer)
  }, [aiActionAt, aiAffectedIds])

  const hoverShape = hoverTargetId && !selectedIds.has(hoverTargetId) ? objects[hoverTargetId] : null
  const editableSelectedIds = useMemo(() => {
    if (!objects[ROOT_SHAPE_ID]) return new Set<string>()
    return new Set(filterEditableShapeIds({ version: 2, rootId: ROOT_SHAPE_ID, objects }, selectedIds))
  }, [objects, selectedIds])
  const bounds = editableSelectedIds.size > 0 ? getSelectionBounds(objects, editableSelectedIds) : null

  // Single selected arrow/line → point editing mode (excalidraw-style). We hide
  // the bbox + 8 resize handles + rotate handles entirely; LinearPointEditor
  // draws vertex/midpoint dots instead. Marquee, snap guides, and AI glow still
  // render below.
  const linearEditTarget = (() => {
    if (editableSelectedIds.size !== 1) return null
    const onlyId = editableSelectedIds.values().next().value as string | undefined
    if (!onlyId) return null
    const s = objects[onlyId]
    if (!s) return null
    if (s.type !== 'arrow' && s.type !== 'line') return null
    if (!s.points || s.points.length < 2) return null
    return s
  })()
  const showBoxHandles = bounds && !linearEditTarget

  const handlePointerDown = useCallback(
    (handle: ResizeHandle, e: React.PointerEvent) => {
      e.stopPropagation()
      e.preventDefault()

      const store = useCanvasShapeStore.getState()
      const selBounds = getSelectionBounds(objects, editableSelectedIds)
      if (!selBounds) return

      const shapeStarts = new Map<string, ShapeBoundsLike>()
      for (const id of editableSelectedIds) {
        const s = store.document.objects[id]
        if (s) shapeStarts.set(id, { x: s.x, y: s.y, width: s.width, height: s.height })
      }

      const htmlFrameSizeMode = handle === 'e' || handle === 'w' ? 'manual-width-auto-height' : 'manual'

      // Entering resize is an explicit user sizing action. Horizontal-only
      // resizing locks the viewport width while leaving height content-driven;
      // vertical/corner resizing locks the whole frame.
      const designStore = useDesignWorkspaceStore.getState()
      for (const [id, start] of shapeStarts) {
        const shape = store.document.objects[id]
        if (!shape || !isHtmlFrame(shape) || !shape.htmlArtifactId) continue
        designStore.updateArtifactNode(shape.htmlArtifactId, {
          x: Math.round(start.x),
          y: Math.round(start.y),
          width: Math.round(start.width),
          height: Math.round(start.height),
          sizeMode: htmlFrameSizeMode,
          viewMode:
            designStore.artifacts.find((item) => item.id === shape.htmlArtifactId)?.node?.viewMode ?? 'preview'
        })
      }

      resizeStateRef.current = {
        handle,
        startBounds: selBounds,
        startClientX: e.clientX,
        startClientY: e.clientY,
        shapeStarts
      }

      const onMove = (ev: PointerEvent): void => {
        const state = resizeStateRef.current
        if (!state) return
        const dx = (ev.clientX - state.startClientX) / zoom
        const dy = (ev.clientY - state.startClientY) / zoom
        let endBounds = computeResizedBounds(
          state.handle,
          state.startBounds,
          dx,
          dy,
          ev.shiftKey
        )
        const viewport = useCanvasViewportStore.getState()
        if (viewport.snapEnabled) {
          const doc = useCanvasShapeStore.getState().document
          const resizingIds = new Set(withDescendants(doc.objects, state.shapeStarts.keys()))
          const staticShapes: Rect[] = []
          for (const id of Object.keys(doc.objects)) {
            if (id === doc.rootId || resizingIds.has(id)) continue
            const s = doc.objects[id]
            staticShapes.push({ x: s.x, y: s.y, width: s.width, height: s.height })
          }
          const snap = findResizeSnaps(
            endBounds,
            state.handle,
            staticShapes,
            viewport.getZoom(),
            viewport.gridVisible ? 10 : null
          )
          endBounds = snap.bounds
          useCanvasSelectionStore.getState().setSnapGuides(snap.guides)
        }
        const newShapeBounds = scaleShapesToBounds(state.shapeStarts, state.startBounds, endBounds)
        const shapeStore = useCanvasShapeStore.getState()
        const designStore = useDesignWorkspaceStore.getState()
        const singleSelection = state.shapeStarts.size === 1
        for (const [id, b] of newShapeBounds) {
          const shape = shapeStore.document.objects[id]
          const artifactId = shape && isHtmlFrame(shape) ? shape.htmlArtifactId : undefined
          const artifact = artifactId ? designStore.artifacts.find((item) => item.id === artifactId) : undefined
          const nextBounds = applyPendingHtmlFrameAspectResize({
            handle: state.handle,
            bounds: b,
            shape,
            artifact,
            parallelStatus: artifactId ? designStore.parallelPageStates[artifactId]?.status : undefined,
            designTarget: designStore.designContext.designTarget,
            singleSelection
          })
          shapeStore.updateShape(id, nextBounds, true)
        }
      }

      const onUp = (): void => {
        const state = resizeStateRef.current
        if (state) {
          const doc = useCanvasShapeStore.getState().document
          const patches: { id: string; before: Partial<CanvasShape>; after: Partial<CanvasShape> }[] = []
          for (const [id, start] of state.shapeStarts) {
            const end = doc.objects[id]
            if (!end) continue
            const changed =
              end.x !== start.x ||
              end.y !== start.y ||
              end.width !== start.width ||
              end.height !== start.height
            if (changed) {
              patches.push({
                id,
                before: { x: start.x, y: start.y, width: start.width, height: start.height },
                after: { x: end.x, y: end.y, width: end.width, height: end.height }
              })
            }
          }
          if (patches.length > 0) {
            if (!commitAutoKeyCanvasGesture(patches, 'resize')) {
              useCanvasUndoStore.getState().pushChange({ patches, label: 'resize' })
            }
          }
          // Persist the final linked HTML frame sizing. Horizontal-only resize
          // keeps auto-height alive so the page can reflow to the new width;
          // vertical/corner resize means the user locked both dimensions.
          const designStore = useDesignWorkspaceStore.getState()
          for (const { id } of patches) {
            const shape = doc.objects[id]
            if (!shape || !isHtmlFrame(shape) || !shape.htmlArtifactId) continue
            designStore.updateArtifactNode(shape.htmlArtifactId, {
              x: Math.round(shape.x),
              y: Math.round(shape.y),
              width: Math.round(shape.width),
              height: Math.round(shape.height),
              sizeMode: htmlFrameSizeMode,
              viewMode:
                designStore.artifacts.find((item) => item.id === shape.htmlArtifactId)?.node?.viewMode ?? 'preview'
            })
          }
        }
        resizeStateRef.current = null
        endAutoKeyCanvasGesture()
        useCanvasSelectionStore.getState().setSnapGuides([])
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [editableSelectedIds, objects, zoom]
  )

  const handleRotatePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation()
      e.preventDefault()

      const store = useCanvasShapeStore.getState()
      const selBounds = getSelectionBounds(objects, editableSelectedIds)
      if (!selBounds) return

      // Pivot in CLIENT coordinates so atan2 works directly off ev.clientX/Y.
      const targetEl = e.currentTarget as SVGGraphicsElement
      const svg = targetEl.ownerSVGElement
      if (!svg) return
      const svgRect = svg.getBoundingClientRect()
      const pivotX =
        svgRect.left +
        ((selBounds.x + selBounds.width / 2 - clientToCanvasOriginX(svg)) / canvasScaleX(svg)) *
          svgRect.width
      const pivotY =
        svgRect.top +
        ((selBounds.y + selBounds.height / 2 - clientToCanvasOriginY(svg)) / canvasScaleY(svg)) *
          svgRect.height

      const shapeStartRotations = new Map<string, number>()
      for (const id of editableSelectedIds) {
        const s = store.document.objects[id]
        if (s) shapeStartRotations.set(id, s.rotation || 0)
      }

      rotateStateRef.current = {
        pivotX,
        pivotY,
        startAngleFromPivot: angleFromPivot(pivotX, pivotY, e.clientX, e.clientY),
        shapeStartRotations
      }
      beginAutoKeyCanvasGesture(shapeStartRotations.keys())

      const onMove = (ev: PointerEvent): void => {
        const state = rotateStateRef.current
        if (!state) return
        const cur = angleFromPivot(state.pivotX, state.pivotY, ev.clientX, ev.clientY)
        const shapeStore = useCanvasShapeStore.getState()
        const gestureStartValues = useCanvasMotionStore.getState().gestureStartValues
        const motionGestureActive = Object.keys(gestureStartValues).length > 0
        for (const [id, startRot] of state.shapeStartRotations) {
          if (motionGestureActive && !gestureStartValues[id]) continue
          const next = computeRotation(state.startAngleFromPivot, cur, startRot, {
            shiftKey: ev.shiftKey,
            metaKey: ev.metaKey,
            ctrlKey: ev.ctrlKey
          })
          shapeStore.updateShape(id, { rotation: next }, true)
        }
      }

      const onUp = (): void => {
        const state = rotateStateRef.current
        const motionCommitted = commitActiveAutoKeyCanvasGesture('rotate')
        if (state) {
          const doc = useCanvasShapeStore.getState().document
          const patches: { id: string; before: Partial<CanvasShape>; after: Partial<CanvasShape> }[] = []
          for (const [id, startRot] of state.shapeStartRotations) {
            const end = doc.objects[id]
            if (!end) continue
            if (end.rotation !== startRot) {
              patches.push({
                id,
                before: { rotation: startRot },
                after: { rotation: end.rotation }
              })
            }
          }
          if (!motionCommitted && patches.length > 0) {
            if (!commitAutoKeyCanvasGesture(patches, 'rotate')) {
              useCanvasUndoStore.getState().pushChange({ patches, label: 'rotate' })
            }
          }
        }
        rotateStateRef.current = null
        endAutoKeyCanvasGesture()
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [editableSelectedIds, objects]
  )

  const resizeHandles: { pos: ResizeHandle; cx: number; cy: number }[] = bounds
    ? [
        { pos: 'nw', cx: bounds.x, cy: bounds.y },
        { pos: 'ne', cx: bounds.x + bounds.width, cy: bounds.y },
        { pos: 'se', cx: bounds.x + bounds.width, cy: bounds.y + bounds.height },
        { pos: 'sw', cx: bounds.x, cy: bounds.y + bounds.height }
      ]
    : []
  const rotateHandle = bounds
    ? { cx: bounds.x + bounds.width / 2, cy: bounds.y - ro }
    : null

  return (
    <>
      {hoverShape && (
        <rect
          x={hoverShape.x}
          y={hoverShape.y}
          width={hoverShape.width}
          height={hoverShape.height}
          fill="none"
          stroke={SELECTION_COLOR}
          strokeWidth={sw}
          strokeOpacity={0.42}
          pointerEvents="none"
        />
      )}

      {showBoxHandles && bounds && (
        <rect
          x={bounds.x}
          y={bounds.y}
          width={bounds.width}
          height={bounds.height}
          fill="none"
          stroke={SELECTION_COLOR}
          strokeWidth={sw}
          pointerEvents="none"
        />
      )}

      {showBoxHandles && rotateHandle ? (
        <g>
          <line
            x1={rotateHandle.cx}
            y1={bounds!.y}
            x2={rotateHandle.cx}
            y2={rotateHandle.cy + rr}
            stroke={SELECTION_COLOR}
            strokeWidth={sw}
            strokeOpacity={0.55}
            pointerEvents="none"
          />
          <circle
            cx={rotateHandle.cx}
            cy={rotateHandle.cy}
            r={rr}
            fill="#ffffff"
            stroke={SELECTION_COLOR}
            strokeWidth={sw}
            style={{ cursor: 'grab' }}
            data-rotate="rotation"
            pointerEvents="all"
            onPointerDown={handleRotatePointerDown}
            aria-label={t('canvasRotateHandle')}
          >
            <title>{t('canvasRotateHandle')}</title>
          </circle>
          <circle
            cx={rotateHandle.cx}
            cy={rotateHandle.cy}
            r={rs / 2}
            fill="transparent"
            style={{ cursor: 'grab' }}
            data-rotate-hit="rotation"
            pointerEvents="all"
            onPointerDown={handleRotatePointerDown}
          />
        </g>
      ) : null}

      {showBoxHandles &&
        !motionEditingAtPlayhead &&
        resizeHandles.map(({ pos, cx, cy }) => (
          <rect
            key={pos}
            x={cx - hs / 2}
            y={cy - hs / 2}
            width={hs}
            height={hs}
            rx={handleRadius}
            fill="#ffffff"
            stroke={SELECTION_COLOR}
            strokeWidth={sw}
            style={{ cursor: handleCursor(pos) }}
            data-handle={pos}
            pointerEvents="all"
            onPointerDown={(e) => handlePointerDown(pos, e)}
          />
        ))}

      {!motionEditingAtPlayhead && linearEditTarget ? (
        <LinearPointEditor shape={linearEditTarget} zoom={zoom} />
      ) : null}

      {marqueeRect && (
        <rect
          x={marqueeRect.x}
          y={marqueeRect.y}
          width={marqueeRect.width}
          height={marqueeRect.height}
          fill="rgba(59,130,246,0.08)"
          stroke={SELECTION_COLOR}
          strokeWidth={sw}
          strokeDasharray={`${4 / zoom} ${4 / zoom}`}
          pointerEvents="none"
        />
      )}

      {aiGlowVisible &&
        aiAffectedIds.map((id) => {
          const shape = objects[id]
          if (!shape) return null
          const sel = shapeGeometry(shape).selrect
          return (
            <rect
              key={`ai-glow-${id}`}
              x={sel.x - 4 / zoom}
              y={sel.y - 4 / zoom}
              width={sel.width + 8 / zoom}
              height={sel.height + 8 / zoom}
              fill="none"
              stroke="#06b6d4"
              strokeWidth={3 / zoom}
              strokeOpacity={0.8}
              pointerEvents="none"
            >
              <animate attributeName="stroke-opacity" from="0.8" to="0" dur="0.9s" fill="freeze" />
            </rect>
          )
        })}

      {snapGuides.map((g, i) => {
        const color = g.source === 'grid' ? '#94a3b8' : '#ec4899'
        if (g.axis === 'v') {
          return (
            <line
              key={`snap-${i}`}
              x1={g.position}
              y1={viewBox.y}
              x2={g.position}
              y2={viewBox.y + viewBox.height}
              stroke={color}
              strokeWidth={sw}
              pointerEvents="none"
            />
          )
        }
        return (
          <line
            key={`snap-${i}`}
            x1={viewBox.x}
            y1={g.position}
            x2={viewBox.x + viewBox.width}
            y2={g.position}
            stroke={color}
            strokeWidth={sw}
            pointerEvents="none"
          />
        )
      })}
    </>
  )
}

// SVG viewBox helpers — convert canvas-space pivot to client-space for rotation math.
function clientToCanvasOriginX(svg: SVGSVGElement): number {
  return svg.viewBox.baseVal.x
}
function clientToCanvasOriginY(svg: SVGSVGElement): number {
  return svg.viewBox.baseVal.y
}
function canvasScaleX(svg: SVGSVGElement): number {
  return svg.viewBox.baseVal.width
}
function canvasScaleY(svg: SVGSVGElement): number {
  return svg.viewBox.baseVal.height
}

function handleCursor(pos: ResizeHandle): string {
  switch (pos) {
    case 'nw':
    case 'se':
      return 'nwse-resize'
    case 'ne':
    case 'sw':
      return 'nesw-resize'
    case 'n':
    case 's':
      return 'ns-resize'
    case 'e':
    case 'w':
      return 'ew-resize'
  }
}

export const SelectionOverlay = memo(SelectionOverlayInner)

type MotionSelectionOverlayProps = Omit<ComponentProps<typeof SelectionOverlay>, 'objects'> & {
  document: CanvasDocument
}

/** Projects motion values at the playhead before drawing selection handles. */
export function MotionSelectionOverlay({ document, ...props }: MotionSelectionOverlayProps) {
  const open = useCanvasMotionStore((state) => state.open)
  const frameId = useCanvasMotionStore((state) => state.activeFrameId)
  const timeMs = useCanvasMotionStore((state) => state.currentTimeMs)
  const gestureOverrides = useCanvasMotionStore((state) => state.gestureOverrides)
  const objects = useMemo(
    () => open && frameId
      ? projectCanvasMotionObjects(document, frameId, timeMs, gestureOverrides)
      : document.objects,
    [document, frameId, gestureOverrides, open, timeMs]
  )
  return <SelectionOverlay {...props} objects={objects} />
}

import { memo, useCallback, useRef } from 'react'
import type { CanvasShape, Rect } from '../../../design/canvas/canvas-types'
import { getSelectionBounds } from '../../../design/canvas/canvas-hit-test'
import {
  computeResizedBounds,
  scaleShapesToBounds,
  type ResizeHandle,
  type ShapeBoundsLike
} from '../../../design/canvas/canvas-resize'
import { angleFromPivot, computeRotation } from '../../../design/canvas/canvas-rotate'
import type { SnapGuide } from '../../../design/canvas/canvas-snap'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { useCanvasUndoStore } from '../../../design/canvas/canvas-undo-store'

const HANDLE_SIZE = 8
const ROTATE_HANDLE_SIZE = 20
const ROTATE_HANDLE_OFFSET = 16
const SELECTION_COLOR = '#3b82f6'

type RotateCorner = 'nw' | 'ne' | 'se' | 'sw'
const ROTATE_CORNERS: RotateCorner[] = ['nw', 'ne', 'se', 'sw']

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
  const sw = Math.max(1, 1 / zoom)
  const hs = HANDLE_SIZE / zoom
  const rs = ROTATE_HANDLE_SIZE / zoom
  const ro = ROTATE_HANDLE_OFFSET / zoom

  const resizeStateRef = useRef<ResizeDragState | null>(null)
  const rotateStateRef = useRef<RotateDragState | null>(null)

  const hoverShape = hoverTargetId && !selectedIds.has(hoverTargetId) ? objects[hoverTargetId] : null
  const bounds = selectedIds.size > 0 ? getSelectionBounds(objects, selectedIds) : null

  const handlePointerDown = useCallback(
    (handle: ResizeHandle, e: React.PointerEvent) => {
      e.stopPropagation()
      e.preventDefault()

      const store = useCanvasShapeStore.getState()
      const selBounds = getSelectionBounds(store.document.objects, selectedIds)
      if (!selBounds) return

      const shapeStarts = new Map<string, ShapeBoundsLike>()
      for (const id of selectedIds) {
        const s = store.document.objects[id]
        if (s) shapeStarts.set(id, { x: s.x, y: s.y, width: s.width, height: s.height })
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
        const endBounds = computeResizedBounds(
          state.handle,
          state.startBounds,
          dx,
          dy,
          ev.shiftKey
        )
        const newShapeBounds = scaleShapesToBounds(state.shapeStarts, state.startBounds, endBounds)
        const shapeStore = useCanvasShapeStore.getState()
        for (const [id, b] of newShapeBounds) {
          shapeStore.updateShape(id, b, true)
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
            useCanvasUndoStore.getState().pushChange({ patches, label: 'resize' })
          }
        }
        resizeStateRef.current = null
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [selectedIds, zoom]
  )

  const handleRotatePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation()
      e.preventDefault()

      const store = useCanvasShapeStore.getState()
      const selBounds = getSelectionBounds(store.document.objects, selectedIds)
      if (!selBounds) return

      // Pivot in CLIENT coordinates so atan2 works directly off ev.clientX/Y.
      const targetEl = e.currentTarget as SVGRectElement
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
      for (const id of selectedIds) {
        const s = store.document.objects[id]
        if (s) shapeStartRotations.set(id, s.rotation || 0)
      }

      rotateStateRef.current = {
        pivotX,
        pivotY,
        startAngleFromPivot: angleFromPivot(pivotX, pivotY, e.clientX, e.clientY),
        shapeStartRotations
      }

      const onMove = (ev: PointerEvent): void => {
        const state = rotateStateRef.current
        if (!state) return
        const cur = angleFromPivot(state.pivotX, state.pivotY, ev.clientX, ev.clientY)
        const shapeStore = useCanvasShapeStore.getState()
        for (const [id, startRot] of state.shapeStartRotations) {
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
          if (patches.length > 0) {
            useCanvasUndoStore.getState().pushChange({ patches, label: 'rotate' })
          }
        }
        rotateStateRef.current = null
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [selectedIds, zoom]
  )

  const resizeHandles: { pos: ResizeHandle; cx: number; cy: number }[] = bounds
    ? [
        { pos: 'nw', cx: bounds.x, cy: bounds.y },
        { pos: 'n', cx: bounds.x + bounds.width / 2, cy: bounds.y },
        { pos: 'ne', cx: bounds.x + bounds.width, cy: bounds.y },
        { pos: 'e', cx: bounds.x + bounds.width, cy: bounds.y + bounds.height / 2 },
        { pos: 'se', cx: bounds.x + bounds.width, cy: bounds.y + bounds.height },
        { pos: 's', cx: bounds.x + bounds.width / 2, cy: bounds.y + bounds.height },
        { pos: 'sw', cx: bounds.x, cy: bounds.y + bounds.height },
        { pos: 'w', cx: bounds.x, cy: bounds.y + bounds.height / 2 }
      ]
    : []

  const rotateHandles: { corner: RotateCorner; cx: number; cy: number }[] = bounds
    ? ROTATE_CORNERS.map((corner) => {
        let cx = 0, cy = 0
        switch (corner) {
          case 'nw': cx = bounds.x - ro; cy = bounds.y - ro; break
          case 'ne': cx = bounds.x + bounds.width + ro; cy = bounds.y - ro; break
          case 'se': cx = bounds.x + bounds.width + ro; cy = bounds.y + bounds.height + ro; break
          case 'sw': cx = bounds.x - ro; cy = bounds.y + bounds.height + ro; break
        }
        return { corner, cx, cy }
      })
    : []

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
          strokeOpacity={0.5}
          pointerEvents="none"
        />
      )}

      {bounds && (
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

      {rotateHandles.map(({ corner, cx, cy }) => (
        <rect
          key={`rot-${corner}`}
          x={cx - rs / 2}
          y={cy - rs / 2}
          width={rs}
          height={rs}
          fill="transparent"
          style={{ cursor: 'grab' }}
          data-rotate={corner}
          pointerEvents="all"
          onPointerDown={handleRotatePointerDown}
        />
      ))}

      {resizeHandles.map(({ pos, cx, cy }) => (
        <rect
          key={pos}
          x={cx - hs / 2}
          y={cy - hs / 2}
          width={hs}
          height={hs}
          fill="#ffffff"
          stroke={SELECTION_COLOR}
          strokeWidth={sw}
          style={{ cursor: handleCursor(pos) }}
          data-handle={pos}
          pointerEvents="all"
          onPointerDown={(e) => handlePointerDown(pos, e)}
        />
      ))}

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

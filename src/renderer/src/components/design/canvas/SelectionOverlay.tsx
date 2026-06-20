import { memo, useCallback, useRef } from 'react'
import type { CanvasShape, Rect } from '../../../design/canvas/canvas-types'
import { getSelectionBounds } from '../../../design/canvas/canvas-hit-test'
import {
  computeResizedBounds,
  scaleShapesToBounds,
  type ResizeHandle,
  type ShapeBoundsLike
} from '../../../design/canvas/canvas-resize'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { useCanvasUndoStore } from '../../../design/canvas/canvas-undo-store'

const HANDLE_SIZE = 8
const SELECTION_COLOR = '#3b82f6'

const HANDLE_POSITIONS: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

type ResizeDragState = {
  handle: ResizeHandle
  startBounds: Rect
  startClientX: number
  startClientY: number
  shapeStarts: Map<string, ShapeBoundsLike>
}

function SelectionOverlayInner({
  selectedIds,
  hoverTargetId,
  marqueeRect,
  objects,
  zoom
}: {
  selectedIds: Set<string>
  hoverTargetId: string | null
  marqueeRect: Rect | null
  objects: Record<string, CanvasShape>
  zoom: number
}) {
  const sw = Math.max(1, 1 / zoom)
  const hs = HANDLE_SIZE / zoom

  const resizeStateRef = useRef<ResizeDragState | null>(null)

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
            useCanvasUndoStore.getState().pushChange({ patches })
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

  const handlePositions: { pos: ResizeHandle; cx: number; cy: number }[] = bounds
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
    : HANDLE_POSITIONS.map((p) => ({ pos: p, cx: 0, cy: 0 })).slice(0, 0)

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

      {handlePositions.map(({ pos, cx, cy }) => (
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
    </>
  )
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

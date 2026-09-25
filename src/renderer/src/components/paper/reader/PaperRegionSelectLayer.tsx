import { useRef, useState, type ReactElement } from 'react'
import {
  normalizeDragRect,
  PAPER_REGION_MIN_DRAG_PX
} from '../../../paper/paper-visual-mark'
import { usePaperReaderServices } from './paper-reader-context'
import type { PaperRect } from '@shared/paper/paper-marks-types'

/**
 * R2.4 region select: while the mode is active each page carries a
 * crosshair overlay. Drag draws a dashed rubber band; releasing commits the
 * capture. Drags under 12px (page pixels) are treated as clicks and
 * dismissed so accidental taps don't create marks.
 */
export function PaperRegionSelectLayer({
  page
}: {
  page: number
}): ReactElement | null {
  const services = usePaperReaderServices()
  const regionSelectActive = services?.regionSelectActive ?? false
  const captureRegion = services?.captureRegion
  const hostRef = useRef<HTMLDivElement | null>(null)
  const originRef = useRef<{ x: number; y: number } | null>(null)
  const [drag, setDrag] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  if (!regionSelectActive || !captureRegion) return null

  const localPoint = (event: React.PointerEvent): { x: number; y: number } => {
    const bounds = hostRef.current?.getBoundingClientRect()
    return { x: event.clientX - (bounds?.left ?? 0), y: event.clientY - (bounds?.top ?? 0) }
  }

  return (
    <div
      ref={hostRef}
      className="absolute inset-0 z-30 cursor-crosshair"
      data-paper-region-select={page}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        hostRef.current?.setPointerCapture(event.pointerId)
        originRef.current = localPoint(event)
        setDrag(null)
      }}
      onPointerMove={(event) => {
        const origin = originRef.current
        if (!origin) return
        const point = localPoint(event)
        setDrag({
          x: Math.min(origin.x, point.x),
          y: Math.min(origin.y, point.y),
          w: Math.abs(point.x - origin.x),
          h: Math.abs(point.y - origin.y)
        })
      }}
      onPointerUp={(event) => {
        const origin = originRef.current
        originRef.current = null
        const bounds = hostRef.current?.getBoundingClientRect()
        setDrag(null)
        if (!origin || !bounds || bounds.width <= 0 || bounds.height <= 0) return
        const point = localPoint(event)
        const rawW = Math.abs(point.x - origin.x)
        const rawH = Math.abs(point.y - origin.y)
        if (rawW < PAPER_REGION_MIN_DRAG_PX && rawH < PAPER_REGION_MIN_DRAG_PX) return
        const rect: PaperRect | null = normalizeDragRect(
          origin.x, origin.y, point.x, point.y, bounds.width, bounds.height
        )
        if (rect) captureRegion(page, rect)
      }}
      onPointerCancel={() => {
        originRef.current = null
        setDrag(null)
      }}
    >
      {drag ? (
        <div
          className="pointer-events-none absolute rounded-[3px] border border-dashed border-[#3b82f6] bg-[#3b82f6]/10 shadow-[0_0_0_1px_rgba(255,255,255,0.6)]"
          style={{ left: drag.x, top: drag.y, width: drag.w, height: drag.h }}
        />
      ) : null}
    </div>
  )
}

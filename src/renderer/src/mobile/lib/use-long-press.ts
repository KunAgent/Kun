import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react'

const HOLD_MS = 450
const SLOP_PX = 10
const SAME_GESTURE_MS = 700

/**
 * IM-style press-and-hold. iOS Safari never fires `contextmenu` on plain
 * elements, so the hold is timed from pointer events; right-click and
 * Android's native long-press `contextmenu` reuse the same action (deduped
 * when both land in one gesture). The click that ends a hold is swallowed so
 * it does not also open the row.
 */
export function useLongPress<T>(onLongPress: (target: T) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const firedAt = useRef(0)
  const swallowClick = useRef(false)
  const callback = useRef(onLongPress)
  callback.current = onLongPress
  const cancel = (): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    origin.current = null
  }
  useEffect(() => cancel, [])
  const trigger = (target: T): void => {
    cancel()
    const now = Date.now()
    if (now - firedAt.current < SAME_GESTURE_MS) return
    firedAt.current = now
    swallowClick.current = true
    navigator.vibrate?.(10)
    callback.current(target)
  }
  return (target: T) => ({
    onPointerDown: (event: PointerEvent) => {
      swallowClick.current = false
      if (event.pointerType === 'mouse' && event.button !== 0) return
      origin.current = { x: event.clientX, y: event.clientY }
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => trigger(target), HOLD_MS)
    },
    onPointerMove: (event: PointerEvent) => {
      const start = origin.current
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > SLOP_PX) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (event: MouseEvent) => {
      event.preventDefault()
      trigger(target)
    },
    onClickCapture: (event: MouseEvent) => {
      if (!swallowClick.current) return
      swallowClick.current = false
      event.preventDefault()
      event.stopPropagation()
    }
  })
}

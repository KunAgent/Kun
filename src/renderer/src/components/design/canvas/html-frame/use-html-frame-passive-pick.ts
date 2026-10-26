import { useEffect, useRef, type RefObject } from 'react'
import type { HtmlFramePickModifiers } from './use-html-frame-element-selection'

const CLICK_SLOP_PX = 4

type PointerBounds = { left: number; top: number; width: number; height: number }

type Options = {
  enabled: boolean
  bodyRef: RefObject<HTMLElement | null>
  onHover: (clientX: number, clientY: number, bounds: PointerBounds, mods: HtmlFramePickModifiers) => void
  onLeave: () => void
  onClick: (clientX: number, clientY: number, bounds: PointerBounds, mods: HtmlFramePickModifiers) => void
  onContextMenu: (clientX: number, clientY: number, bounds: PointerBounds) => boolean
}

/** The pointer is over the bare canvas surface, not a toolbar or panel above it. */
function overCanvasSurface(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('svg[data-canvas-surface]'))
}

function insideBody(body: HTMLElement | null, x: number, y: number): PointerBounds | null {
  if (!body) return null
  const bounds = body.getBoundingClientRect()
  if (!bounds.width || !bounds.height) return null
  if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null
  return bounds
}

/**
 * Hover and click picking that never captures the pointer. The canvas keeps
 * handling drags, board selection and panning; this only watches the same
 * events on the document and, when the pointer is over this frame's page,
 * reports the point. A press that moves more than a few pixels is a drag and
 * is not treated as a pick.
 */
export function useHtmlFramePassivePick(options: Options): void {
  const latest = useRef(options)
  latest.current = options
  const { enabled, bodyRef } = options
  useEffect(() => {
    if (!enabled) return
    let down: { x: number; y: number; moved: boolean; bounds: PointerBounds | null } | null = null
    let inside = false
    const mods = (event: PointerEvent | MouseEvent): HtmlFramePickModifiers =>
      ({ deep: event.metaKey || event.ctrlKey })
    const leaveIfInside = (): void => {
      if (!inside) return
      inside = false
      latest.current.onLeave()
    }
    const onMove = (event: PointerEvent): void => {
      if (down && !down.moved &&
        Math.hypot(event.clientX - down.x, event.clientY - down.y) > CLICK_SLOP_PX) down.moved = true
      if (event.buttons !== 0 && (down?.moved ?? true)) { leaveIfInside(); return }
      const bounds = overCanvasSurface(event.target) ? insideBody(bodyRef.current, event.clientX, event.clientY) : null
      if (!bounds) { leaveIfInside(); return }
      inside = true
      latest.current.onHover(event.clientX, event.clientY, bounds, mods(event))
    }
    const onDown = (event: PointerEvent): void => {
      if (event.button !== 0) return
      const bounds = overCanvasSurface(event.target) ? insideBody(bodyRef.current, event.clientX, event.clientY) : null
      down = { x: event.clientX, y: event.clientY, moved: false, bounds }
    }
    const onUp = (event: PointerEvent): void => {
      const press = down
      down = null
      if (!press || press.moved || !press.bounds || event.button !== 0) return
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_SLOP_PX) return
      latest.current.onClick(event.clientX, event.clientY, press.bounds, mods(event))
    }
    const onContextMenu = (event: MouseEvent): void => {
      const bounds = overCanvasSurface(event.target) ? insideBody(bodyRef.current, event.clientX, event.clientY) : null
      if (!bounds) return
      if (latest.current.onContextMenu(event.clientX, event.clientY, bounds)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    const onCancel = (): void => { down = null; leaveIfInside() }
    document.addEventListener('pointermove', onMove, true)
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('pointerup', onUp, true)
    document.addEventListener('pointercancel', onCancel, true)
    document.addEventListener('contextmenu', onContextMenu, true)
    document.addEventListener('pointerleave', onCancel)
    return () => {
      document.removeEventListener('pointermove', onMove, true)
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('pointerup', onUp, true)
      document.removeEventListener('pointercancel', onCancel, true)
      document.removeEventListener('contextmenu', onContextMenu, true)
      document.removeEventListener('pointerleave', onCancel)
      if (inside) latest.current.onLeave()
    }
  }, [enabled, bodyRef])
}

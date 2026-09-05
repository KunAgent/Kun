/**
 * HTML5 drag-and-drop never scrolls containers on its own: while a workspace
 * or thread row is dragged, the sidebar list stays frozen, so rows outside
 * the viewport are unreachable drop targets. Any scroll container marked with
 * `data-kun-drag-scroll` is watched through document-level capture listeners
 * and scrolls while the pointer hovers near its top or bottom edge.
 */

export const SIDEBAR_DRAG_SCROLL_ATTRIBUTE = 'data-kun-drag-scroll'

const DEFAULT_EDGE_SIZE_PX = 56
const DEFAULT_MAX_SPEED_PX_PER_SECOND = 640
// Keep scrolling at a visible minimum speed right at the threshold boundary.
const MIN_SPEED_RATIO = 0.2

type SidebarDragAutoScrollerOptions = {
  edgeSize?: number
  maxSpeed?: number
  now?: () => number
  requestFrame?: (callback: () => void) => number
  cancelFrame?: (handle: number) => void
}

export type SidebarDragAutoScroller = {
  update: (clientY: number) => void
  stop: () => void
}

export function sidebarDragScrollVelocity(
  clientY: number,
  top: number,
  bottom: number,
  edgeSize: number,
  maxSpeed: number
): number {
  if (!(bottom > top) || edgeSize <= 0 || maxSpeed <= 0) return 0
  if (clientY <= top + edgeSize) {
    const ratio = clientY <= top ? 1 : 1 - (clientY - top) / edgeSize
    return -maxSpeed * Math.min(1, Math.max(MIN_SPEED_RATIO, ratio))
  }
  if (clientY >= bottom - edgeSize) {
    const ratio = clientY >= bottom ? 1 : 1 - (bottom - clientY) / edgeSize
    return maxSpeed * Math.min(1, Math.max(MIN_SPEED_RATIO, ratio))
  }
  return 0
}

export function createSidebarDragAutoScroller(
  container: HTMLElement,
  options: SidebarDragAutoScrollerOptions = {}
): SidebarDragAutoScroller {
  const edgeSize = options.edgeSize ?? DEFAULT_EDGE_SIZE_PX
  const maxSpeed = options.maxSpeed ?? DEFAULT_MAX_SPEED_PX_PER_SECOND
  const now = options.now ?? (() => Date.now())
  const requestFrame = options.requestFrame ?? ((callback: () => void) => requestAnimationFrame(callback))
  const cancelFrame = options.cancelFrame ?? ((handle: number) => cancelAnimationFrame(handle))
  let frame: number | null = null
  let pointerY: number | null = null
  let lastTime: number | null = null

  const velocityFor = (clientY: number): number => {
    const rect = container.getBoundingClientRect()
    return sidebarDragScrollVelocity(clientY, rect.top, rect.bottom, edgeSize, maxSpeed)
  }

  const tick = (): void => {
    frame = null
    if (pointerY === null) return
    const velocity = velocityFor(pointerY)
    if (velocity === 0) {
      lastTime = null
      return
    }
    const current = now()
    const elapsedMs = lastTime === null ? 1000 / 60 : Math.min(Math.max(current - lastTime, 0), 100)
    lastTime = current
    container.scrollTop += velocity * (elapsedMs / 1000)
    frame = requestFrame(tick)
  }

  const update = (clientY: number): void => {
    pointerY = clientY
    if (frame === null && velocityFor(clientY) !== 0) {
      lastTime = null
      frame = requestFrame(tick)
    }
  }

  const stop = (): void => {
    pointerY = null
    lastTime = null
    if (frame !== null) {
      cancelFrame(frame)
      frame = null
    }
  }

  return { update, stop }
}

/**
 * Subscribes once at document level. dragover keeps the active scroller in
 * sync with the pointer; dragend (always fired, even on Escape-cancel) and
 * drop stop it. Capture phase is used so row-level stopPropagation calls in
 * the drop-position handlers cannot silence scrolling.
 */
export function registerSidebarDragAutoScroll(
  doc: Document,
  createScroller: (container: HTMLElement) => SidebarDragAutoScroller = createSidebarDragAutoScroller
): () => void {
  let activeContainer: HTMLElement | null = null
  let activeScroller: SidebarDragAutoScroller | null = null

  const stopActive = (): void => {
    activeScroller?.stop()
    activeScroller = null
    activeContainer = null
  }

  const onDragOver = (event: Event): void => {
    const target = event.target
    const container = target instanceof Element
      ? target.closest<HTMLElement>(`[${SIDEBAR_DRAG_SCROLL_ATTRIBUTE}]`)
      : null
    if (!container) {
      stopActive()
      return
    }
    if (container !== activeContainer) {
      stopActive()
      activeContainer = container
      activeScroller = createScroller(container)
    }
    activeScroller?.update((event as MouseEvent).clientY)
  }

  const onDragSettled = (): void => stopActive()

  doc.addEventListener('dragover', onDragOver, true)
  doc.addEventListener('dragend', onDragSettled, true)
  doc.addEventListener('drop', onDragSettled, true)
  return () => {
    stopActive()
    doc.removeEventListener('dragover', onDragOver, true)
    doc.removeEventListener('dragend', onDragSettled, true)
    doc.removeEventListener('drop', onDragSettled, true)
  }
}

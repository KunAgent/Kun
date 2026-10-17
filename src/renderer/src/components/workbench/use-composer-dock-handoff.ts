import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

const HANDOFF_MS = 360
const HANDOFF_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

/**
 * When the Code home ends (first send, or opening a task), the composer dock
 * moves from the centred home position to the bottom in one layout pass. Slide
 * it there from where it last sat instead of letting it jump.
 */
export function useComposerDockHandoff(dockRef: RefObject<HTMLElement | null>, emptyTaskLayout: boolean): void {
  const homeTopRef = useRef<number | null>(null)
  const wasEmptyRef = useRef(emptyTaskLayout)

  useEffect(() => {
    if (!emptyTaskLayout) return
    const remember = (): void => {
      const dock = dockRef.current
      if (dock) homeTopRef.current = dock.getBoundingClientRect().top
    }
    window.addEventListener('resize', remember)
    return () => window.removeEventListener('resize', remember)
  }, [dockRef, emptyTaskLayout])

  useLayoutEffect(() => {
    const dock = dockRef.current
    const wasEmpty = wasEmptyRef.current
    wasEmptyRef.current = emptyTaskLayout
    if (!dock) return
    if (emptyTaskLayout) {
      homeTopRef.current = dock.getBoundingClientRect().top
      return
    }
    const homeTop = homeTopRef.current
    homeTopRef.current = null
    if (!wasEmpty || homeTop === null || typeof dock.animate !== 'function') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const box = dock.getBoundingClientRect()
    // Rects are in zoomed viewport pixels; the transform is in layout pixels.
    const zoom = dock.offsetWidth > 0 ? box.width / dock.offsetWidth : 1
    const offset = (homeTop - box.top) / (zoom || 1)
    if (Math.abs(offset) < 8) return
    dock.animate(
      [{ transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' }],
      { duration: HANDOFF_MS, easing: HANDOFF_EASING }
    )
  })
}

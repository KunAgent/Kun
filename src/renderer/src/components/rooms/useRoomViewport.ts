import { useEffect, useState, type RefObject } from 'react'

/** Measure the actual Rooms container, including app sidebars and desktop zoom. */
export function useRoomOverlayLayout(panel: RefObject<HTMLElement | null>) {
  const [overlay, setOverlay] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1440)
  useEffect(() => {
    const workspace = panel.current?.closest<HTMLElement>('[data-rooms-workspace]')
    const measure = () => setOverlay((workspace?.getBoundingClientRect().width ?? window.innerWidth) < 1440)
    measure()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : undefined
    if (workspace) observer?.observe(workspace)
    window.addEventListener?.('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener?.('resize', measure) }
  }, [panel])
  return overlay
}

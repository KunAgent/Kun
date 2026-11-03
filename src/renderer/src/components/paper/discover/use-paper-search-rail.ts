import { useEffect, useRef, useState, type RefObject } from 'react'

const RAIL_KEY = 'kun.paper.searchRailOpen'
const NARROW_PX = 980

function readRailOpen(): boolean {
  try {
    return window.localStorage.getItem(RAIL_KEY) !== '0'
  } catch {
    return true
  }
}

/**
 * Shared right-column state for the search page: persisted open flag,
 * narrow-container detection (rail becomes an overlay), and Escape /
 * outside-pointer closing while overlaid.
 */
export function usePaperSearchRail(
  surfaceRef: RefObject<HTMLElement | null>
): {
  railOpen: boolean
  narrow: boolean
  railRef: RefObject<HTMLElement | null>
  toggleRail: () => void
  closeRail: () => void
} {
  const [railOpen, setRailOpen] = useState(readRailOpen)
  const [narrow, setNarrow] = useState(false)
  const railRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const node = surfaceRef.current
    if (!node || typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      setNarrow(width > 0 && width <= NARROW_PX)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [surfaceRef])

  const setOpen = (open: boolean): void => {
    setRailOpen(open)
    try {
      window.localStorage.setItem(RAIL_KEY, open ? '1' : '0')
    } catch {
      // Panel memory is a convenience only.
    }
  }

  useEffect(() => {
    if (!narrow || !railOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (!railRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [narrow, railOpen])

  return {
    railOpen,
    narrow,
    railRef,
    toggleRail: () => setOpen(!railOpen),
    closeRail: () => setOpen(false)
  }
}

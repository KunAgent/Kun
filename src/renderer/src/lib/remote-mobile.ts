import { useEffect, useState } from 'react'

/** Matches the Rooms mobile breakpoint so Remote web reuses the same notion of "phone-sized". */
export const NARROW_VIEWPORT_QUERY = '(max-width: 767px)'

export function isRemoteWeb(): boolean {
  return typeof window !== 'undefined' && window.kunGui?.isRemoteWeb === true
}

function narrowQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(NARROW_VIEWPORT_QUERY)
    : null
}

export function isNarrowViewportNow(): boolean {
  return narrowQuery()?.matches ?? false
}

export function useIsNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(isNarrowViewportNow)
  useEffect(() => {
    const query = narrowQuery()
    if (!query) return
    const onChange = (event: MediaQueryListEvent) => setNarrow(event.matches)
    setNarrow(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return narrow
}

/**
 * True only for Remote browser clients on phone-sized viewports. Desktop
 * Electron windows — even when resized small — keep the regular layout.
 */
export function useRemoteMobileLayout(): boolean {
  return useIsNarrowViewport() && isRemoteWeb()
}

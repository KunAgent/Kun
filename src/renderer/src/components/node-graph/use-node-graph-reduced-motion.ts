import { useEffect, useState } from 'react'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/**
 * Whether the viewer has asked for less motion.
 *
 * The canvas cannot express this in CSS, so the preference is read here and fed
 * into the painter, which then draws every animation at its end state.
 */
export function useNodeGraphReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(REDUCED_MOTION_QUERY)
    setReduced(query.matches)
    const onChange = (event: MediaQueryListEvent): void => setReduced(event.matches)
    query.addEventListener?.('change', onChange)
    return () => query.removeEventListener?.('change', onChange)
  }, [])
  return reduced
}

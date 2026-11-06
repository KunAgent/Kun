import { useEffect, useRef, useState } from 'react'

export function usePetAnimationClock(key: string, paused: boolean): { elapsed: number; reduced: boolean } {
  const [elapsed, setElapsed] = useState(0)
  const [reduced, setReduced] = useState(false)
  const saved = useRef(0)
  useEffect(() => { saved.current = 0; setElapsed(0) }, [key])
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    setReduced(media?.matches === true)
    const change = (): void => setReduced(media?.matches === true)
    media?.addEventListener('change', change)
    return () => media?.removeEventListener('change', change)
  }, [])
  useEffect(() => {
    if (paused || reduced) return
    let frame = 0
    let previous = performance.now()
    let painted = previous
    const tick = (now: number): void => {
      saved.current += Math.max(0, now - previous)
      previous = now
      if (now - painted >= 1000 / 30) { setElapsed(saved.current); painted = now }
      frame = requestAnimationFrame(tick)
    }
    const visibility = (): void => {
      cancelAnimationFrame(frame)
      if (document.hidden) return
      previous = performance.now()
      painted = previous
      frame = requestAnimationFrame(tick)
    }
    visibility()
    document.addEventListener('visibilitychange', visibility)
    return () => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visibility) }
  }, [key, paused, reduced])
  return { elapsed, reduced }
}

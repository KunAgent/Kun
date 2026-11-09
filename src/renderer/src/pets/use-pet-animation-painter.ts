import { useLayoutEffect, useRef } from 'react'
import { PetAnimationLoop, type PetPaint } from './pet-animation-loop'

/** Positions and sprite frames belong to the animation loop, not React state. */
export function usePetAnimationPainter(key: string, paused: boolean, paint: PetPaint): void {
  const painter = useRef(paint)
  const pause = useRef(paused)
  const loop = useRef<PetAnimationLoop | null>(null)
  useLayoutEffect(() => { painter.current = paint; pause.current = paused })
  useLayoutEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const clock = new PetAnimationLoop({
      now: () => performance.now(), frame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (id) => cancelAnimationFrame(id),
      delay: (callback, ms) => window.setTimeout(callback, ms), cancelDelay: (id) => window.clearTimeout(id)
    }, (time) => painter.current(time))
    loop.current = clock
    const sync = (): void => clock.update({ hidden: document.hidden, paused: pause.current, reduced: media.matches })
    sync()
    document.addEventListener('visibilitychange', sync)
    media.addEventListener('change', sync)
    return () => {
      clock.dispose()
      loop.current = null
      document.removeEventListener('visibilitychange', sync)
      media.removeEventListener('change', sync)
    }
  }, [key])
  useLayoutEffect(() => {
    loop.current?.update({ hidden: document.hidden, paused, reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches })
  })
}

// Avoid reassigning unchanged sprite positions (browsers normalize percentage strings).
const painted = new WeakMap<HTMLElement | SVGElement, Record<string, string>>()
export function paintPetStyle(element: HTMLElement | SVGElement | null | undefined, styles: Partial<Record<'transform' | 'opacity' | 'backgroundPosition' | 'zIndex' | 'width' | 'height', string>>): void {
  if (!element) return
  const previous = painted.get(element) ?? {}
  for (const [key, value] of Object.entries(styles)) {
    if (previous[key] === value) continue
    element.style[key as keyof typeof styles] = value
    previous[key] = value
  }
  painted.set(element, previous)
}

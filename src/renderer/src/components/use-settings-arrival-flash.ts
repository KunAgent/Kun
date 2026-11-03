import { useEffect, type RefObject } from 'react'

/** The first block a deep link most likely asked for: a page's leading card. */
const ARRIVAL_TARGET = '.ds-settings-card, .ds-settings-feature-list, .ds-provider-workspace'
const ARRIVAL_MS = 1400
const MAX_WAIT_FRAMES = 120

/**
 * When a deep link ("open permission settings") lands on a page, scroll its
 * leading card into view and ring it briefly so the person sees where they
 * arrived. Pages load lazily, so the target is looked up frame by frame.
 */
export function useSettingsArrivalFlash(pageRef: RefObject<HTMLElement | null>, arrival: number): void {
  useEffect(() => {
    if (!arrival || typeof window === 'undefined') return
    let frame = 0
    let timer = 0
    let attempts = 0
    let target: HTMLElement | null = null
    const find = (): void => {
      target = pageRef.current?.querySelector<HTMLElement>(ARRIVAL_TARGET) ?? null
      if (!target) {
        if (attempts++ < MAX_WAIT_FRAMES) frame = window.requestAnimationFrame(find)
        return
      }
      target.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
      target.setAttribute('data-settings-arrival', 'true')
      timer = window.setTimeout(() => target?.removeAttribute('data-settings-arrival'), ARRIVAL_MS)
    }
    frame = window.requestAnimationFrame(find)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
      target?.removeAttribute('data-settings-arrival')
    }
  }, [arrival, pageRef])
}

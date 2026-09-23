import { useEffect, useRef, useState, type RefObject } from 'react'
import type { TimelineSurface } from './timeline-surface'

/**
 * Mobile replacement for the (hidden) desktop jump rail: once the reader is
 * more than ~1.5 viewports above the end, a floating button jumps back to the
 * latest turn. Content appended while scrolled up lights its unread dot.
 */
export function useMobileJumpLatest({ containerRef, scrollContentKey, surface, resetKey }: {
  containerRef: RefObject<HTMLDivElement | null>
  scrollContentKey: string
  surface: TimelineSurface
  /** Thread switch: re-measure and drop stale unread state. */
  resetKey: string | null | undefined
}): { scrolledFarUp: boolean; unreadBelow: boolean; jumpToLatest: () => void } {
  const [scrolledFarUp, setScrolledFarUp] = useState(false)
  const [unreadBelow, setUnreadBelow] = useState(false)
  const lastContentKeyRef = useRef(scrollContentKey)

  useEffect(() => {
    const el = containerRef.current
    if (!el || surface !== 'mobile') return
    const onScroll = (): void => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      const far = distance > el.clientHeight * 1.5
      setScrolledFarUp(far)
      if (!far) setUnreadBelow(false)
    }
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [containerRef, surface, resetKey])

  useEffect(() => {
    if (lastContentKeyRef.current === scrollContentKey) return
    lastContentKeyRef.current = scrollContentKey
    if (scrolledFarUp) setUnreadBelow(true)
  }, [scrollContentKey, scrolledFarUp])

  const jumpToLatest = (): void => {
    const el = containerRef.current
    if (!el) return
    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' })
    setUnreadBelow(false)
  }

  return { scrolledFarUp, unreadBelow, jumpToLatest }
}

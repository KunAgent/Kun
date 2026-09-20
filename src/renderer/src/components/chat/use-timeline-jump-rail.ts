import { useEffect, type RefObject } from 'react'
import { activeTimelineTurnKey, timelineJumpRailLeft, timelineJumpRailPreviewLeft } from './message-timeline-jump-preview'

export function useTimelineJumpRail({ containerRef, turnRefMap, visibleTurnAnchors, setActiveTurnKey, setJumpRailLayout }: {
  containerRef: RefObject<HTMLDivElement | null>
  turnRefMap: RefObject<Map<string, HTMLDivElement>>
  visibleTurnAnchors: Array<{ key: string }>
  setActiveTurnKey: (key: string | null) => void
  setJumpRailLayout: (layout: { railLeft: number; previewLeft: number } | null) => void
}): void {
  useEffect(() => {
    const container = containerRef.current
    if (!container || visibleTurnAnchors.length === 0) {
      setActiveTurnKey(null)
      return
    }
    let frame: number | null = null
    const update = (): void => {
      frame = null
      if (container.scrollHeight - container.scrollTop - container.clientHeight <= 2) {
        setActiveTurnKey(visibleTurnAnchors.at(-1)?.key ?? null)
        return
      }
      const containerTop = container.getBoundingClientRect().top
      const positions = visibleTurnAnchors.flatMap((anchor) => {
        const node = turnRefMap.current.get(anchor.key)
        return node ? [{ key: anchor.key, top: node.getBoundingClientRect().top - containerTop }] : []
      })
      setActiveTurnKey(activeTimelineTurnKey(positions))
    }
    const schedule = (): void => {
      if (frame === null) frame = window.requestAnimationFrame(update)
    }
    container.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    schedule()
    return () => {
      container.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [visibleTurnAnchors, containerRef, turnRefMap, setActiveTurnKey])

  useEffect(() => {
    const container = containerRef.current
    if (!container || visibleTurnAnchors.length <= 2) {
      setJumpRailLayout(null)
      return
    }
    const update = (): void => {
      const rect = container.getBoundingClientRect()
      const railLeft = timelineJumpRailLeft(rect.width)
      setJumpRailLayout({
        railLeft,
        previewLeft: timelineJumpRailPreviewLeft(railLeft, rect.width)
      })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(container)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [visibleTurnAnchors.length, containerRef, setJumpRailLayout])

}

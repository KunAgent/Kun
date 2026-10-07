import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

export type SlidingTabIndicator = {
  /** `ready` lets CSS hand the active background over to the indicator; `animated` enables sliding. */
  state: 'ready' | 'animated' | undefined
  style: CSSProperties | null
}

type Box = { x: number; y: number; width: number; height: number }

function measure(tab: HTMLElement | null | undefined): Box | null {
  if (!tab || typeof tab.offsetLeft !== 'number' || tab.offsetWidth === 0) return null
  return { x: tab.offsetLeft, y: tab.offsetTop, width: tab.offsetWidth, height: tab.offsetHeight }
}

function sameBox(a: Box | null, b: Box | null): boolean {
  return Boolean(a && b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height)
}

/**
 * Measures the selected tab and returns styles for one shared highlight that
 * glides between tabs. Without layout (server render, tests, hidden panels) it
 * returns no style, and the selected tab keeps painting its own background.
 */
export function useSlidingTabIndicator(
  listRef: RefObject<HTMLElement | null>,
  tabRefs: RefObject<Array<HTMLElement | null>>,
  activeIndex: number,
  itemCount: number
): SlidingTabIndicator {
  const [box, setBox] = useState<Box | null>(null)
  const [animated, setAnimated] = useState(false)

  useLayoutEffect(() => {
    const list = listRef.current
    const update = (): void => {
      const next = measure(tabRefs.current?.[activeIndex])
      setBox((current) => (sameBox(current, next) ? current : next))
    }
    update()
    if (!list || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(list)
    for (const tab of tabRefs.current ?? []) if (tab) observer.observe(tab)
    return () => observer.disconnect()
  }, [activeIndex, itemCount, listRef, tabRefs])

  // Place the first frame without motion, then let later changes slide.
  useLayoutEffect(() => {
    if (!box || animated || typeof requestAnimationFrame === 'undefined') return
    const frame = requestAnimationFrame(() => setAnimated(true))
    return () => cancelAnimationFrame(frame)
  }, [animated, box])

  if (!box) return { state: undefined, style: null }
  return {
    state: animated ? 'animated' : 'ready',
    style: {
      width: box.width,
      height: box.height,
      transform: `translate3d(${box.x}px, ${box.y}px, 0)`
    }
  }
}

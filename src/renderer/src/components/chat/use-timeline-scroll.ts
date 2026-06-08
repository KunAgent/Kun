import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

/** Threshold (px) from the top of the scroll container that triggers
 * auto-loading earlier turns. */
const TOP_LOAD_TRIGGER_PX = 120
/** Distance (px) from the bottom within which the timeline is considered
 * "stuck to bottom" and will snap-scroll on new content. */
const STICK_TO_BOTTOM_PX = 96

type UseTimelineScrollOptions = {
  containerRef: RefObject<HTMLDivElement | null>
  endRef: RefObject<HTMLDivElement | null>
  activeThreadId: string | null
  pageSize: number
  autoCollapseThreshold: number
  totalTurns: number
  busy: boolean
  /** Triggers stick-to-bottom snap scroll. */
  scrollDeps: { contentKey: string; streaming: boolean }
}

export type UseTimelineScrollResult = {
  visibleTurnCount: number
  hiddenTurnCount: number
  loadEarlierTurns: (options?: { userInitiated?: boolean }) => void
  collapseEarlierTurns: () => void
}

export function deriveTimelineVisibleTurnCount({
  currentVisibleTurnCount,
  totalTurns,
  pageSize,
  shouldCollapseHistory,
  historyExpansionRequested
}: {
  currentVisibleTurnCount: number
  totalTurns: number
  pageSize: number
  shouldCollapseHistory: boolean
  historyExpansionRequested: boolean
}): number {
  const latestPageCount = Math.min(pageSize, totalTurns)
  if (!shouldCollapseHistory) return totalTurns
  if (historyExpansionRequested) {
    return Math.min(totalTurns, Math.max(currentVisibleTurnCount, latestPageCount))
  }
  return latestPageCount
}

/**
 * Owns the timeline scroll behaviour: stick-to-bottom snap scroll,
 * earlier-turns lazy loading, and prepend-position preservation. Pulled
 * out of `MessageTimeline` so the component body can stay focused on
 * rendering.
 */
export function useTimelineScroll({
  containerRef,
  endRef,
  activeThreadId,
  pageSize,
  autoCollapseThreshold,
  totalTurns,
  busy,
  scrollDeps
}: UseTimelineScrollOptions): UseTimelineScrollResult {
  const { contentKey, streaming } = scrollDeps
  const shouldCollapseHistory = totalTurns > autoCollapseThreshold
  const [visibleTurnCount, setVisibleTurnCount] = useState(() =>
    deriveTimelineVisibleTurnCount({
      currentVisibleTurnCount: 0,
      totalTurns,
      pageSize,
      shouldCollapseHistory,
      historyExpansionRequested: false
    })
  )
  const hiddenTurnCount = Math.max(0, totalTurns - visibleTurnCount)

  const stickToBottomRef = useRef(true)
  const historyExpansionRequestedRef = useRef(false)
  const pendingPrependRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null)
  const prependInFlightRef = useRef(false)
  const scrollFrameRef = useRef<number | null>(null)

  const loadEarlierTurns = useCallback(
    (options?: { userInitiated?: boolean }): void => {
      if (hiddenTurnCount === 0 || prependInFlightRef.current) return
      if (options?.userInitiated) {
        historyExpansionRequestedRef.current = true
      }
      const el = containerRef.current
      if (el) {
        pendingPrependRef.current = {
          scrollHeight: el.scrollHeight,
          scrollTop: el.scrollTop
        }
      }
      prependInFlightRef.current = true
      setVisibleTurnCount((count) => Math.min(totalTurns, count + pageSize))
    },
    [containerRef, hiddenTurnCount, pageSize, totalTurns]
  )

  const collapseEarlierTurns = useCallback((): void => {
    historyExpansionRequestedRef.current = false
    setVisibleTurnCount(pageSize)
  }, [pageSize])

  // Scroll listener: tracks stick-to-bottom + triggers lazy load.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onScroll = (): void => {
      const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      stickToBottomRef.current = distanceToBottom < STICK_TO_BOTTOM_PX
      if (hiddenTurnCount > 0 && el.scrollTop <= TOP_LOAD_TRIGGER_PX) {
        loadEarlierTurns({ userInitiated: true })
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [containerRef, hiddenTurnCount, loadEarlierTurns])

  // Snap to bottom when content changes, but only if the user was
  // already at the bottom.
  useEffect(() => {
    if (!stickToBottomRef.current) return
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current)
    }
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null
      endRef.current?.scrollIntoView({
        behavior: streaming ? 'auto' : 'smooth',
        block: 'end'
      })
    })
  }, [contentKey, endRef, streaming])

  // Hard reset on thread switch.
  //
  // Streamdown markdown is lazy-loaded, so the timeline keeps growing
  // for a few frames after the new turns mount. A single scrollIntoView
  // at this point lands on the pre-settle height and the viewport ends
  // up above the latest message. Pin the scroll to the bottom while the
  // inner content grows, then let go as soon as either the height
  // settles or a short grace window elapses — so we never fight the
  // user the moment they start scrolling.
  useEffect(() => {
    stickToBottomRef.current = true
    historyExpansionRequestedRef.current = false
    pendingPrependRef.current = null
    prependInFlightRef.current = false
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current)
      scrollFrameRef.current = null
    }
    const el = containerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    const inner = el.firstElementChild as HTMLElement | null
    if (!inner) return
    const SETTLE_WINDOW_MS = 1200
    const observer = new ResizeObserver(() => {
      if (!stickToBottomRef.current) return
      const node = containerRef.current
      if (!node) return
      node.scrollTop = node.scrollHeight
    })
    observer.observe(inner)
    const timer = window.setTimeout(() => observer.disconnect(), SETTLE_WINDOW_MS)
    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
  }, [activeThreadId, containerRef])

  // Cleanup any pending rAF on unmount.
  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current)
      }
    },
    []
  )

  // Re-derive visible count when the thread / collapse flag / total
  // turns change.
  useEffect(() => {
    setVisibleTurnCount((count) =>
      deriveTimelineVisibleTurnCount({
        currentVisibleTurnCount: count,
        totalTurns,
        pageSize,
        shouldCollapseHistory,
        historyExpansionRequested: historyExpansionRequestedRef.current
      })
    )
  }, [activeThreadId, pageSize, shouldCollapseHistory, totalTurns])

  // While a turn is running, keep the latest page visible without
  // mounting every historical turn. Expanding all history during SSE
  // streaming can repaint long conversations and make the viewport look
  // like it scrolled through the whole thread.
  useEffect(() => {
    if (!busy) return
    setVisibleTurnCount((count) =>
      deriveTimelineVisibleTurnCount({
        currentVisibleTurnCount: count,
        totalTurns,
        pageSize,
        shouldCollapseHistory,
        historyExpansionRequested: historyExpansionRequestedRef.current
      })
    )
  }, [busy, pageSize, shouldCollapseHistory, totalTurns])

  // After a prepend, restore scroll position so the user's viewport
  // doesn't jump.
  useEffect(() => {
    const snapshot = pendingPrependRef.current
    const el = containerRef.current
    if (!snapshot || !el) return

    pendingPrependRef.current = null
    prependInFlightRef.current = false

    requestAnimationFrame(() => {
      const addedHeight = el.scrollHeight - snapshot.scrollHeight
      el.scrollTop = snapshot.scrollTop + Math.max(0, addedHeight)
    })
  }, [containerRef, visibleTurnCount])

  // If the user explicitly asked to expand history and the container
  // still has room, keep loading earlier turns until it overflows.
  useEffect(() => {
    const el = containerRef.current
    if (!el || hiddenTurnCount === 0 || prependInFlightRef.current) return
    if (!historyExpansionRequestedRef.current) return
    if (el.scrollHeight <= el.clientHeight + TOP_LOAD_TRIGGER_PX) {
      loadEarlierTurns()
    }
  }, [containerRef, hiddenTurnCount, loadEarlierTurns, visibleTurnCount])

  return {
    visibleTurnCount,
    hiddenTurnCount,
    loadEarlierTurns,
    collapseEarlierTurns
  }
}

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

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
  totalTurns: number
  busy: boolean
  hasRemoteHistory?: boolean
  remoteHistoryLoading?: boolean
  loadRemoteHistory?: () => Promise<boolean>
  /** Triggers stick-to-bottom snap scroll. */
  scrollDeps: { contentKey: string; streaming: boolean; userTurnKey: string }
}

export type UseTimelineScrollResult = {
  visibleTurnCount: number
  hiddenTurnCount: number
  hasEarlierTurns: boolean
  loadEarlierTurns: (options?: { userInitiated?: boolean }) => void
  collapseEarlierTurns: () => void
}

export function shouldCollapseTimelineHistory(totalTurns: number, pageSize: number): boolean {
  return totalTurns > pageSize
}

export function isTimelineNearBottom({
  scrollHeight,
  scrollTop,
  clientHeight
}: {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}): boolean {
  return scrollHeight - scrollTop - clientHeight < STICK_TO_BOTTOM_PX
}

export function deriveTimelineRenderedTurnCount({
  visibleTurnCount,
  totalTurns,
  pageSize,
  busy,
  historyExpansionRequested = false
}: {
  visibleTurnCount: number
  totalTurns: number
  pageSize: number
  busy: boolean
  historyExpansionRequested?: boolean
}): number {
  if (
    busy &&
    !historyExpansionRequested &&
    shouldCollapseTimelineHistory(totalTurns, pageSize)
  ) {
    return Math.min(pageSize, totalTurns)
  }
  return Math.min(visibleTurnCount, totalTurns)
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
  totalTurns,
  busy,
  hasRemoteHistory = false,
  remoteHistoryLoading = false,
  loadRemoteHistory,
  scrollDeps
}: UseTimelineScrollOptions): UseTimelineScrollResult {
  const { contentKey, streaming, userTurnKey } = scrollDeps
  const shouldCollapseHistory = shouldCollapseTimelineHistory(totalTurns, pageSize)
  const [visibleTurnCount, setVisibleTurnCount] = useState(() =>
    deriveTimelineVisibleTurnCount({
      currentVisibleTurnCount: 0,
      totalTurns,
      pageSize,
      shouldCollapseHistory,
      historyExpansionRequested: false
    })
  )
  const historyExpansionRequestedRef = useRef(false)
  const busyStateRef = useRef({ threadId: activeThreadId, busy: false })
  // Sending from an expanded long thread used to render the whole history for
  // one frame before the effect below collapsed it. That transient Markdown
  // mount can be enough to exhaust Chromium's renderer on very large threads.
  const renderedVisibleTurnCount = deriveTimelineRenderedTurnCount({
    visibleTurnCount,
    totalTurns,
    pageSize,
    busy,
    historyExpansionRequested: historyExpansionRequestedRef.current &&
      busyStateRef.current.threadId === activeThreadId &&
      busyStateRef.current.busy
  })
  const hiddenTurnCount = Math.max(0, totalTurns - renderedVisibleTurnCount)
  const hasEarlierTurns = hiddenTurnCount > 0 || hasRemoteHistory

  const stickToBottomRef = useRef(true)
  const lastUserTurnKeyRef = useRef(userTurnKey)
  const pendingPrependRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null)
  const prependInFlightRef = useRef(false)
  const remoteLoadStartTotalRef = useRef<number | null>(null)
  const remoteLoadSettledRef = useRef(false)
  const remoteLoadProgressedRef = useRef(false)
  const [remoteLoadCompletionRevision, setRemoteLoadCompletionRevision] = useState(0)
  const scrollFrameRef = useRef<number | null>(null)

  const loadEarlierTurns = useCallback(
    (options?: { userInitiated?: boolean }): void => {
      if ((busy && !options?.userInitiated) || prependInFlightRef.current) return
      if (hiddenTurnCount === 0 && (!hasRemoteHistory || !loadRemoteHistory || remoteHistoryLoading)) return
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
      if (hiddenTurnCount > 0) {
        setVisibleTurnCount((count) => Math.min(totalTurns, count + pageSize))
        return
      }
      remoteLoadStartTotalRef.current = totalTurns
      remoteLoadSettledRef.current = false
      remoteLoadProgressedRef.current = false
      void loadRemoteHistory!().then((progressed) => {
        remoteLoadProgressedRef.current = progressed
        if (!progressed) historyExpansionRequestedRef.current = false
      }).finally(() => {
        // Keep the prepend snapshot until React has committed the store update.
        // Promise settlement normally precedes the totalTurns/content effects.
        remoteLoadSettledRef.current = true
        setRemoteLoadCompletionRevision((revision) => revision + 1)
      })
    },
    [
      busy,
      containerRef,
      hasRemoteHistory,
      hiddenTurnCount,
      loadRemoteHistory,
      pageSize,
      remoteHistoryLoading,
      totalTurns
    ]
  )

  const collapseEarlierTurns = useCallback((): void => {
    historyExpansionRequestedRef.current = false
    setVisibleTurnCount(pageSize)
  }, [pageSize])

  // A freshly submitted user turn should become visible even if the user was
  // reading older history before pressing Enter. Runs as a layout effect so the
  // stick-to-bottom intent is set before the snap effect below pins (issue #603).
  useLayoutEffect(() => {
    if (!userTurnKey || lastUserTurnKeyRef.current === userTurnKey) return
    lastUserTurnKeyRef.current = userTurnKey
    stickToBottomRef.current = true
  }, [userTurnKey])

  // Scroll listener: tracks stick-to-bottom + triggers lazy load.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onScroll = (): void => {
      stickToBottomRef.current = isTimelineNearBottom(el)
      if (hasEarlierTurns && el.scrollTop <= TOP_LOAD_TRIGGER_PX) {
        loadEarlierTurns({ userInitiated: true })
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [containerRef, hasEarlierTurns, loadEarlierTurns])

  // Snap to bottom when the content or the visible window changes, but only if
  // the user was already at the bottom. Runs as a layout effect so a discrete
  // change (e.g. sending a message, which slides the collapsed turn window and
  // drops the oldest visible turn) pins *before* paint instead of flashing the
  // viewport upward and then jumping back once the model streams (issue #603).
  // Streaming deltas stay rAF-throttled to avoid a forced reflow per delta.
  useLayoutEffect(() => {
    if (!stickToBottomRef.current) return
    // A visibleTurnCount bump from loading earlier turns must not pull the
    // viewport to the bottom — the prepend effect owns scroll position there.
    if (prependInFlightRef.current) return
    if (!streaming) {
      endRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
    }
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current)
    }
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null
      endRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
    })
  }, [contentKey, visibleTurnCount, streaming, endRef])

  // Hard reset on thread switch.
  useEffect(() => {
    stickToBottomRef.current = true
    historyExpansionRequestedRef.current = false
    pendingPrependRef.current = null
    prependInFlightRef.current = false
    remoteLoadStartTotalRef.current = null
    remoteLoadSettledRef.current = false
    remoteLoadProgressedRef.current = false
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current)
      scrollFrameRef.current = null
    }
    endRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
  }, [activeThreadId, endRef])

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

  useEffect(() => {
    const startedWith = remoteLoadStartTotalRef.current
    if (startedWith === null || totalTurns <= startedWith) return
    remoteLoadStartTotalRef.current = null
    remoteLoadSettledRef.current = false
    remoteLoadProgressedRef.current = true
    const addedTurns = totalTurns - startedWith
    setVisibleTurnCount((count) => Math.min(totalTurns, count + addedTurns))
  }, [totalTurns])

  // While a turn is running, keep the latest page visible by default without
  // mounting every historical turn. A user who explicitly expands history keeps
  // that bounded window while the active turn streams.
  useEffect(() => {
    const wasBusy = busyStateRef.current.threadId === activeThreadId && busyStateRef.current.busy
    busyStateRef.current = { threadId: activeThreadId, busy }
    if (!busy || wasBusy) return
    historyExpansionRequestedRef.current = false
    setVisibleTurnCount(Math.min(pageSize, totalTurns))
  }, [activeThreadId, busy, pageSize, totalTurns])

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

  // A successful page can contain only more blocks for an already-rendered
  // turn (for example a tool call split from its result), so totalTurns may not
  // change. Once the committed content effect had a chance to restore scroll,
  // release any remaining in-flight guard.
  useEffect(() => {
    if (!remoteLoadSettledRef.current || remoteLoadStartTotalRef.current === null) return
    const snapshot = pendingPrependRef.current
    const el = containerRef.current
    remoteLoadSettledRef.current = false
    if (!remoteLoadProgressedRef.current) historyExpansionRequestedRef.current = false
    remoteLoadProgressedRef.current = false
    remoteLoadStartTotalRef.current = null
    pendingPrependRef.current = null
    prependInFlightRef.current = false
    if (snapshot && el) {
      requestAnimationFrame(() => {
        const addedHeight = el.scrollHeight - snapshot.scrollHeight
        el.scrollTop = snapshot.scrollTop + Math.max(0, addedHeight)
      })
    }
  }, [containerRef, remoteLoadCompletionRevision, totalTurns])

  // If the user explicitly asked to expand history and the container
  // still has room, keep loading earlier turns until it overflows.
  useEffect(() => {
    const el = containerRef.current
    if (!el || !hasEarlierTurns || prependInFlightRef.current) return
    if (!historyExpansionRequestedRef.current || busy) return
    if (el.scrollHeight <= el.clientHeight + TOP_LOAD_TRIGGER_PX) {
      loadEarlierTurns()
    }
  }, [containerRef, hasEarlierTurns, loadEarlierTurns, visibleTurnCount])

  return {
    visibleTurnCount: renderedVisibleTurnCount,
    hiddenTurnCount,
    hasEarlierTurns,
    loadEarlierTurns,
    collapseEarlierTurns
  }
}

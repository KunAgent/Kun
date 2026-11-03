import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual'
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react'
import { toLayoutPx } from '../../lib/body-zoom'
import { TimelineRowStateContext } from './timeline-row-state'
import { REVEAL_VIRTUAL_TIMELINE_BLOCK } from './timeline-virtual-navigation'

export const TIMELINE_VIRTUAL_THRESHOLD = 40
const OVERSCAN = 5
const VirtualParentContext = createContext(false)

type Props<T> = {
  items: readonly T[]
  viewportRef: RefObject<HTMLDivElement | null>
  itemKey: (item: T) => string
  estimateSize?: (item: T) => number
  keepMounted?: (item: T) => boolean
  containsBlock?: (item: T, blockId: string) => boolean
  className?: string
  children: (item: T) => ReactNode
}

/** Virtualize inside the existing chat scroller, keeping turn anchors in normal flow. */
export function TimelineVirtualList<T>({
  items, viewportRef, itemKey, estimateSize, keepMounted, containsBlock, className, children
}: Props<T>): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null)
  const retainedRows = useRef(new Map<string, Map<string, unknown>>())
  const hasVirtualParent = useContext(VirtualParentContext)
  const [scrollMargin, setScrollMargin] = useState(0)
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const [focusedKey, setFocusedKey] = useState<string | null>(null)
  const enabled = items.length > TIMELINE_VIRTUAL_THRESHOLD
  const keys = useMemo(() => items.map(itemKey), [items, itemKey])
  const pinned = useMemo(() => items.flatMap((item, index) =>
    keys[index] === focusedKey || keepMounted?.(item) ? [index] : []
  ), [items, keys, focusedKey, keepMounted])
  const rangeExtractor = useCallback((range: Range) =>
    [...new Set([...defaultRangeExtractor(range), ...pinned])].sort((a, b) => a - b), [pinned])
  const getItemKey = useCallback((index: number) => keys[index]!, [keys])
  const estimateItemSize = useCallback((index: number) => estimateSize?.(items[index]!) ?? 40, [estimateSize, items])
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: items.length,
    getScrollElement: () => viewport,
    estimateSize: estimateItemSize,
    getItemKey,
    overscan: OVERSCAN,
    scrollMargin,
    initialRect: { width: 800, height: 600 },
    initialOffset: () => viewport?.scrollTop ?? 0,
    rangeExtractor,
    enabled: enabled && viewport !== null,
    useFlushSync: false
  })
  // A nested list's size also resizes its measured parent row. Only the outer
  // owner adjusts the shared scroll offset, otherwise expansion applies twice.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
    !hasVirtualParent && item.start < (instance.scrollOffset ?? 0)

  // The scroller belongs to an ancestor: its DOM ref is attached after this
  // child's layout effects on first mount. Bind once those refs are ready.
  useEffect(() => { setViewport(enabled ? viewportRef.current : null) }, [enabled, viewportRef])

  useLayoutEffect(() => {
    const valid = new Set(keys)
    for (const key of retainedRows.current.keys()) {
      if (!valid.has(key)) retainedRows.current.delete(key)
    }
  }, [keys])

  useLayoutEffect(() => {
    if (!enabled) return
    const host = hostRef.current
    if (!host || !viewport) return
    const measureOffset = (): void => {
      // Rectangles include body zoom; scrollTop and virtual row sizes use layout pixels.
      const margin = toLayoutPx(host.getBoundingClientRect().top - viewport.getBoundingClientRect().top)
        + viewport.scrollTop - viewport.clientTop
      setScrollMargin((previous) => Math.abs(previous - margin) < 0.5 ? previous : margin)
    }
    measureOffset()
    viewport.addEventListener('scroll', measureOffset, { passive: true })
    window.addEventListener('resize', measureOffset)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measureOffset)
    // Earlier turns, media, and sibling virtual lists can move this list even
    // when its own dimensions do not change. Observe its layout ancestors too.
    for (let node: HTMLElement | null = host; node && node !== viewport; node = node.parentElement) {
      observer?.observe(node)
    }
    observer?.observe(viewport)
    return () => {
      observer?.disconnect()
      viewport.removeEventListener('scroll', measureOffset)
      window.removeEventListener('resize', measureOffset)
    }
  }, [enabled, viewport])

  useLayoutEffect(() => {
    if (!enabled || !containsBlock) return
    const turn = hostRef.current?.closest('[data-turn-id]')
    if (!turn) return
    const reveal = (event: Event): void => {
      const blockId = (event as CustomEvent<string>).detail
      const index = items.findIndex((item) => containsBlock(item, blockId))
      if (index < 0) return
      event.preventDefault()
      virtualizer.scrollToIndex(index, { align: 'center', behavior: 'auto' })
    }
    turn.addEventListener(REVEAL_VIRTUAL_TIMELINE_BLOCK, reveal)
    return () => turn.removeEventListener(REVEAL_VIRTUAL_TIMELINE_BLOCK, reveal)
  }, [containsBlock, enabled, items, virtualizer])

  const renderRow = (item: T, key: string): ReactNode => {
    let state = retainedRows.current.get(key)
    if (!state) { state = new Map(); retainedRows.current.set(key, state) }
    return <TimelineRowStateContext.Provider key={key} value={state}>{children(item)}</TimelineRowStateContext.Provider>
  }

  if (!enabled) return <div className={className}>{items.map((item, index) => renderRow(item, keys[index]!))}</div>

  return (
    <div className={className} style={{ flexShrink: 0, overflowAnchor: 'none' }}>
    <div ref={hostRef} data-timeline-virtual-list="true"
      style={{ position: 'relative', height: virtualizer.getTotalSize(), flexShrink: 0 }}
      onFocusCapture={(event) => {
        let row: HTMLElement | null = event.target as HTMLElement
        while (row && row.parentElement !== hostRef.current) row = row.parentElement
        if (row) setFocusedKey(row.dataset.timelineVirtualRow ?? null)
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedKey(null)
      }}>
      {virtualizer.getVirtualItems().map((row) => (
        <div key={row.key} ref={virtualizer.measureElement} data-index={row.index}
          data-timeline-virtual-row={keys[row.index]}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', paddingBottom: 4,
            transform: `translateY(${row.start - scrollMargin}px)` }}>
          <VirtualParentContext.Provider value={true}>
            {renderRow(items[row.index]!, keys[row.index]!)}
          </VirtualParentContext.Provider>
        </div>
      ))}
    </div>
    </div>
  )
}

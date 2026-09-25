import { useLayoutEffect, useRef, useState, type ReactElement, type RefObject } from 'react'
import { Link2, Trash2, X } from 'lucide-react'
import type { TFunction } from 'i18next'
import type { PaperHighlight, PaperRect, PaperVisualMark } from '@shared/paper/paper-marks-types'
import { usePaperMarksStore } from '../../../paper/paper-marks-store'
import { layoutCommentGutter } from '../../../paper/comment-gutter-layout'
import { paperCitationMarkdown } from '../../../paper/paper-citation-copy'
import { PaperVisualMarkCard } from './PaperVisualMarkCard'

const NARROW_RAIL_WIDTH = 900
const CARD_WIDTH = 240
const CARD_GAP = 8

/** One card column entry: a commented highlight or an R2.4 region mark. */
type GutterItem = {
  id: string
  page: number
  /** First rect drives the card's anchor; last rect drives the connector. */
  firstRect: PaperRect
  lastRect: PaperRect
  item: PaperHighlight | PaperVisualMark
}

type MarkGeometry = {
  /** Card's ideal top in container coordinates (mark's first rect top). */
  anchorY: number
  /** Connector start: right edge of the mark's last rect. */
  fromX: number
  fromY: number
  /** Page's right edge in container coordinates (the elbow x). */
  pageRightX: number
}

/**
 * Comment gutter (R1.4): one card per commented highlight / visual mark on
 * the current page, stacked against the reader's right edge with
 * anti-overlap tops from `layoutCommentGutter`. A right-angle SVG connector
 * (mark edge → page edge → card) appears while a card or its source mark is
 * hovered. Below ~900px the column collapses to dots that open the card on
 * click.
 */
export function PaperCommentGutter({
  marks,
  visualMarks = [],
  currentPage,
  containerRef,
  workspaceRoot,
  unitDir,
  paperTitle = '',
  pdfFile,
  onJumpToPage,
  onDelete,
  t
}: {
  marks: readonly PaperHighlight[]
  visualMarks?: readonly PaperVisualMark[]
  currentPage: number
  containerRef: RefObject<HTMLElement | null>
  workspaceRoot: string
  unitDir: string
  paperTitle?: string
  /** PDF file inside the unit for `#page=N` citation links (R3.2). */
  pdfFile?: string
  onJumpToPage: (page: number) => void
  onDelete: (id: string) => void
  t: TFunction
}): ReactElement | null {
  const hoveredMarkId = usePaperMarksStore((s) => s.hoveredMarkId)
  const onHoverMark = (id: string | null): void => {
    usePaperMarksStore.setState({ hoveredMarkId: id })
  }
  const items: GutterItem[] = [
    ...marks
      .filter((mark) => mark.comment && mark.rects.length > 0)
      .map((mark): GutterItem => {
        const first = mark.rects[0]!
        const last = mark.rects[mark.rects.length - 1] ?? first
        return { id: mark.id, page: mark.page, firstRect: first, lastRect: last, item: mark }
      }),
    ...visualMarks.map((mark): GutterItem => ({
      id: mark.id,
      page: mark.page,
      firstRect: mark.rect,
      lastRect: mark.rect,
      item: mark
    }))
  ]
  const onPage = items.filter((item) => item.page === currentPage)
  const [openDotId, setOpenDotId] = useState<string | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)
  const [geometry, setGeometry] = useState<ReadonlyMap<string, MarkGeometry>>(new Map())
  const [cardHeights, setCardHeights] = useState<ReadonlyMap<string, number>>(new Map())
  const cardRefs = useRef(new Map<string, HTMLDivElement>())

  // Measure the container and each mark's page-space anchor. Recomputed on
  // scroll (pages move), resize, and whenever marks/page change.
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const scroller = container.querySelector<HTMLElement>('.write-pdf-scroller')
    let frame = 0
    const measure = (): void => {
      const containerRect = container.getBoundingClientRect()
      setContainerWidth(containerRect.width)
      setContainerHeight(containerRect.height)
      const next = new Map<string, MarkGeometry>()
      for (const entry of onPage) {
        const pageEl = container.querySelector<HTMLElement>(
          `[data-write-pdf-page="${entry.page}"]`
        )
        if (!pageEl) continue
        const pageRect = pageEl.getBoundingClientRect()
        if (pageRect.width <= 0 || pageRect.height <= 0) continue
        next.set(entry.id, {
          anchorY: pageRect.top - containerRect.top + entry.firstRect[1] * pageRect.height,
          fromX: pageRect.left - containerRect.left + (entry.lastRect[0] + entry.lastRect[2]) * pageRect.width,
          fromY: pageRect.top - containerRect.top + (entry.lastRect[1] + entry.lastRect[3] / 2) * pageRect.height,
          pageRightX: pageRect.right - containerRect.left
        })
      }
      setGeometry(next)
      // Backfill measured card heights for the anti-overlap layout.
      const heights = new Map<string, number>()
      for (const [id, el] of cardRefs.current) heights.set(id, el.offsetHeight)
      setCardHeights((prev) => {
        for (const [id, h] of heights) if (prev.get(id) !== h) return heights
        return prev.size === heights.size ? prev : heights
      })
    }
    const schedule = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    measure()
    const observer = new ResizeObserver(schedule)
    observer.observe(container)
    scroller?.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      observer.disconnect()
      scroller?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      cancelAnimationFrame(frame)
    }
    // onPage identity changes when marks/currentPage change — measuring keys
    // off it is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, marks, visualMarks, currentPage, onPage.length])

  if (items.length === 0) return null
  const narrow = containerWidth > 0 && containerWidth < NARROW_RAIL_WIDTH

  const copyCitation = (entry: GutterItem): void => {
    const mark = entry.item
    void navigator.clipboard
      .writeText(
        paperCitationMarkdown({
          quote: mark.kind === 'visual' ? (mark.comment ?? '') : mark.quote,
          title: paperTitle,
          page: entry.page,
          unitDir,
          pdfFile,
          comment: mark.comment
        })
      )
      .catch(() => undefined)
  }

  const itemCard = (entry: GutterItem, opts: { onClose?: () => void } = {}): ReactElement => (
    entry.item.kind === 'visual' ? (
      <div>
        <PaperVisualMarkCard
          mark={entry.item}
          workspaceRoot={workspaceRoot}
          unitDir={unitDir}
          paperTitle={paperTitle}
          pdfFile={pdfFile}
          onJumpToPage={onJumpToPage}
          t={t}
        />
      </div>
    ) : (
      <div>
        <div className="mb-1 flex items-start justify-between gap-2">
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            onClick={() => {
              onJumpToPage(entry.page)
              opts.onClose?.()
            }}
          >
            <span className={`paper-swatch-${entry.item.color} mr-1 inline-block h-2 w-2 rounded-full`} />
            <span className="text-[10.5px] text-ds-faint">
              {t('writePdfPageLabel', { page: entry.page })}
            </span>
            <p className="line-clamp-3 text-[11px] leading-4 text-ds-muted">{entry.item.quote}</p>
          </button>
          <span className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              className="write-pdf-icon-button"
              aria-label={t('writePaperReaderCopyCitation')}
              title={t('writePaperReaderCopyCitation')}
              onClick={() => copyCitation(entry)}
            >
              <Link2 className="h-3.5 w-3.5" strokeWidth={1.9} />
            </button>
            {opts.onClose ? (
              <button
                type="button"
                className="write-pdf-icon-button"
                aria-label={t('close')}
                onClick={opts.onClose}
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            ) : null}
            <button
              type="button"
              className="write-pdf-icon-button"
              aria-label={t('writePaperReaderDelete')}
              onClick={() => {
                onDelete(entry.id)
                opts.onClose?.()
              }}
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
            </button>
          </span>
        </div>
        <p className="text-[12px] leading-4 text-ds-ink">{entry.item.comment}</p>
      </div>
    )
  )

  // Narrow mode: page-edge dots, click to pop the card (pre-refinement look).
  if (narrow) {
    const open = items.find((entry) => entry.id === openDotId)
    return (
      <div className="pointer-events-none absolute bottom-16 right-2 top-16 z-10 w-7">
        {onPage.map((entry) => {
          const top = Math.min(0.96, Math.max(0.02, entry.firstRect[1]))
          return (
            <button
              key={entry.id}
              type="button"
              title={entry.item.comment}
              aria-label={t('writePaperReaderComment')}
              onClick={() => setOpenDotId(openDotId === entry.id ? null : entry.id)}
              onMouseEnter={() => onHoverMark(entry.id)}
              onMouseLeave={() => onHoverMark(null)}
              className={`${entry.item.kind === 'visual' ? 'border border-dashed border-[#3b82f6] bg-[#3b82f6]/20' : `paper-swatch-${entry.item.color} border border-white/70 dark:border-black/40`} pointer-events-auto absolute left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full shadow transition hover:scale-125`}
              style={{ top: `${top * 100}%` }}
            />
          )
        })}
        {items.length > onPage.length ? (
          <span
            className="pointer-events-auto absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full bg-ds-card px-1 py-px text-[9px] text-ds-faint shadow"
            title={t('writePaperReaderCommentOthers', { count: items.length - onPage.length })}
          >
            +{items.length - onPage.length}
          </span>
        ) : null}
        {open ? (
          <div className="pointer-events-auto absolute right-8 top-0 w-[240px] rounded-lg border border-ds-border bg-ds-card p-2 shadow-xl">
            {itemCard(open, { onClose: () => setOpenDotId(null) })}
          </div>
        ) : null}
      </div>
    )
  }

  const placed = onPage.filter((entry) => geometry.has(entry.id))
  const tops = layoutCommentGutter({
    anchors: placed.map((entry) => geometry.get(entry.id)?.anchorY ?? 0),
    heights: placed.map((entry) => cardHeights.get(entry.id) ?? 72),
    containerHeight,
    gap: CARD_GAP
  })
  const cardLeft = containerWidth - CARD_WIDTH - 10

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      <svg
        className="absolute inset-0 h-full w-full text-[#1f2937] dark:text-[#e5e7eb]"
        aria-hidden="true"
      >
        {placed.map((entry, index) => {
          const geo = geometry.get(entry.id)
          if (!geo || hoveredMarkId !== entry.id) return null
          const midY = tops[index] + (cardHeights.get(entry.id) ?? 72) / 2
          return (
            <path
              key={entry.id}
              d={`M ${geo.fromX} ${geo.fromY} H ${geo.pageRightX + 6} V ${midY} H ${cardLeft}`}
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.4}
              strokeWidth={1}
            />
          )
        })}
      </svg>
      {placed.map((entry, index) => (
        <div
          key={entry.id}
          ref={(node) => {
            if (node) cardRefs.current.set(entry.id, node)
            else cardRefs.current.delete(entry.id)
          }}
          className={`pointer-events-auto absolute rounded-lg border bg-ds-card p-2 shadow-md transition-[top] duration-100 motion-reduce:transition-none ${
            entry.item.kind === 'visual' ? 'border-dashed border-[#3b82f6]/60' : 'border-ds-border'
          }`}
          style={{ left: cardLeft, top: tops[index], width: CARD_WIDTH }}
          onMouseEnter={() => onHoverMark(entry.id)}
          onMouseLeave={() => onHoverMark(null)}
        >
          {itemCard(entry)}
        </div>
      ))}
    </div>
  )
}

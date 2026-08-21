import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { InitialSessionUsageHeatmap } from './InitialSessionUsageHeatmap'

const POPOVER_MAX_WIDTH = 920
const POPOVER_MAX_HEIGHT = 720
const POPOVER_ESTIMATED_HEIGHT = 640
const POPOVER_MARGIN = 12
const POPOVER_GAP = 8

type RectEdges = Pick<DOMRect, 'bottom' | 'left' | 'right' | 'top'>

export type UsageHistoryPopoverPlacement = {
  left: number
  top: number
  width: number
  maxHeight: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function calculateUsageHistoryPopoverPlacement({
  anchorRect,
  contentRect,
  popoverHeight,
  uiScale = 1,
  viewportHeight,
  viewportWidth
}: {
  anchorRect: RectEdges
  contentRect?: Pick<DOMRect, 'left' | 'right'>
  popoverHeight: number
  uiScale?: number
  viewportHeight: number
  viewportWidth: number
}): UsageHistoryPopoverPlacement {
  const scale = Number.isFinite(uiScale) && uiScale > 0 ? uiScale : 1
  const layoutAnchorRect: RectEdges = {
    bottom: anchorRect.bottom / scale,
    left: anchorRect.left / scale,
    right: anchorRect.right / scale,
    top: anchorRect.top / scale
  }
  const layoutViewportHeight = viewportHeight / scale
  const layoutViewportWidth = viewportWidth / scale
  const viewportRight = Math.max(POPOVER_MARGIN, layoutViewportWidth - POPOVER_MARGIN)
  const layoutContentLeft = contentRect ? contentRect.left / scale : POPOVER_MARGIN
  const layoutContentRight = contentRect ? contentRect.right / scale : viewportRight
  const contentLeft = clamp(layoutContentLeft, POPOVER_MARGIN, viewportRight)
  const contentRight = clamp(layoutContentRight, contentLeft, viewportRight)
  const availableWidth = Math.max(1, contentRight - contentLeft)
  const width = Math.max(1, Math.min(POPOVER_MAX_WIDTH, availableWidth))
  const centeredLeft = contentLeft + (availableWidth - width) / 2
  const left = clamp(centeredLeft, contentLeft, Math.max(contentLeft, contentRight - width))
  const spaceAbove = Math.max(1, layoutAnchorRect.top - POPOVER_MARGIN - POPOVER_GAP)
  const spaceBelow = Math.max(1, layoutViewportHeight - layoutAnchorRect.bottom - POPOVER_MARGIN - POPOVER_GAP)
  const viewportMaxHeight = Math.max(1, Math.min(POPOVER_MAX_HEIGHT, layoutViewportHeight - POPOVER_MARGIN * 2))
  const desiredHeight = Math.min(Math.max(1, popoverHeight), viewportMaxHeight)
  const openAbove = spaceAbove >= Math.min(desiredHeight, 360) || spaceAbove >= spaceBelow
  const maxHeight = Math.max(1, Math.min(viewportMaxHeight, openAbove ? spaceAbove : spaceBelow))
  const visibleHeight = Math.min(desiredHeight, maxHeight)
  const preferredTop = openAbove
    ? layoutAnchorRect.top - POPOVER_GAP - visibleHeight
    : layoutAnchorRect.bottom + POPOVER_GAP
  const top = clamp(
    preferredTop,
    POPOVER_MARGIN,
    Math.max(POPOVER_MARGIN, layoutViewportHeight - visibleHeight - POPOVER_MARGIN)
  )
  return { left, top, width, maxHeight }
}

function readDocumentUiScale(): number {
  if (
    typeof document === 'undefined' ||
    typeof window === 'undefined' ||
    !document.body ||
    typeof window.getComputedStyle !== 'function'
  ) return 1
  const scale = Number.parseFloat(window.getComputedStyle(document.body).zoom)
  return Number.isFinite(scale) && scale > 0 ? scale : 1
}

type Props = {
  title: string
  children: ReactNode
}

export function FloatingComposerUsageHistory({ title, children }: Props): ReactElement {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<UsageHistoryPopoverPlacement | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      setPlacement(null)
      return
    }
    const updatePlacement = (): void => {
      const button = buttonRef.current
      if (!button) return
      const contentBoundary = button.closest<HTMLElement>('[data-usage-history-boundary]')
      setPlacement(calculateUsageHistoryPopoverPlacement({
        anchorRect: button.getBoundingClientRect(),
        contentRect: contentBoundary?.getBoundingClientRect(),
        popoverHeight: popoverRef.current?.offsetHeight ?? POPOVER_ESTIMATED_HEIGHT,
        uiScale: readDocumentUiScale(),
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth
      }))
    }
    updatePlacement()
    const frame = window.requestAnimationFrame(updatePlacement)
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updatePlacement)
    if (buttonRef.current) resizeObserver?.observe(buttonRef.current)
    if (popoverRef.current) resizeObserver?.observe(popoverRef.current)
    const contentBoundary = buttonRef.current?.closest<HTMLElement>('[data-usage-history-boundary]')
    if (contentBoundary) resizeObserver?.observe(contentBoundary)
    window.addEventListener('resize', updatePlacement)
    window.addEventListener('scroll', updatePlacement, true)
    return () => {
      window.cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updatePlacement)
      window.removeEventListener('scroll', updatePlacement, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return
      if (buttonRef.current?.contains(event.target) || popoverRef.current?.contains(event.target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const viewportWidth = typeof window === 'undefined'
    ? POPOVER_MAX_WIDTH + POPOVER_MARGIN * 2
    : window.innerWidth
  const viewportHeight = typeof window === 'undefined'
    ? POPOVER_MAX_HEIGHT + POPOVER_MARGIN * 2
    : window.innerHeight
  const uiScale = readDocumentUiScale()
  const layoutViewportWidth = viewportWidth / uiScale
  const layoutViewportHeight = viewportHeight / uiScale
  const popoverStyle: CSSProperties = placement
    ? {
        left: placement.left,
        top: placement.top,
        width: placement.width,
        maxHeight: placement.maxHeight
      }
    : {
        left: 0,
        top: 0,
        width: Math.min(POPOVER_MAX_WIDTH, Math.max(1, layoutViewportWidth - POPOVER_MARGIN * 2)),
        maxHeight: Math.min(POPOVER_MAX_HEIGHT, Math.max(1, layoutViewportHeight - POPOVER_MARGIN * 2)),
        visibility: 'hidden'
      }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="ds-composer-usage ds-no-drag inline-flex min-h-7 max-w-full min-w-0 flex-nowrap items-center overflow-hidden whitespace-nowrap rounded-lg border border-ds-border-muted bg-ds-card px-2.5 py-0.5 text-[12.5px] font-medium leading-5 text-ds-muted shadow-sm transition hover:border-accent/30 hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        title={title}
        aria-label={t('usageHistoryOpen', { defaultValue: 'Open usage history' })}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        {children}
      </button>
      {open && typeof document !== 'undefined' ? createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-modal="false"
          aria-label={t('usageHistoryTitle', { defaultValue: 'Usage history' })}
          data-usage-history-popover
          className="ds-no-drag fixed z-[11000] flex min-h-0 flex-col overflow-hidden rounded-2xl border border-ds-border bg-ds-card shadow-[0_24px_80px_rgba(20,30,55,0.24)]"
          style={popoverStyle}
        >
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-ds-border-muted px-4">
            <div>
              <div className="text-[13px] font-semibold text-ds-ink">
                {t('usageHistoryTitle', { defaultValue: 'Usage history' })}
              </div>
              <div className="text-[10px] text-ds-faint">
                {t('usageHistorySubtitle', { defaultValue: '365-day activity and model usage' })}
              </div>
            </div>
            <button
              type="button"
              className="rounded-md p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
              aria-label={t('close')}
              onClick={() => {
                setOpen(false)
                buttonRef.current?.focus()
              }}
            >
              <X className="h-4 w-4" strokeWidth={1.9} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overscroll-contain overflow-auto p-3 sm:p-4">
            <InitialSessionUsageHeatmap hideHero embedded />
          </div>
        </div>,
        document.body
      ) : null}
    </>
  )
}

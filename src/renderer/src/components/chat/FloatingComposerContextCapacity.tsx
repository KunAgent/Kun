import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { RequestContextSnapshot } from '../../agent/types'
import type { AppRoute } from '../../store/chat-store-types'
import { useChatStore } from '../../store/chat-store'
import { useHarnessStore } from '../../store/harness-store'
import { formatPercent } from '../../hooks/use-thread-usage'
import { buildContextCapacity, type ContextCapacity } from '../../lib/context-capacity'
import { ContextCapacityPopover } from './ContextCapacityPopover'

const RING_SIZE = 24
const RING_STROKE = 2.5
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
const POPOVER_WIDTH = 300
const POPOVER_MIN_HEIGHT = 180
const POPOVER_MAX_HEIGHT = 360
const POPOVER_ESTIMATED_HEIGHT = 252
const POPOVER_MARGIN = 12
const POPOVER_GAP = 8

type PopoverAnchorRect = Pick<DOMRect, 'bottom' | 'right' | 'top'>

export type ContextCapacityPopoverPlacement = {
  left: number
  top: number
  width: number
  maxHeight: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function currentBodyZoom(): number {
  if (typeof window === 'undefined') return 1
  const parsed = Number.parseFloat(window.getComputedStyle(document.body).zoom)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function capacityColor(usedRatio: number, thresholdRatio: number): string {
  if (usedRatio >= thresholdRatio) return '#d9544e'
  if (usedRatio >= thresholdRatio * 0.85) return '#d9920f'
  return 'var(--ds-accent)'
}

export function calculateContextCapacityPopoverPlacement({
  anchorRect,
  popoverHeight,
  viewportHeight,
  viewportWidth,
  coordinateScale = 1
}: {
  anchorRect: PopoverAnchorRect
  popoverHeight: number
  viewportHeight: number
  viewportWidth: number
  coordinateScale?: number
}): ContextCapacityPopoverPlacement {
  const scale = Number.isFinite(coordinateScale) && coordinateScale > 0 ? coordinateScale : 1
  const normalizedAnchorRect = {
    bottom: anchorRect.bottom / scale,
    right: anchorRect.right / scale,
    top: anchorRect.top / scale
  }
  const normalizedViewportHeight = viewportHeight / scale
  const normalizedViewportWidth = viewportWidth / scale
  const viewportMaxWidth = Math.max(1, normalizedViewportWidth - POPOVER_MARGIN * 2)
  const width = Math.min(POPOVER_WIDTH, viewportMaxWidth)
  const left = clamp(
    normalizedAnchorRect.right - width,
    POPOVER_MARGIN,
    Math.max(POPOVER_MARGIN, normalizedViewportWidth - POPOVER_MARGIN - width)
  )
  const contentHeight = Math.max(popoverHeight, POPOVER_MIN_HEIGHT)
  const spaceAbove = Math.max(
    1,
    normalizedAnchorRect.top - POPOVER_MARGIN - POPOVER_GAP
  )
  const spaceBelow = Math.max(
    1,
    normalizedViewportHeight - normalizedAnchorRect.bottom - POPOVER_MARGIN - POPOVER_GAP
  )
  const targetHeight = Math.min(contentHeight, POPOVER_MAX_HEIGHT)
  const openAbove = spaceAbove >= targetHeight || spaceAbove >= spaceBelow
  const availableHeight = openAbove ? spaceAbove : spaceBelow
  const maxHeight = Math.min(POPOVER_MAX_HEIGHT, availableHeight)
  const visibleHeight = Math.min(contentHeight, maxHeight)
  const preferredTop = openAbove
    ? normalizedAnchorRect.top - POPOVER_GAP - visibleHeight
    : normalizedAnchorRect.bottom + POPOVER_GAP
  const top = clamp(
    preferredTop,
    POPOVER_MARGIN,
    Math.max(POPOVER_MARGIN, normalizedViewportHeight - POPOVER_MARGIN - visibleHeight)
  )

  return { left, top, width, maxHeight }
}

type Props = {
  compact: boolean
  route: AppRoute
  activeThreadId: string | null
  selectedModel: string
  selectedProviderId?: string
}

/** Owns context-capacity measurement, popover lifecycle, and accessible trigger UI. */
export function FloatingComposerContextCapacity({
  compact,
  route,
  activeThreadId,
  selectedModel,
  selectedProviderId
}: Props): ReactElement | null {
  const { t } = useTranslation('common')
  const capacity = useComposerContextCapacity({
    compact,
    route,
    activeThreadId,
    selectedModel,
    selectedProviderId
  })
  // An Agent-managed context is described in that Agent's name.
  const composerHarnessId = useChatStore((state) => state.composerHarnessId)
  const agentName = useHarnessStore((state) => capacity?.agentManaged
    ? state.rows.find((row) => row.definition.id === composerHarnessId)?.definition.displayName : undefined)
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<ContextCapacityPopoverPlacement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const hoverCloseTimerRef = useRef<number | null>(null)
  const visible = Boolean(capacity)

  useEffect(() => {
    if (!visible && open) setOpen(false)
  }, [open, visible])

  useEffect(() => {
    if (!open || !capacity) {
      setPlacement(null)
      return
    }
    const updatePlacement = (): void => {
      const button = buttonRef.current
      if (!button) return
      setPlacement(calculateContextCapacityPopoverPlacement({
        anchorRect: button.getBoundingClientRect(),
        popoverHeight: popoverRef.current?.offsetHeight ?? POPOVER_ESTIMATED_HEIGHT,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        coordinateScale: currentBodyZoom()
      }))
    }
    updatePlacement()
    const frame = window.requestAnimationFrame(updatePlacement)
    window.addEventListener('resize', updatePlacement)
    window.addEventListener('scroll', updatePlacement, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updatePlacement)
      window.removeEventListener('scroll', updatePlacement, true)
    }
  }, [capacity, open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => () => {
    if (hoverCloseTimerRef.current != null) window.clearTimeout(hoverCloseTimerRef.current)
  }, [])

  if (!capacity) return null

  const cancelClose = (): void => {
    if (hoverCloseTimerRef.current == null) return
    window.clearTimeout(hoverCloseTimerRef.current)
    hoverCloseTimerRef.current = null
  }
  const openPreview = (): void => {
    cancelClose()
    setOpen(true)
  }
  const closePreviewSoon = (): void => {
    cancelClose()
    hoverCloseTimerRef.current = window.setTimeout(() => {
      hoverCloseTimerRef.current = null
      setOpen(false)
    }, 120)
  }
  const popoverStyle: CSSProperties = placement
    ? {
        left: `${placement.left}px`,
        top: `${placement.top}px`,
        width: `${placement.width}px`,
        maxHeight: `${placement.maxHeight}px`
      }
    : {
        left: 0,
        top: 0,
        width: `${POPOVER_WIDTH}px`,
        maxHeight: `${POPOVER_MAX_HEIGHT}px`,
        visibility: 'hidden'
      }
  const percent = formatPercent(capacity.usedRatio)
  const ariaLabel = capacity.nativeHistoryUnknown
    ? t('contextCapacitySdkManagedChipAria', { tokens: capacity.usedTokens })
    : t('contextCapacityChipAria', { percent })

  return (
    <>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popoverRef}
              className="ds-no-drag fixed z-[1000]"
              style={popoverStyle}
              data-context-capacity-popover
              onMouseEnter={cancelClose}
              onMouseLeave={closePreviewSoon}
            >
              <ContextCapacityPopover
                capacity={capacity}
                agentName={agentName}
                style={{ width: '100%', maxHeight: 'inherit', overflowY: 'auto' }}
              />
            </div>,
            document.body
          )
        : null}
      <div className="ds-composer-context-control relative shrink-0" ref={rootRef}>
        <button
          ref={buttonRef}
          type="button"
          onClick={openPreview}
          onFocus={openPreview}
          onBlur={closePreviewSoon}
          onMouseEnter={openPreview}
          onMouseLeave={closePreviewSoon}
          className="ds-composer-context ds-no-drag inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-transparent text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <svg
            className="h-5 w-5 -rotate-90 shrink-0"
            viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
            aria-hidden="true"
          >
            {capacity.nativeHistoryUnknown ? (
              <circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                fill="none"
                stroke="var(--ds-muted)"
                strokeWidth={RING_STROKE}
                strokeLinecap="round"
                strokeDasharray="2 3"
              />
            ) : (
              <>
                <circle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RING_RADIUS}
                  fill="none"
                  stroke="var(--ds-surface-subtle)"
                  strokeWidth={RING_STROKE}
                />
                <circle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RING_RADIUS}
                  fill="none"
                  stroke={capacityColor(capacity.usedRatio, capacity.alertRatio)}
                  strokeWidth={RING_STROKE}
                  strokeLinecap="round"
                  strokeDasharray={RING_CIRCUMFERENCE}
                  strokeDashoffset={RING_CIRCUMFERENCE * (1 - Math.min(1, Math.max(0, capacity.usedRatio)))}
                />
              </>
            )}
          </svg>
        </button>
      </div>
    </>
  )
}

function useComposerContextCapacity({
  compact,
  route,
  activeThreadId,
  selectedModel,
  selectedProviderId
}: Props): ContextCapacity | null {
  const snapshot = useChatStore((state) => state.lastContextSnapshot)
  const enabled = !compact && route === 'chat' && Boolean(activeThreadId)
  return useMemo(() => {
    if (
      !enabled ||
      !snapshot ||
      !requestContextSnapshotMatchesSelection(snapshot, {
        threadId: activeThreadId,
        model: selectedModel,
        providerId: selectedProviderId
      })
    ) {
      return null
    }
    return buildContextCapacity(snapshot)
  }, [activeThreadId, enabled, selectedModel, selectedProviderId, snapshot])
}

function normalizedSelection(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

export function requestContextSnapshotMatchesSelection(
  snapshot: RequestContextSnapshot,
  selection: {
    threadId: string | null
    model: string
    providerId?: string
  }
): boolean {
  if (!selection.threadId || snapshot.threadId !== selection.threadId) return false
  const selectedModel = normalizedSelection(selection.model)
  const snapshotModel = normalizedSelection(snapshot.model)
  if (selectedModel && selectedModel !== 'auto' && selectedModel !== snapshotModel) return false
  const selectedProvider = normalizedSelection(selection.providerId)
  const snapshotProvider = normalizedSelection(snapshot.providerId)
  return selectedProvider
    ? selectedProvider === snapshotProvider
    : !snapshotProvider || snapshotProvider === 'default'
}

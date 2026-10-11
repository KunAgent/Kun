import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement
} from 'react'
import { createPortal } from 'react-dom'
import { Gauge } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ComposerSubscriptionQuotaRequest } from '@shared/composer-subscription-quota'
import type { RequestContextSnapshot } from '../../agent/types'
import type { AppRoute } from '../../store/chat-store-types'
import { useChatStore } from '../../store/chat-store'
import { useHarnessStore } from '../../store/harness-store'
import { formatPercent } from '../../hooks/use-thread-usage'
import { buildContextCapacity, type ContextCapacity } from '../../lib/context-capacity'
import { ContextCapacityPopover } from './ContextCapacityPopover'
import { ComposerSubscriptionQuota } from './ComposerSubscriptionQuota'
import { composerQuotaWindows } from './composer-subscription-quota-model'
import { useComposerSubscriptionQuota } from '../../hooks/use-composer-subscription-quota'
import { subscriptionQuotaSelectionKey } from '../../hooks/composer-subscription-quota-cache'
import { fitComposerToolbar } from './composer-toolbar-fit'

const RING_SIZE = 24
const RING_STROKE = 2.5
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
const POPOVER_WIDTH = 300
const POPOVER_MIN_HEIGHT = 72
const POPOVER_MAX_HEIGHT = 520
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
  subscriptionSelection?: ComposerSubscriptionQuotaRequest
}

/** Owns context-capacity measurement, popover lifecycle, and accessible trigger UI. */
export function FloatingComposerContextCapacity({
  compact,
  route,
  activeThreadId,
  selectedModel,
  selectedProviderId,
  subscriptionSelection
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
  const subscription = useComposerSubscriptionQuota(subscriptionSelection, `${route}:${activeThreadId ?? ''}:${selectedModel}`)
  const quotaEntry = subscription.result?.entry
  const hasQuota = composerQuotaWindows(quotaEntry).length > 0
  const quotaBindingKey = subscriptionSelection ? `${route}:${activeThreadId ?? ''}:${selectedModel}:${subscriptionQuotaSelectionKey(subscriptionSelection)}` : ''
  const knownQuotaRef = useRef({ key: quotaBindingKey, available: false })
  if (knownQuotaRef.current.key !== quotaBindingKey || !subscription.verifyingIdentity) {
    knownQuotaRef.current = { key: quotaBindingKey, available: hasQuota }
  }
  const checkingQuota = subscription.verifyingIdentity && knownQuotaRef.current.key === quotaBindingKey && knownQuotaRef.current.available
  const quotaTriggerVisible = hasQuota || checkingQuota
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<ContextCapacityPopoverPlacement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const hoverCloseTimerRef = useRef<number | null>(null)
  const suppressFocusOpenRef = useRef(false)
  const visible = Boolean(capacity) || quotaTriggerVisible

  useEffect(() => {
    const toolbar = rootRef.current?.closest<HTMLElement>('.ds-composer-toolbar')
    if (toolbar) fitComposerToolbar(toolbar)
  }, [quotaTriggerVisible, visible])

  useEffect(() => {
    if (!visible && open) setOpen(false)
  }, [open, visible])

  useEffect(() => {
    if (!open || !visible) {
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
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePlacement)
    if (popoverRef.current) observer?.observe(popoverRef.current)
    if (buttonRef.current) observer?.observe(buttonRef.current)
    window.addEventListener('resize', updatePlacement)
    window.addEventListener('scroll', updatePlacement, true)
    return () => {
      window.cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', updatePlacement)
      window.removeEventListener('scroll', updatePlacement, true)
    }
  }, [capacity, hasQuota, open, visible])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
        suppressFocusOpenRef.current = true
        buttonRef.current?.focus({ preventScroll: true })
        queueMicrotask(() => { suppressFocusOpenRef.current = false })
      }
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

  if (!visible) return null

  const cancelClose = (): void => {
    if (hoverCloseTimerRef.current == null) return
    window.clearTimeout(hoverCloseTimerRef.current)
    hoverCloseTimerRef.current = null
  }
  const openPreview = (): void => {
    cancelClose()
    if (!open) subscription.revalidate()
    setOpen(true)
  }
  const closePreviewSoon = (): void => {
    cancelClose()
    const focused = document.activeElement
    if (focused && (rootRef.current?.contains(focused) || popoverRef.current?.contains(focused))) return
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
  const percent = capacity ? formatPercent(capacity.usedRatio) : ''
  const ariaLabel = !capacity ? t('subscriptionQuota.open') : capacity.nativeHistoryUnknown
    ? t('contextCapacitySdkManagedChipAria', { tokens: capacity.usedTokens })
    : t('contextCapacityChipAria', { percent })

  return (
    <>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popoverRef}
              className="ds-composer-capacity-popup ds-no-drag fixed z-[1000]"
              style={popoverStyle}
              data-context-capacity-popover
              role="dialog"
              aria-label={t(quotaTriggerVisible ? capacity ? 'subscriptionQuota.contextAndQuota' : 'subscriptionQuota.title' : 'contextCapacityTitle')}
              onMouseEnter={cancelClose}
              onMouseLeave={closePreviewSoon}
              onFocusCapture={cancelClose}
              onBlurCapture={(event) => {
                if (event.relatedTarget instanceof Node && (popoverRef.current?.contains(event.relatedTarget) || rootRef.current?.contains(event.relatedTarget))) return
                closePreviewSoon()
              }}
            >
              {capacity ? <ContextCapacityPopover
                capacity={capacity}
                agentName={agentName}
                embedded
              /> : null}
              {hasQuota && quotaEntry ? <ComposerSubscriptionQuota entry={quotaEntry}
                refreshedAt={subscription.result?.refreshedAt} refreshing={subscription.refreshing} onRefresh={subscription.refresh} /> : null}
              {checkingQuota ? <section className="ds-composer-subscription" data-composer-subscription-checking role="status">
                <div className="ds-composer-subscription-header"><h3>{t('subscriptionQuota.title')}</h3></div>
                <p className="ds-composer-subscription-updated">{t('subscriptionQuota.checking')}</p>
              </section> : null}
            </div>,
            document.body
          )
        : null}
      <div className={`${quotaTriggerVisible ? 'ds-composer-subscription-control' : 'ds-composer-context-control'} relative shrink-0`} ref={rootRef}>
        <button
          ref={buttonRef}
          type="button"
          onClick={openPreview}
          onFocus={() => { if (!suppressFocusOpenRef.current) openPreview() }}
          onBlur={closePreviewSoon}
          onMouseEnter={openPreview}
          onMouseLeave={closePreviewSoon}
          className={capacity ? 'ds-composer-context ds-no-drag inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-transparent text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30' : 'ds-composer-subscription-trigger ds-no-drag'}
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-haspopup="dialog"
          data-composer-capacity-trigger={capacity ? 'context' : 'subscription'}
        >
          {capacity ? <svg
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
          </svg> : <><Gauge size={15} aria-hidden="true" /><span className="ds-composer-subscription-trigger-label">{t('subscriptionQuota.button')}</span></>}
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

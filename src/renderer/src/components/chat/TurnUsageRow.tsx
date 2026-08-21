import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { TurnUsageSummary } from '../../hooks/use-turn-usage'
import {
  formatProviderLocalCostAmount,
  formatProviderLocalCostCount
} from '../provider-local-cost-summary'
import { TurnUsageDetailsCard } from './TurnUsageDetailsCard'
import { formatTurnActualCost } from './turn-usage-format'
import {
  calculateTurnUsagePopoverPlacement,
  currentTurnUsageBodyZoom,
  type TurnUsagePopoverPlacement
} from './turn-usage-popover-placement'

const OPEN_DELAY_MS = 120
const CLOSE_DELAY_MS = 150
const ESTIMATED_DETAILS_HEIGHT = 420

export function TurnUsageRow({
  usage,
  stale = false
}: {
  usage: TurnUsageSummary
  stale?: boolean
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const locale = i18n.resolvedLanguage ?? i18n.language
  const triggerRef = useRef<HTMLButtonElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppressNextFocusRef = useRef(false)
  const [visible, setVisible] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [placement, setPlacement] = useState<TurnUsagePopoverPlacement | null>(null)
  const hasReference = usage.referenceEstimateUsd !== null &&
    usage.estimateCoverage !== 'unavailable'
  const unavailable = usage.actualCost === null && !hasReference
  const detailsId = `turn-usage-details-${usage.turnId}`

  const clearOpenTimer = useCallback((): void => {
    if (openTimerRef.current) clearTimeout(openTimerRef.current)
    openTimerRef.current = null
  }, [])
  const clearCloseTimer = useCallback((): void => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }, [])
  const showSoon = useCallback((immediate = false): void => {
    clearCloseTimer()
    clearOpenTimer()
    if (immediate) {
      setVisible(true)
      return
    }
    openTimerRef.current = setTimeout(() => setVisible(true), OPEN_DELAY_MS)
  }, [clearCloseTimer, clearOpenTimer])
  const hideSoon = useCallback((): void => {
    clearOpenTimer()
    clearCloseTimer()
    if (pinned) return
    closeTimerRef.current = setTimeout(() => setVisible(false), CLOSE_DELAY_MS)
  }, [clearCloseTimer, clearOpenTimer, pinned])
  const dismiss = useCallback((restoreFocus = false): void => {
    clearOpenTimer()
    clearCloseTimer()
    setPinned(false)
    setVisible(false)
    if (restoreFocus && triggerRef.current && document.activeElement !== triggerRef.current) {
      suppressNextFocusRef.current = true
      triggerRef.current.focus()
    }
  }, [clearCloseTimer, clearOpenTimer])

  const updatePlacement = useCallback((): void => {
    const trigger = triggerRef.current
    if (!trigger || typeof window === 'undefined') return
    setPlacement(calculateTurnUsagePopoverPlacement({
      anchorRect: trigger.getBoundingClientRect(),
      contentHeight: cardRef.current?.scrollHeight ?? ESTIMATED_DETAILS_HEIGHT,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      coordinateScale: currentTurnUsageBodyZoom()
    }))
  }, [])

  useEffect(() => () => {
    clearOpenTimer()
    clearCloseTimer()
  }, [clearCloseTimer, clearOpenTimer])

  useEffect(() => {
    if (!visible) {
      setPlacement(null)
      return
    }
    const frame = window.requestAnimationFrame(updatePlacement)
    window.addEventListener('resize', updatePlacement)
    window.addEventListener('scroll', updatePlacement, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updatePlacement)
      window.removeEventListener('scroll', updatePlacement, true)
    }
  }, [updatePlacement, visible])

  useEffect(() => {
    if (!visible) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') dismiss(true)
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (!pinned) return
      const target = event.target as Node | null
      if (target && !triggerRef.current?.contains(target) && !cardRef.current?.contains(target)) {
        dismiss()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [dismiss, pinned, visible])

  const togglePinned = (): void => {
    if (pinned) {
      dismiss()
      return
    }
    clearOpenTimer()
    clearCloseTimer()
    setPinned(true)
    setVisible(true)
  }

  const popoverStyle: CSSProperties = placement
    ? {
        left: placement.left,
        top: placement.top,
        width: placement.width,
        maxHeight: placement.maxHeight
      }
    : { left: 0, top: 0, width: 352, visibility: 'hidden' }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="turn-usage-row ds-no-drag self-start cursor-help rounded-md border-0 bg-transparent px-1 py-0.5 text-left text-[11.5px] text-ds-faint outline-none transition hover:bg-ds-hover/70 focus-visible:bg-ds-hover focus-visible:ring-2 focus-visible:ring-accent/25"
        data-turn-usage={usage.turnId}
        data-estimate-coverage={usage.estimateCoverage}
        data-stale={stale ? 'true' : 'false'}
        data-pinned={pinned ? 'true' : 'false'}
        aria-expanded={visible}
        aria-controls={detailsId}
        aria-label={t('turnUsageDetailsOpenLabel')}
        onPointerEnter={() => showSoon()}
        onPointerLeave={hideSoon}
        onFocus={() => {
          if (suppressNextFocusRef.current) {
            suppressNextFocusRef.current = false
            return
          }
          showSoon(true)
        }}
        onBlur={hideSoon}
        onClick={togglePinned}
      >
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="whitespace-nowrap tabular-nums">
            {t('sessionUsageFooterTokens', {
              tokens: formatProviderLocalCostCount(usage.totalTokens, locale)
            })}
          </span>
          {usage.actualCost ? (
            <span className="whitespace-nowrap tabular-nums text-ds-muted" data-turn-usage-actual-cost>
              {t('sessionUsageFooterActualCost', {
                value: formatTurnActualCost(usage.actualCost, locale)
              })}
            </span>
          ) : null}
          {hasReference ? (
            <span className="whitespace-nowrap tabular-nums text-ds-muted" data-turn-usage-reference-estimate>
              {t('sessionUsageFooterEstimate', {
                value: formatProviderLocalCostAmount(usage.referenceEstimateUsd as number, locale)
              })}
            </span>
          ) : null}
          {usage.estimateCoverage === 'partial' && hasReference ? (
            <span className="rounded-full border border-amber-500/30 px-1.5 text-[10.5px] text-amber-700 dark:text-amber-300" data-turn-usage-partial>
              {t('turnUsageEstimatePartial')}
            </span>
          ) : null}
          {unavailable ? <span className="whitespace-nowrap" data-turn-usage-unavailable>{t('sessionUsagePriceUnavailable')}</span> : null}
          {stale ? <span className="whitespace-nowrap" data-turn-usage-stale>{t('turnUsageStale')}</span> : null}
        </span>
      </button>
      {visible && typeof document !== 'undefined' ? createPortal(
        <div
          ref={cardRef}
          id={detailsId}
          role="tooltip"
          className="ds-no-drag fixed z-[12000] overflow-y-auto overscroll-contain rounded-xl border border-ds-border bg-ds-card shadow-[0_18px_50px_rgba(20,30,55,0.22)]"
          style={popoverStyle}
          data-turn-usage-details={usage.turnId}
          onPointerEnter={() => {
            clearCloseTimer()
            showSoon(true)
          }}
          onPointerLeave={hideSoon}
        >
          <TurnUsageDetailsCard usage={usage} stale={stale} />
        </div>,
        document.body
      ) : null}
    </>
  )
}

export { formatTurnActualCost } from './turn-usage-format'

import { formatRuntimeError } from '../../lib/format-runtime-error'
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement
} from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getProvider } from '../../agent/registry'
import type { ChatBlock, RuntimeChildActivity } from '../../agent/types'
import { threadSnapshotLooksRunning } from '../../store/chat-store-runtime-helpers'
import {
  calculateComposerPopoverPlacement,
  currentComposerBodyZoom,
  type ComposerPopoverPlacement
} from './floating-composer-popover-placement'
import { ExplorePeekBody } from './explore-peek-body'
import {
  formatChildActivityLabel,
  summarizeExplorePeekBlocks,
  type ExplorePeekStep
} from './explore-peek-summary'

export { ExplorePeekBody } from './explore-peek-body'

const PEEK_POPOVER_WIDTH = 420
const PEEK_POPOVER_MAX_HEIGHT = 360
const PEEK_POPOVER_ESTIMATED_HEIGHT = 280
const PEEK_POLL_MS = 1_200

export type ExplorePeekPopoverProps = {
  open: boolean
  anchorEl: HTMLElement | null
  childId: string
  title: string
  elapsedLabel: string
  statusLabel: string
  activity?: RuntimeChildActivity
  summary?: string
  onClose: () => void
  onOpenChildThread?: (threadId: string) => void
}

export function ExplorePeekPopover({
  open,
  anchorEl,
  childId,
  title,
  elapsedLabel,
  statusLabel,
  activity,
  summary,
  onClose,
  onOpenChildThread
}: ExplorePeekPopoverProps): ReactElement | null {
  const { t } = useTranslation('common')
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const [placement, setPlacement] = useState<ComposerPopoverPlacement | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [steps, setSteps] = useState<ExplorePeekStep[]>([])
  const [reasoningPreview, setReasoningPreview] = useState<string | undefined>()
  const [assistantPreview, setAssistantPreview] = useState<string | undefined>()

  useEffect(() => {
    if (!open || !childId) {
      setSteps([])
      setReasoningPreview(undefined)
      setAssistantPreview(undefined)
      setError(null)
      setLoading(false)
      return
    }
    let cancelled = false
    let pollTimer: number | null = null
    setLoading(true)
    setError(null)

    const load = async (): Promise<void> => {
      try {
        const detail = await getProvider().getThreadDetail(childId)
        if (cancelled) return
        const peek = summarizeExplorePeekBlocks(detail.blocks as ChatBlock[])
        setSteps(peek.steps)
        setReasoningPreview(peek.reasoningPreview)
        setAssistantPreview(peek.assistantPreview)
        setError(null)
        if (threadSnapshotLooksRunning(detail.blocks, detail.threadStatus)) {
          pollTimer = window.setTimeout(() => {
            void load()
          }, PEEK_POLL_MS)
        }
      } catch (err) {
        if (!cancelled) {
          setError(formatRuntimeError(err))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
      if (pollTimer !== null) window.clearTimeout(pollTimer)
    }
  }, [open, childId])

  useEffect(() => {
    if (!open || !anchorEl || typeof window === 'undefined') {
      setPlacement(null)
      return
    }
    const updatePlacement = (): void => {
      setPlacement(calculateComposerPopoverPlacement({
        anchorRect: anchorEl.getBoundingClientRect(),
        popoverHeight: popoverRef.current?.offsetHeight ?? PEEK_POPOVER_ESTIMATED_HEIGHT,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        coordinateScale: currentComposerBodyZoom(),
        preferredWidth: PEEK_POPOVER_WIDTH,
        maximumHeight: PEEK_POPOVER_MAX_HEIGHT
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
  }, [open, anchorEl, steps.length, loading, error, reasoningPreview, assistantPreview])

  useEffect(() => {
    if (!open || typeof window === 'undefined') return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (anchorEl?.contains(target) || popoverRef.current?.contains(target)) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, anchorEl, onClose])

  if (!open || typeof document === 'undefined') return null

  const activityLabel = formatChildActivityLabel(activity)
  const style: CSSProperties | undefined = placement
    ? {
        position: 'fixed',
        left: placement.left,
        top: placement.top,
        width: placement.width,
        maxHeight: placement.maxHeight,
        zIndex: 80
      }
    : {
        position: 'fixed',
        left: -9999,
        top: -9999,
        width: PEEK_POPOVER_WIDTH,
        maxHeight: PEEK_POPOVER_MAX_HEIGHT,
        zIndex: 80,
        visibility: 'hidden'
      }

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={t('explorePeekTitle', { defaultValue: 'Explore progress' })}
      data-testid="explore-peek-popover"
      style={style}
      className="flex flex-col overflow-hidden rounded-[16px] border border-ds-border bg-ds-card/95 shadow-[0_18px_48px_rgba(60,76,110,0.18)] backdrop-blur-xl"
    >
      <div className="flex items-start gap-2 border-b border-ds-border-muted px-3.5 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold text-ds-ink" title={title}>
            {title}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-ds-muted">
            <span>{statusLabel}</span>
            <span className="tabular-nums">{elapsedLabel}</span>
          </div>
          {activityLabel ? (
            <div className="mt-1 truncate text-[12px] text-accent" title={activityLabel}>
              {activityLabel}
            </div>
          ) : null}
        </div>
        {childId ? (
          <button
            type="button"
            onClick={() => onOpenChildThread?.(childId)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ds-faint transition hover:bg-accent/10 hover:text-accent"
            aria-label={t('subagentOpenSession')}
            title={t('subagentOpenSession')}
          >
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
          aria-label={t('explorePeekClose', { defaultValue: 'Close' })}
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>

      <ExplorePeekBody
        loading={loading}
        error={error}
        summary={summary}
        reasoningPreview={reasoningPreview}
        assistantPreview={assistantPreview}
        steps={steps}
      />
    </div>,
    document.body
  )
}

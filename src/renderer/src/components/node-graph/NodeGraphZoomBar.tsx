import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock, LockOpen, Minus, Plus } from 'lucide-react'

type Props = {
  scale: number
  paused: boolean
  onZoom: (factor: number) => void
  onResetZoom: () => void
  onTogglePaused: () => void
}

/**
 * Zoom readout with a lock for the layout.
 *
 * The percentage is not decoration: the text-fade threshold and the edge-label
 * cutoff are both zoom-dependent, so knowing the current zoom explains why
 * labels came or went. Clicking it returns to 100%.
 */
export function NodeGraphZoomBar({
  scale,
  paused,
  onZoom,
  onResetZoom,
  onTogglePaused
}: Props): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="ds-no-drag flex items-center gap-0.5 rounded-pill border border-ds-border-muted bg-ds-card/85 p-0.5 shadow-panel backdrop-blur">
      <button
        type="button"
        onClick={() => onZoom(1 / 1.25)}
        title={t('nodeGraphZoomOut')}
        aria-label={t('nodeGraphZoomOut')}
        className="rounded-pill p-1.5 text-ds-muted transition-colors hover:bg-ds-hover hover:text-ds-ink"
      >
        <Minus className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={onResetZoom}
        title={t('nodeGraphZoomReset')}
        className="min-w-[3.5rem] rounded-pill px-1 py-1 text-center text-[12px] tabular-nums text-ds-ink transition-colors hover:bg-ds-hover"
      >
        {Math.round(scale * 100)}%
      </button>
      <button
        type="button"
        onClick={() => onZoom(1.25)}
        title={t('nodeGraphZoomIn')}
        aria-label={t('nodeGraphZoomIn')}
        className="rounded-pill p-1.5 text-ds-muted transition-colors hover:bg-ds-hover hover:text-ds-ink"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
      <span aria-hidden className="mx-0.5 h-4 w-px bg-ds-border-muted" />
      <button
        type="button"
        onClick={onTogglePaused}
        aria-pressed={paused}
        title={paused ? t('nodeGraphResume') : t('nodeGraphFreeze')}
        aria-label={paused ? t('nodeGraphResume') : t('nodeGraphFreeze')}
        className={`rounded-pill p-1.5 transition-colors hover:bg-ds-hover ${
          paused ? 'text-accent' : 'text-ds-muted hover:text-ds-ink'
        }`}
      >
        {paused
          ? <Lock className="h-3.5 w-3.5" strokeWidth={1.9} />
          : <LockOpen className="h-3.5 w-3.5" strokeWidth={1.9} />}
      </button>
    </div>
  )
}

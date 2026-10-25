import { ChevronDown, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react'
import type { ViewerZoomLevel } from '@extend-ai/react-pptx'
import type { ReactElement, ReactNode } from 'react'
import i18n from '../i18n'

const ZOOM_MODES = ['fit-page', 'fit-width', 'automatic'] as const
const ZOOM_PERCENTS = [25, 50, 75, 100, 125, 150, 200, 300] as const
export const OFFICE_MIN_ZOOM_PERCENT = ZOOM_PERCENTS[0]
export const OFFICE_MAX_ZOOM_PERCENT = ZOOM_PERCENTS[ZOOM_PERCENTS.length - 1]

/** The next preset above or below the zoom the document currently resolves to. */
export function steppedOfficeZoom(resolvedPercent: number, direction: 1 | -1): number {
  const current = Number.isFinite(resolvedPercent) ? resolvedPercent : 100
  if (direction > 0) {
    return ZOOM_PERCENTS.find((value) => value > current + 0.5) ?? OFFICE_MAX_ZOOM_PERCENT
  }
  return [...ZOOM_PERCENTS].reverse().find((value) => value < current - 0.5) ?? OFFICE_MIN_ZOOM_PERCENT
}

function zoomOptionLabel(level: ViewerZoomLevel): string {
  if (level === 'fit-page') return i18n.t('officeZoomFitPage')
  if (level === 'fit-width') return i18n.t('officeZoomFitWidth')
  if (level === 'automatic') return i18n.t('officeZoomAutomatic')
  return `${Math.round(level)}%`
}

export const OFFICE_ICON_BUTTON =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:pointer-events-none disabled:opacity-35'

/** One row above a document: navigation on the left, status in the middle, zoom and actions on the right. */
export function WorkspaceOfficeToolbar({
  leading,
  status,
  trailing
}: {
  leading?: ReactNode
  status?: ReactNode
  trailing?: ReactNode
}): ReactElement {
  return (
    <div
      data-document-toolbar
      className="kun-office-toolbar flex h-10 shrink-0 items-center gap-1 border-b border-ds-border-muted bg-ds-card px-2 text-[12px] text-ds-muted"
    >
      <div className="flex min-w-0 items-center gap-0.5">{leading}</div>
      <div className="min-w-0 flex-1 truncate px-1 text-right text-[11.5px]">{status}</div>
      <div className="flex shrink-0 items-center gap-0.5">{trailing}</div>
    </div>
  )
}

/** Refresh and failure text shown in the middle of the toolbar. */
export function OfficeToolbarStatus({
  loading,
  message
}: {
  loading: boolean
  message?: string | null
}): ReactElement {
  return (
    <>
      {loading ? <span data-office-preview-state="refreshing">{i18n.t('officePreviewUpdating')}</span> : null}
      {message ? <span className="text-red-700 dark:text-red-300">{message}</span> : null}
    </>
  )
}

/** Previous / "Slide 3 of 9" / next. */
export function OfficePageNav({
  summary,
  prevLabel,
  nextLabel,
  canPrev,
  canNext,
  onPrev,
  onNext
}: {
  summary: string
  prevLabel: string
  nextLabel: string
  canPrev: boolean
  canNext: boolean
  onPrev: () => void
  onNext: () => void
}): ReactElement {
  return (
    <>
      <button type="button" aria-label={prevLabel} title={prevLabel} disabled={!canPrev} className={OFFICE_ICON_BUTTON} onClick={onPrev}>
        <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
      </button>
      <span aria-live="polite" aria-label={summary} className="min-w-0 truncate px-0.5 text-[12.5px] tabular-nums text-ds-ink">
        {summary}
      </span>
      <button type="button" aria-label={nextLabel} title={nextLabel} disabled={!canNext} className={OFFICE_ICON_BUTTON} onClick={onNext}>
        <ChevronRight className="h-4 w-4" strokeWidth={1.8} />
      </button>
    </>
  )
}

/** Zoom out / fit-or-percentage menu / zoom in, for viewers with responsive zoom modes. */
export function OfficeZoomLevelControls({
  zoom,
  resolvedZoom,
  disabled = false,
  onChange
}: {
  zoom: ViewerZoomLevel
  resolvedZoom: number
  disabled?: boolean
  onChange: (zoom: ViewerZoomLevel) => void
}): ReactElement {
  const customLevel = typeof zoom === 'number' && !ZOOM_PERCENTS.some((value) => value === zoom)
    ? [Math.round(zoom)]
    : []
  return (
    <>
      <button
        type="button"
        aria-label={i18n.t('officeZoomOut')}
        title={i18n.t('officeZoomOut')}
        disabled={disabled || resolvedZoom <= OFFICE_MIN_ZOOM_PERCENT + 0.5}
        className={OFFICE_ICON_BUTTON}
        onClick={() => onChange(steppedOfficeZoom(resolvedZoom, -1))}
      >
        <ZoomOut className="h-4 w-4" strokeWidth={1.8} />
      </button>
      <label className="relative inline-flex items-center">
        <span className="sr-only">{i18n.t('officeZoomLevel')}</span>
        <select
          value={String(zoom)}
          disabled={disabled}
          onChange={(event) => {
            const value = event.target.value
            onChange(Number.isNaN(Number(value)) ? value as ViewerZoomLevel : Number(value))
          }}
          className="h-7 min-w-[5.75rem] cursor-pointer appearance-none rounded-md border border-ds-border-muted bg-ds-card pl-2.5 pr-6 text-[12px] text-ds-ink outline-none transition hover:bg-ds-hover focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-40"
        >
          {[...ZOOM_MODES, ...customLevel, ...ZOOM_PERCENTS].map((level) => (
            <option key={String(level)} value={String(level)}>{zoomOptionLabel(level)}</option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-1.5 h-3.5 w-3.5 text-ds-faint" strokeWidth={1.8} />
      </label>
      <button
        type="button"
        aria-label={i18n.t('officeZoomIn')}
        title={i18n.t('officeZoomIn')}
        disabled={disabled || resolvedZoom >= OFFICE_MAX_ZOOM_PERCENT - 0.5}
        className={OFFICE_ICON_BUTTON}
        onClick={() => onChange(steppedOfficeZoom(resolvedZoom, 1))}
      >
        <ZoomIn className="h-4 w-4" strokeWidth={1.8} />
      </button>
    </>
  )
}

/** Zoom out / current percentage (click to reset) / zoom in, for viewers that only scale. */
export function OfficeZoomStepper({
  percent,
  canZoomIn,
  canZoomOut,
  disabled = false,
  onZoomIn,
  onZoomOut,
  onReset
}: {
  percent: number
  canZoomIn: boolean
  canZoomOut: boolean
  disabled?: boolean
  onZoomIn: () => void
  onZoomOut: () => void
  onReset: () => void
}): ReactElement {
  return (
    <>
      <button type="button" aria-label={i18n.t('officeZoomOut')} title={i18n.t('officeZoomOut')} disabled={disabled || !canZoomOut} className={OFFICE_ICON_BUTTON} onClick={onZoomOut}>
        <ZoomOut className="h-4 w-4" strokeWidth={1.8} />
      </button>
      <button
        type="button"
        aria-label={i18n.t('officeResetZoom')}
        title={i18n.t('officeResetZoom')}
        disabled={disabled}
        className="h-7 min-w-[3.25rem] rounded-md px-1.5 text-[12px] tabular-nums text-ds-ink transition hover:bg-ds-hover disabled:opacity-40"
        onClick={onReset}
      >
        {Math.round(percent)}%
      </button>
      <button type="button" aria-label={i18n.t('officeZoomIn')} title={i18n.t('officeZoomIn')} disabled={disabled || !canZoomIn} className={OFFICE_ICON_BUTTON} onClick={onZoomIn}>
        <ZoomIn className="h-4 w-4" strokeWidth={1.8} />
      </button>
    </>
  )
}

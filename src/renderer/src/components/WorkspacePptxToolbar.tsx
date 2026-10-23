import { ChevronDown, ChevronLeft, ChevronRight, Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
import type { ViewerZoomLevel } from '@extend-ai/react-pptx'
import type { ReactElement } from 'react'
import type { WorkspaceOfficePreviewSuccess } from '@shared/office-document'
import i18n from '../i18n'

const ZOOM_MODES = ['fit-page', 'fit-width', 'automatic'] as const
const ZOOM_PERCENTS = [25, 50, 75, 100, 125, 150, 200, 300] as const
export const PPTX_MIN_ZOOM_PERCENT = ZOOM_PERCENTS[0]
export const PPTX_MAX_ZOOM_PERCENT = ZOOM_PERCENTS[ZOOM_PERCENTS.length - 1]

/** The next preset above or below the zoom the deck currently resolves to. */
export function steppedPptxZoom(resolvedPercent: number, direction: 1 | -1): number {
  const current = Number.isFinite(resolvedPercent) ? resolvedPercent : 100
  if (direction > 0) {
    return ZOOM_PERCENTS.find((value) => value > current + 0.5) ?? PPTX_MAX_ZOOM_PERCENT
  }
  return [...ZOOM_PERCENTS].reverse().find((value) => value < current - 0.5) ?? PPTX_MIN_ZOOM_PERCENT
}

function zoomOptionLabel(level: ViewerZoomLevel): string {
  if (level === 'fit-page') return i18n.t('officeZoomFitPage')
  if (level === 'fit-width') return i18n.t('officeZoomFitWidth')
  if (level === 'automatic') return i18n.t('officeZoomAutomatic')
  return `${Math.round(level)}%`
}

const iconButton =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:pointer-events-none disabled:opacity-35'

export function WorkspacePptxToolbar({
  result,
  slide,
  slideCount,
  zoom,
  resolvedZoom,
  loading,
  status,
  onSelectSlide,
  onZoomChange,
  onEnterFullscreen
}: {
  result: WorkspaceOfficePreviewSuccess
  slide: number
  slideCount: number
  zoom: ViewerZoomLevel
  resolvedZoom: number
  loading: boolean
  status?: string | null
  onSelectSlide: (slide: number) => void
  onZoomChange: (zoom: ViewerZoomLevel) => void
  onEnterFullscreen: () => void
}): ReactElement {
  const summary = i18n.t('officeSlideSummary', { slide, count: slideCount })
  const numericZoom = typeof zoom === 'number' && !ZOOM_PERCENTS.some((value) => value === zoom)
    ? [Math.round(zoom)]
    : []
  return (
    <div
      data-document-toolbar
      className="kun-pptx-toolbar flex h-10 shrink-0 items-center gap-1 border-b border-ds-border-muted bg-ds-card px-2 text-[12px] text-ds-muted"
    >
      <div className="flex min-w-0 items-center gap-0.5">
        <button
          type="button"
          aria-label={i18n.t('officePreviousSlide')}
          title={i18n.t('officePreviousSlide')}
          disabled={slide <= 1}
          className={iconButton}
          onClick={() => onSelectSlide(slide - 1)}
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
        </button>
        <span
          aria-live="polite"
          aria-label={summary}
          className="min-w-0 truncate px-0.5 text-[12.5px] tabular-nums text-ds-ink"
        >
          {summary}
        </span>
        <button
          type="button"
          aria-label={i18n.t('officeNextSlide')}
          title={i18n.t('officeNextSlide')}
          disabled={slide >= slideCount}
          className={iconButton}
          onClick={() => onSelectSlide(slide + 1)}
        >
          <ChevronRight className="h-4 w-4" strokeWidth={1.8} />
        </button>
        {result.convertedFromLegacy ? (
          <span className="ml-1 shrink-0 rounded border border-ds-border-muted px-1.5 py-0.5 text-[10.5px] font-semibold uppercase text-ds-faint">
            {result.sourceFormat} → {result.renderFormat}
          </span>
        ) : null}
      </div>
      <div className="min-w-0 flex-1 truncate px-1 text-right text-[11.5px]">
        {loading ? <span data-office-preview-state="refreshing">{i18n.t('officePreviewUpdating')}</span> : null}
        {status ? <span className="text-red-700 dark:text-red-300">{status}</span> : null}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          aria-label={i18n.t('officeZoomOut')}
          title={i18n.t('officeZoomOut')}
          disabled={resolvedZoom <= PPTX_MIN_ZOOM_PERCENT + 0.5}
          className={iconButton}
          onClick={() => onZoomChange(steppedPptxZoom(resolvedZoom, -1))}
        >
          <ZoomOut className="h-4 w-4" strokeWidth={1.8} />
        </button>
        <label className="relative inline-flex items-center">
          <span className="sr-only">{i18n.t('officeZoomLevel')}</span>
          <select
            value={String(zoom)}
            onChange={(event) => {
              const value = event.target.value
              onZoomChange(Number.isNaN(Number(value)) ? value as ViewerZoomLevel : Number(value))
            }}
            className="h-7 min-w-[5.75rem] cursor-pointer appearance-none rounded-md border border-ds-border-muted bg-ds-card pl-2.5 pr-6 text-[12px] text-ds-ink outline-none transition hover:bg-ds-hover focus-visible:ring-2 focus-visible:ring-accent/30"
          >
            {[...ZOOM_MODES, ...numericZoom, ...ZOOM_PERCENTS].map((level) => (
              <option key={String(level)} value={String(level)}>{zoomOptionLabel(level)}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-1.5 h-3.5 w-3.5 text-ds-faint" strokeWidth={1.8} />
        </label>
        <button
          type="button"
          aria-label={i18n.t('officeZoomIn')}
          title={i18n.t('officeZoomIn')}
          disabled={resolvedZoom >= PPTX_MAX_ZOOM_PERCENT - 0.5}
          className={iconButton}
          onClick={() => onZoomChange(steppedPptxZoom(resolvedZoom, 1))}
        >
          <ZoomIn className="h-4 w-4" strokeWidth={1.8} />
        </button>
        <span aria-hidden className="mx-1 h-4 w-px bg-ds-border-muted" />
        <button
          type="button"
          aria-label={i18n.t('officeEnterFullscreen')}
          title={i18n.t('officeEnterFullscreen')}
          disabled={slideCount === 0}
          className={iconButton}
          onClick={onEnterFullscreen}
        >
          <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      </div>
    </div>
  )
}

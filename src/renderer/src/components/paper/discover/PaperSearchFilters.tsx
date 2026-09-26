import type { ReactElement } from 'react'
import { CheckSquare, Loader2, Quote, Send, Square, SquareCheckBig } from 'lucide-react'
import type {
  PaperSearchHit,
  PaperSearchResponse,
  PaperSearchSource
} from '@shared/paper/paper-search'

export type Translate = (key: string, opts?: Record<string, unknown>) => string

/** Client-side result filters (plan P5): applied to the returned hit list. */
export type PaperSearchFilters = {
  hasPdf: boolean
  venueOnly: boolean
  minCitations: number
  /** Non-empty subset restricts hits to these sources; empty = no filter. */
  sources: PaperSearchSource[]
}

export const EMPTY_PAPER_SEARCH_FILTERS: PaperSearchFilters = {
  hasPdf: false,
  venueOnly: false,
  minCitations: 0,
  sources: []
}

export function applyPaperSearchFilters(
  hits: PaperSearchHit[],
  filters: PaperSearchFilters
): PaperSearchHit[] {
  return hits.filter((hit) => {
    if (filters.hasPdf && !hit.pdfUrl) return false
    if (filters.venueOnly && !hit.sources.includes('venues')) return false
    if (filters.minCitations > 0 && (hit.citations ?? 0) < filters.minCitations) return false
    if (filters.sources.length && !hit.sources.some((s) => filters.sources.includes(s))) return false
    return true
  })
}

/** Filter chips + per-source status with click-to-retry (plan P5 errors). */
export function PaperSearchFilterBar({
  result,
  filters,
  onFilters,
  sourcesAvailable,
  onRetrySource,
  t
}: {
  result: PaperSearchResponse
  filters: PaperSearchFilters
  onFilters: (filters: PaperSearchFilters) => void
  sourcesAvailable: PaperSearchSource[]
  onRetrySource: (source: PaperSearchSource) => void
  t: Translate
}): ReactElement {
  const counts = { '10': 10, '50': 50, '100': 100 }
  const toggleSource = (source: PaperSearchSource): void => {
    const next = filters.sources.includes(source)
      ? filters.sources.filter((value) => value !== source)
      : [...filters.sources, source]
    onFilters({ ...filters, sources: next })
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <FilterChip
        active={filters.hasPdf}
        label={t('writePaperSearchFilterHasPdf')}
        onClick={() => onFilters({ ...filters, hasPdf: !filters.hasPdf })}
      />
      <FilterChip
        active={filters.venueOnly}
        label={t('writePaperSearchFilterVenue')}
        onClick={() => onFilters({ ...filters, venueOnly: !filters.venueOnly })}
      />
      <span className="inline-flex items-center gap-1 rounded-md border border-ds-border-muted px-1.5 py-0.5 text-[11px] text-ds-muted">
        <Quote className="h-2.5 w-2.5" strokeWidth={1.8} />
        {t('writePaperSearchFilterMinCitations')}
        <select
          value={filters.minCitations}
          onChange={(event) =>
            onFilters({ ...filters, minCitations: Number(event.target.value) || 0 })
          }
          className="bg-transparent text-[11px] text-ds-ink outline-none"
        >
          <option value={0}>{t('writePaperSearchFilterAnyCount')}</option>
          {Object.values(counts).map((value) => (
            <option key={value} value={value}>
              ≥{value}
            </option>
          ))}
        </select>
      </span>
      <span className="mx-0.5 h-4 w-px bg-ds-border-muted" aria-hidden />
      {sourcesAvailable.map((source) => {
        const report = result.sources.find((row) => row.source === source)
        const failed = Boolean(report?.error)
        return (
          <button
            key={source}
            type="button"
            title={
              failed
                ? `${t('writePaperSearchSourceFailedTitle')}: ${report?.error} — ${t('writePaperSearchSourceRetryHint')}`
                : t(`writePaperSearchSource_${source}`)
            }
            aria-pressed={filters.sources.includes(source)}
            onClick={() => toggleSource(source)}
            onContextMenu={(event) => {
              event.preventDefault()
              if (failed) onRetrySource(source)
            }}
            className={`inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] transition ${
              failed
                ? 'border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/40'
                : filters.sources.includes(source)
                  ? 'border-transparent bg-[var(--ds-sidebar-row-active)] font-medium text-ds-ink'
                  : 'border-ds-border-muted text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
            }`}
          >
            {t(`writePaperSearchSource_${source}`)}
            {failed ? <span className="text-[9px]">!</span> : null}
          </button>
        )
      })}
    </div>
  )
}

function FilterChip({
  active,
  label,
  onClick
}: {
  active: boolean
  label: string
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`h-6 rounded-md border px-2 text-[11px] transition ${
        active
          ? 'border-transparent bg-[var(--ds-sidebar-row-active)] font-medium text-ds-ink'
          : 'border-ds-border-muted text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
      }`}
    >
      {label}
    </button>
  )
}

/** Bulk actions for the selected hits (plan P5): import / BibTeX / send. */
export function PaperSearchSelectionBar({
  total,
  selectedCount,
  importing,
  copied,
  onSelectAll,
  onImport,
  onCopyBibtex,
  onSend,
  canSend,
  t
}: {
  total: number
  selectedCount: number
  importing: boolean
  copied: boolean
  onSelectAll: () => void
  onImport: () => void
  onCopyBibtex: () => void
  onSend: () => void
  canSend: boolean
  t: Translate
}): ReactElement {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-ds-border-muted bg-ds-subtle/60 px-2 py-1.5">
      <button
        type="button"
        onClick={onSelectAll}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
      >
        {selectedCount === total && total > 0 ? (
          <CheckSquare className="h-3.5 w-3.5" strokeWidth={1.8} />
        ) : selectedCount ? (
          <SquareCheckBig className="h-3.5 w-3.5" strokeWidth={1.8} />
        ) : (
          <Square className="h-3.5 w-3.5" strokeWidth={1.8} />
        )}
        {t('writePaperSearchSelectAll')}
      </button>
      <span className="text-[11px] tabular-nums text-ds-faint">
        {t('writePaperSearchSelected', { count: selectedCount })}
      </span>
      <span className="flex-1" />
      <button
        type="button"
        onClick={onImport}
        disabled={!selectedCount || importing}
        className="inline-flex items-center gap-1 rounded-md bg-[var(--ds-control)] px-2 py-0.5 text-[11px] font-medium text-[var(--ds-control-foreground)] transition hover:opacity-90 disabled:opacity-50"
      >
        {importing ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        {t('writePaperReportImportSelected', { count: selectedCount })}
      </button>
      <button
        type="button"
        onClick={onCopyBibtex}
        disabled={!selectedCount}
        className="rounded-md border border-ds-border px-2 py-0.5 text-[11px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
      >
        {copied ? t('writePaperReportCopied') : t('writePaperReportCopyBibtex')}
      </button>
      {canSend ? (
        <button
          type="button"
          onClick={onSend}
          disabled={!selectedCount}
          title={t('writePaperReportSendHint')}
          className="inline-flex items-center gap-1 rounded-md border border-ds-border px-2 py-0.5 text-[11px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
        >
          <Send className="h-3 w-3" strokeWidth={1.8} />
          {t('writePaperReportSend')}
        </button>
      ) : null}
    </div>
  )
}

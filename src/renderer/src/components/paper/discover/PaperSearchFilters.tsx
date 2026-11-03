import type { ReactElement } from 'react'
import { Quote, Send, Sparkles } from 'lucide-react'
import type { ImportCandidate } from '../../../paper/paper-import-plan'
import { PaperImportAction } from '../import/PaperImportAction'
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

/** Filter chips + per-source counts; a failed source's chip retries it. */
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
            onClick={() => (failed ? onRetrySource(source) : toggleSource(source))}
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
            <span className="tabular-nums text-ds-faint">{failed ? t('writePaperSearchSourceFailed') : report?.count ?? 0}</span>
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

/**
 * Floating action bar for the selected hits: one import control (the shared
 * import sheet), BibTeX, send to the assistant and "hand these to the Agent
 * as seeds". Sticks to the bottom of the results while anything is selected.
 */
export function PaperSearchSelectionBar({
  scope,
  candidates,
  topic,
  copied,
  onClear,
  onCopyBibtex,
  onSend,
  canSend,
  onSeedAgent,
  t
}: {
  scope: string
  candidates: readonly ImportCandidate[]
  topic: string
  copied: boolean
  onClear: () => void
  onCopyBibtex: () => void
  onSend: () => void
  canSend: boolean
  onSeedAgent: () => void
  t: Translate
}): ReactElement {
  const ghost = 'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] text-white/85 transition hover:bg-white/10 hover:text-white'
  return (
    <div
      role="toolbar"
      aria-label={t('writePaperSearchSelected', { count: candidates.length })}
      className="sticky bottom-4 z-20 mx-auto mt-4 flex w-fit max-w-full flex-wrap items-center gap-1.5 rounded-2xl bg-[#20242d] py-2 pl-4 pr-2 text-white shadow-[0_16px_40px_rgba(15,23,42,0.28)]"
    >
      <button type="button" onClick={onClear} title={t('paperSearchClearSelection')} className="text-[12.5px] tabular-nums text-white/90 hover:text-white">
        {t('writePaperSearchSelected', { count: candidates.length })}
      </button>
      <span aria-hidden="true" className="mx-1 h-[18px] w-px bg-white/20" />
      <PaperImportAction scope={scope} candidates={candidates} topic={topic} onDark />
      <button type="button" onClick={onCopyBibtex} className={ghost}>
        <Quote className="h-3.5 w-3.5" strokeWidth={1.8} />
        {copied ? t('writePaperReportCopied') : 'BibTeX'}
      </button>
      {canSend ? (
        <button type="button" onClick={onSend} title={t('writePaperReportSendHint')} className={ghost}>
          <Send className="h-3.5 w-3.5" strokeWidth={1.8} />
          {t('writePaperReportSend')}
        </button>
      ) : null}
      <button type="button" onClick={onSeedAgent} title={t('paperSearchSeedAgentHint')} className={`${ghost} text-[#c7d0ff] hover:text-white`}>
        <Sparkles className="h-3.5 w-3.5" strokeWidth={1.8} />
        {t('paperSearchSeedAgent')}
      </button>
    </div>
  )
}

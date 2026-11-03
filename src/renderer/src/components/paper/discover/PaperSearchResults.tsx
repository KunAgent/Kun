import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { paperViewOwnsKeyEvent } from './paper-view-keys'
import { BookOpenText, FileText, GripVertical, Quote } from 'lucide-react'
import type {
  PaperSearchHit,
  PaperSearchResponse,
  PaperSearchSource
} from '@shared/paper/paper-search'
import type { PaperUnitMetaV2 } from '@shared/paper/paper-meta-v2'
import { generatePaperBibtex } from '@shared/paper/paper-bibtex'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { candidateFromSearchHit, useLibraryIndex } from '../../../paper/paper-import-candidates'
import { startPaperImportDrag, usePaperImportDrag } from '../../../paper/paper-import-drag'
import { findImportItem, usePaperImportJobs } from '../../../paper/paper-import-job'
import type { ImportCandidate } from '../../../paper/paper-import-plan'
import { selectionHas, usePaperImportSelection, usePaperSelectionRecords } from '../../../paper/paper-import-selection'
import { useChatStore } from '../../../store/chat-store'
import { ExpandableAbstract } from './PaperDiscoverParts'
import { PaperSearchDetailPane } from './PaperSearchDetailPane'
import {
  applyPaperSearchFilters,
  EMPTY_PAPER_SEARCH_FILTERS,
  PaperSearchFilterBar,
  PaperSearchSelectionBar,
  type PaperSearchFilters
} from './PaperSearchFilters'
import { PaperImportStatus } from '../import/PaperImportStatus'
import { PaperCheck } from '../import/PaperPickRow'

type Translate = (key: string, opts?: Record<string, unknown>) => string
type SortKey = 'relevance' | 'citations' | 'year'

const SORTS: SortKey[] = ['relevance', 'citations', 'year']

/** Selection / import scope of the quick-search page. */
export const QUICK_SEARCH_SCOPE = 'quick'

function sortHits(hits: PaperSearchHit[], key: SortKey): PaperSearchHit[] {
  if (key === 'relevance') return hits
  const value = (hit: PaperSearchHit): number => (key === 'citations' ? hit.citations ?? -1 : hit.year ?? 0)
  return [...hits].sort((a, b) => value(b) - value(a) || b.score - a.score)
}

/** Loose BibTeX projection of a merged hit (plan P5 export). */
function hitToBibtexMeta(hit: PaperSearchHit): PaperUnitMetaV2 {
  return {
    version: 2,
    slug: hit.key,
    title: hit.title,
    authors: hit.authors,
    abstract: hit.abstract,
    year: hit.year !== undefined ? String(hit.year) : undefined,
    venue: hit.venue,
    doi: hit.doi,
    arxivId: hit.arxivId,
    pdfUrl: hit.pdfUrl,
    sourceUrl: hit.url,
    importedAt: ''
  }
}

/** Line the assistant composer gets for a picked hit (plan P5 send). */
function hitSendText(hit: PaperSearchHit): string {
  const ids = [
    hit.arxivId ? `arXiv:${hit.arxivId}` : '',
    hit.doi ? `doi:${hit.doi}` : '',
    !hit.arxivId && !hit.doi && hit.url ? `url:${hit.url}` : ''
  ].filter(Boolean).join(' ')
  return `- ${hit.title}${ids ? ` (${ids})` : ''}${hit.year ? `, ${hit.year}` : ''}`
}

function openExternal(url: string): void {
  void window.kunGui?.openExternal?.(url)
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

export function PaperSearchResults({
  result,
  topic,
  onRetrySource,
  onSeedAgent,
  t
}: {
  result: PaperSearchResponse
  /** Search text; names the default import folder. */
  topic: string
  /** Re-run just one failed source and merge its hits back (plan P5 errors). */
  onRetrySource: (source: PaperSearchSource) => void
  /** Hand the selected hits to a new Agent research as seed papers. */
  onSeedAgent: (hits: PaperSearchHit[]) => void
  t: Translate
}): ReactElement {
  const composer = usePaperModeStore((s) => s.composerBridge)
  const index = useLibraryIndex()
  const records = usePaperSelectionRecords(QUICK_SEARCH_SCOPE)
  const job = usePaperImportJobs((s) => s.jobs[QUICK_SEARCH_SCOPE])
  const [sort, setSort] = useState<SortKey>('relevance')
  const [filters, setFilters] = useState<PaperSearchFilters>(EMPTY_PAPER_SEARCH_FILTERS)
  const [copied, setCopied] = useState(false)
  const [focusIndex, setFocusIndex] = useState(-1)
  const [detailKey, setDetailKey] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const hits = useMemo(
    () => sortHits(applyPaperSearchFilters(result.hits, filters), sort),
    [result.hits, filters, sort]
  )
  const candidates = useMemo(
    () => new Map(hits.map((hit) => [hit.key, candidateFromSearchHit(hit, index)])),
    [hits, index]
  )
  const sourcesAvailable = useMemo(
    () => [...new Set(result.sources.map((report) => report.source))],
    [result.sources]
  )
  const allFailed = result.sources.length > 0 && result.sources.every((report) => report.error)
  const failedSources = result.sources.filter((report) => report.error)

  useEffect(() => {
    usePaperImportSelection.getState().clear(QUICK_SEARCH_SCOPE)
    setFocusIndex(-1)
    setDetailKey(null)
  }, [result])

  const detailHit = hits.find((hit) => hit.key === detailKey) ?? null
  const candidateOf = (hit: PaperSearchHit): ImportCandidate => candidates.get(hit.key) ?? candidateFromSearchHit(hit, index)
  const selectedHits = hits.filter((hit) => selectionHas(records, candidateOf(hit).keys))
  const selectedCandidates = selectedHits.map(candidateOf)
  const locked = job?.running === true

  const toggle = useCallback((hit: PaperSearchHit): void => {
    const candidate = candidates.get(hit.key)
    if (candidate) usePaperImportSelection.getState().toggle(QUICK_SEARCH_SCOPE, candidate.keys)
  }, [candidates])

  const allState = selectedHits.length === 0 ? 'off' : selectedHits.length === hits.length ? 'on' : 'some'
  const toggleAll = (): void =>
    usePaperImportSelection.getState().setMany(
      QUICK_SEARCH_SCOPE,
      hits.map((hit) => candidateOf(hit).keys),
      allState !== 'on'
    )

  const copyBibtex = useCallback(async (): Promise<void> => {
    const text = generatePaperBibtex(selectedHits.map(hitToBibtexMeta))
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }, [selectedHits])

  const sendToAssistant = useCallback((): void => {
    if (!composer?.setInput || !selectedHits.length) return
    composer.setInput(
      [t('writePaperReportTitle'), '', ...selectedHits.map(hitSendText)].join('\n')
    )
  }, [composer, selectedHits, t])

  // Keyboard controls (plan P5): arrows move, Enter opens the detail pane,
  // `x` / Space toggles selection, Escape closes detail.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isEditableTarget(event.target) || !hits.length) return
      // The results sit in a document listener; only react while this view
      // owns the keyboard, never when a PDF or chat pane next to it does.
      if (!paperViewOwnsKeyEvent(listRef.current, event)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setFocusIndex((current) =>
          event.key === 'ArrowDown' ? Math.min(current + 1, hits.length - 1) : Math.max(current - 1, 0)
        )
        return
      }
      const focused = focusIndex >= 0 ? hits[focusIndex] : undefined
      if (event.key === 'Escape') {
        setDetailKey(null)
        setFocusIndex(-1)
      } else if (event.key === 'Enter' && focused) {
        event.preventDefault()
        setDetailKey((current) => (current === focused.key ? null : focused.key))
      } else if ((event.key === 'x' || event.key === ' ') && focused) {
        event.preventDefault()
        toggle(focused)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [hits, focusIndex, toggle])

  useEffect(() => {
    if (focusIndex < 0) return
    listRef.current
      ?.querySelector(`[data-hit-index="${focusIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [focusIndex])

  return (
    <div className="mt-4" ref={listRef}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pb-2.5">
        {hits.length ? (
          <PaperCheck state={allState} disabled={locked} onToggle={toggleAll} label={t('writePaperSearchSelectAll')} />
        ) : null}
        <span className="text-[12.5px] font-medium text-ds-ink">
          {t('writePaperSearchResultCount', { count: hits.length })}
          {hits.length !== result.hits.length
            ? ` ${t('writePaperSearchResultFiltered', { count: result.hits.length })}`
            : ''}
        </span>
        <div className="ml-auto flex h-7 items-center rounded-lg bg-ds-subtle p-0.5">
          {SORTS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setSort(key)}
              className={`inline-flex h-6 items-center rounded-md px-2 text-[12px] transition ${
                sort === key ? 'bg-ds-main font-medium text-ds-ink shadow-sm' : 'text-ds-muted hover:text-ds-ink'
              }`}
            >
              {t(`writePaperSearchSort_${key}`)}
            </button>
          ))}
        </div>
      </div>

      {allFailed ? (
        <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          {t('writePaperSearchAllFailed')}{' '}
          <button
            type="button"
            onClick={() => useChatStore.getState().openSettings('general')}
            className="font-medium underline underline-offset-2 hover:text-amber-900"
          >
            {t('writePaperSearchProxyHintLink')}
          </button>
        </p>
      ) : null}

      <PaperSearchFilterBar
        result={result}
        filters={filters}
        onFilters={setFilters}
        sourcesAvailable={sourcesAvailable}
        onRetrySource={onRetrySource}
        t={t}
      />

      <div className="mt-3 flex items-start gap-3">
        {hits.length ? (
          <ul className="min-w-0 flex-1 overflow-hidden rounded-2xl border border-ds-border-muted bg-ds-main">
            {hits.map((hit, position) => (
              <SearchHitRow
                key={hit.key}
                hit={hit}
                index={position}
                candidate={candidateOf(hit)}
                importState={findImportItem(job, candidateOf(hit).keys)}
                focused={position === focusIndex}
                checked={selectionHas(records, candidateOf(hit).keys)}
                locked={locked}
                detailOpen={detailKey === hit.key}
                onToggle={() => toggle(hit)}
                onFocus={() => setFocusIndex(position)}
                onOpenDetail={() => setDetailKey((current) => (current === hit.key ? null : hit.key))}
                dragCandidates={() => (selectedHits.some((chosen) => chosen.key === hit.key) ? selectedCandidates : [candidateOf(hit)])}
                t={t}
              />
            ))}
          </ul>
        ) : (
          <p className="flex-1 py-16 text-center text-[12.5px] text-ds-faint">
            {allFailed ? '' : t('writePaperSearchNoResults')}
          </p>
        )}
        {detailHit ? <PaperSearchDetailPane hit={detailHit} onClose={() => setDetailKey(null)} /> : null}
      </div>

      {failedSources.length && !allFailed ? (
        <p className="mt-3 text-[11px] text-ds-faint">
          {t('writePaperSearchPartialFailure', {
            sources: failedSources.map((row) => t(`writePaperSearchSource_${row.source}`)).join(', ')
          })}
        </p>
      ) : null}
      <p className="mt-2 text-[10.5px] text-ds-faint">{t('writePaperSearchKeyboardHint')}</p>

      {selectedHits.length ? (
        <PaperSearchSelectionBar
          scope={QUICK_SEARCH_SCOPE}
          candidates={selectedCandidates}
          topic={topic}
          copied={copied}
          onClear={() => usePaperImportSelection.getState().clear(QUICK_SEARCH_SCOPE)}
          onCopyBibtex={() => void copyBibtex()}
          onSend={sendToAssistant}
          canSend={Boolean(composer?.setInput)}
          onSeedAgent={() => onSeedAgent(selectedHits)}
          t={t}
        />
      ) : null}
    </div>
  )
}

function LinkChip({ label, url, icon }: { label: string; url: string; icon?: ReactElement }): ReactElement {
  return (
    <a
      href="#"
      onClick={(event) => {
        event.preventDefault()
        openExternal(url)
      }}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
    >
      {icon}
      {label}
    </a>
  )
}

function SearchHitRow({
  hit,
  index,
  candidate,
  importState,
  focused,
  checked,
  locked,
  detailOpen,
  onToggle,
  onFocus,
  onOpenDetail,
  dragCandidates,
  t
}: {
  hit: PaperSearchHit
  index: number
  candidate: ImportCandidate
  importState: ReturnType<typeof findImportItem>
  focused: boolean
  checked: boolean
  locked: boolean
  detailOpen: boolean
  onToggle: () => void
  onFocus: () => void
  onOpenDetail: () => void
  /** What a drag from this row carries: the selection, or just this paper. */
  dragCandidates: () => readonly ImportCandidate[]
  t: Translate
}): ReactElement {
  const rowRef = useRef<HTMLLIElement | null>(null)
  const authors = hit.authors.slice(0, 6).join(', ')
  const extraAuthors = hit.authors.length - 6
  const meta = [hit.year ? String(hit.year) : '', hit.venue ?? ''].filter(Boolean).join(' · ')
  return (
    <li
      ref={rowRef}
      data-hit-index={index}
      onMouseEnter={onFocus}
      className={`group/hit relative border-t border-ds-border-muted/70 px-4 py-3 transition first:border-t-0 ${
        checked ? 'bg-[var(--ds-accent-soft)]/50' : focused ? 'bg-ds-hover/60' : ''
      } ${detailOpen ? 'shadow-[inset_2px_0_0_var(--ds-accent)]' : ''}`}
    >
      <div className="flex items-start gap-3">
        <span
          draggable
          role="presentation"
          title={t('paperSearchDragHint')}
          onDragStart={(event) => {
            if (rowRef.current) event.dataTransfer.setDragImage(rowRef.current, 12, 12)
            startPaperImportDrag(event, dragCandidates(), QUICK_SEARCH_SCOPE)
          }}
          onDragEnd={() => usePaperImportDrag.getState().end()}
          className="absolute left-0.5 top-3.5 hidden h-5 w-3.5 cursor-grab items-center text-ds-faint group-hover/hit:flex"
        >
          <GripVertical className="h-3.5 w-3.5" strokeWidth={1.8} />
        </span>
        <span className="mt-1">
          <PaperCheck
            state={checked ? 'on' : 'off'}
            disabled={locked}
            onToggle={onToggle}
            label={`${t('writePaperSearchSelectHit')}: ${hit.title}`}
          />
        </span>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onOpenDetail}
            className="block w-full text-left text-[14px] font-semibold leading-5 text-ds-ink transition hover:text-accent"
          >
            {hit.title}
          </button>
          {authors ? (
            <p className="mt-0.5 truncate text-[12px] text-ds-muted" title={hit.authors.join(', ')}>
              {authors}
              {extraAuthors > 0 ? ` +${extraAuthors}` : ''}
              {meta ? <span className="text-ds-faint">{` · ${meta}`}</span> : null}
            </p>
          ) : meta ? (
            <p className="mt-0.5 truncate text-[11.5px] text-ds-faint" title={meta}>{meta}</p>
          ) : null}
          {hit.abstract ? <ExpandableAbstract text={hit.abstract} /> : null}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {hit.sources.map((source) => (
              <span key={source} className="rounded-full bg-ds-subtle px-2 py-px text-[11px] text-ds-muted">
                {t(`writePaperSearchSource_${source}`)}
              </span>
            ))}
            {typeof hit.citations === 'number' ? (
              <span className="inline-flex items-center gap-1 text-[11px] tabular-nums text-ds-faint" title={t('writePaperSearchCitations')}>
                <Quote className="h-3 w-3" strokeWidth={1.8} />
                {hit.citations}
              </span>
            ) : null}
            <PaperImportStatus scope={QUICK_SEARCH_SCOPE} item={importState} owned={candidate.owned} />
            <span className="flex-1" />
            <button
              type="button"
              onClick={onOpenDetail}
              className="rounded-md px-1.5 py-0.5 text-[11.5px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              {detailOpen ? t('writePaperDetailClose') : t('writePaperDetailOpen')}
            </button>
            {hit.arxivId ? (
              <LinkChip
                label={`arXiv ${hit.arxivId}`}
                url={`https://arxiv.org/abs/${hit.arxivId}`}
                icon={<BookOpenText className="h-3 w-3" strokeWidth={1.8} />}
              />
            ) : hit.url ? (
              <LinkChip
                label={t('writePaperVenuePaperPage')}
                url={hit.url}
                icon={<BookOpenText className="h-3 w-3" strokeWidth={1.8} />}
              />
            ) : null}
            {hit.doi ? <LinkChip label="DOI" url={`https://doi.org/${hit.doi}`} /> : null}
            {hit.pdfUrl ? (
              <LinkChip label="PDF" url={hit.pdfUrl} icon={<FileText className="h-3 w-3" strokeWidth={1.8} />} />
            ) : null}
          </div>
        </div>
      </div>
    </li>
  )
}

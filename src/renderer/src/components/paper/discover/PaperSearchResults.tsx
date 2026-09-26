import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  AlertCircle,
  BookOpenText,
  CheckSquare,
  FileText,
  Quote,
  Square
} from 'lucide-react'
import type {
  PaperSearchHit,
  PaperSearchResponse,
  PaperSearchSource
} from '@shared/paper/paper-search'
import type { PaperImportHintMeta } from '@shared/paper/paper-types'
import type { PaperUnitMetaV2 } from '@shared/paper/paper-meta-v2'
import { generatePaperBibtex } from '@shared/paper/paper-bibtex'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import { newPaperRequestId, usePaperStore } from '../../../write/paper/paper-store'
import { useChatStore } from '../../../store/chat-store'
import { ExpandableAbstract, ImportButton } from './PaperDiscoverParts'
import { PaperSearchDetailPane } from './PaperSearchDetailPane'
import {
  applyPaperSearchFilters,
  EMPTY_PAPER_SEARCH_FILTERS,
  PaperSearchFilterBar,
  PaperSearchSelectionBar,
  type PaperSearchFilters
} from './PaperSearchFilters'

type Translate = (key: string, opts?: Record<string, unknown>) => string
type SortKey = 'relevance' | 'citations' | 'year'

const SORTS: SortKey[] = ['relevance', 'citations', 'year']

function sortHits(hits: PaperSearchHit[], key: SortKey): PaperSearchHit[] {
  if (key === 'relevance') return hits
  const value = (hit: PaperSearchHit): number => (key === 'citations' ? hit.citations ?? -1 : hit.year ?? 0)
  return [...hits].sort((a, b) => value(b) - value(a) || b.score - a.score)
}

/** Import handle in order of reliability: arXiv (PDF always), venue id, DOI. */
function importInput(hit: PaperSearchHit): string | undefined {
  return hit.arxivId ?? hit.coolId ?? hit.doi
}

/** Prefetched card metadata for the import path (plan P3.2). */
function importMeta(hit: PaperSearchHit): PaperImportHintMeta {
  return {
    title: hit.title,
    authors: hit.authors,
    abstract: hit.abstract,
    year: hit.year !== undefined ? String(hit.year) : undefined,
    venue: hit.venue,
    doi: hit.doi,
    arxivId: hit.arxivId,
    coolId: hit.coolId,
    pdfUrl: hit.pdfUrl,
    sourceUrl: hit.url
  }
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
  workspaceRoot,
  onRetrySource,
  t
}: {
  result: PaperSearchResponse
  workspaceRoot: string
  /** Re-run just one failed source and merge its hits back (plan P5 errors). */
  onRetrySource: (source: PaperSearchSource) => void
  t: Translate
}): ReactElement {
  const composer = usePaperModeStore((s) => s.composerBridge)
  const refreshEntries = usePaperModeStore((s) => s.refreshEntries)
  const [sort, setSort] = useState<SortKey>('relevance')
  const [filters, setFilters] = useState<PaperSearchFilters>(EMPTY_PAPER_SEARCH_FILTERS)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [importing, setImporting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [focusIndex, setFocusIndex] = useState(-1)
  const [detailKey, setDetailKey] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const hits = useMemo(
    () => sortHits(applyPaperSearchFilters(result.hits, filters), sort),
    [result.hits, filters, sort]
  )
  const sourcesAvailable = useMemo(
    () => [...new Set(result.sources.map((report) => report.source))],
    [result.sources]
  )
  const allFailed = result.sources.length > 0 && result.sources.every((report) => report.error)
  const failedSources = result.sources.filter((report) => report.error)

  useEffect(() => {
    setSelected(new Set())
    setFocusIndex(-1)
    setDetailKey(null)
  }, [result])

  const detailHit = hits.find((hit) => hit.key === detailKey) ?? null
  const selectedHits = hits.filter((hit) => selected.has(hit.key))

  const toggle = useCallback((key: string): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const toggleAll = useCallback((): void => {
    setSelected((current) =>
      current.size === hits.length ? new Set() : new Set(hits.map((hit) => hit.key))
    )
  }, [hits])

  const importHits = useCallback(
    async (targets: PaperSearchHit[]): Promise<void> => {
      const items = targets
        .map((hit) => ({ input: importInput(hit), meta: importMeta(hit) }))
        .filter((item): item is { input: string; meta: PaperImportHintMeta } => Boolean(item.input))
      if (!items.length || typeof window.kunGui?.paperImportBatch !== 'function') return
      const paperReading = useWriteWorkspaceStore.getState().paperReading
      setImporting(true)
      try {
        const outcome = await window.kunGui.paperImportBatch({
          workspaceRoot,
          items,
          parentDir: paperReading.papersDir || 'papers',
          requestId: newPaperRequestId()
        })
        if (outcome.ok) {
          const imported = outcome.results.filter((row) => row.ok && !row.reused).length
          const reused = outcome.results.filter((row) => row.ok && row.reused).length
          const failed = outcome.results.filter((row) => !row.ok).length
          usePaperStore.getState().setNotice({
            tone: failed ? 'error' : 'info',
            message: t('writePaperReportImportDone', { imported, reused, failed })
          })
          refreshEntries()
        } else {
          usePaperStore.getState().setNotice({ tone: 'error', message: outcome.message })
        }
      } finally {
        setImporting(false)
      }
    },
    [workspaceRoot, refreshEntries, t]
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
  // `x` toggles selection, `i` imports the focused hit, Escape closes detail.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isEditableTarget(event.target) || !hits.length) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setFocusIndex((current) => {
          const next =
            event.key === 'ArrowDown'
              ? Math.min(current + 1, hits.length - 1)
              : Math.max(current - 1, 0)
          return next
        })
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
        toggle(focused.key)
      } else if ((event.key === 'i' || event.key === 'I') && focused) {
        event.preventDefault()
        void importHits([focused])
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [hits, focusIndex, toggle, importHits])

  useEffect(() => {
    if (focusIndex < 0) return
    listRef.current
      ?.querySelector(`[data-hit-index="${focusIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [focusIndex])

  return (
    <div className="mt-5" ref={listRef}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-ds-border-muted pb-2.5">
        <span className="text-[12.5px] font-medium text-ds-ink">
          {t('writePaperSearchResultCount', { count: hits.length })}
          {hits.length !== result.hits.length
            ? ` ${t('writePaperSearchResultFiltered', { count: result.hits.length })}`
            : ''}
        </span>
        <span className="flex flex-wrap items-center gap-1">
          {result.sources.map((report) => (
            <button
              key={report.source}
              type="button"
              title={
                report.error
                  ? `${report.error} — ${t('writePaperSearchSourceRetryHint')}`
                  : `${(report.ms / 1000).toFixed(1)}s`
              }
              onClick={() => (report.error ? onRetrySource(report.source) : undefined)}
              className={`inline-flex items-center gap-1 rounded px-1.5 py-px text-[11px] tabular-nums transition ${
                report.error
                  ? 'bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950 dark:text-red-300 dark:hover:bg-red-900'
                  : 'bg-ds-subtle text-ds-muted'
              }`}
            >
              {report.error ? <AlertCircle className="h-3 w-3" strokeWidth={2} /> : null}
              {t(`writePaperSearchSource_${report.source}`)}
              <span className="text-ds-faint">{report.error ? t('writePaperSearchSourceFailed') : report.count}</span>
            </button>
          ))}
        </span>
        <div className="ml-auto flex h-7 items-center rounded-md border border-ds-border-muted bg-ds-subtle p-0.5">
          {SORTS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setSort(key)}
              className={`inline-flex h-6 items-center rounded px-2 text-[12px] transition ${
                sort === key ? 'bg-ds-main font-medium text-ds-ink shadow-sm' : 'text-ds-muted hover:text-ds-ink'
              }`}
            >
              {t(`writePaperSearchSort_${key}`)}
            </button>
          ))}
        </div>
      </div>

      {allFailed ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
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

      {hits.length ? (
        <PaperSearchSelectionBar
          total={hits.length}
          selectedCount={selectedHits.length}
          importing={importing}
          copied={copied}
          onSelectAll={toggleAll}
          onImport={() => void importHits(selectedHits)}
          onCopyBibtex={() => void copyBibtex()}
          onSend={sendToAssistant}
          canSend={Boolean(composer?.setInput)}
          t={t}
        />
      ) : null}

      <div className={`mt-3 flex items-start gap-3 ${detailHit ? '' : ''}`}>
        {hits.length ? (
          <ul className="min-w-0 flex-1 space-y-2">
            {hits.map((hit, index) => (
              <SearchHitRow
                key={hit.key}
                hit={hit}
                index={index}
                focused={index === focusIndex}
                checked={selected.has(hit.key)}
                detailOpen={detailKey === hit.key}
                onToggle={() => toggle(hit.key)}
                onFocus={() => setFocusIndex(index)}
                onOpenDetail={() =>
                  setDetailKey((current) => (current === hit.key ? null : hit.key))
                }
                workspaceRoot={workspaceRoot}
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
  focused,
  checked,
  detailOpen,
  onToggle,
  onFocus,
  onOpenDetail,
  workspaceRoot,
  t
}: {
  hit: PaperSearchHit
  index: number
  focused: boolean
  checked: boolean
  detailOpen: boolean
  onToggle: () => void
  onFocus: () => void
  onOpenDetail: () => void
  workspaceRoot: string
  t: Translate
}): ReactElement {
  const authors = hit.authors.slice(0, 6).join(', ')
  const extraAuthors = hit.authors.length - 6
  const input = importInput(hit)
  const meta = [hit.year ? String(hit.year) : '', hit.venue ?? ''].filter(Boolean).join(' · ')
  return (
    <li
      data-hit-index={index}
      onMouseEnter={onFocus}
      className={`rounded-lg border px-4 py-3 transition ${
        focused ? 'border-accent/60 bg-accent-tint/[0.04]' : 'border-ds-border-muted bg-ds-card'
      } ${detailOpen ? 'border-accent/50' : ''}`}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          role="checkbox"
          aria-checked={checked}
          aria-label={`${t('writePaperSearchSelectHit')}: ${hit.title}`}
          onClick={onToggle}
          className="mt-1 shrink-0 text-ds-faint transition hover:text-ds-ink"
        >
          {checked ? (
            <CheckSquare className="h-3.5 w-3.5 text-accent" strokeWidth={1.8} />
          ) : (
            <Square className="h-3.5 w-3.5" strokeWidth={1.8} />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onOpenDetail}
            className="block w-full text-left text-[13.5px] font-semibold leading-5 text-ds-ink transition hover:text-accent"
          >
            {hit.title}
          </button>
          {authors ? (
            <p className="mt-0.5 truncate text-[12px] text-ds-muted" title={hit.authors.join(', ')}>
              {authors}
              {extraAuthors > 0 ? ` +${extraAuthors}` : ''}
            </p>
          ) : null}
          {meta ? <p className="mt-0.5 truncate text-[11.5px] text-ds-faint" title={meta}>{meta}</p> : null}
        </div>
        {input ? <ImportButton input={input} meta={importMeta(hit)} workspaceRoot={workspaceRoot} t={t} /> : null}
      </div>
      {hit.abstract ? <ExpandableAbstract text={hit.abstract} /> : null}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {typeof hit.citations === 'number' ? (
          <span
            className="inline-flex items-center gap-1 text-[11px] tabular-nums text-ds-faint"
            title={t('writePaperSearchCitations')}
          >
            <Quote className="h-3 w-3" strokeWidth={1.8} />
            {hit.citations}
          </span>
        ) : null}
        {hit.sources.map((source) => (
          <span key={source} className="rounded bg-ds-subtle px-1.5 py-px text-[10.5px] text-ds-muted">
            {t(`writePaperSearchSource_${source}`)}
          </span>
        ))}
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
    </li>
  )
}

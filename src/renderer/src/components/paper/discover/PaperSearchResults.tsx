import { useMemo, useState, type ReactElement } from 'react'
import { AlertCircle, BookOpenText, FileText, Quote } from 'lucide-react'
import type { PaperSearchHit, PaperSearchResponse } from '@shared/paper/paper-search'
import { ExpandableAbstract, ImportButton } from './PaperDiscoverParts'

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

function openExternal(url: string): void {
  void window.kunGui?.openExternal?.(url)
}

export function PaperSearchResults({
  result,
  workspaceRoot,
  t
}: {
  result: PaperSearchResponse
  workspaceRoot: string
  t: Translate
}): ReactElement {
  const [sort, setSort] = useState<SortKey>('relevance')
  const hits = useMemo(() => sortHits(result.hits, sort), [result.hits, sort])
  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-ds-border-muted pb-2.5">
        <span className="text-[12.5px] font-medium text-ds-ink">
          {t('writePaperSearchResultCount', { count: result.hits.length })}
        </span>
        <span className="flex flex-wrap items-center gap-1">
          {result.sources.map((report) => (
            <span
              key={report.source}
              title={report.error ?? `${(report.ms / 1000).toFixed(1)}s`}
              className={`inline-flex items-center gap-1 rounded px-1.5 py-px text-[11px] tabular-nums ${
                report.error
                  ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
                  : 'bg-ds-subtle text-ds-muted'
              }`}
            >
              {report.error ? <AlertCircle className="h-3 w-3" strokeWidth={2} /> : null}
              {t(`writePaperSearchSource_${report.source}`)}
              <span className="text-ds-faint">{report.error ? t('writePaperSearchSourceFailed') : report.count}</span>
            </span>
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

      {hits.length ? (
        <ul className="mt-3 space-y-2">
          {hits.map((hit) => (
            <SearchHitRow key={hit.key} hit={hit} workspaceRoot={workspaceRoot} t={t} />
          ))}
        </ul>
      ) : (
        <p className="py-16 text-center text-[12.5px] text-ds-faint">{t('writePaperSearchNoResults')}</p>
      )}
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
  workspaceRoot,
  t
}: {
  hit: PaperSearchHit
  workspaceRoot: string
  t: Translate
}): ReactElement {
  const authors = hit.authors.slice(0, 6).join(', ')
  const extraAuthors = hit.authors.length - 6
  const input = importInput(hit)
  const meta = [hit.year ? String(hit.year) : '', hit.venue ?? ''].filter(Boolean).join(' · ')
  return (
    <li className="rounded-lg border border-ds-border-muted bg-ds-card px-4 py-3 transition hover:border-ds-border">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold leading-5 text-ds-ink">{hit.title}</p>
          {authors ? (
            <p className="mt-0.5 truncate text-[12px] text-ds-muted" title={hit.authors.join(', ')}>
              {authors}
              {extraAuthors > 0 ? ` +${extraAuthors}` : ''}
            </p>
          ) : null}
          {meta ? <p className="mt-0.5 truncate text-[11.5px] text-ds-faint" title={meta}>{meta}</p> : null}
        </div>
        {input ? <ImportButton input={input} workspaceRoot={workspaceRoot} t={t} /> : null}
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

import { useMemo, useState, type ReactElement } from 'react'
import { ClipboardCopy, Search, Send, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { generatePaperBibtex } from '@shared/paper/paper-bibtex'
import type { PaperUnitMetaV2 } from '@shared/paper/paper-meta-v2'
import { candidateFromPoolEntry, findLibraryEntry, useLibraryIndex } from '../../../paper/paper-import-candidates'
import { findImportItem, usePaperImportJobs } from '../../../paper/paper-import-job'
import { selectionHas, usePaperImportSelection, usePaperSelectionRecords } from '../../../paper/paper-import-selection'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import type { ResearchPool, ResearchPoolEntry } from '../../../paper/paper-research-pool'
import { PaperImportAction } from '../import/PaperImportAction'
import { PaperImportStatus } from '../import/PaperImportStatus'
import { PaperMoreMenu } from '../import/PaperMoreMenu'
import { PaperCheck, PaperPickRow, PRIORITY_TONE } from '../import/PaperPickRow'
import { PaperResearchPoolDetail } from './PaperResearchPoolDetail'

type PoolTab = 'all' | 'recommended' | 'library'
type PoolSort = 'relevance' | 'hits' | 'year' | 'citations'

const PRIORITY_RANK: Record<string, number> = { must: 0, should: 1, optional: 2 }

function toBibtexMeta(entry: ResearchPoolEntry): PaperUnitMetaV2 {
  return {
    version: 2,
    slug: entry.id,
    title: entry.title,
    authors: entry.authors,
    abstract: entry.abstract,
    year: entry.year !== undefined ? String(entry.year) : undefined,
    venue: entry.venue,
    doi: entry.doi,
    arxivId: entry.arxivId,
    pdfUrl: entry.pdfUrl,
    sourceUrl: entry.url,
    importedAt: ''
  }
}

function sendableLine(entry: ResearchPoolEntry): string {
  const ids = [entry.arxivId ? `arXiv:${entry.arxivId}` : '', entry.doi ? `doi:${entry.doi}` : ''].filter(Boolean).join(' ')
  return `- ${entry.title}${entry.year ? ` (${entry.year})` : ''}${ids ? ` [${ids}]` : ''}`
}

function sortEntries(entries: ResearchPoolEntry[], sort: PoolSort): ResearchPoolEntry[] {
  if (sort === 'relevance') {
    return [...entries].sort((a, b) =>
      (PRIORITY_RANK[a.recommended?.priority ?? ''] ?? (a.recommended ? 3 : 4)) -
        (PRIORITY_RANK[b.recommended?.priority ?? ''] ?? (b.recommended ? 3 : 4)) || b.hits - a.hits
    )
  }
  const value = (entry: ResearchPoolEntry): number =>
    sort === 'hits' ? entry.hits : sort === 'year' ? entry.year ?? 0 : entry.citations ?? -1
  return [...entries].sort((a, b) => value(b) - value(a))
}

/**
 * Right panel of the research stage: every paper the session surfaced,
 * deduplicated. It shares one selection with the recommendation card, shows
 * each paper's import state, and imports through the same import sheet.
 */
export function PaperResearchPool({
  pool,
  scope,
  topic,
  running,
  onFocusBlock,
  onClose
}: {
  pool: ResearchPool
  scope: string
  topic: string
  running: boolean
  onFocusBlock: (blockId: string) => void
  /** Hide the panel (the header shows a close button when given). */
  onClose?: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const index = useLibraryIndex()
  const composer = usePaperModeStore((s) => s.composerBridge)
  const records = usePaperSelectionRecords(scope)
  const job = usePaperImportJobs((s) => s.jobs[scope])
  const [tab, setTab] = useState<PoolTab>(pool.stats.recommended > 0 ? 'recommended' : 'all')
  const [sort, setSort] = useState<PoolSort>('relevance')
  const [query, setQuery] = useState('')
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const rows = useMemo(
    () => pool.entries.map((entry) => ({ entry, candidate: candidateFromPoolEntry(entry, index) })),
    [pool.entries, index]
  )
  const needle = query.trim().toLowerCase()
  const visible = useMemo(() => {
    const kept = rows.filter(({ entry, candidate }) => {
      if (tab === 'recommended' && !entry.recommended) return false
      if (tab === 'library' && !candidate.owned) return false
      return !needle || `${entry.title} ${entry.authors.join(' ')}`.toLowerCase().includes(needle)
    })
    const order = new Map(sortEntries(kept.map((row) => row.entry), sort).map((entry, position) => [entry.key, position]))
    return [...kept].sort((a, b) => (order.get(a.entry.key) ?? 0) - (order.get(b.entry.key) ?? 0))
  }, [rows, tab, needle, sort])
  const libraryCount = rows.filter((row) => row.candidate.owned).length
  const chosen = rows.filter((row) => selectionHas(records, row.candidate.keys))
  const locked = job?.running === true
  // Papers surfaced by the last two searches get a "new" tag while running.
  const recentBlocks = running ? new Set(Object.keys(pool.newCountByBlock).slice(-2)) : new Set<string>()

  const toggle = (keys: readonly string[]): void => usePaperImportSelection.getState().toggle(scope, keys)
  const visibleState = (): 'on' | 'off' | 'some' => {
    const count = visible.filter((row) => selectionHas(records, row.candidate.keys)).length
    return count === 0 ? 'off' : count === visible.length ? 'on' : 'some'
  }
  const recommendedRows = rows.filter((row) => row.entry.recommended && row.entry.recommended.priority !== 'optional' && !row.candidate.owned)

  const copyBibtex = async (): Promise<void> => {
    const text = generatePaperBibtex(chosen.map((row) => toBibtexMeta(row.entry)))
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }
  const sendToAssistant = (): void => {
    if (!composer?.setInput || !chosen.length) return
    const lines = chosen.map((row) => sendableLine(row.entry)).join('\n')
    composer.setInput(composer.input.trim() ? `${composer.input.trim()}\n\n${lines}` : lines)
  }

  const tabs: Array<[PoolTab, string, number | string]> = [
    ['all', t('paperResearchPoolAll'), pool.entries.length],
    ['recommended', t('paperResearchPoolRecommended'), pool.stats.recommended || '–'],
    ['library', t('paperResearchPoolInLibrary'), libraryCount]
  ]

  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-ds-main" aria-label={t('paperResearchPoolTitle')}>
      <div className="shrink-0 border-b border-ds-border-muted px-3 pb-2 pt-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold text-ds-ink">{t('paperResearchPoolTitle')}</span>
          <span className="text-[11.5px] tabular-nums text-ds-faint">{t('paperToolPaperCount', { count: pool.entries.length })}</span>
          {running ? (
            <span className="inline-flex items-center gap-1 text-[11.5px] text-[var(--ds-accent)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--ds-accent)]" />
              {t('paperResearchPoolLive')}
            </span>
          ) : null}
          <span className="flex-1" />
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label={t('close')}
              title={t('close')}
              className="-mr-1 grid h-6 w-6 place-items-center rounded-md text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          ) : null}
        </div>
        <div className="mt-2 flex h-7 items-center rounded-lg bg-ds-subtle p-0.5" role="tablist" aria-label={t('paperResearchPoolTitle')}>
          {tabs.map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`inline-flex h-6 flex-1 items-center justify-center gap-1 rounded-md px-1 text-[11.5px] transition ${
                tab === value ? 'bg-ds-main font-medium text-ds-ink shadow-sm' : 'text-ds-muted hover:text-ds-ink'
              }`}
            >
              {label}<span className="tabular-nums text-ds-faint">{count}</span>
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <label className="relative flex h-7 min-w-0 flex-1 items-center">
            <Search className="pointer-events-none absolute left-2 h-3 w-3 text-ds-faint" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('paperResearchPoolFilter')}
              aria-label={t('paperResearchPoolFilter')}
              className="h-7 w-full rounded-md border border-ds-border-muted bg-ds-main pl-6 pr-5 text-[12px] text-ds-ink outline-none placeholder:text-ds-faint focus-visible:outline-none focus:border-[var(--ds-accent)]"
            />
            {query ? (
              <button type="button" aria-label={t('clearSearch')} onClick={() => setQuery('')} className="absolute right-1 p-0.5 text-ds-faint hover:text-ds-ink">
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </label>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as PoolSort)}
            aria-label={t('paperResearchPoolSort')}
            className="h-7 rounded-md border border-ds-border-muted bg-ds-main px-1 text-[11.5px] text-ds-muted outline-none"
          >
            <option value="relevance">{t('writePaperSearchSort_relevance')}</option>
            <option value="hits">{t('paperResearchPoolSortHits')}</option>
            <option value="year">{t('writePaperSearchSort_year')}</option>
            <option value="citations">{t('writePaperSearchSort_citations')}</option>
          </select>
        </div>
        {visible.length > 0 ? (
          <div className="mt-2 flex items-center gap-2 text-[11.5px] text-ds-muted">
            <PaperCheck
              state={visibleState()}
              disabled={locked}
              onToggle={() => usePaperImportSelection.getState().setMany(scope, visible.map((row) => row.candidate.keys), visibleState() !== 'on')}
              label={t('writePaperReportSelectAll')}
            />
            <span className="flex-1">{t('writePaperReportSelectAll')}</span>
            {recommendedRows.length > 0 ? (
              <button
                type="button"
                disabled={locked}
                onClick={() => usePaperImportSelection.getState().setMany(scope, recommendedRows.map((row) => row.candidate.keys), true)}
                className="rounded px-1.5 py-0.5 font-medium text-[var(--ds-accent)] transition hover:bg-ds-hover disabled:opacity-40"
              >
                {t('paperPoolSelectRecommended')}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {visible.map(({ entry, candidate }) => {
          const priority = entry.recommended?.priority
          const library = findLibraryEntry(index, candidate.keys)
          const meta = [entry.year ? String(entry.year) : '', entry.venue ?? '', entry.hits > 1 ? `×${entry.hits}` : ''].filter(Boolean).join(' · ')
          return (
            <PaperPickRow
              key={entry.key}
              checked={selectionHas(records, candidate.keys)}
              onToggle={() => (locked ? undefined : toggle(candidate.keys))}
              checkLabel={entry.title}
              priority={priority
                ? { label: t(`paperResearchPriority_${priority}`), tone: PRIORITY_TONE[priority] ?? '' }
                : entry.recommended
                  ? { label: t('paperResearchPoolRecommendedBadge'), tone: PRIORITY_TONE.should ?? '' }
                  : recentBlocks.has(entry.firstBlockId)
                    ? { label: t('paperPoolNew'), tone: 'bg-[var(--ds-accent-soft)] text-[var(--ds-accent)]' }
                    : undefined}
              title={entry.title}
              meta={meta}
              status={<PaperImportStatus scope={scope} item={findImportItem(job, candidate.keys)} owned={library ? { unitDir: library.unitDir, group: library.group } : undefined} />}
              open={openKey === entry.key}
              onOpen={() => setOpenKey((current) => (current === entry.key ? null : entry.key))}
            >
              <PaperResearchPoolDetail entry={entry} onFocusBlock={onFocusBlock} />
            </PaperPickRow>
          )
        })}
        {!visible.length ? (
          <li className="px-3 py-10 text-center text-[12px] text-ds-faint">
            {running && !pool.entries.length ? t('paperResearchPoolWaiting') : t('paperResearchPoolEmpty')}
          </li>
        ) : null}
      </ul>

      <div className="flex shrink-0 items-center gap-2 border-t border-ds-border-muted bg-ds-subtle/40 px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-[12px] text-ds-muted">{t('paperResearchPoolSelected', { count: chosen.length })}</span>
        <PaperImportAction scope={scope} candidates={chosen.map((row) => row.candidate)} topic={topic} compact />
        <PaperMoreMenu
          label={t('paperReportMore')}
          items={[
            { id: 'bibtex', label: copied ? t('writePaperReportCopied') : t('writePaperReportCopyBibtex'), icon: <ClipboardCopy className="h-3.5 w-3.5" strokeWidth={1.8} />, disabled: !chosen.length, onSelect: () => void copyBibtex() },
            { id: 'send', label: t('paperResearchPoolSendToChat'), icon: <Send className="h-3.5 w-3.5" strokeWidth={1.8} />, disabled: !chosen.length || !composer?.setInput, onSelect: sendToAssistant }
          ]}
        />
      </div>
    </aside>
  )
}

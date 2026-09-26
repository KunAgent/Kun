import type { ReactElement } from 'react'
import { FileDown, FileWarning, Import, RefreshCw, Search, X } from 'lucide-react'
import type { PaperLibraryFilter } from '@shared/paper/paper-library-types'

type Translate = (key: string, opts?: Record<string, unknown>) => string

const STATUS_TABS = [
  { key: 'all', labelKey: 'writePaperFilterAll' },
  { key: 'unread', labelKey: 'writePaperFilterUnread' },
  { key: 'reading', labelKey: 'writePaperFilterReading' },
  { key: 'read', labelKey: 'writePaperFilterRead' },
  { key: 'recent', labelKey: 'writePaperFilterRecent' }
] as const

const selectClass =
  'h-7 max-w-[9rem] rounded-md border border-ds-border-muted bg-ds-main px-1.5 text-[12px] text-ds-muted outline-none transition hover:text-ds-ink focus:border-[var(--ds-accent)]'

const iconButtonClass =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink'

/**
 * Library toolbar: search + status tabs + tag/group filters on the left,
 * library actions on the right. All filtering is client-side over the
 * already-indexed entries.
 */
export function PaperLibraryToolbar({
  filter,
  counts,
  tags,
  groups,
  shown,
  loading,
  missingPdf,
  onFilter,
  onRefresh,
  onDownloadMissing,
  onExportBibtex,
  onImport,
  t
}: {
  filter: PaperLibraryFilter
  counts: { total: number; unread: number; reading: number; read: number }
  tags: string[]
  groups: string[]
  shown: number
  loading: boolean
  missingPdf: number
  onFilter: (patch: Partial<PaperLibraryFilter>) => void
  onRefresh: () => void
  onDownloadMissing: () => void
  onExportBibtex: () => void
  onImport: () => void
  t: Translate
}): ReactElement {
  const activeTab = filter.recent ? 'recent' : filter.status || 'all'
  const countFor: Record<string, number | undefined> = {
    all: counts.total,
    unread: counts.unread,
    reading: counts.reading,
    read: counts.read
  }
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-ds-border-muted px-4 py-2">
      <label className="relative flex h-7 w-56 min-w-[10rem] items-center">
        <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-ds-faint" strokeWidth={1.9} />
        <input
          value={filter.query}
          onChange={(event) => onFilter({ query: event.target.value })}
          placeholder={t('writePaperSearchPlaceholder')}
          aria-label={t('writePaperSearchPlaceholder')}
          className="h-7 w-full rounded-md border border-ds-border-muted bg-ds-main pl-7 pr-6 text-[12.5px] text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-[var(--ds-accent)]"
        />
        {filter.query ? (
          <button
            type="button"
            aria-label={t('clearSearch')}
            onClick={() => onFilter({ query: '' })}
            className="absolute right-1 rounded p-0.5 text-ds-faint hover:text-ds-ink"
          >
            <X className="h-3 w-3" strokeWidth={2} />
          </button>
        ) : null}
      </label>

      <div role="tablist" aria-label={t('writePaperFilterStatus')} className="flex h-7 items-center rounded-md border border-ds-border-muted bg-ds-subtle p-0.5">
        {STATUS_TABS.map(({ key, labelKey }) => {
          const active = activeTab === key
          const count = countFor[key]
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onFilter(
                key === 'recent'
                  ? { recent: true, status: '' }
                  : { recent: false, status: key === 'all' ? '' : key }
              )}
              className={`inline-flex h-6 items-center gap-1 rounded px-2 text-[12px] transition ${
                active ? 'bg-ds-main font-medium text-ds-ink shadow-sm' : 'text-ds-muted hover:text-ds-ink'
              }`}
            >
              {t(labelKey)}
              {typeof count === 'number' ? <span className="text-[11px] tabular-nums text-ds-faint">{count}</span> : null}
            </button>
          )
        })}
      </div>

      {tags.length ? (
        <select
          value={filter.tag}
          onChange={(event) => onFilter({ tag: event.target.value })}
          aria-label={t('writePaperFilterTag')}
          className={selectClass}
        >
          <option value="">{t('writePaperFilterTagAll')}</option>
          {tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
        </select>
      ) : null}
      {groups.length ? (
        <select
          value={filter.group}
          onChange={(event) => onFilter({ group: event.target.value })}
          aria-label={t('writePaperFilterGroup')}
          className={selectClass}
        >
          <option value="">{t('writePaperFilterGroupAll')}</option>
          {groups.map((group) => <option key={group} value={group}>{group}</option>)}
        </select>
      ) : null}

      <span className="text-[12px] tabular-nums text-ds-faint">
        {t('writePaperLibraryCount', { shown, total: counts.total })}
      </span>

      <div className="ml-auto flex items-center gap-1">
        <button type="button" onClick={onRefresh} title={t('writeRefreshWorkspace')} aria-label={t('writeRefreshWorkspace')} className={iconButtonClass}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.8} />
        </button>
        {missingPdf > 0 ? (
          <button
            type="button"
            onClick={onDownloadMissing}
            title={t('writePaperDownloadMissingHint')}
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-amber-700 transition hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950"
          >
            <FileWarning className="h-3.5 w-3.5" strokeWidth={1.8} />
            {t('writePaperDownloadMissing', { count: missingPdf })}
          </button>
        ) : null}
        <button type="button" onClick={onExportBibtex} title={t('writePaperBibtexExport')} aria-label={t('writePaperBibtexExport')} className={iconButtonClass}>
          <FileDown className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={onImport}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-[var(--ds-control)] px-2.5 text-[12px] font-medium text-[var(--ds-control-foreground)] transition hover:opacity-90"
        >
          <Import className="h-3.5 w-3.5" strokeWidth={1.9} />
          {t('writePaperImport')}
        </button>
      </div>
    </div>
  )
}

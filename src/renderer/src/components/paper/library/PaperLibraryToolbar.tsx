import type { ReactElement } from 'react'
import { FileDown, FileWarning, Import, Info, RefreshCw, Search, X } from 'lucide-react'
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
  'h-[30px] max-w-[9rem] rounded-full border-0 bg-ds-hover px-2.5 text-[12.5px] text-ds-muted outline-none transition hover:text-ds-ink focus-visible:ring-2 focus-visible:ring-[var(--ds-accent)]/40'

const iconButtonClass =
  'inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink'

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
  onShowInfo,
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
  /** Open the editor-side metadata drawer for the focused unit. */
  onShowInfo: () => void
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
    <div className="flex shrink-0 flex-wrap items-center gap-2 px-6 pb-1 pt-1">
      <label className="relative flex h-[34px] w-64 min-w-[10rem] items-center">
        <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-ds-faint" strokeWidth={1.9} />
        <input
          value={filter.query}
          onChange={(event) => onFilter({ query: event.target.value })}
          placeholder={t('writePaperSearchPlaceholder')}
          aria-label={t('writePaperSearchPlaceholder')}
          className="h-[34px] w-full rounded-full border-0 bg-ds-hover pl-8 pr-7 text-[13px] text-ds-ink outline-none transition placeholder:text-ds-faint focus:bg-ds-main focus:shadow-[0_0_0_1.5px_var(--ds-accent)]"
        />
        {filter.query ? (
          <button
            type="button"
            aria-label={t('clearSearch')}
            onClick={() => onFilter({ query: '' })}
            className="absolute right-2 rounded-full p-0.5 text-ds-faint hover:text-ds-ink"
          >
            <X className="h-3 w-3" strokeWidth={2} />
          </button>
        ) : null}
      </label>

      <div role="tablist" aria-label={t('writePaperFilterStatus')} className="flex items-center gap-0.5">
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
              className={`inline-flex h-[30px] items-center gap-1 rounded-full px-3 text-[12.5px] transition ${
                active ? 'bg-ds-hover font-semibold text-ds-ink' : 'text-ds-muted hover:bg-ds-hover/60 hover:text-ds-ink'
              }`}
            >
              {t(labelKey)}
              {typeof count === 'number' ? <span className="text-[12px] font-normal tabular-nums text-ds-faint">{count}</span> : null}
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
        <button type="button" onClick={onShowInfo} title={t('writePaperInfoTitle')} aria-label={t('writePaperInfoTitle')} className={iconButtonClass}>
          <Info className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
        <button type="button" onClick={onRefresh} title={t('writeRefreshWorkspace')} aria-label={t('writeRefreshWorkspace')} className={iconButtonClass}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.8} />
        </button>
        {missingPdf > 0 ? (
          <button
            type="button"
            onClick={onDownloadMissing}
            title={t('writePaperDownloadMissingHint')}
            className="inline-flex h-[30px] items-center gap-1 rounded-full px-2.5 text-[12px] text-amber-700 transition hover:bg-amber-500/10 dark:text-amber-300"
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
          className="inline-flex h-[34px] items-center gap-1.5 rounded-full bg-[var(--ds-control)] px-3.5 text-[13px] font-medium text-[var(--ds-control-foreground)] transition hover:opacity-90"
        >
          <Import className="h-3.5 w-3.5" strokeWidth={1.9} />
          {t('writePaperImport')}
        </button>
      </div>
    </div>
  )
}

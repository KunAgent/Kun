import type { ReactElement } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, FileWarning, MoreHorizontal, ScrollText } from 'lucide-react'
import type {
  PaperLibraryEntry,
  PaperLibrarySort,
  PaperLibrarySortKey,
  PaperUnitReadingActivity
} from '@shared/paper/paper-library-types'
import { PaperTitleText } from '../PaperTitleText'
import { PaperReadingHeat } from './PaperReadingHeat'

type Translate = (key: string, opts?: Record<string, unknown>) => string

type Column = {
  id: string
  labelKey: string
  sortKey?: PaperLibrarySortKey
  /** Fixed px width, or a relative weight of the remaining width. */
  width: string
}

// Table-fixed layout: the title keeps the lion's share and the table scrolls
// horizontally below its min width instead of squeezing the title to zero.
const COLUMNS: Column[] = [
  { id: 'title', labelKey: 'writePaperColTitle', sortKey: 'title', width: '38%' },
  { id: 'authors', labelKey: 'writePaperMetaAuthorsShort', sortKey: 'authors', width: '17%' },
  { id: 'year', labelKey: 'writePaperColYear', sortKey: 'year', width: '64px' },
  { id: 'venue', labelKey: 'writePaperColVenue', sortKey: 'venue', width: '13%' },
  { id: 'tags', labelKey: 'writePaperMetaTagsShort', width: '12%' },
  { id: 'status', labelKey: 'writePaperColStatus', sortKey: 'status', width: '76px' },
  { id: 'progress', labelKey: 'writePaperColProgress', width: '72px' },
  { id: 'added', labelKey: 'writePaperColAdded', sortKey: 'importedAt', width: '92px' }
]

const STATUS_DOT: Record<string, string> = {
  unread: 'border border-ds-faint',
  reading: 'bg-amber-500',
  read: 'bg-emerald-500'
}

function statusLabelKey(status: string | undefined): string {
  switch (status ?? 'unread') {
    case 'reading': return 'writePaperFilterReading'
    case 'read': return 'writePaperFilterRead'
    default: return 'writePaperFilterUnread'
  }
}

function formatDate(value: string | undefined): string {
  if (!value) return ''
  const time = Date.parse(value)
  if (Number.isNaN(time)) return ''
  const date = new Date(time)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * Library grid: sticky translucent header, hairline rows, neutral hover wash,
 * a thin status dot instead of colored chips, and the reading heat bar. Rows
 * open on click; right click or the trailing button opens the row menu.
 */
export function PaperLibraryTable({
  rows,
  sort,
  selection,
  activity,
  onToggleSort,
  onToggleSelected,
  onToggleAll,
  onOpen,
  onMenu,
  t
}: {
  rows: PaperLibraryEntry[]
  sort: PaperLibrarySort
  selection: ReadonlySet<string>
  activity: Record<string, PaperUnitReadingActivity>
  onToggleSort: (key: PaperLibrarySortKey) => void
  onToggleSelected: (unitDir: string) => void
  onToggleAll: () => void
  onOpen: (entry: PaperLibraryEntry) => void
  onMenu: (entry: PaperLibraryEntry, x: number, y: number) => void
  t: Translate
}): ReactElement {
  const allSelected = rows.length > 0 && rows.every((row) => selection.has(row.unitDir))
  return (
    <table className="w-full min-w-[860px] table-fixed border-collapse text-left text-[13px]">
      <colgroup>
        <col style={{ width: '36px' }} />
        {COLUMNS.map((column) => <col key={column.id} style={{ width: column.width }} />)}
        <col style={{ width: '36px' }} />
      </colgroup>
      <thead className="sticky top-0 z-[1] bg-ds-main shadow-[0_1px_0_0_var(--ds-border-muted)]">
        <tr className="h-9 select-none text-[12px] text-ds-faint">
          <th className="pl-3 font-normal">
            <input
              type="checkbox"
              aria-label={t('writePaperSelectAll')}
              checked={allSelected}
              onChange={onToggleAll}
              className="h-3.5 w-3.5 align-middle accent-[var(--ds-accent)]"
            />
          </th>
          {COLUMNS.map((column) => (
            <th key={column.id} className="px-3 font-normal">
              {column.sortKey ? (
                <button
                  type="button"
                  onClick={() => onToggleSort(column.sortKey as PaperLibrarySortKey)}
                  className="group inline-flex max-w-full items-center gap-1 transition hover:text-ds-ink"
                >
                  <span className="truncate">{t(column.labelKey)}</span>
                  {sort.key === column.sortKey ? (
                    sort.dir === 'asc'
                      ? <ArrowUp className="h-3 w-3 shrink-0 text-ds-ink" strokeWidth={2} />
                      : <ArrowDown className="h-3 w-3 shrink-0 text-ds-ink" strokeWidth={2} />
                  ) : (
                    <ArrowUpDown className="h-3 w-3 shrink-0 opacity-0 transition group-hover:opacity-40" strokeWidth={2} />
                  )}
                </button>
              ) : (
                <span className="truncate">{t(column.labelKey)}</span>
              )}
            </th>
          ))}
          <th aria-hidden />
        </tr>
      </thead>
      <tbody>
        {rows.map((entry) => (
          <PaperLibraryRow
            key={entry.unitDir}
            entry={entry}
            activity={activity[entry.unitDir]}
            selected={selection.has(entry.unitDir)}
            onToggle={() => onToggleSelected(entry.unitDir)}
            onOpen={() => onOpen(entry)}
            onMenu={(x, y) => onMenu(entry, x, y)}
            t={t}
          />
        ))}
      </tbody>
    </table>
  )
}

function PaperLibraryRow({
  entry,
  activity,
  selected,
  onToggle,
  onOpen,
  onMenu,
  t
}: {
  entry: PaperLibraryEntry
  activity: PaperUnitReadingActivity | undefined
  selected: boolean
  onToggle: () => void
  onOpen: () => void
  onMenu: (x: number, y: number) => void
  t: Translate
}): ReactElement {
  const meta = entry.meta
  const status = meta.status ?? 'unread'
  const markCount = (activity?.pages ?? []).reduce((sum, count) => sum + count, 0)
  const heatTooltip = t('writePaperReadingHeatTooltip', {
    marks: markCount,
    page: activity?.lastPage ?? entry.lastPage ?? 0,
    total: activity?.pageCount ?? entry.pageCount ?? 0
  })
  const authors = meta.authors.join(', ')
  return (
    <tr
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          onOpen()
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        onMenu(event.clientX, event.clientY)
      }}
      className={`group cursor-default border-b border-ds-border-muted transition-colors duration-100 hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--ds-accent)] ${
        selected ? 'bg-accent-tint/[0.08]' : ''
      }`}
    >
      <td className="pl-3" onClick={(event) => event.stopPropagation()}>
        <input
          type="checkbox"
          aria-label={meta.title}
          checked={selected}
          onChange={onToggle}
          className={`h-3.5 w-3.5 align-middle accent-[var(--ds-accent)] transition ${
            selected ? '' : 'opacity-40 group-hover:opacity-100'
          }`}
        />
      </td>
      <td className="overflow-hidden px-3 py-2.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <ScrollText className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} aria-hidden />
          <PaperTitleText title={meta.title} className="min-w-0 truncate font-medium text-ds-ink" />
          {!entry.hasPdf ? (
            <span title={t('writePaperMissingPdf')} className="shrink-0 text-amber-600 dark:text-amber-300">
              <FileWarning className="h-3 w-3" strokeWidth={1.9} />
            </span>
          ) : null}
          {meta.needsReview ? (
            <span className="shrink-0 rounded border border-amber-300 px-1 text-[10px] text-amber-700 dark:border-amber-800 dark:text-amber-300">
              {t('writePaperNeedsReview')}
            </span>
          ) : null}
        </span>
      </td>
      <td className="overflow-hidden px-3 py-2.5 text-[12px] text-ds-muted">
        <span className="block truncate" title={authors}>{authors}</span>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-[12px] tabular-nums text-ds-muted">{meta.year ?? '—'}</td>
      <td className="overflow-hidden px-3 py-2.5 text-[12px] text-ds-muted">
        <span className="block truncate" title={meta.venue ?? ''}>{meta.venue || '—'}</span>
      </td>
      <td className="overflow-hidden px-3 py-2.5">
        {(meta.tags ?? []).length ? (
          <span className="flex min-w-0 gap-1 overflow-hidden">
            {(meta.tags ?? []).slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="shrink-0 truncate rounded-md border border-ds-border-muted bg-ds-subtle px-1.5 py-px text-[11px] text-ds-muted"
              >
                {tag}
              </span>
            ))}
          </span>
        ) : (
          <span className="text-[12px] text-ds-faint">—</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        <span className="inline-flex items-center gap-1.5 text-[12px] text-ds-muted">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[status] ?? STATUS_DOT.unread}`} />
          {t(statusLabelKey(status))}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <PaperReadingHeat
          activity={activity}
          lastPage={activity?.lastPage ?? entry.lastPage}
          pageCount={activity?.pageCount ?? entry.pageCount}
          tooltip={heatTooltip}
        />
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-[12px] tabular-nums text-ds-faint">
        {formatDate(meta.importedAt)}
      </td>
      <td className="pr-2" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          aria-label={t('writePaperMoreActions')}
          title={t('writePaperMoreActions')}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            onMenu(rect.left, rect.bottom + 4)
          }}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ds-faint opacity-0 transition hover:bg-ds-hover hover:text-ds-ink group-hover:opacity-100 focus-visible:opacity-100"
        >
          <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.9} />
        </button>
      </td>
    </tr>
  )
}

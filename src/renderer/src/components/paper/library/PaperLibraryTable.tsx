import { useEffect, useRef, useState, type ReactElement, type RefObject } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Check, FileWarning, MessageSquare, MoreHorizontal } from 'lucide-react'
import type {
  PaperLibraryEntry,
  PaperLibrarySort,
  PaperLibrarySortKey,
  PaperUnitReadingActivity
} from '@shared/paper/paper-library-types'
import { PaperTitleText } from '../PaperTitleText'
import { PaperReadingHeat } from './PaperReadingHeat'

type Translate = (key: string, opts?: Record<string, unknown>) => string

// Below this width (assistant rail open, detail panel, small window) the
// tag and date columns drop so the title line keeps its room.
const COMPACT_WIDTH = 720

function useCompactList(): [RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [compact, setCompact] = useState(false)
  useEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setCompact((entry?.contentRect.width ?? 1000) < COMPACT_WIDTH))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return [ref, compact]
}

/** Reading status pill tones: unread waits (warm), reading is live (accent), read is done (green). */
export const PAPER_STATUS_PILL: Record<string, string> = {
  unread: 'bg-amber-500/[0.12] text-amber-800 dark:text-amber-300',
  reading: 'bg-accent/[0.12] text-accent',
  read: 'bg-emerald-500/[0.13] text-emerald-800 dark:text-emerald-300'
}

export function statusLabelKey(status: string | undefined): string {
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

/** "authors · venue year", skipping the missing parts. */
export function paperByline(meta: PaperLibraryEntry['meta']): string {
  const where = [meta.venue, meta.year].filter(Boolean).join(' ')
  return [meta.authors.join(', '), where].filter(Boolean).join(' · ')
}

function gridColumns(compact: boolean): string {
  return compact
    ? '28px minmax(0,1fr) 64px 56px 28px'
    : '28px minmax(0,1fr) 150px 64px 56px 84px 28px'
}

function SortButton({
  label,
  sortKey,
  sort,
  onToggleSort
}: {
  label: string
  sortKey: PaperLibrarySortKey
  sort: PaperLibrarySort
  onToggleSort: (key: PaperLibrarySortKey) => void
}): ReactElement {
  const active = sort.key === sortKey
  return (
    <button
      type="button"
      onClick={() => onToggleSort(sortKey)}
      className={`group inline-flex max-w-full items-center gap-1 rounded-full px-1.5 py-0.5 transition hover:bg-ds-hover hover:text-ds-ink ${active ? 'text-ds-ink' : ''}`}
    >
      <span className="truncate">{label}</span>
      {active ? (
        sort.dir === 'asc'
          ? <ArrowUp className="h-3 w-3 shrink-0" strokeWidth={2} />
          : <ArrowDown className="h-3 w-3 shrink-0" strokeWidth={2} />
      ) : (
        <ArrowUpDown className="h-3 w-3 shrink-0 opacity-0 transition group-hover:opacity-40" strokeWidth={2} />
      )}
    </button>
  )
}

/** Rounded square checkbox drawn to match the row radius. */
function RowCheck({ checked, label, onToggle, quiet }: {
  checked: boolean
  label: string
  onToggle: () => void
  quiet?: boolean
}): ReactElement {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[6px] text-white transition ${
        checked
          ? 'bg-accent'
          : `shadow-[inset_0_0_0_1.5px_var(--ds-border)] hover:shadow-[inset_0_0_0_1.5px_var(--ds-text-faint)] ${quiet ? 'opacity-50 group-hover:opacity-100' : ''}`
      }`}
    >
      {checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
    </button>
  )
}

/**
 * Library list: one rounded card row per paper — title over a quiet
 * "authors · venue year" byline, tag pills, a tinted status pill, the reading
 * heat bar and the import date. Click focuses the paper (detail panel) when
 * the view offers one, double click / Enter opens it; right click or the
 * trailing button opens the row menu.
 */
export function PaperLibraryTable({
  rows,
  sort,
  selection,
  activity,
  focused,
  onToggleSort,
  onToggleSelected,
  onToggleAll,
  onOpen,
  onFocus,
  onMenu,
  sessionCounts,
  onOpenSessions,
  t
}: {
  rows: PaperLibraryEntry[]
  sort: PaperLibrarySort
  selection: ReadonlySet<string>
  activity: Record<string, PaperUnitReadingActivity>
  /** unitDir shown in the detail panel. */
  focused?: string | null
  onToggleSort: (key: PaperLibrarySortKey) => void
  onToggleSelected: (unitDir: string) => void
  onToggleAll: () => void
  onOpen: (entry: PaperLibraryEntry) => void
  /** Show the paper in the detail panel; when absent a click opens it. */
  onFocus?: (entry: PaperLibraryEntry) => void
  onMenu: (entry: PaperLibraryEntry, x: number, y: number) => void
  /** unitDir → number of sessions anchored to the paper (readings, batches). */
  sessionCounts?: Record<string, number>
  /** Open the paper with its most recent session. */
  onOpenSessions?: (entry: PaperLibraryEntry) => void
  t: Translate
}): ReactElement {
  const allSelected = rows.length > 0 && rows.every((row) => selection.has(row.unitDir))
  const [wrapRef, compact] = useCompactList()
  const columns = gridColumns(compact)
  return (
    <div ref={wrapRef} className="w-full px-3 pb-4 text-[13px]">
      <div
        className="sticky top-0 z-[1] grid h-9 select-none items-center gap-3 bg-ds-main px-3 text-[12px] text-ds-faint"
        style={{ gridTemplateColumns: columns }}
      >
        <RowCheck checked={allSelected} label={t('writePaperSelectAll')} onToggle={onToggleAll} />
        <span className="flex min-w-0 items-center gap-0.5 overflow-hidden">
          <SortButton label={t('writePaperColTitle')} sortKey="title" sort={sort} onToggleSort={onToggleSort} />
          <SortButton label={t('writePaperMetaAuthorsShort')} sortKey="authors" sort={sort} onToggleSort={onToggleSort} />
          <SortButton label={t('writePaperColYear')} sortKey="year" sort={sort} onToggleSort={onToggleSort} />
          {compact ? null : <SortButton label={t('writePaperColVenue')} sortKey="venue" sort={sort} onToggleSort={onToggleSort} />}
        </span>
        {compact ? null : <span className="truncate px-1.5">{t('writePaperMetaTagsShort')}</span>}
        <SortButton label={t('writePaperColStatus')} sortKey="status" sort={sort} onToggleSort={onToggleSort} />
        <span className="truncate">{t('writePaperColProgress')}</span>
        {compact ? null : (
          <span className="flex justify-end">
            <SortButton label={t('writePaperColAdded')} sortKey="importedAt" sort={sort} onToggleSort={onToggleSort} />
          </span>
        )}
        <span aria-hidden />
      </div>
      <div role="list" className="flex flex-col gap-0.5">
        {rows.map((entry) => (
          <PaperLibraryRow
            key={entry.unitDir}
            entry={entry}
            columns={columns}
            compact={compact}
            activity={activity[entry.unitDir]}
            selected={selection.has(entry.unitDir)}
            focused={focused === entry.unitDir}
            onToggle={() => onToggleSelected(entry.unitDir)}
            onOpen={() => onOpen(entry)}
            onFocus={onFocus ? () => onFocus(entry) : undefined}
            onMenu={(x, y) => onMenu(entry, x, y)}
            sessions={sessionCounts?.[entry.unitDir] ?? 0}
            onOpenSessions={onOpenSessions ? () => onOpenSessions(entry) : undefined}
            t={t}
          />
        ))}
      </div>
    </div>
  )
}

function PaperLibraryRow({
  entry,
  columns,
  compact,
  activity,
  selected,
  focused,
  onToggle,
  onOpen,
  onFocus,
  onMenu,
  sessions,
  onOpenSessions,
  t
}: {
  entry: PaperLibraryEntry
  columns: string
  compact: boolean
  activity: PaperUnitReadingActivity | undefined
  sessions: number
  onOpenSessions?: () => void
  selected: boolean
  focused: boolean
  onToggle: () => void
  onOpen: () => void
  onFocus?: () => void
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
  const byline = paperByline(meta)
  const tags = meta.tags ?? []
  return (
    <div
      role="listitem"
      tabIndex={0}
      data-paper-row={entry.unitDir}
      aria-current={focused || undefined}
      onClick={onFocus ?? onOpen}
      onDoubleClick={onFocus ? onOpen : undefined}
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
      style={{ gridTemplateColumns: columns }}
      className={`group grid cursor-default items-center gap-3 rounded-[14px] px-3 py-2.5 transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ds-accent)] ${
        focused
          ? 'bg-ds-hover shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ds-accent)_28%,transparent)]'
          : selected
            ? 'bg-accent/[0.06]'
            : 'hover:bg-ds-hover'
      }`}
    >
      <RowCheck checked={selected} label={meta.title} onToggle={onToggle} quiet />
      <span className="flex min-w-0 flex-col gap-[3px]">
        <span className="flex min-w-0 items-center gap-1.5">
          <PaperTitleText title={meta.title} className="min-w-0 truncate text-[13.5px] font-semibold text-ds-ink" />
          {!entry.hasPdf ? (
            <span title={t('writePaperMissingPdf')} className="shrink-0 text-amber-600 dark:text-amber-300">
              <FileWarning className="h-3 w-3" strokeWidth={1.9} />
            </span>
          ) : null}
          {meta.needsReview ? (
            <span className="shrink-0 rounded-full bg-amber-500/[0.12] px-1.5 text-[10.5px] text-amber-800 dark:text-amber-300">
              {t('writePaperNeedsReview')}
            </span>
          ) : null}
          {sessions > 0 && onOpenSessions ? (
            <button
              type="button"
              data-paper-sessions={sessions}
              title={t('paperRowSessions', { count: sessions })}
              aria-label={t('paperRowSessions', { count: sessions })}
              onClick={(event) => {
                event.stopPropagation()
                onOpenSessions()
              }}
              onDoubleClick={(event) => event.stopPropagation()}
              className="ml-auto inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-1.5 text-[11px] text-accent transition hover:bg-accent/10"
            >
              <MessageSquare className="h-3 w-3" strokeWidth={1.9} />
              {sessions}
            </button>
          ) : null}
        </span>
        <span className="truncate text-[12px] text-ds-muted" title={byline}>{byline || '—'}</span>
      </span>
      {compact ? null : (
        <span className="flex min-w-0 gap-1 overflow-hidden">
          {tags.slice(0, 2).map((tag) => (
            <span key={tag} className="h-[22px] shrink-0 truncate rounded-full bg-ds-subtle px-2 text-[11.5px] leading-[22px] text-ds-muted">
              {tag}
            </span>
          ))}
          {tags.length > 2 ? <span className="shrink-0 text-[11.5px] leading-[22px] text-ds-faint">+{tags.length - 2}</span> : null}
        </span>
      )}
      <span
        data-paper-status={status}
        className={`inline-flex h-[22px] w-16 items-center justify-center rounded-full text-[11.5px] font-semibold ${PAPER_STATUS_PILL[status] ?? PAPER_STATUS_PILL.unread}`}
      >
        {t(statusLabelKey(status))}
      </span>
      <span className="flex items-center">
        <PaperReadingHeat
          activity={activity}
          lastPage={activity?.lastPage ?? entry.lastPage}
          pageCount={activity?.pageCount ?? entry.pageCount}
          tooltip={heatTooltip}
        />
      </span>
      {compact ? null : (
        <span className="whitespace-nowrap text-right text-[12px] tabular-nums text-ds-faint">
          {formatDate(meta.importedAt)}
        </span>
      )}
      <span className="flex justify-end" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          aria-label={t('writePaperMoreActions')}
          title={t('writePaperMoreActions')}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            onMenu(rect.left, rect.bottom + 4)
          }}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full text-ds-faint opacity-0 transition hover:bg-ds-main hover:text-ds-ink group-hover:opacity-100 focus-visible:opacity-100"
        >
          <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.9} />
        </button>
      </span>
    </div>
  )
}

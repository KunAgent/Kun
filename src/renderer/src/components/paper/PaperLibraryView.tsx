import { useMemo, useState, type DragEvent, type ReactElement } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  FileDown,
  FileWarning,
  Loader2,
  RefreshCw,
  Trash2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { normalizePath } from '../../write/write-workspace-store-helpers'
import { confirmDialog } from '../../lib/confirm-dialog'
import { usePaperModeStore } from '../../paper/paper-mode-store'
import {
  filterPaperEntries,
  sortPaperEntries
} from '../../paper/paper-library-filter'
import { openLibraryEntry } from '../../paper/paper-library-actions'
import { trashPaperUnits } from '../../paper/paper-unit-ops'
import { newPaperRequestId, usePaperStore } from '../../write/paper/paper-store'
import type {
  PaperLibraryEntry,
  PaperLibrarySortKey
} from '@shared/paper/paper-library-types'

const COLUMNS: { key: PaperLibrarySortKey; labelKey: string; className: string }[] = [
  { key: 'title', labelKey: 'writePaperColTitle', className: 'min-w-0 flex-1' },
  { key: 'year', labelKey: 'writePaperColYear', className: 'w-14 shrink-0' },
  { key: 'venue', labelKey: 'writePaperColVenue', className: 'w-40 shrink-0' },
  { key: 'status', labelKey: 'writePaperColStatus', className: 'w-24 shrink-0' },
  { key: 'lastOpenedAt', labelKey: 'writePaperColOpened', className: 'w-28 shrink-0' }
]

function statusLabelKey(status: string | undefined): string {
  switch (status ?? 'unread') {
    case 'reading': return 'writePaperFilterReading'
    case 'read': return 'writePaperFilterRead'
    default: return 'writePaperFilterUnread'
  }
}

function formatOpenedAt(value: string | undefined): string {
  if (!value) return ''
  const time = Date.parse(value)
  if (Number.isNaN(time)) return ''
  return new Date(time).toLocaleDateString()
}

/** Library table view (§3.4): filter chips live in the sidebar; this is the
 * sortable/selectable grid plus the bulk-action bar. */
export function PaperLibraryView(): ReactElement {
  const { t } = useTranslation('common')
  const { workspaceRoot, paperReading } = useWriteWorkspaceStore(
    useShallow((s) => ({
      workspaceRoot: s.workspaceRoot,
      paperReading: s.paperReading
    }))
  )
  const {
    entries,
    entriesLoading,
    entriesError,
    filter,
    sort,
    selection,
    counts,
    setSort,
    toggleSelected,
    setSelection,
    clearSelection,
    setEntriesResult,
    setEntriesError,
    setEntriesLoading,
    setImportDialogOpen
  } = usePaperModeStore(
    useShallow((s) => ({
      entries: s.entries,
      entriesLoading: s.entriesLoading,
      entriesError: s.entriesError,
      filter: s.filter,
      sort: s.sort,
      selection: s.selection,
      counts: s.counts,
      setSort: s.setSort,
      toggleSelected: s.toggleSelected,
      setSelection: s.setSelection,
      clearSelection: s.clearSelection,
      setEntriesResult: s.setEntriesResult,
      setEntriesError: s.setEntriesError,
      setEntriesLoading: s.setEntriesLoading,
      setImportDialogOpen: s.setImportDialogOpen
    }))
  )

  const [dropActive, setDropActive] = useState(false)

  const visible = useMemo(
    () => sortPaperEntries(filterPaperEntries(entries, filter), sort),
    [entries, filter, sort]
  )

  const reload = async (): Promise<void> => {
    if (!workspaceRoot || typeof window.kunGui?.paperLibraryList !== 'function') return
    setEntriesLoading(true)
    try {
      const result = await window.kunGui.paperLibraryList({
        workspaceRoot,
        papersDir: paperReading.papersDir
      })
      if (result.ok) {
        setEntriesResult({
          entries: result.entries,
          counts: result.counts,
          tags: result.tags,
          groups: result.groups
        })
      } else {
        setEntriesError(result.message)
      }
    } catch (error) {
      setEntriesError(error instanceof Error ? error.message : String(error))
    }
  }

  const toggleSort = (key: PaperLibrarySortKey): void => {
    setSort(
      sort.key === key
        ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'title' ? 'asc' : 'desc' }
    )
  }

  const exportBibtex = async (): Promise<void> => {
    if (!workspaceRoot || typeof window.kunGui?.paperExportBibtex !== 'function') return
    const result = await window.kunGui.paperExportBibtex({
      workspaceRoot,
      papersDir: paperReading.papersDir
    })
    if (!result.ok) {
      usePaperStore.getState().setNotice({ tone: 'error', message: result.message })
      return
    }
    const stamp = new Date().toISOString().slice(0, 10)
    const target = `library-${stamp}.bib`
    const write = await window.kunGui.writeWorkspaceFile({
      workspaceRoot,
      path: target,
      content: result.bibtex
    })
    usePaperStore.getState().setNotice(
      write.ok === false
        ? { tone: 'error', message: write.message }
        : {
            tone: 'success',
            message: t('writePaperBibtexExported', {
              path: `${normalizePath(workspaceRoot)}/${target}`
            })
          }
    )
  }

  const bulkSetStatus = async (status: 'unread' | 'reading' | 'read'): Promise<void> => {
    if (typeof window.kunGui?.paperUpdateMeta !== 'function') return
    const failed: string[] = []
    for (const unitDir of selection) {
      const result = await window.kunGui.paperUpdateMeta({ workspaceRoot, unitDir, patch: { status } })
        .catch((error: unknown) => ({ ok: false as const, message: String(error) }))
      if (!result.ok) failed.push(result.message)
    }
    clearSelection()
    void reload()
    if (failed.length) {
      usePaperStore.getState().setNotice({
        tone: 'error',
        message: t('writePaperOpFailed', { count: failed.length, message: failed[0] })
      })
    }
  }

  const bulkTrash = async (): Promise<void> => {
    if (selection.size === 0) return
    if (!(await confirmDialog(t('writePaperTrashConfirm', { count: selection.size })))) return
    const outcome = await trashPaperUnits([...selection])
    clearSelection()
    if (outcome.failed.length) {
      usePaperStore.getState().setNotice({
        tone: 'error',
        message: t('writePaperOpFailed', {
          count: outcome.failed.length,
          message: outcome.failed[0].message
        })
      })
    }
  }

  const allVisibleSelected = visible.length > 0 && visible.every((e) => selection.has(e.unitDir))

  // PM4: drop PDFs anywhere on the table to import them into this library.
  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDropActive(false)
    const getPath = window.kunGui?.getPathForFile
    const pdfs = Array.from(event.dataTransfer?.files ?? [])
      .map((file) => (typeof getPath === 'function' ? getPath(file) : ''))
      .filter((path) => /\.pdf$/i.test(path))
    if (!pdfs.length || !workspaceRoot) return
    const notice = usePaperStore.getState().setNotice
    void (async () => {
      let imported = 0
      for (const localPdfPath of pdfs) {
        const result = await window.kunGui.paperImport({
          workspaceRoot,
          input: '',
          localPdfPath,
          parentDir: paperReading.papersDir || 'papers',
          requestId: newPaperRequestId()
        })
        if (result.ok) imported += 1
        else notice({ tone: 'error', message: result.message })
      }
      if (imported) {
        notice({
          tone: 'success',
          message: t('writePaperDroppedImported', { count: imported })
        })
        void reload()
      }
    })()
  }

  return (
    <div
      className={`flex min-h-0 min-w-0 flex-1 flex-col ${dropActive ? 'bg-accent/[0.04]' : ''}`}
      onDragOver={(event) => { event.preventDefault(); setDropActive(true) }}
      onDragLeave={() => setDropActive(false)}
      onDrop={onDrop}
    >
      <div className="flex items-center gap-2 border-b border-ds-border-muted px-4 py-2.5">
        <BookOpen className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.9} />
        <span className="text-[14px] font-semibold text-ds-ink">
          {t('writePaperModeLibraryView')}
        </span>
        <span className="text-[12px] text-ds-faint">
          {t('writePaperLibraryCount', { shown: visible.length, total: counts.total })}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void reload()}
          title={t('writeRefreshWorkspace')}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${entriesLoading ? 'animate-spin' : ''}`} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={() => void exportBibtex()}
          className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-ds-border-muted px-2.5 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
        >
          <FileDown className="h-3.5 w-3.5" strokeWidth={1.8} />
          {t('writePaperBibtexExport')}
        </button>
        <button
          type="button"
          onClick={() => setImportDialogOpen(true)}
          className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-accent/10 px-2.5 text-[12px] font-medium text-accent transition hover:bg-accent/15"
        >
          {t('writePaperImport')}
        </button>
      </div>

      {selection.size > 0 ? (
        <div className="flex items-center gap-2 border-b border-ds-border-muted bg-accent/[0.05] px-4 py-2">
          <span className="text-[12px] font-medium text-ds-ink">
            {t('writePaperSelected', { count: selection.size })}
          </span>
          {(['unread', 'reading', 'read'] as const).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => void bulkSetStatus(status)}
              className="inline-flex h-6 items-center rounded-full border border-ds-border-muted px-2 text-[11.5px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              {t(statusLabelKey(status))}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void bulkTrash()}
            className="inline-flex h-6 items-center gap-1 rounded-full border border-red-200/70 px-2 text-[11.5px] text-red-600 transition hover:bg-red-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/40"
          >
            <Trash2 className="h-3 w-3" strokeWidth={1.9} />
            {t('writePaperTrash')}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={clearSelection}
            className="text-[11.5px] text-ds-faint transition hover:text-ds-ink"
          >
            {t('writePaperClearSelection')}
          </button>
        </div>
      ) : null}

      {entriesError ? (
        <div className="mx-4 mt-3 rounded-lg border border-red-200/70 bg-red-50/80 px-3 py-2 text-[12px] text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
          {entriesError}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex items-center gap-2 border-b border-ds-border-muted px-4 py-1.5 text-[11.5px] font-medium text-ds-faint">
          <input
            type="checkbox"
            aria-label={t('writePaperSelectAll')}
            checked={allVisibleSelected}
            onChange={() =>
              setSelection(
                allVisibleSelected
                  ? new Set<string>()
                  : new Set(visible.map((entry) => entry.unitDir))
              )
            }
            className="h-3.5 w-3.5 accent-accent"
          />
          {COLUMNS.map((column) => (
            <button
              key={column.key}
              type="button"
              onClick={() => toggleSort(column.key)}
              className={`flex items-center gap-0.5 text-left transition hover:text-ds-ink ${column.className}`}
            >
              {t(column.labelKey)}
              {sort.key === column.key ? (
                sort.dir === 'asc' ? (
                  <ArrowUp className="h-3 w-3" strokeWidth={2} />
                ) : (
                  <ArrowDown className="h-3 w-3" strokeWidth={2} />
                )
              ) : null}
            </button>
          ))}
        </div>

        {entriesLoading && visible.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-ds-faint">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
            <span className="text-[13px]">{t('loading')}</span>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <BookOpen className="h-8 w-8 text-ds-faint" strokeWidth={1.5} />
            <p className="text-[13px] text-ds-muted">{t('writePaperLibraryEmpty')}</p>
            <button
              type="button"
              onClick={() => setImportDialogOpen(true)}
              className="mt-1 inline-flex h-8 items-center rounded-full bg-accent px-4 text-[12.5px] font-semibold text-white transition hover:brightness-110"
            >
              {t('writePaperImport')}
            </button>
          </div>
        ) : (
          visible.map((entry) => (
            <LibraryRow
              key={entry.unitDir}
              entry={entry}
              selected={selection.has(entry.unitDir)}
              onToggle={() => toggleSelected(entry.unitDir)}
              onOpen={() => void openLibraryEntry(entry)}
              t={t}
            />
          ))
        )}
      </div>
    </div>
  )
}

function LibraryRow({
  entry,
  selected,
  onToggle,
  onOpen,
  t
}: {
  entry: PaperLibraryEntry
  selected: boolean
  onToggle: () => void
  onOpen: () => void
  t: (key: string, opts?: Record<string, unknown>) => string
}): ReactElement {
  const meta = entry.meta
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      className={`flex w-full cursor-pointer items-center gap-2 border-b border-ds-border-muted/60 px-4 py-2 text-left transition hover:bg-ds-hover/60 ${
        selected ? 'bg-accent/[0.06]' : ''
      }`}
    >
      <input
        type="checkbox"
        aria-label={meta.title}
        checked={selected}
        onClick={(event) => event.stopPropagation()}
        onChange={onToggle}
        className="h-3.5 w-3.5 shrink-0 accent-accent"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-ds-ink">{meta.title}</span>
          {!entry.hasPdf ? (
            <span
              title={t('writePaperMissingPdf')}
              className="inline-flex shrink-0 items-center text-amber-600 dark:text-amber-300"
            >
              <FileWarning className="h-3.5 w-3.5" strokeWidth={1.9} />
            </span>
          ) : null}
          {meta.needsReview ? (
            <span className="shrink-0 rounded-full border border-amber-300/70 px-1.5 py-px text-[10px] font-medium text-amber-700 dark:border-amber-800/60 dark:text-amber-300">
              {t('writePaperNeedsReview')}
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-ds-faint">
          <span className="truncate">{meta.authors.slice(0, 3).join(', ')}</span>
          {(meta.tags ?? []).slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="shrink-0 rounded-full bg-accent/[0.08] px-1.5 py-px text-[10.5px] text-accent"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
      <span className="w-14 shrink-0 text-[12px] text-ds-muted">{meta.year ?? ''}</span>
      <span className="w-40 shrink-0 truncate text-[12px] text-ds-muted" title={meta.venue ?? ''}>
        {meta.venue ?? ''}
      </span>
      <span className="w-24 shrink-0">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
          (meta.status ?? 'unread') === 'read'
            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            : (meta.status ?? 'unread') === 'reading'
              ? 'bg-accent/10 text-accent'
              : 'bg-slate-500/10 text-ds-muted'
        }`}>
          {t(statusLabelKey(meta.status))}
        </span>
      </span>
      <span className="w-28 shrink-0 text-[11.5px] text-ds-faint">
        {formatOpenedAt(entry.lastOpenedAt)}
      </span>
    </div>
  )
}

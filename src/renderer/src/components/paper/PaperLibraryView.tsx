import { useEffect, useMemo, useState, type DragEvent, type ReactElement } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  BookOpen,
  FolderInput,
  Loader2,
  Sparkles,
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
import {
  copyPaperEntryBibtex,
  downloadMissingPaperPdfs,
  revealPaperEntry,
  updatePaperEntryMeta
} from '../../paper/paper-library-row-actions'
import { PaperRowMenu, type PaperRowMenuAction } from './library/PaperRowMenu'
import { PaperMetaEditDialog } from './library/PaperMetaEditDialog'
import { PaperMoveGroupDialog } from './library/PaperMoveGroupDialog'
import { PaperLibraryTable } from './library/PaperLibraryTable'
import { PaperLibraryToolbar } from './library/PaperLibraryToolbar'
import {
  buildPaperMultiPrompt,
  paperMultiOutputPath,
  type PaperMultiTask
} from '../../paper/paper-multi-prompt'
import { newPaperRequestId, usePaperStore } from '../../write/paper/paper-store'
import type {
  PaperLibraryEntry,
  PaperLibrarySortKey,
  PaperUnitReadingActivity
} from '@shared/paper/paper-library-types'

function statusLabelKey(status: string | undefined): string {
  switch (status ?? 'unread') {
    case 'reading': return 'writePaperFilterReading'
    case 'read': return 'writePaperFilterRead'
    default: return 'writePaperFilterUnread'
  }
}

/** Library tab: toolbar (search + filters + actions), bulk-action bar, and
 * the sortable/selectable paper table. */
export function PaperLibraryView({
  onSubmitPrompt
}: {
  /** Sends a prompt to the Work assistant (library-level conversation). */
  onSubmitPrompt?: (value: string) => void
} = {}): ReactElement {
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
    tags,
    groups,
    setFilter,
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
      tags: s.tags,
      groups: s.groups,
      setFilter: s.setFilter,
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
  const [menu, setMenu] = useState<{ entry: PaperLibraryEntry; x: number; y: number } | null>(null)
  const [editEntry, setEditEntry] = useState<PaperLibraryEntry | null>(null)
  const [moveUnits, setMoveUnits] = useState<string[] | null>(null)
  // R3.1: mark-density data for the per-row heat bar; fetched once per tab
  // visit (main process mtime-caches the per-unit aggregates).
  const [activity, setActivity] = useState<Record<string, PaperUnitReadingActivity>>({})

  const loadActivity = async (): Promise<void> => {
    if (!workspaceRoot || typeof window.kunGui?.paperReadingActivity !== 'function') return
    const result = await window.kunGui.paperReadingActivity({
      workspaceRoot,
      papersDir: paperReading.papersDir
    }).catch(() => null)
    if (result?.ok) setActivity(result.activity)
  }

  useEffect(() => {
    void loadActivity()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceRoot])

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
        void loadActivity()
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

  const runRowAction = async (entry: PaperLibraryEntry, action: PaperRowMenuAction): Promise<void> => {
    if (typeof action === 'object') {
      await updatePaperEntryMeta(entry, { status: action.status }, t)
      return
    }
    switch (action) {
      case 'open':
        await openLibraryEntry(entry)
        return
      case 'edit':
        setEditEntry(entry)
        return
      case 'download-pdf':
        await downloadMissingPaperPdfs([entry], t)
        return
      case 'copy-bibtex':
        await copyPaperEntryBibtex(entry, t)
        return
      case 'reveal':
        await revealPaperEntry(entry)
        return
      case 'move':
        setMoveUnits([entry.unitDir])
        return
      case 'trash': {
        if (!(await confirmDialog(t('writePaperTrashConfirm', { count: 1 })))) return
        const outcome = await trashPaperUnits([entry.unitDir])
        if (outcome.failed.length) {
          usePaperStore.getState().setNotice({
            tone: 'error',
            message: t('writePaperOpFailed', { count: 1, message: outcome.failed[0].message })
          })
        }
      }
    }
  }

  const runMultiTask = (task: PaperMultiTask): void => {
    const chosen = entries.filter((entry) => selection.has(entry.unitDir))
    if (chosen.length === 0 || !onSubmitPrompt) return
    const prompt = buildPaperMultiPrompt({ task, entries: chosen, outputPath: paperMultiOutputPath(task) })
    useWriteWorkspaceStore.getState().setAssistantOpen(true)
    onSubmitPrompt(prompt)
    clearSelection()
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
      className={`flex min-h-0 min-w-0 flex-1 flex-col ${dropActive ? 'bg-accent-tint/[0.04]' : ''}`}
      onDragOver={(event) => { event.preventDefault(); setDropActive(true) }}
      onDragLeave={() => setDropActive(false)}
      onDrop={onDrop}
    >
      <PaperLibraryToolbar
        filter={filter}
        counts={counts}
        tags={tags}
        groups={groups}
        shown={visible.length}
        loading={entriesLoading}
        missingPdf={counts.missingPdf}
        onFilter={setFilter}
        onRefresh={() => void reload()}
        onDownloadMissing={() => void downloadMissingPaperPdfs(entries, t)}
        onExportBibtex={() => void exportBibtex()}
        onImport={() => setImportDialogOpen(true)}
        t={t}
      />

      {selection.size > 0 ? (
        <div className="flex items-center gap-2 border-b border-ds-border-muted bg-accent-tint/[0.05] px-4 py-2">
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
          {onSubmitPrompt ? (
            <>
              <button
                type="button"
                disabled={selection.size < 2}
                title={selection.size < 2 ? t('writePaperCompareNeedsTwo') : undefined}
                onClick={() => runMultiTask('compare')}
                className="inline-flex h-6 items-center gap-1 rounded-full border border-accent-tint/30 px-2 text-[11.5px] text-accent transition hover:bg-accent-tint/10 disabled:opacity-50"
              >
                <Sparkles className="h-3 w-3" strokeWidth={1.9} />
                {t('writePaperCompare')}
              </button>
              <button
                type="button"
                onClick={() => runMultiTask('related-work')}
                className="inline-flex h-6 items-center gap-1 rounded-full border border-accent-tint/30 px-2 text-[11.5px] text-accent transition hover:bg-accent-tint/10"
              >
                <Sparkles className="h-3 w-3" strokeWidth={1.9} />
                {t('writePaperRelatedWork')}
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => setMoveUnits([...selection])}
            className="inline-flex h-6 items-center gap-1 rounded-full border border-ds-border-muted px-2 text-[11.5px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <FolderInput className="h-3 w-3" strokeWidth={1.9} />
            {t('writePaperMoveToGroup')}
          </button>
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
        {entriesLoading && visible.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-ds-faint">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
            <span className="text-[13px]">{t('loading')}</span>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
            <BookOpen className="h-8 w-8 text-ds-faint" strokeWidth={1.4} />
            <p className="text-[13px] text-ds-muted">
              {entries.length ? t('writePaperLibraryNoMatch') : t('writePaperLibraryEmpty')}
            </p>
            {entries.length ? null : (
              <button
                type="button"
                onClick={() => setImportDialogOpen(true)}
                className="mt-1 inline-flex h-8 items-center rounded-md bg-[var(--ds-control)] px-4 text-[12.5px] font-medium text-[var(--ds-control-foreground)] transition hover:opacity-90"
              >
                {t('writePaperImport')}
              </button>
            )}
          </div>
        ) : (
          <PaperLibraryTable
            rows={visible}
            sort={sort}
            selection={selection}
            activity={activity}
            onToggleSort={toggleSort}
            onToggleSelected={toggleSelected}
            onToggleAll={() => setSelection(
              allVisibleSelected ? new Set<string>() : new Set(visible.map((entry) => entry.unitDir))
            )}
            onOpen={(entry) => void openLibraryEntry(entry)}
            onMenu={(entry, x, y) => setMenu({ entry, x, y })}
            t={t}
          />
        )}
      </div>
      {menu ? (
        <PaperRowMenu
          entry={menu.entry}
          x={menu.x}
          y={menu.y}
          onAction={(action) => void runRowAction(menu.entry, action)}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {editEntry ? <PaperMetaEditDialog entry={editEntry} onClose={() => setEditEntry(null)} /> : null}
      {moveUnits ? <PaperMoveGroupDialog unitDirs={moveUnits} onClose={() => setMoveUnits(null)} /> : null}
    </div>
  )
}


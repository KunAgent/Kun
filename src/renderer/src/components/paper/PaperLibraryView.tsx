import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactElement } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  FolderInput,
  Layers,
  List,
  Loader2,
  Sparkles,
  Table2,
  Trash2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWriteWorkspaceStore, writeBasenameFromPath } from '../../write/write-workspace-store'
import { useChatStore } from '../../store/chat-store'
import { paperSessionIds, usePaperBatchInterpret } from '../../paper/paper-batch-interpret'
import { openPaperSession } from '../../paper/paper-session-open'
import { normalizePath } from '../../write/write-workspace-store-helpers'
import { confirmDialog } from '../../lib/confirm-dialog'
import { emptyPaperLibraryFilter, usePaperModeStore } from '../../paper/paper-mode-store'
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
import { PaperLibraryTable, statusLabelKey } from './library/PaperLibraryTable'
import { PaperLibraryDetailPanel, useLibraryHasRoom } from './library/PaperLibraryDetailPanel'
import { PaperLibraryToolbar } from './library/PaperLibraryToolbar'
import { PaperLibraryEmptyState } from './library/PaperLibraryEmptyState'
import paperSurface from './PaperWorkspaceSurface.module.css'
import { PaperMatrixWorkspace } from './evidence/PaperMatrixWorkspace'
import { buildPaperMultiPrompt, paperMultiOutputPath, type PaperMultiTask } from '../../paper/paper-multi-prompt'
import { interpretPaperWithAssistant } from '../../write/paper/paper-actions'
import { usePaperStore } from '../../write/paper/paper-store'
import type {
  PaperLibraryEntry,
  PaperLibrarySortKey,
  PaperUnitReadingActivity
} from '@shared/paper/paper-library-types'
import { setImportFolder } from '../../paper/paper-import-target'
import { usePaperImportDraft } from '../../paper/paper-import-draft'

/** Library tab: toolbar (search + filters + actions), bulk-action bar, and
 * the sortable/selectable paper table. */
export function PaperLibraryView({
  onSubmitPrompt
}: {
  /** Sends a prompt to the Work assistant (library-level conversation). */
  onSubmitPrompt?: (value: string) => void
} = {}): ReactElement {
  const { t } = useTranslation('common')
  const { workspaceRoot, paperReading, defaultWorkspaceRoot } = useWriteWorkspaceStore(
    useShallow((s) => ({
      workspaceRoot: s.workspaceRoot,
      paperReading: s.paperReading,
      defaultWorkspaceRoot: s.defaultWorkspaceRoot
    }))
  )
  // Readings and batch interpretations are sessions anchored to the paper.
  const threadCount = useChatStore((s) => s.threads.length)
  const batchItems = usePaperBatchInterpret((s) => s.job?.items)
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
  const [matrixOpen, setMatrixOpen] = useState(false)
  const [menu, setMenu] = useState<{ entry: PaperLibraryEntry; x: number; y: number } | null>(null)
  const [editEntry, setEditEntry] = useState<PaperLibraryEntry | null>(null)
  const [moveUnits, setMoveUnits] = useState<string[] | null>(null)
  const [focusedDir, setFocusedDir] = useState<string | null>(null)
  const [listAreaRef, hasRoomForDetail] = useLibraryHasRoom()
  // R3.1: mark-density data for the per-row heat bar; fetched once per tab
  // visit (main process mtime-caches the per-unit aggregates).
  const activityRequest = useRef(0)
  const reloadRequest = useRef(0)
  const [activity, setActivity] = useState<Record<string, PaperUnitReadingActivity>>({})

  const loadActivity = async (): Promise<void> => {
    if (!workspaceRoot || typeof window.kunGui?.paperReadingActivity !== 'function') return
    const request = ++activityRequest.current
    const result = await window.kunGui.paperReadingActivity({
      workspaceRoot,
      papersDir: paperReading.papersDir
    }).catch(() => null)
    if (result?.ok && request === activityRequest.current && workspaceRoot === useWriteWorkspaceStore.getState().workspaceRoot) setActivity(result.activity)
  }

  useEffect(() => {
    setActivity({})
    void loadActivity()
    return () => {
      activityRequest.current += 1
      reloadRequest.current += 1
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceRoot])

  const visible = useMemo(
    () => sortPaperEntries(filterPaperEntries(entries, filter), sort),
    [entries, filter, sort]
  )
  const sessionCounts = useMemo(() => Object.fromEntries(
    entries.map((entry) => [entry.unitDir, paperSessionIds(workspaceRoot, entry.unitDir).length])
  ), [entries, workspaceRoot, threadCount, batchItems]) // eslint-disable-line react-hooks/exhaustive-deps
  const openSessions = (entry: PaperLibraryEntry): void => {
    const [latest] = paperSessionIds(workspaceRoot, entry.unitDir)
    if (latest) void openPaperSession(workspaceRoot, latest, entry.unitDir)
  }
  const interpretSelected = (): void => {
    const chosen = visible.filter((entry) => selection.has(entry.unitDir))
    usePaperBatchInterpret.getState().openDialog(workspaceRoot, chosen.map(({ unitDir, meta }) => ({ unitDir, meta })))
  }
  const spaceName = workspaceRoot === defaultWorkspaceRoot ? t('writeDefaultSpace') : writeBasenameFromPath(workspaceRoot)

  const reload = async (): Promise<void> => {
    if (!workspaceRoot || typeof window.kunGui?.paperLibraryList !== 'function') return
    const request = ++reloadRequest.current
    const isCurrent = (): boolean => request === reloadRequest.current && workspaceRoot === useWriteWorkspaceStore.getState().workspaceRoot
    setEntriesLoading(true)
    try {
      const result = await window.kunGui.paperLibraryList({
        workspaceRoot,
        papersDir: paperReading.papersDir
      })
      if (!isCurrent()) return
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
      if (!isCurrent()) return
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
    const outcome = await trashPaperUnits([...selection], workspaceRoot)
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
      await updatePaperEntryMeta(entry, { status: action.status }, t, workspaceRoot)
      return
    }
    switch (action) {
      case 'open':
        await openLibraryEntry(entry, workspaceRoot, t)
        return
      case 'interpret':
        await interpretPaperWithAssistant({ t, workspaceRoot, unitDir: entry.unitDir, meta: entry.meta })
        return
      case 'edit':
        setEditEntry(entry)
        return
      case 'download-pdf':
        await downloadMissingPaperPdfs([entry], t, workspaceRoot)
        return
      case 'copy-bibtex':
        await copyPaperEntryBibtex(entry, t, workspaceRoot)
        return
      case 'reveal':
        await revealPaperEntry(entry, workspaceRoot)
        return
      case 'move':
        setMoveUnits([entry.unitDir])
        return
      case 'trash': {
        if (!(await confirmDialog(t('writePaperTrashConfirm', { count: 1 })))) return
        const outcome = await trashPaperUnits([entry.unitDir], workspaceRoot)
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
    // The assistant reads each paper's files and writes one note under notes/.
    onSubmitPrompt(buildPaperMultiPrompt({ task, entries: chosen, outputPath: paperMultiOutputPath(task) }))
    clearSelection()
  }

  const detailEntry = hasRoomForDetail && focusedDir ? visible.find((entry) => entry.unitDir === focusedDir) ?? null : null
  const allVisibleSelected = visible.length > 0 && visible.every((e) => selection.has(e.unitDir))

  // Drop PDFs anywhere on the library: the import dialog takes them (with a
  // folder filter active they land in that folder) and reports each one.
  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDropActive(false)
    const getPath = window.kunGui?.getPathForFile
    const pdfs = Array.from(event.dataTransfer?.files ?? [])
      .map((file) => (typeof getPath === 'function' ? getPath(file) : ''))
      .filter((path) => /\.pdf$/i.test(path))
    if (!pdfs.length || !workspaceRoot) return
    if (filter.group) setImportFolder(filter.group, workspaceRoot)
    usePaperImportDraft.getState().queue(pdfs)
    setImportDialogOpen(true)
  }

  return (
    <div
      className={`${paperSurface.surface} flex min-h-0 min-w-0 flex-1 flex-col ${dropActive ? 'bg-accent-tint/[0.04]' : ''}`}
      onDragOver={(event) => { event.preventDefault(); setDropActive(true) }}
      onDragLeave={() => setDropActive(false)}
      onDrop={onDrop}
    >
      <header className="flex shrink-0 flex-wrap items-end gap-3 px-6 pb-3 pt-5">
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-bold tracking-[-0.01em] text-ds-ink">{t('workSidebarLibrary')}</h1>
          <p className="mt-0.5 truncate text-[12.5px] text-ds-faint" title={workspaceRoot}>
            {t('paperLibrarySummary', { space: spaceName, total: counts.total, unread: counts.unread, reading: counts.reading })}
          </p>
        </div>
        <div role="tablist" aria-label={t('paperLibraryViewLabel')} className="inline-flex rounded-full bg-ds-hover p-[3px]">
          <button type="button" role="tab" aria-selected={!matrixOpen} onClick={() => setMatrixOpen(false)}
            className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12.5px] transition ${matrixOpen ? 'text-ds-muted hover:text-ds-ink' : 'bg-ds-card font-semibold text-ds-ink shadow-sm'}`}>
            <List className="h-3.5 w-3.5" strokeWidth={1.9} />{t('paperLibraryViewList')}
          </button>
          <button type="button" role="tab" aria-selected={matrixOpen} data-testid="paper-open-matrix" onClick={() => setMatrixOpen(true)}
            title={t('paperReadingLocalControls')}
            className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12.5px] transition ${matrixOpen ? 'bg-ds-card font-semibold text-ds-ink shadow-sm' : 'text-ds-muted hover:text-ds-ink'}`}>
            <Table2 className="h-3.5 w-3.5" strokeWidth={1.9} />{t('paperMatrixTitle')}
          </button>
        </div>
      </header>
      {matrixOpen ? (
        <PaperMatrixWorkspace workspaceRoot={workspaceRoot} selected={entries.filter((entry) => selection.has(entry.unitDir))} onClose={() => setMatrixOpen(false)} />
      ) : (<>
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
        onDownloadMissing={() => void downloadMissingPaperPdfs(entries, t, workspaceRoot)}
        onExportBibtex={() => void exportBibtex()}
        onImport={() => setImportDialogOpen(true)}
        onShowInfo={() => usePaperModeStore.getState().openInfoDrawer()}
        t={t}
      />

      {selection.size > 0 ? (
        <div data-testid="paper-batch-bar" className="paper-batch-bar mx-5 mb-1 mt-2.5 flex min-h-10 flex-wrap items-center gap-1.5 rounded-xl py-1.5 pl-3.5 pr-2 text-[13px]">
          <span className="mr-1 text-[13px] font-medium">
            {t('writePaperSelected', { count: selection.size })}
          </span>
          <button
            type="button"
            data-testid="paper-batch-interpret"
            onClick={interpretSelected}
            className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12.5px] transition paper-batch-button is-primary"
          >
            <Layers className="h-3.5 w-3.5" strokeWidth={1.9} />
            {t('paperBatchAction', { count: selection.size })}
          </button>
          {(['unread', 'reading', 'read'] as const).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => void bulkSetStatus(status)}
              className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12.5px] transition paper-batch-button"
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
                className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12.5px] transition paper-batch-button disabled:opacity-50"
              >
                <Sparkles className="h-3 w-3" strokeWidth={1.9} />
                {t('writePaperCompare')}
              </button>
              <button
                type="button"
                onClick={() => runMultiTask('related-work')}
                className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12.5px] transition paper-batch-button"
              >
                <Sparkles className="h-3 w-3" strokeWidth={1.9} />
                {t('writePaperRelatedWork')}
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => setMoveUnits([...selection])}
            className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12.5px] transition paper-batch-button"
          >
            <FolderInput className="h-3 w-3" strokeWidth={1.9} />
            {t('writePaperMoveToGroup')}
          </button>
          <button
            type="button"
            onClick={() => void bulkTrash()}
            className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12.5px] transition paper-batch-button is-danger"
          >
            <Trash2 className="h-3 w-3" strokeWidth={1.9} />
            {t('writePaperTrash')}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={clearSelection}
            className="paper-batch-clear h-7 rounded-full px-2.5 text-[12px] transition"
          >
            {t('writePaperClearSelection')}
          </button>
        </div>
      ) : null}

      {entriesError ? (
        <div role="alert" className="mx-4 mt-3 break-words rounded-lg border border-red-200/70 bg-red-50/80 px-3 py-2 text-[12px] text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
          {entriesError}
        </div>
      ) : null}

      <div ref={listAreaRef} className="flex min-h-0 flex-1">
      <div className="min-h-0 min-w-0 flex-1 overflow-auto pt-1">
        {entriesLoading && visible.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-ds-faint">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
            <span className="text-[13px]">{t('loading')}</span>
          </div>
        ) : visible.length === 0 ? (
          entriesError ? (
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <p className="max-w-md text-[13px] leading-6 text-ds-muted">{t('paperWorkspaceUnavailableHint')}</p>
              <button type="button" onClick={() => void reload()} className="rounded-lg border border-ds-border-muted px-4 py-2 text-[12px] text-ds-ink hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                {t('paperWorkspaceRetry')}
              </button>
            </div>
          ) : (
            <PaperLibraryEmptyState
              filtered={entries.length > 0}
              onImport={() => setImportDialogOpen(true)}
              onClearFilters={() => setFilter(emptyPaperLibraryFilter())}
            />
          )
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
            onOpen={(entry) => void openLibraryEntry(entry, workspaceRoot, t)}
            focused={detailEntry?.unitDir ?? null}
            onFocus={hasRoomForDetail ? (entry) => setFocusedDir(entry.unitDir) : undefined}
            onMenu={(entry, x, y) => setMenu({ entry, x, y })}
            sessionCounts={sessionCounts}
            onOpenSessions={openSessions}
            t={t}
          />
        )}
      </div>
      {detailEntry ? (
        <PaperLibraryDetailPanel
          entry={detailEntry}
          sessions={sessionCounts[detailEntry.unitDir] ?? 0}
          onOpen={() => void openLibraryEntry(detailEntry, workspaceRoot, t)}
          onInterpret={() => void interpretPaperWithAssistant({ t, workspaceRoot, unitDir: detailEntry.unitDir, meta: detailEntry.meta })}
          onOpenSessions={() => openSessions(detailEntry)}
          onClose={() => setFocusedDir(null)}
          t={t}
        />
      ) : null}
      </div>
      </>)}
      {menu ? (
        <PaperRowMenu
          entry={menu.entry}
          x={menu.x}
          y={menu.y}
          onAction={(action) => void runRowAction(menu.entry, action)}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {editEntry ? (
        <PaperMetaEditDialog entry={editEntry} libraryRoot={workspaceRoot} onClose={() => setEditEntry(null)} />
      ) : null}
      {moveUnits ? (
        <PaperMoveGroupDialog unitDirs={moveUnits} libraryRoot={workspaceRoot} onClose={() => setMoveUnits(null)} />
      ) : null}
    </div>
  )
}


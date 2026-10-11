import { useEffect, useRef, useState, type DragEvent, type ReactElement } from 'react'
import {
  CheckCircle2,
  CircleDashed,
  FileUp,
  GraduationCap,
  Loader2,
  MinusCircle,
  X,
  XCircle
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  localPdfImportLine,
  parsePaperImportInput
} from '../../../paper/paper-import-classify'
import {
  cancelPaperImportItem,
  newPaperImportItem,
  pickPaperImportCandidate,
  runPaperImportQueue,
  type PaperImportQueueItem,
  type PaperImportItemStatus
} from '../../../paper/paper-import-queue'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { PaperSearchCandidates } from './PaperSearchCandidates'
import { PaperImportFolderPicker } from './PaperImportFolderPicker'
import { currentImportParentDir } from '../../../paper/paper-import-target'
import { usePaperImportDraft } from '../../../paper/paper-import-draft'
import { rememberPaperSpace } from '../../../paper/paper-mode-actions'
import { usePaperBatchInterpret } from '../../../paper/paper-batch-interpret'
import { openPaperUnit } from '../../../write/paper/paper-open-layout'
import { useWriteWorkspaceStore, writeBasenameFromPath } from '../../../write/write-workspace-store'

const STATUS_ICON: Record<PaperImportItemStatus, ReactElement> = {
  pending: <CircleDashed className="h-3.5 w-3.5 text-ds-faint" strokeWidth={2} />,
  resolving: <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" strokeWidth={2} />,
  picking: <CircleDashed className="h-3.5 w-3.5 text-amber-500" strokeWidth={2} />,
  importing: <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" strokeWidth={2} />,
  done: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" strokeWidth={2} />,
  failed: <XCircle className="h-3.5 w-3.5 text-red-500" strokeWidth={2} />,
  skipped: <MinusCircle className="h-3.5 w-3.5 text-ds-faint" strokeWidth={2} />,
  canceled: <MinusCircle className="h-3.5 w-3.5 text-ds-faint" strokeWidth={2} />
}

const ACTIVE: ReadonlySet<PaperImportItemStatus> = new Set([
  'pending',
  'resolving',
  'picking',
  'importing'
])

/**
 * Multiline import dialog (PM4): paste arXiv ids/URLs, DOIs, papers.cool
 * links, publisher URLs, BibTeX blocks, or bare titles — one status row per
 * line, 2 concurrent imports, per-row cancel and pick for title matches.
 * Papers land in the current space; PDFs dropped elsewhere arrive here and
 * start at once. A finished run summarizes what was added (and what was
 * already there) and offers the next step: open, interpret all, or browse.
 */
export function PaperImportDialog({
  workspaceRoot,
  papersDir,
  folderPicker = false,
  onClose
}: {
  workspaceRoot: string
  papersDir?: string
  /** Paper mode: let the user file imports into a library folder. */
  folderPicker?: boolean
  onClose: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [value, setValue] = useState('')
  const [items, setItems] = useState<PaperImportQueueItem[]>([])
  const [downloadPdfs, setDownloadPdfs] = useState(true)
  const [running, setRunning] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [finished, setFinished] = useState(false)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const refreshEntries = usePaperModeStore((s) => s.refreshEntries)
  const defaultWorkspaceRoot = useWriteWorkspaceStore((s) => s.defaultWorkspaceRoot)
  const spaceName = workspaceRoot === defaultWorkspaceRoot ? t('writeDefaultSpace') : writeBasenameFromPath(workspaceRoot)

  const patchItem = (next: PaperImportQueueItem): void => {
    setItems((prev) => prev.map((item) => (item.id === next.id ? next : item)))
  }

  const appendLines = (lines: Parameters<typeof newPaperImportItem>[0][]): void => {
    if (!lines.length) return
    setItems((prev) => [...prev, ...lines.map(newPaperImportItem)])
  }

  const pickFiles = async (): Promise<void> => {
    if (running || typeof window.kunGui?.pickLocalFiles !== 'function') return
    const picked = await window.kunGui.pickLocalFiles()
    if (picked.canceled) return
    const pdfs = picked.paths.filter((path) => /\.pdf$/i.test(path))
    const bibs = picked.paths.filter((path) => /\.bib$/i.test(path))
    if (pdfs.length) appendLines(pdfs.map(localPdfImportLine))
    for (const bib of bibs) await appendBibFile(bib)
    if (!pdfs.length && !bibs.length && picked.paths.length) {
      setItems((prev) => prev)
    }
  }

  const appendBibFile = async (path: string): Promise<void> => {
    const result = await window.kunGui.readWorkspaceFile({ path })
    if (result.ok && result.content.trim()) {
      appendLines(parsePaperImportInput(result.content))
    }
  }

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDragOver(false)
    if (running) return
    const files = Array.from(event.dataTransfer?.files ?? [])
    for (const file of files) {
      const path =
        typeof window.kunGui?.getPathForFile === 'function'
          ? window.kunGui.getPathForFile(file)
          : ''
      if (!path) continue
      if (/\.pdf$/i.test(path)) appendLines([localPdfImportLine(path)])
      else if (/\.bib$/i.test(path)) void appendBibFile(path)
    }
  }

  const parseTextarea = (): PaperImportQueueItem[] => {
    const lines = parsePaperImportInput(value)
    if (!lines.length) return []
    const created = lines.map(newPaperImportItem)
    setItems((prev) => [...prev, ...created])
    setValue('')
    return created
  }

  const start = async (extra: PaperImportQueueItem[] = []): Promise<void> => {
    const created = parseTextarea()
    const known = new Set(itemsRef.current.map((item) => item.id))
    const queue = [...itemsRef.current, ...extra.filter((item) => !known.has(item.id)), ...created].filter(
      (item) => item.status === 'pending'
    )
    if (!queue.length) return
    setRunning(true)
    setFinished(false)
    try {
      await runPaperImportQueue(
        queue,
        { workspaceRoot, papersDir: folderPicker ? currentImportParentDir() : papersDir, downloadPdfs },
        { onItem: patchItem }
      )
    } finally {
      setRunning(false)
      setFinished(true)
      refreshEntries()
      if (itemsRef.current.some((item) => item.status === 'done' && !item.reused)) void rememberPaperSpace(workspaceRoot)
    }
  }

  // Esc closes and ⌘/Ctrl+Enter imports, wherever focus is (a dropped
  // import starts without focusing the dialog).
  const keysRef = useRef({ running, onClose, start })
  keysRef.current = { running, onClose, start }
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const { running: busy, onClose: close, start: run } = keysRef.current
      if (busy) return
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        void run()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // PDFs dropped on the library or the space start right away.
  useEffect(() => {
    const dropped = usePaperImportDraft.getState().take()
    if (!dropped.length) return
    const created = dropped.map((path) => newPaperImportItem(localPdfImportLine(path)))
    setItems((prev) => [...prev, ...created])
    void start(created)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const imported = items.filter((item) => item.status === 'done' && item.unitDir && item.meta)
  const added = imported.filter((item) => !item.reused).length
  const failed = items.filter((item) => item.status === 'failed').length
  const openSingle = (): void => {
    const [item] = imported
    if (!item?.unitDir || !item.meta) return
    onClose()
    void openPaperUnit({ workspaceRoot, unitDir: item.unitDir, meta: item.meta })
  }
  const interpretAll = (): void => {
    const papers = imported.flatMap((item) => item.unitDir && item.meta ? [{ unitDir: item.unitDir, meta: item.meta }] : [])
    onClose()
    usePaperBatchInterpret.getState().openDialog(workspaceRoot, papers)
  }
  const browseLibrary = (): void => {
    onClose()
    useWriteWorkspaceStore.getState().openPaperViewTab('library')
  }

  const cancelAll = (): void => {
    for (const item of itemsRef.current) {
      if (ACTIVE.has(item.status)) {
        cancelPaperImportItem(item)
        patchItem({ ...item })
      }
    }
  }

  const anyActive = items.some((item) => ACTIVE.has(item.status))

  return (
    <div
      className="ds-no-drag fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/18 px-4 backdrop-blur-[2px] dark:bg-black/35"
      onMouseDown={() => { if (!running) onClose() }}
    >
      <div
        role="dialog"
        aria-label={t('paperImportIntoSpace', { space: spaceName })}
        data-testid="paper-import-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        onDragOver={(event) => { event.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex max-h-[80vh] w-full max-w-lg flex-col rounded-[24px] border bg-ds-card p-5 shadow-[0_24px_72px_rgba(20,47,95,0.22)] ${
          dragOver ? 'border-accent-tint/60' : 'border-ds-border'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-tint/10 text-accent">
            <GraduationCap className="h-5 w-5" strokeWidth={1.9} />
          </span>
          <h2 className="min-w-0 truncate text-[18px] font-semibold tracking-[-0.035em] text-ds-ink" title={workspaceRoot}>
            {t('paperImportIntoSpace', { space: spaceName })}
          </h2>
        </div>
        <p className="mt-2 text-[13px] leading-6 text-ds-muted">
          {t('writePaperImportLinesDesc')}
        </p>

        <textarea
          value={value}
          disabled={running}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t('writePaperImportLinesPlaceholder')}
          spellCheck={false}
          rows={4}
          className="mt-3 w-full resize-none rounded-xl border border-ds-border bg-ds-main px-3 py-2 font-mono text-[12.5px] leading-5 text-ds-ink outline-none transition focus:border-accent-tint/40 focus:ring-1 focus:ring-accent-tint/25 disabled:opacity-60"
        />

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={running}
            onClick={() => void pickFiles()}
            className="inline-flex items-center gap-1.5 rounded-lg text-[12.5px] font-medium text-ds-muted transition hover:text-accent disabled:opacity-60"
          >
            <FileUp className="h-3.5 w-3.5" strokeWidth={1.9} />
            {t('writePaperImportPickFiles')}
          </button>
          {folderPicker ? <PaperImportFolderPicker className="ml-auto" /> : null}
          <label className={`${folderPicker ? '' : 'ml-auto '}inline-flex items-center gap-1.5 text-[12.5px] text-ds-muted`}>
            <input
              type="checkbox"
              checked={downloadPdfs}
              disabled={running}
              onChange={(event) => setDownloadPdfs(event.target.checked)}
              className="h-3.5 w-3.5 accent-accent"
            />
            {t('writePaperImportDownloadPdfs')}
          </label>
        </div>

        {items.length ? (
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-xl border border-ds-border-muted">
            {items.map((item) => (
              <div key={item.id} className="border-b border-ds-border-muted px-3 py-2 last:border-b-0">
                <div className="flex items-center gap-2">
                  {STATUS_ICON[item.status]}
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ds-ink">
                    {item.line.raw.length > 80 ? `${item.line.raw.slice(0, 80)}…` : item.line.raw}
                  </span>
                  {item.detail ? (
                    <span className="min-w-0 max-w-[45%] truncate text-[11.5px] text-ds-muted">
                      {item.reused ? `${t('paperImportAlreadyIn')} · ` : ''}{item.detail}
                    </span>
                  ) : null}
                  {ACTIVE.has(item.status) ? (
                    <button
                      type="button"
                      aria-label={t('writePaperCancel')}
                      onClick={() => { cancelPaperImportItem(item); patchItem({ ...item }) }}
                      className="shrink-0 rounded p-0.5 text-ds-faint transition hover:text-ds-ink"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  ) : null}
                </div>
                {item.status === 'picking' && item.candidates ? (
                  <PaperSearchCandidates
                    candidates={item.candidates}
                    onPick={(choice) => pickPaperImportCandidate(item, choice)}
                  />
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {finished && !running && items.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-ds-subtle/60 px-3 py-2.5 text-[12.5px]"
            data-testid="paper-import-summary">
            <span className="min-w-0 flex-1 text-ds-ink">
              {t('paperImportSummary', { added, existing: imported.length - added, failed })}
            </span>
            {imported.length === 1 ? (
              <button type="button" onClick={openSingle}
                className="rounded-lg px-2 py-1 font-medium text-accent transition hover:bg-accent/10">
                {t('workPaperOpen')}
              </button>
            ) : null}
            {imported.length > 0 ? (
              <button type="button" onClick={interpretAll} data-testid="paper-import-interpret"
                className="rounded-lg px-2 py-1 font-medium text-accent transition hover:bg-accent/10">
                {t('paperImportInterpretAll', { count: imported.length })}
              </button>
            ) : null}
            <button type="button" onClick={browseLibrary}
              className="rounded-lg px-2 py-1 font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink">
              {t('paperImportBrowse')}
            </button>
          </div>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          {anyActive ? (
            <button
              type="button"
              onClick={cancelAll}
              className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
              {t('writePaperImportCancelAll')}
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              {finished ? t('paperImportDone') : t('writeEntryDialogCancel')}
            </button>
          )}
          <button
            type="button"
            disabled={running}
            onClick={() => void start()}
            title="⌘/Ctrl + Enter"
            className="rounded-xl bg-accent px-3 py-2 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {t('writePaperImportSubmit')}
          </button>
        </div>
      </div>
    </div>
  )
}

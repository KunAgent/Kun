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
import { pickPaperImportCandidate, type PaperImportItemStatus } from '../../../paper/paper-import-queue'
import { usePaperImportDraft } from '../../../paper/paper-import-draft'
import { usePaperBatchInterpret } from '../../../paper/paper-batch-interpret'
import { openPaperSpace, openPaperSpaceItem, refreshPaperSpace } from '../../../paper/paper-space'
import { usePaperSpaceStore } from '../../../paper/paper-space-store'
import { appendPaperImportFiles, cancelPaperImportSessionItem, editFailedPaperImportInput, startPaperImportSession, usePaperImportSession } from '../../../paper/paper-import-session'
import { PaperSearchCandidates } from './PaperSearchCandidates'

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

/** A view of the app-owned import task. Closing or navigating never cancels it. */
export function PaperImportDialog({ onClose }: { onClose: () => void }): ReactElement {
  const { t } = useTranslation('common')
  const { value, items, downloadPdfs, running, finished, error } = usePaperImportSession()
  const [dragOver, setDragOver] = useState(false)
  const queued = usePaperImportDraft((state) => state.pdfs)
  const start = (): Promise<void> => startPaperImportSession()
  const spaceName = t('workSidebarLibrary')

  const pickFiles = async (): Promise<void> => {
    if (typeof window.kunGui?.pickLocalFiles !== 'function') return
    const picked = await window.kunGui.pickLocalFiles()
    if (!picked.canceled) await appendPaperImportFiles(picked.paths)
  }
  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDragOver(false)
    const paths = Array.from(event.dataTransfer?.files ?? []).map((file) => window.kunGui.getPathForFile(file)).filter(Boolean)
    void appendPaperImportFiles(paths)
  }

  const keysRef = useRef({ running, onClose })
  keysRef.current = { running, onClose }
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); keysRef.current.onClose() }
      else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !keysRef.current.running) {
        event.preventDefault(); void startPaperImportSession()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    const paths = usePaperImportDraft.getState().take()
    if (paths.length) void appendPaperImportFiles(paths).then(() => startPaperImportSession())
  }, [queued])

  const imported = items.filter((item) => item.status === 'done' && item.unitDir && item.meta)
  const added = imported.filter((item) => !item.reused).length
  const failed = items.filter((item) => item.status === 'failed').length
  const openSingle = async (): Promise<void> => {
    const [item] = imported
    if (!item?.unitDir || !item.workspaceRoot) return
    onClose()
    await refreshPaperSpace()
    const found = usePaperSpaceStore.getState().items.find((paper) => paper.libraryRoot === item.workspaceRoot && paper.entry.unitDir === item.unitDir)
    if (found) await openPaperSpaceItem(found)
  }
  const interpretAll = (): void => {
    const papers = imported.flatMap((item) => item.unitDir && item.meta && item.workspaceRoot
      ? [{ unitDir: item.unitDir, meta: item.meta, workspaceRoot: item.workspaceRoot }] : [])
    const root = usePaperImportSession.getState().workspaceRoot
    if (!root) return
    onClose()
    usePaperBatchInterpret.getState().openDialog(root, papers)
  }
  const browseLibrary = (): void => { onClose(); void openPaperSpace() }
  const cancelAll = (): void => {
    for (const item of usePaperImportSession.getState().items) cancelPaperImportSessionItem(item)
  }

  const anyActive = items.some((item) => ACTIVE.has(item.status))

  return (
    <div
      className="ds-no-drag fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/18 px-4 backdrop-blur-[2px] dark:bg-black/35"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-label={t('paperImportIntoSpace', { space: spaceName })}
        data-testid="paper-import-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        onDragOver={(event) => { event.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex max-h-[80vh] w-full max-w-2xl flex-col rounded-[24px] border bg-ds-card p-5 shadow-[0_24px_72px_rgba(20,47,95,0.22)] ${
          dragOver ? 'border-accent-tint/60' : 'border-ds-border'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-tint/10 text-accent">
            <GraduationCap className="h-5 w-5" strokeWidth={1.9} />
          </span>
          <h2 className="min-w-0 flex-1 truncate text-[18px] font-semibold tracking-[-0.035em] text-ds-ink" title={t('paperSpaceOneSpace')}>
            {t('paperImportIntoSpace', { space: spaceName })}
          </h2>
          <button type="button" aria-label={t('close')} onClick={onClose} className="shrink-0 rounded-lg p-1 text-ds-faint hover:bg-ds-hover hover:text-ds-ink">
            <X className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>
        <p className="mt-2 text-[13px] leading-6 text-ds-muted">
          {t('writePaperImportLinesDesc')} {t('paperSpaceImportHint')}
        </p>

        {error ? <p role="alert" className="mt-3 text-[13px] text-red-500">{error}</p> : null}
        <textarea
          value={value}
          disabled={running}
          onChange={(event) => usePaperImportSession.setState({ value: event.target.value })}
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
          <label className="ml-auto inline-flex items-center gap-1.5 text-[12.5px] text-ds-muted">
            <input
              type="checkbox"
              checked={downloadPdfs}
              disabled={running}
              onChange={(event) => usePaperImportSession.setState({ downloadPdfs: event.target.checked })}
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
                      onClick={() => cancelPaperImportSessionItem(item)}
                      className="shrink-0 rounded p-0.5 text-ds-faint transition hover:text-ds-ink"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  ) : null}
                </div>
                {item.pdfError ? <p className="mt-1 text-[11.5px] text-amber-600 dark:text-amber-400" role="status">
                  {t('paperImportPdfFailed', { message: item.pdfError })}
                </p> : null}
                {item.status === 'failed' && !item.sourceFile && item.line.kind !== 'localPdf' ? <textarea
                  value={item.retryInput ?? item.line.ref} rows={item.line.kind === 'bibtex' ? 3 : 1} disabled={running}
                  aria-label={t('writePaperImportLinesPlaceholder')} placeholder={t('writePaperImportLinesPlaceholder')}
                  onChange={(event) => editFailedPaperImportInput(item.id, event.target.value)}
                  className="mt-2 w-full resize-y rounded-lg border border-ds-border bg-ds-card px-2 py-1.5 font-mono text-[12px] text-ds-ink focus:border-accent focus:outline-none"
                /> : null}
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
              <button type="button" onClick={() => void openSingle()}
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

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <span className="mr-auto self-center text-[12px] text-ds-muted">{t('paperSpaceImportBackground')}</span>
          {failed > 0 ? <button type="button" disabled={running} onClick={() => void startPaperImportSession(true)}
            className="rounded-xl border border-ds-border px-3 py-2 text-[13px] text-accent disabled:opacity-55">{t('paperSpaceRetryFailed', { count: failed })}</button> : null}
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
            disabled={running || (!value.trim() && !items.some((item) => item.status === 'pending'))}
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

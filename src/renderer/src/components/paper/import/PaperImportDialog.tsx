import { useRef, useState, type DragEvent, type ReactElement } from 'react'
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
 */
export function PaperImportDialog({
  workspaceRoot,
  papersDir,
  onClose
}: {
  workspaceRoot: string
  papersDir?: string
  onClose: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [value, setValue] = useState('')
  const [items, setItems] = useState<PaperImportQueueItem[]>([])
  const [downloadPdfs, setDownloadPdfs] = useState(true)
  const [running, setRunning] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const refreshEntries = usePaperModeStore((s) => s.refreshEntries)

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

  const start = async (): Promise<void> => {
    const created = parseTextarea()
    const queue = [...itemsRef.current, ...created].filter(
      (item) => item.status === 'pending'
    )
    if (!queue.length) return
    setRunning(true)
    try {
      await runPaperImportQueue(
        queue,
        { workspaceRoot, papersDir, downloadPdfs },
        { onItem: patchItem }
      )
    } finally {
      setRunning(false)
      refreshEntries()
    }
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
        onMouseDown={(event) => event.stopPropagation()}
        onDragOver={(event) => { event.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex max-h-[80vh] w-full max-w-lg flex-col rounded-[24px] border bg-ds-card p-5 shadow-[0_24px_72px_rgba(20,47,95,0.22)] ${
          dragOver ? 'border-accent/60' : 'border-ds-border'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <GraduationCap className="h-5 w-5" strokeWidth={1.9} />
          </span>
          <h2 className="text-[18px] font-semibold tracking-[-0.035em] text-ds-ink">
            {t('writePaperImportTitle')}
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
          className="mt-3 w-full resize-none rounded-xl border border-ds-border bg-ds-main/65 px-3 py-2 font-mono text-[12.5px] leading-5 text-ds-ink outline-none transition focus:border-accent/40 focus:ring-1 focus:ring-accent/25 disabled:opacity-60"
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
              onChange={(event) => setDownloadPdfs(event.target.checked)}
              className="h-3.5 w-3.5 accent-accent"
            />
            {t('writePaperImportDownloadPdfs')}
          </label>
        </div>

        {items.length ? (
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-xl border border-ds-border-muted">
            {items.map((item) => (
              <div key={item.id} className="border-b border-ds-border-muted/60 px-3 py-2 last:border-b-0">
                <div className="flex items-center gap-2">
                  {STATUS_ICON[item.status]}
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ds-ink">
                    {item.line.raw.length > 80 ? `${item.line.raw.slice(0, 80)}…` : item.line.raw}
                  </span>
                  {item.detail ? (
                    <span className="min-w-0 max-w-[45%] truncate text-[11.5px] text-ds-muted">
                      {item.detail}
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
              {t('writeEntryDialogCancel')}
            </button>
          )}
          <button
            type="button"
            disabled={running}
            onClick={() => void start()}
            className="rounded-xl bg-accent px-3 py-2 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {t('writePaperImportSubmit')}
          </button>
        </div>
      </div>
    </div>
  )
}

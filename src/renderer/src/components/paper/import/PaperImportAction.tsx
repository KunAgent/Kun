import { useMemo, useState, type ReactElement } from 'react'
import { ChevronDown, Download, Loader2, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { importFolderLabel } from '../../../paper/paper-import-target'
import { cancelPaperImport, importJobCounts, usePaperImportJobs } from '../../../paper/paper-import-job'
import { suggestTopicFolder, type ImportCandidate } from '../../../paper/paper-import-plan'
import { readImportSheetPrefs } from '../../../paper/paper-import-sheet-prefs'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { PaperImportSheet } from './PaperImportSheet'

/**
 * The single "import" control of every paper surface: a split button that
 * names the destination and opens the import sheet; while a job runs it turns
 * into a progress readout with Stop. Rows never carry their own import button.
 */
export function PaperImportAction({
  scope,
  candidates,
  topic,
  compact = false,
  onDark = false
}: {
  scope: string
  candidates: readonly ImportCandidate[]
  topic: string
  /** Drop the destination half (very narrow panels). */
  compact?: boolean
  /** Rendered on a dark floating bar. */
  onDark?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const groups = usePaperModeStore((s) => s.groups)
  const job = usePaperImportJobs((s) => s.jobs[scope])
  const fresh = candidates.filter((candidate) => !candidate.owned)
  const destination = useMemo(() => {
    const prefs = readImportSheetPrefs()
    if (prefs.mode === 'existing') return importFolderLabel(prefs.existing, t('paperImportFolderRoot'))
    return suggestTopicFolder(topic, groups) || t('paperImportFolderRoot')
    // The sheet writes prefs when it closes; `open` re-reads them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, groups, open, t])

  if (job?.running) {
    const { done, total } = importJobCounts(job)
    return (
      <span className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border border-ds-border-muted bg-ds-main px-2.5 text-[12px] text-ds-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--ds-accent)]" />
        <span className="tabular-nums">{t('paperImportActionProgress', { done, total })}</span>
        <button
          type="button"
          onClick={() => cancelPaperImport(scope)}
          aria-label={t('paperImportActionStop')}
          title={t('paperImportActionStop')}
          className="grid h-5 w-5 place-items-center rounded text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
        >
          <Square className="h-3 w-3" fill="currentColor" strokeWidth={0} />
        </button>
      </span>
    )
  }

  const disabled = fresh.length === 0
  const label = fresh.length > 0
    ? t('paperImportActionButton', { count: fresh.length })
    : candidates.length > 0
      ? t('paperImportActionOwned')
      : t('paperImportActionNeedSelection')
  const dark = onDark
    ? 'bg-white text-[#20242d]'
    : 'bg-[var(--ds-control)] text-[var(--ds-control-foreground)]'
  const divider = onDark ? 'border-black/15' : 'border-white/25'
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        title={t('paperImportFolderTooltip', { folder: destination })}
        className={`inline-flex h-8 shrink-0 items-stretch overflow-hidden rounded-lg text-[12.5px] font-semibold transition hover:opacity-90 disabled:opacity-40 ${dark}`}
      >
        <span className="inline-flex items-center gap-1.5 px-3">
          <Download className="h-3.5 w-3.5" strokeWidth={2} />
          {label}
        </span>
        {!compact ? (
          <span className={`inline-flex max-w-[112px] items-center gap-1 border-l ${divider} px-2.5 text-[12px] font-normal opacity-80`}>
            <span className="min-w-0 truncate">{t('paperImportActionTo', { folder: destination })}</span>
            <ChevronDown className="h-3 w-3 shrink-0" strokeWidth={2} />
          </span>
        ) : null}
      </button>
      {open ? <PaperImportSheet scope={scope} candidates={candidates} topic={topic} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

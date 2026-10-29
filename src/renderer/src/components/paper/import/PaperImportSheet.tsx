import { useEffect, useMemo, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { runPaperImport } from '../../../paper/paper-import-job'
import {
  planPaperImport,
  plannedImportCount,
  type ImportCandidate
} from '../../../paper/paper-import-plan'

/** Search/recommendation imports always land in the fixed paper-space root. */
export function PaperImportSheet({
  scope,
  candidates,
  topic,
  onClose
}: {
  scope: string
  candidates: readonly ImportCandidate[]
  topic: string
  onClose: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const plan = useMemo(
    () => planPaperImport(candidates, { folder: '', byGroup: false, owned: 'keep' }),
    [candidates]
  )
  const count = plannedImportCount(plan)
  const failed = plan.unresolved.length

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const confirm = (): void => {
    if (!count && !failed) return
    void runPaperImport({ scope, plan, folder: '', t })
    onClose()
  }

  return createPortal(
    <div className="ds-no-drag fixed inset-0 z-[95] flex items-center justify-center bg-black/25 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('paperImportSheetTitle', { count: candidates.length })}
        onMouseDown={(event) => event.stopPropagation()}
        className="w-[440px] max-w-full rounded-2xl border border-ds-border bg-ds-elevated shadow-[0_24px_64px_rgba(15,23,42,0.22)]"
      >
        <header className="flex items-start gap-2 px-4 pb-2 pt-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-ds-ink">{t('paperImportSheetTitle', { count: candidates.length })}</h2>
            {topic ? <p className="mt-0.5 truncate text-[12px] text-ds-faint">{t('paperImportSheetFrom', { topic })}</p> : null}
          </div>
          <button type="button" aria-label={t('close')} onClick={onClose} className="grid h-7 w-7 place-items-center rounded-md text-ds-faint hover:bg-ds-hover hover:text-ds-ink">
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </header>
        <div className="px-4 pb-4 pt-2">
          <p className="text-[12.5px] leading-5 text-ds-muted">{t('paperImportIntoSpace', { space: t('paperImportFolderRoot') })}</p>
          <p className="mt-3 text-[12px] text-ds-faint">{t('paperImportSheetSummary', { count, folder: t('paperImportFolderRoot') })}</p>
          {failed ? <p className="mt-1 text-[12px] text-red-600 dark:text-red-300">{t('paperImportFailedAll', { message: `${failed}` })}</p> : null}
        </div>
        <footer className="flex justify-end gap-2 border-t border-ds-border-muted bg-ds-subtle/50 px-4 py-3">
          <button type="button" onClick={onClose} className="h-8 rounded-lg border border-ds-border px-3 text-[12.5px] text-ds-ink hover:bg-ds-hover">{t('paperImportSheetCancel')}</button>
          <button type="button" disabled={!count && !failed} onClick={confirm} className="h-8 rounded-lg bg-[var(--ds-control)] px-3.5 text-[12.5px] font-semibold text-[var(--ds-control-foreground)] hover:opacity-90 disabled:opacity-40">{t('paperImportSheetConfirm', { count })}</button>
        </footer>
      </div>
    </div>,
    document.body
  )
}

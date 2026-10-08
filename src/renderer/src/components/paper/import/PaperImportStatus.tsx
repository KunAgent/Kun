import type { ReactElement } from 'react'
import { AlertCircle, Check, FolderInput, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { importFolderLabel } from '../../../paper/paper-import-target'
import { backfillPaperPdf, type ImportItemState } from '../../../paper/paper-import-job'
import type { ImportOwned } from '../../../paper/paper-import-plan'

/**
 * One-line import state of a paper row: queued / importing / filed in a
 * folder / metadata only (with "add PDF") / failed. Also names the folder of a
 * paper that already lived in the library before this run.
 */
export function PaperImportStatus({
  scope,
  item,
  owned
}: {
  scope: string
  item?: ImportItemState
  owned?: ImportOwned
}): ReactElement | null {
  const { t } = useTranslation('common')
  const root = t('paperImportFolderRoot')
  const base = 'inline-flex min-w-0 items-center gap-1 text-[11.5px]'
  if (item) {
    const where = importFolderLabel(item.folder, root)
    switch (item.status) {
      case 'queued':
        return <span className={`${base} text-ds-faint`}>{t('paperImportStatus_queued')}</span>
      case 'importing':
        return (
          <span className={`${base} text-[var(--ds-accent)]`}>
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
            {t('paperImportStatus_importing')}
          </span>
        )
      case 'imported':
      case 'reused':
        return (
          <span className={`${base} text-emerald-700 dark:text-emerald-300`}>
            <Check className="h-3 w-3 shrink-0" strokeWidth={2.4} />
            <span className="truncate">{t(item.status === 'reused' ? 'paperImportStatus_reused' : 'paperImportStatus_imported', { folder: where })}</span>
          </span>
        )
      case 'moved':
        return (
          <span className={`${base} text-emerald-700 dark:text-emerald-300`}>
            <FolderInput className="h-3 w-3 shrink-0" strokeWidth={2} />
            <span className="truncate">{t('paperImportStatus_moved', { folder: where })}</span>
          </span>
        )
      case 'kept':
        return <span className={`${base} text-ds-muted`}><span className="truncate">{t('paperImportStatus_kept', { folder: where })}</span></span>
      case 'metadata':
        return (
          <span className={`${base} text-amber-700 dark:text-amber-300`}>
            <AlertCircle className="h-3 w-3 shrink-0" strokeWidth={2} />
            <span className="truncate">{t('paperImportStatus_metadata')}</span>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                void backfillPaperPdf(scope, item.key, t)
              }}
              className="shrink-0 rounded px-1 font-medium text-[var(--ds-accent)] hover:bg-ds-hover"
            >
              {t('paperImportAddPdf')}
            </button>
          </span>
        )
      case 'failed':
        return (
          <span className={`${base} text-red-600 dark:text-red-300`} title={item.message}>
            <AlertCircle className="h-3 w-3 shrink-0" strokeWidth={2} />
            <span className="truncate">{t('paperImportStatus_failed')}</span>
          </span>
        )
      case 'canceled':
        return <span className={`${base} text-ds-faint`}>{t('paperImportStatus_canceled')}</span>
    }
  }
  if (owned) {
    return (
      <span className={`${base} text-emerald-700 dark:text-emerald-300`}>
        <Check className="h-3 w-3 shrink-0" strokeWidth={2.4} />
        <span className="truncate">{t('paperImportOwnedIn', { folder: importFolderLabel(owned.group, root) })}</span>
      </span>
    )
  }
  return null
}

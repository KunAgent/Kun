import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, X } from 'lucide-react'

/** A failed stop / release / answer, shown where the action was taken. */
export function WorkerActionError({ message, onDismiss }: { message: string; onDismiss: () => void }): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div role="alert" className="ds-worker-alert flex items-start gap-2 rounded-lg px-3 py-2 text-[12px] leading-[1.5]" data-worker-action-error>
      <AlertCircle className="mt-[2px] h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
      <span className="min-w-0 flex-1 break-words">{message}</span>
      <button type="button" onClick={onDismiss} aria-label={t('close')} className="shrink-0 rounded p-0.5 opacity-70 transition hover:opacity-100">
        <X className="h-3 w-3" strokeWidth={2.2} aria-hidden />
      </button>
    </div>
  )
}

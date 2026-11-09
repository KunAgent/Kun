import { useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldAlert } from 'lucide-react'

export function AgentBrowserClearConfirmation({ onCancel, onConfirm }: {
  onCancel: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation('common')
  const title = useId()
  const description = useId()
  const cancel = useRef<HTMLButtonElement | null>(null)
  const confirm = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    const before = typeof document === 'undefined' ? null : document.activeElement
    cancel.current?.focus()
    return () => { if (typeof HTMLElement !== 'undefined' && before instanceof HTMLElement && before.isConnected) before.focus() }
  }, [])
  return <div className="absolute inset-0 flex items-center justify-center overflow-auto bg-ds-card p-4"
    role="alertdialog" aria-modal="true" aria-labelledby={title} aria-describedby={description}
    onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); onCancel() }
      if (event.key === 'Tab') {
        event.preventDefault()
        if (document.activeElement === cancel.current) confirm.current?.focus()
        else cancel.current?.focus()
      }
    }}>
    <div className="w-full max-w-sm rounded-xl border border-ds-border-strong bg-ds-card p-5 shadow-lg">
      <ShieldAlert size={24} className="text-ds-muted" />
      <h3 id={title} className="mt-3 text-sm font-semibold text-ds-ink">{t('browserUseClearConfirmTitle')}</h3>
      <p id={description} className="mt-2 text-xs leading-5 text-ds-muted">{t('browserUseClearConfirmBody')}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button ref={cancel} type="button" onClick={onCancel}
          className="min-h-8 rounded-md border border-ds-border px-3 text-xs text-ds-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
          {t('browserUseCancelClear')}
        </button>
        <button ref={confirm} type="button" onClick={onConfirm}
          className="min-h-8 rounded-md bg-red-600 px-3 text-xs font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
          {t('browserUseConfirmClear')}
        </button>
      </div>
    </div>
  </div>
}

import { useEffect, type ReactElement, type ReactNode } from 'react'
import { AlertTriangle, Check, CircleAlert, X } from 'lucide-react'
import { pluginButton } from './PluginPrimitives'

type Translate = (key: string, values?: Record<string, unknown>) => string

function useEscape(onClose: () => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
}

/** Centered modal sheet; bottom-anchored and full width on narrow windows. */
export function PluginModal({
  label,
  width = 600,
  onClose,
  children
}: {
  label: string
  width?: number
  onClose: () => void
  children: ReactNode
}): ReactElement {
  useEscape(onClose)
  return (
    <div className="ds-no-drag fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 backdrop-blur-[2px] sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-[18px] border border-ds-border bg-ds-card shadow-[0_18px_48px_rgba(32,55,90,0.14)] sm:rounded-[18px]"
        style={{ maxWidth: width }}
      >
        {children}
      </section>
    </div>
  )
}

export function PluginModalHeader({ t, title, meta, leading, onClose }: {
  t: Translate
  title: ReactNode
  meta?: ReactNode
  leading?: ReactNode
  onClose: () => void
}): ReactElement {
  return (
    <div className="flex items-start gap-3.5 border-b border-ds-border-muted px-6 pb-3.5 pt-5">
      {leading}
      <div className="min-w-0 flex-1">
        <h2 className="m-0 truncate text-[18px] font-semibold text-ds-ink">{title}</h2>
        {meta ? <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-ds-muted">{meta}</div> : null}
      </div>
      <button type="button" onClick={onClose} aria-label={t('pluginsClose')} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

export function ConfirmDialog({
  t,
  title,
  body,
  confirmLabel,
  busy,
  onCancel,
  onConfirm
}: {
  t: Translate
  title: string
  body: string
  confirmLabel: string
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}): ReactElement {
  useEscape(onCancel)
  return (
    <div className="ds-no-drag fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <section role="alertdialog" aria-modal="true" aria-label={title} className="flex w-full max-w-[420px] flex-col gap-2.5 rounded-2xl border border-ds-border bg-ds-card p-5 shadow-[0_18px_48px_rgba(32,55,90,0.14)]">
        <h2 className="m-0 text-[15px] font-semibold text-ds-ink">{title}</h2>
        <p className="m-0 text-[13px] leading-5 text-ds-muted">{body}</p>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className={pluginButton.base} onClick={onCancel}>{t('pluginsCancel')}</button>
          <button type="button" disabled={busy} className="inline-flex h-9 items-center justify-center rounded-[10px] bg-ds-danger px-3.5 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-55" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}

export type PluginToastState = {
  tone: 'success' | 'error' | 'info'
  message: string
  action?: { label: string; run: () => void }
}

/** Bottom toast for action results; success and info dismiss themselves. */
export function PluginToast({ t, toast, onDismiss }: { t: Translate; toast: PluginToastState; onDismiss: () => void }): ReactElement {
  useEffect(() => {
    if (toast.tone === 'error') return
    const timer = window.setTimeout(onDismiss, toast.action ? 8000 : 5000)
    return () => window.clearTimeout(timer)
  }, [onDismiss, toast])
  const Icon = toast.tone === 'success' ? Check : toast.tone === 'error' ? CircleAlert : AlertTriangle
  const iconTone = toast.tone === 'success' ? 'text-[#7ee0a5]' : toast.tone === 'error' ? 'text-[#ff9b93]' : 'text-[#ffc46b]'
  return (
    <div role={toast.tone === 'error' ? 'alert' : 'status'} className="ds-no-drag pointer-events-auto fixed bottom-6 left-1/2 z-[70] flex w-[min(560px,calc(100vw-32px))] -translate-x-1/2 items-start gap-2.5 rounded-xl bg-[#20242d] px-3.5 py-2.5 text-[13px] leading-5 text-white shadow-[0_18px_48px_rgba(32,55,90,0.24)]">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconTone}`} strokeWidth={2.2} />
      <span className="min-w-0 flex-1 break-words">{toast.message}</span>
      {toast.action ? (
        <button type="button" className="shrink-0 rounded-md px-1.5 text-[12.5px] font-semibold text-[#aebdff] hover:bg-white/10" onClick={() => { toast.action?.run(); onDismiss() }}>
          {toast.action.label}
        </button>
      ) : null}
      <button type="button" aria-label={t('pluginsDismiss')} className="shrink-0 rounded-md p-0.5 text-white/70 hover:bg-white/10 hover:text-white" onClick={onDismiss}>
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

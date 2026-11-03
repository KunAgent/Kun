import { useEffect, useId, useState, type ReactElement } from 'react'
import { ComposerPickerPortalContext } from '../chat/composer-picker-portal-context'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { dispatchPreferencesValid } from '@shared/ade-collaboration-settings'
import { DispatchPreferenceEditor, type DispatchPreferenceEditorProps } from './DispatchPreferenceEditor'

export function DispatchPreferenceDialog({ onClose, onSave, saving, dirty, message, ...editor }: DispatchPreferenceEditorProps & {
  onClose: () => void
  onSave: () => void
  saving: boolean
  dirty: boolean
  message: { tone: 'ok' | 'error'; text: string } | null
}): ReactElement {
  const { t } = useTranslation('common')
  const titleId = useId()
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!portalContainer) return
    const previous = document.activeElement as HTMLElement | null
    portalContainer.focus()
    return () => previous?.focus()
  }, [portalContainer])
  const valid = dispatchPreferencesValid({ preferences: editor.preferences, preferencePrompt: editor.notes })
  return createPortal(<div className="ds-no-drag fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4">
    <div ref={setPortalContainer} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}
      className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-ds-border bg-ds-card shadow-xl outline-none"
      onKeyDown={(event) => {
        if (event.defaultPrevented || !event.currentTarget.contains(event.target as Node)) return
        if (event.key === 'Escape') { event.stopPropagation(); if (!saving) onClose() }
        if (event.key !== 'Tab') return
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]')]
          .filter((element) => element.getClientRects().length > 0)
        const first = controls[0], last = controls.at(-1)
        if (!first) { event.preventDefault(); return }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === portalContainer)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }}>
      <header className="flex shrink-0 items-center justify-between border-b border-ds-border-muted px-5 py-4">
        <h2 id={titleId} className="text-[18px] font-semibold text-ds-ink">{t('dispatchPreference.title')}</h2>
        <button type="button" disabled={saving} onClick={onClose} aria-label={t('dispatchPreference.close')}
          className="grid h-9 w-9 place-items-center rounded-lg text-ds-muted hover:bg-ds-hover"><X size={18} /></button>
      </header>
      <div className="min-h-0 overflow-y-auto p-5"><ComposerPickerPortalContext.Provider value={portalContainer}>
        <DispatchPreferenceEditor {...editor} disabled={saving} />
      </ComposerPickerPortalContext.Provider></div>
      <footer className="flex shrink-0 items-center gap-3 border-t border-ds-border-muted px-5 py-4">
        {message ? <span role={message.tone === 'error' ? 'alert' : 'status'} className="min-w-0 flex-1 text-[12px] text-ds-muted">{message.text}</span> : <span className="flex-1" />}
        <button type="button" disabled={saving} onClick={onClose} className="rounded-lg px-3 py-2 text-[12.5px] text-ds-muted hover:bg-ds-hover">{t('dispatchPreference.cancel')}</button>
        <button type="button" data-dispatch-preference-save disabled={saving || !dirty || !valid} onClick={onSave}
          className="rounded-lg bg-accent px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-50">{t(saving ? 'dispatchPreference.saving' : 'dispatchPreference.save')}</button>
      </footer>
    </div>
  </div>, document.body)
}

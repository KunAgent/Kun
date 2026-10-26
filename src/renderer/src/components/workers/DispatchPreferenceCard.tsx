import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'
import type { AdeCollaborationSettingsSnapshot } from '@shared/ade-collaboration-settings'
import { DispatchPreferenceField } from '../dispatch-preference-field'

/**
 * Collaboration panel footer: the user's dispatch preference, editable in
 * place. It saves through the same revisioned collaboration settings as the
 * Settings window, so a concurrent edit there is detected, not overwritten.
 */
export function DispatchPreferenceCard(): ReactElement {
  const { t } = useTranslation('common')
  const [snapshot, setSnapshot] = useState<AdeCollaborationSettingsSnapshot | null>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const load = useCallback(async (): Promise<AdeCollaborationSettingsSnapshot | null> => {
    try {
      const next = await window.kunGui.getAdeCollaborationSettings()
      setSnapshot(next)
      return next
    } catch {
      return null
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const saved = snapshot?.value.dispatch.preferencePrompt ?? ''
  const dirty = draft !== saved

  const expand = (): void => {
    setDraft(saved)
    setMessage(null)
    setOpen(true)
    // Pick up edits made in Settings since the panel loaded.
    void load().then((next) => { if (next) setDraft(next.value.dispatch.preferencePrompt) })
  }

  const save = async (): Promise<void> => {
    if (!snapshot || saving) return
    setSaving(true)
    setMessage(null)
    try {
      const value = { ...snapshot.value, dispatch: { ...snapshot.value.dispatch, preferencePrompt: draft.trim() } }
      const result = await window.kunGui.saveAdeCollaborationSettings({ expectedRevision: snapshot.revision, value })
      setSnapshot({ value: result.value, revision: result.revision })
      if (result.ok) {
        setDraft(result.value.dispatch.preferencePrompt)
        setMessage({ tone: 'ok', text: t('dispatchPreference.saved') })
      } else {
        setMessage({ tone: 'error', text: t('dispatchPreference.conflict') })
      }
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(false)
    }
  }

  const summary = saved.trim().split(/\r?\n/).find((line) => line.trim()) ?? ''
  return (
    <div className="shrink-0 border-t border-ds-border-muted px-3 py-2.5" data-dispatch-preference-card>
      <button type="button" aria-expanded={open} onClick={() => (open ? setOpen(false) : expand())}
        className="flex w-full min-w-0 items-center gap-2.5 rounded-xl px-1.5 py-1 text-left transition hover:bg-ds-hover">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ds-subtle text-ds-muted" aria-hidden>
          <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.9} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-semibold text-ds-ink">{t('dispatchPreference.title')}</span>
          <span className="block truncate text-[11.5px] text-ds-faint">{summary || t('dispatchPreference.empty')}</span>
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-ds-faint transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open ? (
        <div className="mt-2 flex flex-col gap-2 px-1.5" data-dispatch-preference-editor>
          <p className="text-[11.5px] leading-[1.55] text-ds-muted">{t('dispatchPreference.description')}</p>
          <DispatchPreferenceField value={draft} onChange={setDraft} rows={6} autoFocus />
          <div className="flex items-center gap-2">
            {message ? (
              <span role={message.tone === 'error' ? 'alert' : 'status'}
                className={`min-w-0 flex-1 truncate text-[11.5px] ${message.tone === 'error' ? 'text-ds-status-danger' : 'text-ds-status-success'}`}>
                {message.text}
              </span>
            ) : <span className="flex-1" />}
            <button type="button" disabled={saving} onClick={() => { setDraft(saved); setOpen(false) }}
              className="inline-flex h-[28px] items-center rounded-[9px] px-2.5 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50">
              {t('dispatchPreference.cancel')}
            </button>
            <button type="button" data-dispatch-preference-save disabled={!snapshot || !dirty || saving} onClick={() => void save()}
              className="inline-flex h-[28px] items-center rounded-[9px] bg-accent px-3 text-[12px] font-semibold text-white transition hover:brightness-110 disabled:opacity-50">
              {t(saving ? 'dispatchPreference.saving' : 'dispatchPreference.save')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

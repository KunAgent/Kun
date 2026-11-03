import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, SlidersHorizontal } from 'lucide-react'
import { dispatchPreferencesValid, type AdeCollaborationSettingsSnapshot, type AdeDispatchPreferenceRule } from '@shared/ade-collaboration-settings'
import { DispatchPreferenceSummary } from './DispatchPreferenceEditor'
import { DispatchPreferenceDialog } from './DispatchPreferenceDialog'

/** Both entry points edit the same revisioned, globally scoped preferences. */
export function DispatchPreferenceCard(): ReactElement {
  const { t } = useTranslation('common')
  const [snapshot, setSnapshot] = useState<AdeCollaborationSettingsSnapshot | null>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [preferences, setPreferences] = useState<AdeDispatchPreferenceRule[]>([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const request = useRef(0)
  const load = useCallback(async (): Promise<AdeCollaborationSettingsSnapshot | null> => {
    const sequence = ++request.current
    setLoading(true)
    try {
      const next = await window.kunGui.getAdeCollaborationSettings()
      if (sequence !== request.current) return null
      setSnapshot(next)
      return next
    } catch (error) {
      if (sequence === request.current) setMessage({ tone: 'error', text: String(error) })
      return null
    } finally {
      if (sequence === request.current) setLoading(false)
    }
  }, [])
  const invalidateLoad = useCallback(() => { request.current++ }, [])
  useEffect(() => { void load(); return invalidateLoad }, [load, invalidateLoad])
  const saved = snapshot?.value.dispatch.preferencePrompt ?? ''
  const savedRules = snapshot?.value.dispatch.preferences ?? []
  const dirty = draft !== saved || JSON.stringify(preferences) !== JSON.stringify(savedRules)
  const adopt = (next: AdeCollaborationSettingsSnapshot): void => {
    setDraft(next.value.dispatch.preferencePrompt)
    setPreferences((next.value.dispatch.preferences ?? []).map((rule) => ({ ...rule })))
  }
  const expand = async (): Promise<void> => {
    setMessage(null)
    const next = await load()
    if (next) { adopt(next); setOpen(true) }
  }
  const save = async (): Promise<void> => {
    if (!snapshot || saving || !dispatchPreferencesValid({ preferences, preferencePrompt: draft })) return
    setSaving(true)
    setMessage(null)
    try {
      const value = { ...snapshot.value, dispatch: { ...snapshot.value.dispatch,
        preferencePrompt: draft.trim(), preferences: preferences.map((rule) => ({ ...rule })) } }
      const result = await window.kunGui.saveAdeCollaborationSettings({ expectedRevision: snapshot.revision, value })
      setSnapshot({ value: result.value, revision: result.revision })
      // A stale revision never silently replaces the other editor's changes.
      adopt(result)
      setMessage({ tone: result.ok ? 'ok' : 'error', text: t(result.ok ? 'dispatchPreference.saved' : 'dispatchPreference.conflict') })
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally { setSaving(false) }
  }
  const activeRules = savedRules.filter((rule) => rule.enabled)
  const summary = activeRules[0]?.scenario || saved.trim().split(/\r?\n/).find((line) => line.trim())
  return <div className="shrink-0 border-t border-ds-border-muted px-3 py-2.5" data-dispatch-preference-card>
    <button type="button" disabled={loading} aria-haspopup="dialog" aria-expanded={open} onClick={() => void expand()}
      className="flex w-full min-w-0 items-center gap-2.5 rounded-xl px-1.5 py-2 text-left hover:bg-ds-hover disabled:opacity-50">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ds-subtle text-ds-muted"><SlidersHorizontal size={16} /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-ds-ink">{t('dispatchPreference.title')}
          {savedRules.length ? <span className="ml-2 text-[11px] font-normal text-ds-muted">{t('dispatchPreference.summary', { count: savedRules.length })}</span> : null}
        </span>
        <span className="block truncate text-[11.5px] text-ds-muted">{summary || t('dispatchPreference.empty')}</span>
        <DispatchPreferenceSummary preferences={savedRules} />
      </span><ChevronRight size={15} className="shrink-0 text-ds-muted" />
    </button>
    {!open && message ? <p role={message.tone === 'error' ? 'alert' : 'status'}
      className={`text-[12px] ${message.tone === 'error' ? 'text-ds-status-danger' : 'text-ds-status-success'}`}>{message.text}</p> : null}
    {open ? <DispatchPreferenceDialog preferences={preferences} notes={draft} onPreferencesChange={setPreferences} onNotesChange={setDraft}
      saving={saving} dirty={dirty} message={message} onSave={() => void save()} onClose={() => setOpen(false)} /> : null}
  </div>
}

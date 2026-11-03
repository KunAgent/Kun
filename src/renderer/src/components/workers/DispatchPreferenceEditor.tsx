import { useId, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import {
  ADE_DISPATCH_PREFERENCE_MAX_CHARS, ADE_DISPATCH_PREFERENCE_MAX_RULES,
  composeDispatchPreferencePrompt, type AdeDispatchPreferenceRule
} from '@shared/ade-collaboration-settings'
import { AgentIcon } from '../agent-icon'
import { AgentDispatchRoutePicker } from '../chat/AgentDispatchRoutePicker'
import { useHarnessStore } from '../../store/harness-store'

export type DispatchPreferenceEditorProps = {
  preferences: AdeDispatchPreferenceRule[]
  notes: string
  onPreferencesChange: (rules: AdeDispatchPreferenceRule[]) => void
  onNotesChange: (value: string) => void
  disabled?: boolean
}

export function DispatchPreferenceSummary({ preferences }: { preferences: AdeDispatchPreferenceRule[] }): ReactElement {
  const rows = useHarnessStore((state) => state.rows)
  const groups = new Map<string, { name: string; count: number }>()
  for (const rule of preferences.filter((rule) => rule.enabled)) {
    const previous = groups.get(rule.agentId)
    groups.set(rule.agentId, { name: rows.find((row) => row.definition.id === rule.agentId)?.definition.displayName ||
      rule.agentLabel || rule.agentId, count: (previous?.count ?? 0) + 1 })
  }
  return <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1" data-preference-summary>
    {[...groups].map(([id, group]) => <span key={id} className="inline-flex min-w-0 items-center gap-1.5 text-[12px] text-ds-muted">
      <AgentIcon harnessId={id} size={18} /><span className="max-w-40 truncate">{group.name} ×{group.count}</span>
    </span>)}
  </span>
}

/** Scenarios are prose guidance, never ordered workflow nodes. */
export function DispatchPreferenceEditor({ preferences, notes, onPreferencesChange, onNotesChange, disabled = false }: DispatchPreferenceEditorProps): ReactElement {
  const { t } = useTranslation('common')
  const id = useId()
  const rows = useHarnessStore((state) => state.rows)
  const update = (key: string, patch: Partial<AdeDispatchPreferenceRule>): void => {
    onPreferencesChange(preferences.map((rule) => rule.id === key ? { ...rule, ...patch } : rule))
  }
  const prompt = composeDispatchPreferencePrompt({ preferences, preferencePrompt: notes }, { truncate: false })
  const tooLong = prompt.length > ADE_DISPATCH_PREFERENCE_MAX_CHARS
  return <div className="flex min-w-0 flex-col gap-4" data-dispatch-preference-editor>
    <p className="text-[12.5px] leading-5 text-ds-muted">{t('dispatchPreference.description')}</p>
    <DispatchPreferenceSummary preferences={preferences} />
    {!preferences.length ? <p className="rounded-xl bg-ds-subtle p-4 text-[12.5px] text-ds-muted">{t('dispatchPreference.empty')}</p> : null}
    {preferences.map((rule, index) => {
      const fieldId = `${id}-${index}`
      return <section key={rule.id} data-preference-rule={rule.id} className="flex min-w-0 flex-col gap-3 rounded-xl border border-ds-border bg-ds-card p-4">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={`${fieldId}-scenario`} className="text-[12px] font-semibold text-ds-ink">{t('dispatchPreference.scenarioLabel')}</label>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[12px] text-ds-muted">
              <input type="checkbox" checked={rule.enabled} disabled={disabled} onChange={(event) => update(rule.id, { enabled: event.target.checked })} />
              {t('dispatchPreference.enabled')}
            </label>
            <button type="button" disabled={disabled} aria-label={t('dispatchPreference.remove')} onClick={() => onPreferencesChange(preferences.filter((item) => item.id !== rule.id))}
              className="grid h-8 w-8 place-items-center rounded-lg text-ds-muted hover:bg-ds-hover disabled:opacity-50"><Trash2 size={15} /></button>
          </div>
        </div>
        <input id={`${fieldId}-scenario`} value={rule.scenario} maxLength={200} disabled={disabled} aria-invalid={!rule.scenario.trim()}
          placeholder={t('dispatchPreference.scenarioPlaceholder')} onChange={(event) => update(rule.id, { scenario: event.target.value })}
          className="w-full min-w-0 rounded-lg border border-ds-border bg-ds-main px-3 py-2 text-[13px] text-ds-ink" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <AgentDispatchRoutePicker preference route={rule} disabled={disabled} onChange={(route) => update(rule.id, {
            agentId: route.agentId, model: route.model, providerId: route.providerId, credentialMode: route.credentialMode,
            agentLabel: rows.find((row) => row.definition.id === route.agentId)?.definition.displayName?.slice(0, 80)
          })} />
          <button type="button" disabled={disabled} onClick={() => update(rule.id, { model: undefined, providerId: undefined, credentialMode: undefined })}
            className="rounded-lg px-2 py-1.5 text-[11.5px] text-ds-muted hover:bg-ds-hover disabled:opacity-50">{t('dispatchPreference.defaultModel')}</button>
        </div>
        {!rule.model ? <span className="text-[11.5px] text-ds-muted">{t('dispatchPreference.defaultModel')}</span> : null}
        <label htmlFor={`${fieldId}-note`} className="text-[12px] text-ds-muted">{t('dispatchPreference.ruleNote')}</label>
        <input id={`${fieldId}-note`} value={rule.note ?? ''} maxLength={300} disabled={disabled}
          onChange={(event) => update(rule.id, { note: event.target.value })}
          className="w-full min-w-0 rounded-lg border border-ds-border bg-ds-main px-3 py-2 text-[12px] text-ds-ink" />
      </section>
    })}
    <button type="button" data-preference-add disabled={disabled || preferences.length >= ADE_DISPATCH_PREFERENCE_MAX_RULES}
      onClick={() => onPreferencesChange([...preferences, { id: crypto.randomUUID(), scenario: '', agentId: 'kun', enabled: true }])}
      className="flex min-h-10 items-center justify-center gap-2 rounded-xl border border-dashed border-ds-border px-3 py-2 text-[12.5px] text-ds-muted hover:bg-ds-hover disabled:opacity-50">
      <Plus size={16} />{t('dispatchPreference.add')}
    </button>
    {preferences.length >= ADE_DISPATCH_PREFERENCE_MAX_RULES ? <p className="text-[12px] text-ds-muted">{t('dispatchPreference.limitReached')}</p> : null}
    <label htmlFor={`${id}-notes`} className="text-[12px] font-semibold text-ds-ink">{t('dispatchPreference.notesLabel')}</label>
    <textarea id={`${id}-notes`} data-dispatch-preference-input value={notes} rows={3} maxLength={ADE_DISPATCH_PREFERENCE_MAX_CHARS} disabled={disabled}
      placeholder={t('dispatchPreference.notesPlaceholder')} onChange={(event) => onNotesChange(event.target.value)}
      className="w-full resize-y rounded-xl border border-ds-border bg-ds-main px-3 py-2 text-[12.5px] leading-5 text-ds-ink" />
    <p className="text-[12px] leading-5 text-ds-muted">{t('dispatchPreference.fallbackNote')}</p>
    <details className="border-t border-ds-border-muted pt-3">
      <summary className="cursor-pointer text-[12px] font-medium text-ds-ink">{t('dispatchPreference.preview')} · {prompt.length} / {ADE_DISPATCH_PREFERENCE_MAX_CHARS}</summary>
      <p className="mt-2 text-[11.5px] text-ds-muted">{t('dispatchPreference.previewHint')}</p>
      <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-ds-subtle p-3 font-mono text-[11.5px] text-ds-ink">{prompt || t('dispatchPreference.empty')}</pre>
    </details>
    {tooLong ? <p role="alert" className="text-[12px] text-ds-status-danger">{t('dispatchPreference.tooLong')}</p> : null}
  </div>
}

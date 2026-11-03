import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ADE_DISPATCH_PREFERENCE_MAX_CHARS } from '@shared/ade-collaboration-settings'
import { SettingRow } from './settings-controls'
import { DispatchPreferenceEditor, type DispatchPreferenceEditorProps } from './workers/DispatchPreferenceEditor'

/**
 * The user's dispatch preference: plain guidance on which Agent and model
 * suit which work. The dispatching Agent reads it every time it dispatches.
 */
export function DispatchPreferenceField({ value, onChange, rows = 5, autoFocus = false, id }: {
  value: string
  onChange: (value: string) => void
  rows?: number
  autoFocus?: boolean
  id?: string
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <textarea
        id={id}
        data-dispatch-preference-input
        value={value}
        rows={rows}
        autoFocus={autoFocus}
        maxLength={ADE_DISPATCH_PREFERENCE_MAX_CHARS}
        aria-label={t('dispatchPreference.title')}
        placeholder={t('dispatchPreference.placeholder')}
        onChange={(event) => onChange(event.target.value)}
        className="w-full resize-y rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[12.5px] leading-5 text-ds-ink shadow-sm placeholder:text-ds-faint focus:border-accent/40 focus:outline-none"
      />
      <span className="self-end text-[11px] tabular-nums text-ds-faint">
        {value.length} / {ADE_DISPATCH_PREFERENCE_MAX_CHARS}
      </span>
    </div>
  )
}

/** Settings → Collaboration row for the same preference. */
export function DispatchPreferenceSettingRows(props: DispatchPreferenceEditorProps): ReactElement {
  const { t } = useTranslation('common')
  return (
    <SettingRow
      title={t('dispatchPreference.title')}
      description={t('dispatchPreference.description')}
      wideControl
      control={<div className="w-full min-w-0" data-dispatch-preference-setting><DispatchPreferenceEditor {...props} /></div>}
    />
  )
}

import { useEffect, useId, useState, type ReactElement } from 'react'
import { normalizeHarnessPermissionMode } from '@shared/harness-permission-mode'
import type { AdeHarnessPermissionMode } from '@shared/ade-harnesses'
import { settingsButtonClass } from '../settings-button'
import { agentSettingFieldClass, AgentSettingsSelect } from './AgentSettingsSelect'

type T = (key: string, options?: Record<string, unknown>) => string

/** The text is local until Apply; incomplete input must never start a connection check. */
export function AgentPermissionModeField({ value, modes, disabled, onChange, onEditingChange, t }: {
  value: string
  modes: readonly AdeHarnessPermissionMode[]
  disabled: boolean
  onChange: (value: string) => void
  onEditingChange: (editing: boolean) => void
  t: T
}): ReactElement {
  const isCustom = Boolean(value && !modes.some(mode => mode.id === value))
  const [custom, setCustom] = useState(isCustom)
  const [text, setText] = useState(value)
  const [editing, setEditing] = useState(false)
  const id = useId()
  useEffect(() => { setCustom(isCustom); setText(value); setEditing(false) }, [value, isCustom])
  useEffect(() => { onEditingChange(editing); return () => onEditingChange(false) }, [editing, onEditingChange])
  let normalized: string | undefined
  let invalid = false
  try { normalized = normalizeHarnessPermissionMode(text) } catch { invalid = true }
  const cancel = (): void => { setCustom(isCustom); setText(value); setEditing(false) }
  const apply = (): void => {
    if (invalid || disabled) return
    onChange(normalized ?? '')
    setText(normalized ?? '')
    setCustom(Boolean(normalized && !modes.some(mode => mode.id === normalized)))
    setEditing(false)
  }
  return <div className="w-full min-w-0 space-y-2" data-acp-permission-editor>
    <AgentSettingsSelect label={t('adeSettings.harnessPermissionMode')}
      disabled={disabled} value={custom ? 'custom' : value ? `preset:${value}` : ''}
      options={[{ value: '', label: t('adeSettings.harnessPermissionModeDefault') },
        ...modes.map(mode => ({ value: `preset:${mode.id}`, label: mode.label })),
        { value: 'custom', label: t('adeSettings.harnessPermissionCustom') }]}
      onChange={selected => {
        if (selected === 'custom') { setCustom(true); setText(value); setEditing(true); return }
        setCustom(false); setEditing(false); onChange(selected.replace(/^preset:/, ''))
      }} />
    {custom ? <>
      <label htmlFor={id} className="block text-xs font-medium text-ds-ink">{t('adeSettings.harnessPermissionCustomLabel')}</label>
      <input id={id} value={text} disabled={disabled} spellCheck={false} autoComplete="off"
        aria-invalid={invalid} aria-describedby={`${id}-help${invalid ? ` ${id}-error` : ''}`}
        className={agentSettingFieldClass}
        onChange={event => { setText(event.target.value); setEditing(true) }}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); apply() } else if (event.key === 'Escape') cancel() }} />
      <p id={`${id}-help`} className="text-xs leading-relaxed text-ds-muted">{t('adeSettings.harnessPermissionCustomHelp')}</p>
      {invalid ? <p id={`${id}-error`} role="alert" className="text-xs text-ds-danger">{t('adeSettings.harnessPermissionCustomInvalid')}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={disabled || !editing || invalid} className={settingsButtonClass()} onClick={apply}>{t('adeSettings.harnessPermissionCustomApply')}</button>
        <button type="button" disabled={disabled || !editing} className={settingsButtonClass()} onClick={cancel}>{t('adeSettings.harnessPermissionCustomCancel')}</button>
      </div>
    </> : null}
  </div>
}

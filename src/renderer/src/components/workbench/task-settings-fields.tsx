import { useEffect, useId, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AdeExecutionConfigSnapshot } from '@shared/ade-execution-config'
import type { AdeProjectDefaults, AdeProjectDefaultField } from '@shared/ade-project-defaults'
import { harnessRowRunsTurns, harnessModelFingerprint, loadHarnessModels, loadHarnessProviderGroups, loadHarnesses, useHarnessStore } from '../../store/harness-store'
import { useChatStore } from '../../store/chat-store'
import { isKunModelProviderGroup } from '../../lib/kun-model-provider-groups'
import { AgentIcon } from '../agent-icon'

export type TaskSettingsField = Exclude<AdeProjectDefaultField, 'isolation'>
export const TASK_SETTINGS_FIELDS: TaskSettingsField[] = ['route', 'collaborationEnabled', 'managerModel', 'limits', 'budget']
const fieldClass = 'w-full min-w-0 rounded-lg border border-ds-border bg-ds-card px-2.5 py-2 text-[12px] text-ds-ink focus:border-accent focus:outline-none'

/** Only task-local execution choices; paths and credentials are never editable here. */
export function TaskSettingsFields({ value, effective, onChange, onRestore, restored, disabled, editable }: {
  value: AdeProjectDefaults
  effective: AdeExecutionConfigSnapshot
  onChange: <K extends TaskSettingsField>(field: K, value: AdeProjectDefaults[K]) => void
  onRestore: (field: TaskSettingsField) => void
  restored: ReadonlySet<TaskSettingsField>
  disabled: boolean
  editable?: Partial<Record<TaskSettingsField, { allowed: boolean; reason?: string }>>
}): ReactElement {
  const { t } = useTranslation('common')
  const id = useId()
  const rows = useHarnessStore((s) => s.rows)
  const route = value.route ?? effective.route
  const harnessId = route.harnessId || 'kun'
  const models = useHarnessStore((s) => s.models[harnessId]?.models)
  const allGroups = useChatStore((s) => s.composerModelGroups)
  const kunGroups = allGroups.filter(isKunModelProviderGroup)
  const externalGroups = useHarnessStore((s) => s.providerGroups[harnessId]?.groups)
  const groups = harnessId === 'kun' ? kunGroups : (externalGroups ?? []).map((group) => ({
    providerId: group.providerId, label: group.label, modelIds: group.models
  }))
  const row = rows.find((row) => row.definition.id === harnessId)
  const definition = row?.definition
  const fingerprint = harnessModelFingerprint(row)
  const modes = definition?.credentialModes ?? (harnessId === 'kun' ? ['provider'] : ['native-login'])
  const credentialMode = route.credentialMode ?? modes[0] ?? 'provider'
  const providerId = route.providerId ?? ''
  const modelIds = credentialMode === 'native-login'
    ? models ?? definition?.staticModels ?? []
    : groups.find((group) => group.providerId === providerId)?.modelIds ?? []
  useEffect(() => { void loadHarnesses() }, [])
  useEffect(() => { if (harnessId !== 'kun') void loadHarnessModels(harnessId) }, [harnessId])
  useEffect(() => {
    if (harnessId !== 'kun' && credentialMode !== 'native-login') void loadHarnessProviderGroups(harnessId, true)
  }, [harnessId, credentialMode, fingerprint])
  const limits = value.limits ?? effective.limits
  const budget = value.budget ?? effective.budget ?? {}
  const manager = value.managerModel ?? effective.managerModel

  const section = (field: TaskSettingsField, body: ReactNode, hint: string): ReactElement => (
    <fieldset disabled={disabled || editable?.[field]?.allowed === false} className="min-w-0 space-y-2 rounded-xl border border-ds-border-muted p-3">
      <legend className="max-w-full px-1 text-[13px] font-medium text-ds-ink">{t(`taskSettings.field.${field}`)}</legend>
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-ds-faint">{restored.has(field)
          ? t('taskSettings.restorePending')
          : t(`taskSettings.origin.${value[field] !== undefined ? 'task' : effective.origins[field]}`)}</span>
        <button type="button" onClick={() => onRestore(field)} className="shrink-0 text-accent hover:underline disabled:opacity-50">
          {t('taskSettings.restore')}
        </button>
      </div>
      {body}
      <p className="text-[11px] leading-5 text-ds-muted">{hint}</p>
      {editable?.[field]?.allowed === false ? <p className="text-[11px] text-ds-faint">{t('taskSettings.readOnly')}</p> : null}
    </fieldset>
  )
  const changeRoute = (patch: Partial<NonNullable<AdeProjectDefaults['route']>>): void => {
    const next = { ...route, harnessId, ...patch }
    if ((next.credentialMode ?? credentialMode) === 'native-login') delete next.providerId
    onChange('route', next)
  }

  return <div className="space-y-4">
    {section('route', <div className="space-y-2">
      <label className="flex min-w-0 items-center gap-2">
        <AgentIcon harnessId={harnessId} size={20} />
        <select aria-label={t('taskSettings.agent')} className={fieldClass} value={harnessId} onChange={(event) => {
          const next = rows.find((row) => row.definition.id === event.target.value)?.definition
          const mode = next?.credentialModes[0] ?? 'provider'
          onChange('route', { harnessId: event.target.value, model: next?.staticModels?.[0] ?? '', credentialMode: mode })
        }}>
          {!rows.some((row) => row.definition.id === harnessId) ? <option value={harnessId}>{harnessId}</option> : null}
          {rows.filter(harnessRowRunsTurns).map((row) =>
            <option key={row.definition.id} value={row.definition.id}>{row.definition.displayName}</option>)}
        </select>
      </label>
      <select aria-label={t('taskSettings.credential')} className={fieldClass} value={credentialMode} onChange={(event) => {
        const mode = event.target.value as NonNullable<AdeProjectDefaults['route']>['credentialMode']
        changeRoute({ credentialMode: mode, providerId: mode === 'native-login' ? undefined : providerId || undefined, model: '' })
      }}>
        {modes.map((mode) => <option key={mode} value={mode}>{t(`adeCredential.${mode === 'native-login' ? 'nativeLogin' : mode === 'kun-gateway' ? 'kunGateway' : 'provider'}`)}</option>)}
      </select>
      {credentialMode !== 'native-login' ? <select aria-label={t('taskSettings.provider')} className={fieldClass} value={providerId}
        onChange={(event) => changeRoute({ providerId: event.target.value || undefined, model: '' })}>
        <option value="">{t('taskSettings.selectProvider')}</option>
        {groups.map((group) => <option key={group.providerId} value={group.providerId}>{group.label}</option>)}
      </select> : null}
      <input aria-label={t('taskSettings.model')} className={fieldClass} value={route.model} list={`${id}-models`}
        placeholder={t('taskSettings.model')} onChange={(event) => changeRoute({ model: event.target.value })} />
      <datalist id={`${id}-models`}>{modelIds.map((model) => <option key={model} value={model} />)}</datalist>
    </div>, t('taskSettings.nextTurn'))}
    {section('collaborationEnabled', <label className="flex items-center gap-2 text-[12px] text-ds-ink">
      <input type="checkbox" checked={value.collaborationEnabled ?? effective.collaborationEnabled}
        onChange={(event) => onChange('collaborationEnabled', event.target.checked)} />
      {t('codeCollaborationEnable')}
    </label>, t('taskSettings.collaborationHint'))}
    {section('managerModel', <div className="grid gap-2">
      <select aria-label={t('taskSettings.managerProvider')} className={fieldClass} value={manager?.providerId ?? ''}
        onChange={(event) => onChange('managerModel', { providerId: event.target.value, model: '' })}>
        <option value="">{t('taskSettings.selectProvider')}</option>
        {kunGroups.map((group) => <option key={group.providerId} value={group.providerId}>{group.label}</option>)}
      </select>
      <input aria-label={t('taskSettings.managerModel')} className={fieldClass} value={manager?.model ?? ''}
        onChange={(event) => onChange('managerModel', { providerId: manager?.providerId ?? '', model: event.target.value })} />
    </div>, t('taskSettings.nextAdmission'))}
    {section('limits', <div className="grid grid-cols-2 gap-2">
      {(['softWorkers', 'hardWorkers'] as const).map((key) => <label key={key} className="min-w-0 space-y-1 text-[11px] text-ds-muted">
        <span>{t(`taskSettings.${key}`)}</span>
        <input type="number" min={1} max={key === 'softWorkers' ? 16 : 32} className={fieldClass} value={limits[key]}
          onChange={(event) => onChange('limits', { ...limits, [key]: Number(event.target.value) })} />
      </label>)}
    </div>, t('taskSettings.nextAdmission'))}
    {section('budget', <div className="grid grid-cols-2 gap-2">
      {(['softTokens', 'hardTokens'] as const).map((key) => <label key={key} className="min-w-0 space-y-1 text-[11px] text-ds-muted">
        <span>{t(`taskSettings.${key}`)}</span>
        <input type="number" min={1} className={fieldClass} value={budget[key] ?? ''}
          onChange={(event) => onChange('budget', { ...budget, [key]: event.target.value === '' ? undefined : Number(event.target.value) })} />
      </label>)}
    </div>, t('taskSettings.budgetHint'))}
  </div>
}

import { useMemo, type ReactElement } from 'react'
import {
  systemTimeZone,
  supportedTimeZones,
  type AppSettingsV1,
  type KunLabSettingsPatchV1,
  type KunLabSettingsV1,
  type ScheduleReasoningEffort
} from '@shared/app-settings'
import {
  resolveScheduleModelSelection,
  resolveScheduleReasoningSelection,
  scheduleModelProfileForSelection,
  scheduleModelProviderOptions,
  scheduleReasoningLabel,
  scheduleReasoningOptionsForModel
} from './schedule/schedule-task-support'
import { Sparkles } from 'lucide-react'
import { SettingRow, Toggle } from './settings-controls'
import { SettingsFeatureCard } from './settings-feature-card'

type Translate = (key: string, options?: Record<string, unknown>) => string

export function AutoPlanBuildSettingsPanel({
  t,
  settings,
  value,
  selectControlClass,
  onChange
}: {
  t: Translate
  settings: AppSettingsV1
  value: KunLabSettingsV1
  selectControlClass: string
  onChange: (patch: KunLabSettingsPatchV1) => void
}): ReactElement {
  const automatic = value.autoPlanBuild
  const providers = useMemo(() => scheduleModelProviderOptions(settings), [settings])
  const selection = resolveScheduleModelSelection(
    providers,
    automatic.scheduledDefaults.providerId,
    automatic.scheduledDefaults.model
  )
  const provider = providers.find((item) => item.providerId === selection.providerId)
  const profile = scheduleModelProfileForSelection(provider, selection.model)
  const reasoning = resolveScheduleReasoningSelection(
    automatic.scheduledDefaults.reasoningEffort,
    profile
  )
  const reasoningOptions = scheduleReasoningOptionsForModel(profile)
  const updateScheduled = (
    patch: Partial<typeof automatic.scheduledDefaults>
  ): void => onChange({
    autoPlanBuild: {
      scheduledDefaults: {
        ...automatic.scheduledDefaults,
        ...patch
      }
    }
  })

  const changeProvider = (providerId: string): void => {
    const next = providers.find((item) => item.providerId === providerId)
    const model = next?.modelIds[0] ?? ''
    updateScheduled({
      providerId,
      model,
      reasoningEffort: resolveScheduleReasoningSelection(
        undefined,
        scheduleModelProfileForSelection(next, model)
      )
    })
  }

  return (
    <SettingsFeatureCard
      icon={Sparkles}
      tone="amber"
      title={t('labAutoPlanBuildTitle')}
      description={t('labAutoPlanBuildDescription')}
      enabled={automatic.enabled}
      onEnabledChange={(enabled) => onChange({ autoPlanBuild: { enabled } })}
      toggleLabel={t('labAutoPlanBuildEnabled')}
      enabledLabel={t('settingsIaFeatureOn')}
    >
      <SettingRow
        title={t('labAutoPlanBuildConfirmation')}
        description={t('labAutoPlanBuildConfirmationDesc')}
        control={(
          <select
            data-auto-plan-build-confirmation
            className={selectControlClass}
            value={automatic.confirmation}
            onChange={(event) => onChange({
              autoPlanBuild: { confirmation: event.target.value as 'always' | 'defaults' }
            })}
          >
            <option value="always">{t('labAutoPlanBuildConfirmationAlways')}</option>
            <option value="defaults">{t('labAutoPlanBuildConfirmationDefaults')}</option>
          </select>
        )}
      />
      <SettingRow
        title={t('labAutoPlanBuildDefaultMode')}
        description={t('labAutoPlanBuildDefaultModeDesc')}
        control={(
          <select
            data-auto-plan-build-default-mode
            className={selectControlClass}
            value={automatic.defaultBuildMode}
            onChange={(event) => onChange({
              autoPlanBuild: { defaultBuildMode: event.target.value as 'direct' | 'scheduled' }
            })}
          >
            <option value="direct">{t('planBuildDirect')}</option>
            <option value="scheduled">{t('planScheduleBuild')}</option>
          </select>
        )}
      />
      <SettingRow
        title={t('labAutoPlanBuildDefaultWorktree')}
        description={t('labAutoPlanBuildDefaultWorktreeDesc')}
        control={(
          <Toggle
            checked={automatic.useWorktreeByDefault}
            onChange={(useWorktreeByDefault) => onChange({ autoPlanBuild: { useWorktreeByDefault } })}
          />
        )}
      />
      {automatic.defaultBuildMode === 'scheduled' ? (
        <>
          <SettingRow
            title={t('scheduleProvider')}
            description={t('labAutoPlanBuildScheduledModelDesc')}
            control={(
              <select className={selectControlClass} value={selection.providerId} onChange={(event) => changeProvider(event.target.value)}>
                {providers.map((item) => <option key={item.providerId} value={item.providerId}>{item.label}</option>)}
              </select>
            )}
          />
          <SettingRow
            title={t('scheduleModel')}
            description={t('labAutoPlanBuildScheduledModelDesc')}
            control={(
              <select className={selectControlClass} value={selection.model} onChange={(event) => updateScheduled({ model: event.target.value })}>
                {provider?.modelIds.map((model) => <option key={model} value={model}>{model}</option>)}
              </select>
            )}
          />
          <SettingRow
            title={t('scheduleReasoning')}
            description={t('labAutoPlanBuildScheduledModelDesc')}
            control={(
              <select className={selectControlClass} value={reasoning} onChange={(event) => updateScheduled({ reasoningEffort: event.target.value as ScheduleReasoningEffort })}>
                {reasoningOptions.map((effort) => <option key={effort} value={effort}>{scheduleReasoningLabel(effort, t)}</option>)}
              </select>
            )}
          />
          <SettingRow
            title={t('planScheduleBuildTimeZone')}
            description={t('labAutoPlanBuildTimeZoneDesc')}
            control={(
              <select className={selectControlClass} value={automatic.scheduledDefaults.timeZone || systemTimeZone()} onChange={(event) => updateScheduled({ timeZone: event.target.value })}>
                {supportedTimeZones().map((zone) => <option key={zone} value={zone}>{zone}</option>)}
              </select>
            )}
          />
        </>
      ) : null}
    </SettingsFeatureCard>
  )
}

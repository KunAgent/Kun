import type { ReactElement } from 'react'
import type { KunLabSettingsPatchV1, KunLabSettingsV1 } from '@shared/app-settings'
import { Bot } from 'lucide-react'
import { SettingRow, Toggle } from './settings-controls'
import { SettingsFeatureCard } from './settings-feature-card'

/** Lab switch for driving personal assistants (Cue, Grok Bot, Muse, dots) from Kun. */
export function AssistantMailboxSettingsPanel({
  t,
  value,
  onChange
}: {
  t: (key: string) => string
  value: KunLabSettingsV1
  onChange: (patch: KunLabSettingsPatchV1) => void
}): ReactElement {
  return (
    <SettingsFeatureCard
      icon={Bot}
      tone="teal"
      title={t('labAssistantMailboxTitle')}
      description={t('labAssistantMailboxDescription')}
      enabled={value.assistantMailbox?.enabled === true}
      onEnabledChange={(enabled) => onChange({ assistantMailbox: { enabled } })}
      toggleLabel={t('labAssistantMailboxEnabled')}
      enabledLabel={t('settingsIaFeatureOn')}
    >
      <SettingRow title={t('assistantAutoContinueFeature')} description={t('assistantAutoContinueFeatureDescription')}
        control={<Toggle checked={value.assistantMailbox?.autoContinueEnabled === true} ariaLabel={t('assistantAutoContinueFeature')}
          onChange={autoContinueEnabled => onChange({ assistantMailbox: { autoContinueEnabled } })} />} />
    </SettingsFeatureCard>
  )
}

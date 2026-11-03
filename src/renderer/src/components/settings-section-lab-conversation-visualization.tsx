import type { ReactElement } from 'react'
import type { KunLabSettingsPatchV1, KunLabSettingsV1 } from '@shared/app-settings'
import { Waypoints } from 'lucide-react'
import { SettingsFeatureCard } from './settings-feature-card'

type Translate = (key: string) => string

export function ConversationVisualizationSettingsPanel({
  t,
  value,
  onChange
}: {
  t: Translate
  value: KunLabSettingsV1
  onChange: (patch: KunLabSettingsPatchV1) => void
}): ReactElement {
  return (
    <SettingsFeatureCard
      icon={Waypoints}
      tone="teal"
      title={t('labConversationVisualizationTitle')}
      description={t('labConversationVisualizationDescription')}
      enabled={value.conversationVisualization.enabled}
      onEnabledChange={(enabled) => onChange({ conversationVisualization: { enabled } })}
      toggleLabel={t('labConversationVisualizationEnabled')}
      enabledLabel={t('settingsIaFeatureOn')}
    />
  )
}

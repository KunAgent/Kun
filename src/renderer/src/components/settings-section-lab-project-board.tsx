import type { ReactElement } from 'react'
import type { KunLabSettingsPatchV1, KunLabSettingsV1 } from '@shared/app-settings'
import { Columns3 } from 'lucide-react'
import { SettingsFeatureCard } from './settings-feature-card'

type Translate = (key: string) => string

export function ProjectBoardSettingsPanel({
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
      icon={Columns3}
      tone="pink"
      title={t('labProjectBoardTitle')}
      description={t('labProjectBoardDescription')}
      enabled={value.projectBoard.enabled}
      onEnabledChange={(enabled) => onChange({ projectBoard: { enabled } })}
      toggleLabel={t('labProjectBoardEnabled')}
      enabledLabel={t('settingsIaFeatureOn')}
    />
  )
}

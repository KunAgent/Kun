import type { ReactElement } from 'react'
import { AppWindow } from 'lucide-react'
import { SettingRow, Toggle } from './settings-controls'
import { SettingsFeatureCard } from './settings-feature-card'

type Translate = (key: string) => string

export function ContextWindowSettingsPanel({
  t,
  modelInitiatedCompactionEnabled,
  windowModeEnabled,
  onModelInitiatedChange,
  onWindowModeChange
}: {
  t: Translate
  modelInitiatedCompactionEnabled: boolean
  windowModeEnabled: boolean
  onModelInitiatedChange: (enabled: boolean) => void
  onWindowModeChange: (windowModeEnabled: boolean) => void
}): ReactElement {
  return (
    <SettingsFeatureCard
      icon={AppWindow}
      tone="blue"
      title={t('labContextCompressionTitle')}
      description={t('labContextCompressionDescription')}
      enabled={modelInitiatedCompactionEnabled}
      onEnabledChange={onModelInitiatedChange}
      toggleLabel={t('labModelInitiatedCompactionEnabled')}
      enabledLabel={t('settingsIaFeatureOn')}
    >
      <SettingRow
        title={t('labContextWindowEnabled')}
        description={t('labContextWindowEnabledDesc')}
        control={
          <Toggle
            checked={windowModeEnabled}
            onChange={onWindowModeChange}
            disabled={!modelInitiatedCompactionEnabled}
            ariaLabel={t('labContextWindowEnabled')}
          />
        }
      />
    </SettingsFeatureCard>
  )
}

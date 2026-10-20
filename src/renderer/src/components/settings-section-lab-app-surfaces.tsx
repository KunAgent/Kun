import type { ReactElement } from 'react'
import type { KunLabSettingsPatchV1, KunLabSettingsV1 } from '@shared/app-settings'
import { AppWindow, Sparkles } from 'lucide-react'
import { SettingsFeatureCard } from './settings-feature-card'

type Translate = (key: string) => string

/** Lab switches for agent-generated widgets and MCP App pages. */
export function AppSurfacesSettingsPanels({
  t,
  value,
  onChange
}: {
  t: Translate
  value: KunLabSettingsV1
  onChange: (patch: KunLabSettingsPatchV1) => void
}): ReactElement {
  return (
    <>
      <SettingsFeatureCard
        icon={Sparkles}
        tone="teal"
        title={t('labGenUiTitle')}
        description={t('labGenUiDescription')}
        enabled={value.genUi?.enabled === true}
        onEnabledChange={(enabled) => onChange({ genUi: { enabled } })}
        toggleLabel={t('labGenUiEnabled')}
        enabledLabel={t('settingsIaFeatureOn')}
      />
      <SettingsFeatureCard
        icon={AppWindow}
        tone="teal"
        title={t('labMcpAppsTitle')}
        description={t('labMcpAppsDescription')}
        enabled={value.mcpApps?.enabled === true}
        onEnabledChange={(enabled) => onChange({ mcpApps: { enabled } })}
        toggleLabel={t('labMcpAppsEnabled')}
        enabledLabel={t('settingsIaFeatureOn')}
      />
    </>
  )
}

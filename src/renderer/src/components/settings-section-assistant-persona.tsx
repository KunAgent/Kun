import type { CodeAgentPresetV1 } from '@shared/app-settings'
import type { ReactElement } from 'react'
import { CodeAgentPresetsEditor } from './settings-code-agent-presets'
import { SettingRow, SettingsCard, Toggle } from './settings-controls'

type Translate = (key: string) => string

export function ComposerPersonaSettingsPanel({
  t,
  enabled,
  presets,
  onEnabledChange,
  onPresetsChange
}: {
  t: Translate
  enabled: boolean
  presets: CodeAgentPresetV1[]
  onEnabledChange: (enabled: boolean) => void
  onPresetsChange: (next: CodeAgentPresetV1[]) => void
}): ReactElement {
  return (
    <div className="mt-6">
      <SettingsCard title={t('composerPersonaTitle')}>
        <SettingRow
          title={t('composerPersonaEnabled')}
          description={t('composerPersonaEnabledDesc')}
          control={
            <Toggle
              checked={enabled}
              onChange={onEnabledChange}
            />
          }
        />
        {enabled ? (
          <SettingRow
            title={t('codeAgentPresets')}
            description={t('codeAgentPresetsDesc')}
            wideControl
            control={
              <CodeAgentPresetsEditor
                presets={presets}
                onChange={onPresetsChange}
              />
            }
          />
        ) : null}
      </SettingsCard>
    </div>
  )
}

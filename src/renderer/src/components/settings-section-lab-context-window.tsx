import type { ReactElement } from 'react'
import {
  InlineNoticeView,
  SettingRow,
  SettingsCard,
  Toggle
} from './settings-controls'

type Translate = (key: string) => string

export function ContextWindowSettingsPanel({
  t,
  windowModeEnabled,
  onChange
}: {
  t: Translate
  windowModeEnabled: boolean
  onChange: (windowModeEnabled: boolean) => void
}): ReactElement {
  return (
    <div className="mt-6">
      <SettingsCard title={t('labContextWindowTitle')}>
        <div className="space-y-3 px-3 py-4">
          <InlineNoticeView notice={{
            tone: 'info',
            message: t('labContextWindowDescription')
          }} />
        </div>
        <SettingRow
          title={t('labContextWindowEnabled')}
          description={t('labContextWindowEnabledDesc')}
          control={
            <Toggle
              checked={windowModeEnabled}
              onChange={onChange}
            />
          }
        />
      </SettingsCard>
    </div>
  )
}

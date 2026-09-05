import type { ReactElement } from 'react'
import type { KunLabSettingsPatchV1, KunLabSettingsV1 } from '@shared/app-settings'
import {
  InlineNoticeView,
  SettingRow,
  SettingsCard,
  Toggle
} from './settings-controls'

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
    <div className="mt-6">
      <SettingsCard title={t('labProjectBoardTitle')}>
        <div className="space-y-3 px-3 py-4">
          <InlineNoticeView notice={{
            tone: 'info',
            message: t('labProjectBoardDescription')
          }} />
        </div>
        <SettingRow
          title={t('labProjectBoardEnabled')}
          description={t('labProjectBoardEnabledDesc')}
          control={
            <Toggle
              checked={value.projectBoard.enabled}
              onChange={(enabled) => onChange({ projectBoard: { enabled } })}
            />
          }
        />
      </SettingsCard>
    </div>
  )
}

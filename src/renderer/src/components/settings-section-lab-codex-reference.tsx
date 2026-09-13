import type { ReactElement } from 'react'
import type { KunLabSettingsPatchV1, KunLabSettingsV1 } from '@shared/app-settings'
import {
  InlineNoticeView,
  SettingRow,
  SettingsCard,
  Toggle
} from './settings-controls'

type Translate = (key: string) => string

export function CodexReferenceBranchesSettingsPanel({
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
      <SettingsCard title={t('labCodexReferenceBranchesTitle')}>
        <div className="space-y-3 px-3 py-4">
          <InlineNoticeView notice={{
            tone: 'info',
            message: t('labCodexReferenceBranchesDescription')
          }} />
        </div>
        <SettingRow
          title={t('labCodexReferenceBranchesEnabled')}
          description={t('labCodexReferenceBranchesEnabledDesc')}
          control={
            <Toggle
              checked={value.codexReferenceBranches?.enabled === true}
              onChange={(enabled) => onChange({ codexReferenceBranches: { enabled } })}
            />
          }
        />
      </SettingsCard>
    </div>
  )
}

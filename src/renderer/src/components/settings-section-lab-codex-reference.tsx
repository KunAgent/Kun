import type { ReactElement } from 'react'
import type { KunLabSettingsPatchV1, KunLabSettingsV1 } from '@shared/app-settings'
import { GitBranch } from 'lucide-react'
import { SettingRow, Toggle } from './settings-controls'
import { SettingsFeatureCard } from './settings-feature-card'

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
    <SettingsFeatureCard
      icon={GitBranch}
      tone="violet"
      title={t('labCodexReferenceBranchesTitle')}
      description={t('labCodexReferenceBranchesDescription')}
      enabled={value.codexReferenceBranches?.enabled === true
        || value.claudeCodeReferenceBranches?.enabled === true
        || value.opencodeReferenceBranches?.enabled === true}
      enabledLabel={t('settingsIaFeatureOn')}
    >
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
      <SettingRow
        title={t('labClaudeCodeReferenceBranchesEnabled')}
        description={t('labClaudeCodeReferenceBranchesEnabledDesc')}
        control={<Toggle checked={value.claudeCodeReferenceBranches?.enabled === true}
          onChange={(enabled) => onChange({ claudeCodeReferenceBranches: { enabled } })} />}
      />
      <SettingRow title={t('labOpenCodeReferenceBranchesEnabled')}
        description={t('labOpenCodeReferenceBranchesEnabledDesc')}
        control={<Toggle checked={value.opencodeReferenceBranches?.enabled === true}
          onChange={(enabled) => onChange({ opencodeReferenceBranches: { enabled } })} />}
      />
    </SettingsFeatureCard>
  )
}

import type { ReactElement } from 'react'
import type { AdeHarnessReadiness, AdeHarnessRow, AdeHarnessTestResult } from '@shared/ade-harnesses'
import type { KunHarnessDefaultsEntryV1, KunHarnessEnabledProfileV1, KunHarnessSettingsV1 } from '@shared/app-settings'
import { permissionFollowsKunLevel } from '../../lib/harness-native-permission'
import { SettingRow } from '../settings-controls'
import { AgentSection } from './AgentCenterParts'
import { AgentConnectionFields } from './AgentConnectionFields'
import { AgentDiagnosticsCard } from './AgentDiagnosticsCard'
import { AgentDraftBar } from './AgentDraftBar'
import { AgentLoginRow } from './AgentLoginRow'
import { AgentPermissionModeField } from './AgentPermissionModeField'
import { AgentSettingsSelect } from './AgentSettingsSelect'
import type { AgentSetupIssue } from './agent-setup-help'

type T = (key: string, options?: Record<string, unknown>) => string

/** Tab 1: how the Agent reaches its models, plus what the last check found. */
export function AgentConnectionTab({ row, settings, entry, profile, dirty, checking, busy, readiness, error, errorDetail, platform, onChange, onDiscard, onRecheck, onSetPermissionMode, permissionEditing, onPermissionEditingChange, onSetupCommand, onTrial, reportText, issue, t, tSettings }: {
  row: AdeHarnessRow
  settings: KunHarnessSettingsV1
  entry: KunHarnessDefaultsEntryV1
  profile: KunHarnessEnabledProfileV1
  dirty: boolean
  checking: boolean
  busy: boolean
  readiness?: AdeHarnessReadiness
  error: string
  errorDetail: string
  platform: string
  onChange: (patch: Partial<KunHarnessDefaultsEntryV1>) => void
  onDiscard: () => void
  onRecheck: () => void
  permissionEditing: boolean
  onPermissionEditingChange: (editing: boolean) => void
  onSetPermissionMode: (modeId: string) => void
  onSetupCommand?: (harnessId: string, command: string, title: string) => void
  onTrial?: () => Promise<AdeHarnessTestResult>
  reportText: () => string
  issue: (failure: string) => AgentSetupIssue
  t: T
  tSettings: T
}): ReactElement {
  const { definition } = row
  return <div className="space-y-7" data-agent-enablement-fields={definition.id}>
    <AgentSection title={t('agentCenter.connection.title')} description={t('agentCenter.connection.desc', { name: definition.displayName })}>
      <AgentConnectionFields row={row} value={entry} profile={profile} modelsEnabled onChange={onChange} />
      {profile.credentialMode === 'native-login' ? <AgentLoginRow row={row} platform={platform} onSetupCommand={onSetupCommand} t={t} /> : null}
      {definition.permissionModes.length ? permissionFollowsKunLevel(definition.transport)
        ? <SettingRow title={tSettings('adeSettings.harnessPermissionMode')}
          description={tSettings('adeSettings.harnessPermissionModeFollowsKun', { agent: definition.displayName })}
          control={<span className="text-xs text-ds-muted">{tSettings('adeSettings.harnessPermissionModeDefault')}</span>} />
        : definition.transport === 'acp'
          ? <SettingRow title={tSettings('adeSettings.harnessPermissionMode')} description={tSettings('adeSettings.harnessPermissionModeDesc')}
            control={<AgentPermissionModeField value={entry.permissionMode ?? ''} modes={definition.permissionModes}
              disabled={busy} onChange={mode => onChange({ permissionMode: mode || undefined })}
              onEditingChange={onPermissionEditingChange} t={tSettings} />} />
        : <SettingRow title={tSettings('adeSettings.harnessPermissionMode')} description={tSettings('adeSettings.harnessPermissionModeDesc')}
          control={<AgentSettingsSelect label={tSettings('adeSettings.harnessPermissionMode')}
            value={settings.defaults[definition.id]?.permissionMode ?? ''} onChange={onSetPermissionMode}
            options={[{ value: '', label: tSettings('adeSettings.harnessPermissionModeDefault') },
              ...definition.permissionModes.map((mode) => ({ value: mode.id, label: mode.label }))]} />} /> : null}
      <AgentDraftBar dirty={dirty} busy={busy || permissionEditing} onDiscard={onDiscard} onRecheck={onRecheck} t={t} />
    </AgentSection>
    <AgentDiagnosticsCard harnessId={definition.id} readiness={readiness} error={error} errorDetail={errorDetail}
      checking={checking} busy={busy || permissionEditing} onRecheck={onRecheck} onTrial={permissionEditing ? undefined : onTrial} reportText={reportText} issue={issue} t={t} />
  </div>
}

import type { AdeExecutionConfigSnapshot } from './ade-execution-config'
import type { AdeProjectDefaults } from './ade-project-defaults'

export type AdeTaskSettingsField = Exclude<keyof AdeProjectDefaults, 'isolation'>
export type AdeTaskSettingsResponse = {
  current: AdeExecutionConfigSnapshot
  pending?: AdeExecutionConfigSnapshot
  inherited: AdeExecutionConfigSnapshot
  revision: string
  editable: Record<AdeTaskSettingsField | 'isolation', { allowed: boolean; reason?: string }>
}
export type AdeTaskSettingsMutation = {
  expectedRevision: string
  set?: Pick<AdeProjectDefaults, AdeTaskSettingsField>
  unset?: AdeTaskSettingsField[]
}

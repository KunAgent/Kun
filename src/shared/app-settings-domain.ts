import type { AppSettingsV1 } from './app-settings-types'

export type SettingsFieldOwner =
  | 'core' | 'provider' | 'kun' | 'write' | 'claw' | 'schedule' | 'workflow'
  | 'design' | 'terminal' | 'keyboard' | 'update'

/** Compile-time complete inventory of every persisted top-level settings field. */
export const APP_SETTINGS_FIELD_OWNERS: { readonly [K in keyof AppSettingsV1]-?: SettingsFieldOwner } = {
  version: 'core', initialSetupCompleted: 'core', locale: 'core', theme: 'core', uiFontScale: 'core', chatContentMaxWidthPx: 'core',
  composerSendKey: 'core', cursorSpotlight: 'core', cursorSpotlightColor: 'core', provider: 'provider', agents: 'kun',
  workspaceRoot: 'core', conversationWorkspaceRoot: 'core', log: 'core', checkpointCleanup: 'core',
  gitBranchPrefix: 'core', notifications: 'core', appBehavior: 'core', keyboardShortcuts: 'keyboard',
  write: 'write', claw: 'claw', schedule: 'schedule', workflow: 'workflow', design: 'design',
  guiUpdate: 'update', terminal: 'terminal', codePromptPrefix: 'core', disabledSkillIds: 'core'
}

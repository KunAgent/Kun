import { describe, expect, it } from 'vitest'
import {
  defaultClawSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '@shared/app-settings'
import { clawModelSelectOptions, mergeClawModelOptions } from './claw-model-options'

function buildSettings(models: string[]): AppSettingsV1 {
  const provider = defaultModelProviderSettings()
  provider.providers = [
    {
      ...provider.providers[0],
      models,
      modelProfiles: {}
    }
  ]
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'medium',
    provider,
    agents: { kun: defaultKunRuntimeSettings() },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: true, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: '',
    disabledSkillIds: []
  }
}

describe('claw model options', () => {
  it('uses configured text models instead of provider preset catalogs', () => {
    expect(clawModelSelectOptions(buildSettings(['team-chat-model']))).toEqual([
      'auto',
      'team-chat-model'
    ])
  })

  it('keeps the current channel model when editing older settings', () => {
    expect(mergeClawModelOptions(['team-chat-model'], 'legacy-channel-model')).toEqual([
      'auto',
      'team-chat-model',
      'legacy-channel-model'
    ])
  })
})

import { describe, expect, it } from 'vitest'
import {
  defaultClawSettings,
  defaultDesignSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  defaultTerminalSettings,
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
    uiFontScale: 0.88,
    chatContentMaxWidthPx: 896,
    provider,
    agents: { kun: defaultKunRuntimeSettings() },
    workspaceRoot: '/tmp/workspace',
    conversationWorkspaceRoot: '~/Documents/Kun',
    log: { enabled: true, retentionDays: 7 },
    checkpointCleanup: { enabled: false, intervalDays: 3 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    design: defaultDesignSettings(),
    terminal: defaultTerminalSettings(),
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

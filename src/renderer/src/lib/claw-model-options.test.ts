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
    composerSendKey: 'enter',
    provider,
    agents: { kun: defaultKunRuntimeSettings() },
    workspaceRoot: '/tmp/workspace',
    conversationWorkspaceRoot: '~/Documents/Kun',
    log: { enabled: true, retentionDays: 7 },
    checkpointCleanup: { createEnabled: false, enabled: false, intervalDays: 3 },
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
    chatWelcomeMessage: '',
    codeAgentPresets: [],
    disabledSkillIds: []
  }
}

describe('claw model options', () => {
  it('includes configured text models alongside the always-available free catalog', () => {
    const options = clawModelSelectOptions(buildSettings(['team-chat-model']))
    expect(options).toEqual(expect.arrayContaining([
      'auto',
      'big-pickle',
      'team-chat-model'
    ]))
    expect(options).not.toContain('gpt-5-nano')
    expect(options).not.toContain('deepseek-chat')
  })

  it('keeps the current channel model when editing older settings', () => {
    expect(mergeClawModelOptions(['team-chat-model'], 'legacy-channel-model')).toEqual([
      'auto',
      'team-chat-model',
      'legacy-channel-model'
    ])
  })
})

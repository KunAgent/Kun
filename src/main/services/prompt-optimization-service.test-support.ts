import {
  defaultClawSettings,
  defaultDesignSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultTerminalSettings, defaultRemoteAccessSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../shared/app-settings'

export function createSettings(patch: Partial<AppSettingsV1['agents']['kun']> = {}): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 0.82,
    chatContentMaxWidthPx: 896,
    composerSendKey: 'enter',
    provider: defaultModelProviderSettings(),
    agents: {
      kun: {
        ...defaultKunRuntimeSettings(),
        apiKey: 'sk-runtime',
        promptOptimization: {
          ...defaultKunRuntimeSettings().promptOptimization,
          enabled: true
        },
        ...patch
      }
    },
    workspaceRoot: '/tmp/workspace',
    conversationWorkspaceRoot: '~/Documents/Kun',
    log: {
      enabled: true,
      retentionDays: 2
    },
    checkpointCleanup: { createEnabled: false, enabled: false, intervalDays: 3 },
    notifications: {
      turnComplete: true
    },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    terminal: defaultTerminalSettings(),
    remote: defaultRemoteAccessSettings(),
    guiUpdate: {
      channel: 'stable'
    },
    design: defaultDesignSettings(),
    codePromptPrefix: '',
    chatWelcomeMessage: '',
    codeAgentPresets: [],
    disabledSkillIds: [],
    claw: defaultClawSettings()
  }
}

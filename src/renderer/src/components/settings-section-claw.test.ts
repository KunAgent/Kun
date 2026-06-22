import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  defaultClawSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  defaultTerminalSettings,
  type AppSettingsV1
} from '@shared/app-settings'
import { ClawSettingsSection } from './settings-section-claw'

const settingsLabels: Record<string, string> = {
  clawRuntime: 'Phone connection',
  clawEnabled: 'Enable phone connection',
  clawEnabledDesc: 'Enable phone connection description',
  clawDefaultWorkspace: 'Default phone workspace',
  clawDefaultWorkspaceDesc: 'Default phone workspace description',
  clawDefaultWorkspacePlaceholder: 'Inherit {{path}}',
  clawDefaultWorkspaceReset: 'Use GUI default',
  browse: 'Browse',
  clawManageAgents: 'Connected phone agents',
  clawManageAgentsEmpty: 'No phone agents',
  clawManageAgentMeta: '{{provider}} {{model}} {{workspace}}',
  clawManageAgentEnabled: 'Enabled',
  clawManageAgentDisabled: 'Disabled',
  clawManageAgentName: 'Agent name',
  clawManageAgentNamePlaceholder: 'Agent name placeholder',
  clawModel: 'Model',
  clawWorkspaceOverride: 'Workspace override',
  clawWorkspaceInherit: 'Use default workspace: {{path}}',
  clawManageAgentDescription: 'Short description',
  clawManageAgentDescriptionPlaceholder: 'Short description placeholder',
  clawManageAgentIdentity: 'Role definition',
  clawManageAgentIdentityPlaceholder: 'Role definition placeholder',
  clawManageAgentPersonality: 'Personality',
  clawManageAgentPersonalityPlaceholder: 'Personality placeholder',
  clawManageAgentUserContext: 'User context',
  clawManageAgentUserContextPlaceholder: 'User context placeholder',
  clawManageAgentReplyRules: 'Reply rules',
  clawManageAgentReplyRulesPlaceholder: 'Reply rules placeholder',
  clawTelegramConnectTitle: 'Connect Telegram Bot',
  clawTelegramConnectDesc: 'Connect Telegram Bot description',
  clawTelegramConnectStep1: 'Open Telegram and open BotFather',
  clawTelegramConnectStep2: 'Create the bot and copy the token',
  clawTelegramConnectStep3: 'Paste the token below',
  clawTelegramConnectStep4: 'Message the bot privately',
  clawTelegramCredentialTitle: 'Telegram Bot Credentials',
  clawTelegramConnectedHint: '{{bot}} is connected and saved locally.'
}

const commonLabels: Record<string, string> = {
  connectPhoneTelegramBotTokenLabel: 'Bot Token',
  connectPhoneTelegramBotTokenPlaceholder: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
  connectPhoneTelegramAllowedChatsLabel: 'Allowed Private Chat IDs (optional)',
  connectPhoneTelegramAllowedChatsPlaceholder: 'e.g. 123456789, 987654321',
  connectPhoneTelegramAllowedChatsHint: 'Comma-separated private chat IDs. Leave empty to allow all private messages; group chats are not supported.',
  connectPhoneTelegramConnect: 'Connect',
  connectPhoneTelegramConnecting: 'Verifying...',
  connectPhoneTelegramTokenRequired: 'Please enter a Bot Token.',
  connectPhoneTelegramErrorInvalidFormat: 'Invalid bot token format.',
  connectPhoneTelegramErrorRejected: 'Telegram rejected this token.',
  connectPhoneTelegramErrorNetwork: 'Network error.',
  connectPhoneTelegramErrorUnknown: 'Verification failed.',
  connectPhoneTelegramErrorPayload: 'Invalid request payload.'
}

function translate(labels: Record<string, string>, key: string, values?: Record<string, unknown>): string {
  let label = labels[key] ?? key
  for (const [name, value] of Object.entries(values ?? {})) {
    label = label.replace(`{{${name}}}`, String(value))
  }
  return label
}

function t(key: string, values?: Record<string, unknown>): string {
  return translate(settingsLabels, key, values)
}

function tCommon(key: string, values?: Record<string, unknown>): string {
  return translate(commonLabels, key, values)
}

function buildSettings(): AppSettingsV1 {
  const settings: AppSettingsV1 = {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'medium',
    provider: defaultModelProviderSettings(),
    agents: { kun: defaultKunRuntimeSettings() },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: true, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    terminal: defaultTerminalSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: '',
    disabledSkillIds: []
  }
  settings.claw.enabled = true
  settings.claw.im.workspaceRoot = '/tmp/claw'
  settings.provider.providers = [{
    ...settings.provider.providers[0],
    models: ['team-chat-model'],
    modelProfiles: {}
  }]
  settings.claw.channels = [
    {
      id: 'channel_1',
      provider: 'feishu',
      label: 'Team helper',
      enabled: true,
      model: 'team-chat-model',
      threadId: 'thr_1',
      workspaceRoot: '',
      agentProfile: {
        name: 'Team helper',
        description: 'Handles team chat requests',
        identity: 'You are the project assistant.',
        personality: 'Concise and practical.',
        userContext: 'The user coordinates product and engineering.',
        replyRules: 'Start with the conclusion.'
      },
      conversations: [],
      createdAt: '2026-06-03T00:00:00.000Z',
      updatedAt: '2026-06-03T00:00:00.000Z'
    }
  ]
  return settings
}

function buildTelegramSettings(): AppSettingsV1 {
  const settings = buildSettings()
  settings.claw.channels = [{
    id: 'telegram_1',
    provider: 'telegram',
    label: 'telegram agent',
    enabled: true,
    model: 'auto',
    threadId: '',
    workspaceRoot: '',
    agentProfile: {
      name: 'telegram agent',
      description: '',
      identity: '',
      personality: '',
      userContext: '',
      replyRules: ''
    },
    platformCredential: {
      kind: 'telegram',
      botToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi',
      allowedChatIds: '123456789',
      botUsername: 'kun_test_bot',
      createdAt: '2026-06-19T00:00:00.000Z'
    },
    conversations: [],
    createdAt: '2026-06-19T00:00:00.000Z',
    updatedAt: '2026-06-19T00:00:00.000Z'
  }]
  return settings
}

describe('ClawSettingsSection', () => {
  it('renders connected phone agent management fields', () => {
    const html = renderToStaticMarkup(
      createElement(ClawSettingsSection, {
        ctx: {
          t,
          tCommon,
          form: buildSettings(),
          update: vi.fn(),
          selectControlClass: 'select-control',
          compactHomePath: (path: string) => path,
          expandHomePath: (path: string) => path,
          pickClawWorkspace: async () => undefined,
          resetClawWorkspaceToDefault: () => undefined,
          clawWorkspacePickerError: null,
          addClawChannel: async () => undefined
        }
      })
    )

    expect(html).toContain('Connected phone agents')
    expect(html).toContain('Connect Telegram Bot')
    expect(html).toContain('Paste the token below')
    expect(html).toContain('Allowed Private Chat IDs (optional)')
    expect(html).toContain('e.g. 123456789, 987654321')
    expect(html).not.toContain('clawTelegramConnectTitle')
    expect(html).not.toContain('connectPhoneTelegramBotTokenLabel')
    expect(html).not.toContain('-1009876543210')
    expect(html).toContain('Team helper')
    expect(html).toContain('Role definition')
    expect(html).toContain('You are the project assistant.')
    expect(html).toContain('Personality')
    expect(html).toContain('Reply rules')
    expect(html).toContain('Start with the conclusion.')
    expect(html).toContain('<option value="team-chat-model"')
    expect(html).not.toContain('<option value="deepseek-v4-pro"')
  })

  it('renders saved telegram credentials and the IM-thread hint', () => {
    const html = renderToStaticMarkup(
      createElement(ClawSettingsSection, {
        ctx: {
          t,
          tCommon,
          form: buildTelegramSettings(),
          update: vi.fn(),
          selectControlClass: 'select-control',
          compactHomePath: (value: string) => value,
          expandHomePath: (value: string) => value,
          pickClawWorkspace: async () => undefined,
          resetClawWorkspaceToDefault: () => undefined,
          clawWorkspacePickerError: null,
          addClawChannel: async () => undefined
        }
      })
    )

    expect(html).toContain('Telegram Bot Credentials')
    expect(html).toContain('@kun_test_bot is connected and saved locally.')
    expect(html).not.toContain('Connect Telegram Bot')
  })
})

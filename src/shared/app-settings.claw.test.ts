import { describe, expect, it } from 'vitest'
import {
  APP_LOCALES,
  applyKunRuntimePatch,
  kunSettingsEnvelope,
  kunSettingsPatch,
  DEFAULT_KUN_DATA_DIR,
  DEFAULT_KUN_MODEL,
  DEFAULT_KUN_STREAM_IDLE_TIMEOUT_MS,
  DEFAULT_LOG_RETENTION_DAYS,
  DEFAULT_CURSOR_SPOTLIGHT_COLOR,
  DEFAULT_GIT_BRANCH_PREFIX,
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_SANDBOX_MODE,
  DEFAULT_WEIXIN_BRIDGE_RPC_URL,
  DEFAULT_SCHEDULE_INTERNAL_PORT,
  DEFAULT_TOOL_OUTPUT_MAX_BYTES,
  DEFAULT_TOOL_OUTPUT_MAX_LINES,
  buildClawRuntimePrompt,
  defaultClawSettings,
  defaultModelProviderSettings,
  mergeKunRuntimeSettings,
  mergeScheduleSettings,
  defaultKunRuntimeSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultTerminalSettings, defaultRemoteAccessSettings,
  defaultWriteSelectionAssistSettings,
  defaultDesignSettings,
  normalizeDesignSettings,
  defaultWriteSettings,
  getModelProviderPreset,
  defaultKeyboardShortcuts,
  modelProviderPresetProfile,
  mergeAppBehaviorSettings,
  mergeWriteSettings,
  normalizeWriteSettings,
  normalizeWriteAgentPresets,
  isKunRuntimeInsecure,
  migrateLegacyAppSettings,
  normalizeAppSettings,
  KUN_RUNTIME_TUNING_DEFAULTS_VERSION,
  normalizeChatContentMaxWidth,
  normalizeComposerSendKey,
  isComposerSendHotkey,
  normalizeGitBranchPrefix,
  normalizeClawImPlatformCredential,
  applyGitBranchPrefix,
  parseClawUserPromptForDisplay,
  inferModelEndpointFormatFromUrl,
  kunToolPermissionModeFromSettings,
  kunToolPermissionModeSettings,
  normalizeScheduleSettings,
  validateClawImTelegramProxy,
  resolveKunRuntimeSettings,
  resolveWriteInlineCompletionApiKey,
  resolveWriteInlineCompletionBaseUrl,
  resolveWriteInlineCompletionModel,
  type AppSettingsV1,
  type ClawImChannelV1,
  type ClawImProvider
} from './app-settings'

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 0.82,
    chatContentMaxWidthPx: 896,
    composerSendKey: 'enter',
    provider: defaultModelProviderSettings(),
    agents: {
      kun: defaultKunRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    conversationWorkspaceRoot: '~/Documents/Kun',
    log: { enabled: false, retentionDays: 7 },
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
    remote: defaultRemoteAccessSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: '',
    chatWelcomeMessage: '',
    codeAgentPresets: [],
    disabledSkillIds: []
  }
}

function clawChannel(provider: ClawImProvider, label: string, name = label): ClawImChannelV1 {
  const now = '2026-06-01T00:00:00.000Z'
  return {
    id: `${provider}-${label}`,
    provider,
    label,
    enabled: true,
    model: 'auto',
    threadId: '',
    workspaceRoot: '',
    agentProfile: {
      name,
      description: '',
      identity: '',
      personality: '',
      userContext: '',
      replyRules: ''
    },
    conversations: [],
    createdAt: now,
    updatedAt: now
  }
}

describe('claw settings', () => {
  it('normalizes Telegram proxies while keeping legacy credentials compatible', () => {
    const legacy = normalizeClawImPlatformCredential({
      kind: 'telegram',
      botToken: '123:token',
      allowedChatIds: '',
      createdAt: '2026-08-09T00:00:00.000Z'
    })
    expect(legacy).toMatchObject({
      kind: 'telegram',
      proxy: { enabled: false, url: '' }
    })

    const proxied = normalizeClawImPlatformCredential({
      kind: 'telegram',
      botToken: '123:token',
      allowedChatIds: '',
      proxy: { enabled: true, url: '  socks5://user:pass@127.0.0.1:1080  ' },
      createdAt: '2026-08-09T00:00:00.000Z'
    })
    expect(proxied).toMatchObject({
      kind: 'telegram',
      proxy: { enabled: true, url: 'socks5://user:pass@127.0.0.1:1080' }
    })

    const invalid = normalizeClawImPlatformCredential({
      kind: 'telegram',
      botToken: '123:token',
      allowedChatIds: '',
      proxy: { enabled: true, url: 'ftp://127.0.0.1:21' }
    })
    expect(invalid).toMatchObject({
      kind: 'telegram',
      proxy: { enabled: false, url: 'ftp://127.0.0.1:21' }
    })
  })

  it.each(['http', 'https', 'socks', 'socks4', 'socks5'])(
    'accepts %s Telegram proxy URLs',
    (scheme) => {
      expect(validateClawImTelegramProxy({
        enabled: true,
        url: `${scheme}://127.0.0.1:1080`
      })).toMatchObject({ ok: true })
    }
  )

  it('rejects enabled empty, relative, and unsupported Telegram proxies', () => {
    for (const url of ['', '127.0.0.1:1080', 'ftp://127.0.0.1:21']) {
      expect(validateClawImTelegramProxy({ enabled: true, url })).toMatchObject({ ok: false })
    }
  })

  it('stores the WeChat bridge URL in Claw IM settings', () => {
    const defaults = defaultClawSettings()
    expect(defaults.im.weixinBridgeUrl).toBe(DEFAULT_WEIXIN_BRIDGE_RPC_URL)

    const normalized = normalizeAppSettings({
      ...settings(),
      claw: {
        ...defaults,
        im: {
          ...defaults.im,
          weixinBridgeUrl: '  http://127.0.0.1:18787/rpc  '
        }
      }
    })

    expect(normalized.claw.im.weixinBridgeUrl).toBe('http://127.0.0.1:18787/rpc')
  })

  it('normalizes the IM recent thread list limit', () => {
    const defaults = defaultClawSettings()
    expect(defaults.im.recentThreadListLimit).toBe(5)

    const normalized = normalizeAppSettings({
      ...settings(),
      claw: {
        ...defaults,
        im: {
          ...defaults.im,
          recentThreadListLimit: 500
        }
      }
    })

    expect(normalized.claw.im.recentThreadListLimit).toBe(50)
  })

  it('migrates the legacy OpenClaw Gateway URL into the WeChat bridge URL', () => {
    const defaults = defaultClawSettings()
    const normalized = normalizeAppSettings({
      ...settings(),
      claw: {
        ...defaults,
        im: {
          ...defaults.im,
          weixinBridgeUrl: '',
          openClawGatewayUrl: '  http://127.0.0.1:18787/rpc  '
        } as typeof defaults.im & { openClawGatewayUrl: string }
      }
    })

    expect(normalized.claw.im.weixinBridgeUrl).toBe('http://127.0.0.1:18787/rpc')
  })

  it('normalizes phone agent default names without touching custom names', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      claw: {
        ...defaultClawSettings(),
        channels: [
          clawChannel('weixin', 'WeChat Agent', 'WeChat Agent'),
          clawChannel('feishu', 'Feishu / Lark', 'Feishu Agent'),
          clawChannel('weixin', 'Support Bot', '')
        ]
      }
    })

    expect(normalized.claw.channels.map((channel) => ({
      label: channel.label,
      name: channel.agentProfile.name
    }))).toEqual([
      { label: 'weixin agent', name: 'weixin agent' },
      { label: 'feishu agent', name: 'feishu agent' },
      { label: 'Support Bot', name: 'Support Bot' }
    ])
  })

  it('keeps the channel welcomeSentAt marker and drops empty values', () => {
    const welcomed = { ...clawChannel('weixin', 'WeChat Agent'), welcomeSentAt: '2026-06-10T00:00:00.000Z' }
    const fresh = { ...clawChannel('feishu', 'Feishu / Lark'), welcomeSentAt: '' }
    const normalized = normalizeAppSettings({
      ...settings(),
      claw: {
        ...defaultClawSettings(),
        channels: [welcomed, fresh]
      }
    })

    expect(normalized.claw.channels[0].welcomeSentAt).toBe('2026-06-10T00:00:00.000Z')
    expect(normalized.claw.channels[1]).not.toHaveProperty('welcomeSentAt')
  })

  it('defaults per-channel ClawImChannelV1.feishuStream to false when missing on old settings', () => {
    const defaults = defaultClawSettings()
    const legacyChannel = { ...defaults.channels[0], id: 'channel_legacy' }
    delete (legacyChannel as Partial<typeof legacyChannel>).feishuStream
    const normalized = normalizeAppSettings({
      ...settings(),
      claw: {
        ...defaults,
        channels: [legacyChannel as typeof defaults.channels[0]]
      }
    })

    expect(normalized.claw.channels[0].feishuStream).toBe(false)
  })

  it('preserves ClawImChannelV1.feishuStream=true when explicitly set on old settings', () => {
    const defaults = defaultClawSettings()
    const channelWithStream = { ...defaults.channels[0], id: 'channel_stream', feishuStream: true }
    const normalized = normalizeAppSettings({
      ...settings(),
      claw: {
        ...defaults,
        channels: [channelWithStream as typeof defaults.channels[0]]
      }
    })

    expect(normalized.claw.channels[0].feishuStream).toBe(true)
  })
})

describe('isKunRuntimeInsecure', () => {
  it('keeps auth enabled even when the runtime token is empty', () => {
    expect(
      isKunRuntimeInsecure({
        ...defaultKunRuntimeSettings(),
        insecure: false,
        runtimeToken: ''
      })
    ).toBe(false)
  })

  it('keeps auth enabled when a token exists and insecure is false', () => {
    expect(
      isKunRuntimeInsecure({
        ...defaultKunRuntimeSettings(),
        insecure: false,
        runtimeToken: 'tok-1'
      })
    ).toBe(false)
  })

  it('honors explicit insecure mode', () => {
    expect(
      isKunRuntimeInsecure({
        ...defaultKunRuntimeSettings(),
        insecure: true,
        runtimeToken: 'tok-1'
      })
    ).toBe(true)
  })
})

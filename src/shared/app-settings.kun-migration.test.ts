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
  defaultTerminalSettings,
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
  applyGitBranchPrefix,
  parseClawUserPromptForDisplay,
  inferModelEndpointFormatFromUrl,
  kunToolPermissionModeFromSettings,
  kunToolPermissionModeSettings,
  normalizeScheduleSettings,
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
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: '',
    chatWelcomeMessage: '',
    codeAgentPresets: [],
    disabledSkillIds: []
  }
}

describe('kun envelope helpers', () => {
  it('wraps runtime settings and patches into the compatibility shell', () => {
    const runtime = defaultKunRuntimeSettings()
    expect(kunSettingsEnvelope(runtime)).toEqual({ kun: runtime })
    expect(kunSettingsPatch({ model: 'deepseek-reasoner' })).toEqual({
      kun: { model: 'deepseek-reasoner' }
    })
  })

  it('applies a kun patch onto full app settings', () => {
    const current = settings()
    const next = applyKunRuntimePatch(current, { model: 'deepseek-reasoner' })
    expect(next.agents.kun.model).toBe('deepseek-reasoner')
    expect(next.write).toEqual(current.write)
  })
})

describe('legacy Kun defaults migration', () => {
  it('normalizes old master settings without an agents.kun envelope', () => {
    const normalized = normalizeAppSettings({
      version: 1,
      locale: 'zh',
      theme: 'dark',
      uiFontScale: 0.82,
      agentProvider: 'deepseek-runtime',
      deepseek: {
        binaryPath: '/usr/local/bin/deepseek',
        port: 18787,
        autoStart: false,
        apiKey: 'sk-old',
        baseUrl: 'https://api.deepseek.com',
        runtimeToken: 'old-token',
        extraCorsOrigins: [],
        approvalPolicy: 'on-request',
        sandboxMode: 'read-only'
      },
      workspaceRoot: '/tmp/legacy-workspace',
      log: { enabled: true, retentionDays: 2 },
      notifications: { turnComplete: true },
      guiUpdate: { channel: 'frontier' },
      claw: defaultClawSettings()
    } as unknown as AppSettingsV1)

    expect(normalized.agents.kun).toEqual(expect.objectContaining({
      binaryPath: '',
      port: 18787,
      autoStart: false,
      runtimeToken: 'old-token',
      approvalPolicy: 'on-request',
      sandboxMode: 'read-only',
      approvalReviewer: 'user'
    }))
    expect(normalized.provider).toEqual(expect.objectContaining({
      apiKey: 'sk-old',
      baseUrl: 'https://api.deepseek.com'
    }))
    expect('agentProvider' in normalized).toBe(false)
    expect('deepseek' in normalized).toBe(false)
  })

  it('keeps legacy workspace-write permissions during Kun migration', () => {
    const normalized = normalizeAppSettings({
      version: 1,
      locale: 'zh',
      theme: 'dark',
      uiFontScale: 0.82,
      agentProvider: 'deepseek-runtime',
      deepseek: {
        binaryPath: '/usr/local/bin/deepseek',
        port: 8787,
        autoStart: false,
        apiKey: 'sk-old',
        baseUrl: 'https://api.deepseek.com',
        runtimeToken: 'old-token',
        extraCorsOrigins: [],
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write'
      },
      workspaceRoot: '/tmp/legacy-workspace',
      log: { enabled: true, retentionDays: 2 },
      notifications: { turnComplete: true },
      guiUpdate: { channel: 'frontier' },
      claw: defaultClawSettings()
    } as unknown as AppSettingsV1)

    expect(normalized.agents.kun).toEqual(expect.objectContaining({
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      approvalReviewer: 'user'
    }))
  })

  it('drops legacy top-level instructions during normalization', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      instructions: { enabled: true }
    } as unknown as AppSettingsV1)

    expect('instructions' in normalized).toBe(false)
  })

  it('moves the legacy local HTTP default port to the Kun default port', () => {
    const migrated = migrateLegacyAppSettings({
      version: 1,
      agentProvider: 'deepseek-runtime',
      deepseek: {
        // 这里必须保留旧版真实写入值, 用于升级到当前 Kun 默认端口。
        port: 7878
      }
    } as unknown as Parameters<typeof migrateLegacyAppSettings>[0])

    expect(migrated.agents?.kun?.port).toBe(18899)
  })

  it('moves previous Kun local default ports out of the low range', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      agents: { kun: { ...defaultKunRuntimeSettings(), port: 8899 } },
      claw: {
        ...defaultClawSettings(),
        im: { ...defaultClawSettings().im, port: 8787 }
      },
      schedule: {
        ...defaultScheduleSettings(),
        internal: { ...defaultScheduleSettings().internal, port: 8788 }
      },
      workflow: {
        ...defaultWorkflowSettings(),
        webhookPort: 8799
      }
    })

    expect(normalized.agents.kun.port).toBe(18899)
    expect(normalized.claw.im.port).toBe(18787)
    expect(normalized.schedule.internal.port).toBe(18788)
    expect(normalized.workflow.webhookPort).toBe(18799)
  })

  it('fills image generation defaults for settings stored before the feature existed', () => {
    const migrated = migrateLegacyAppSettings({
      version: 1,
      agentProvider: 'deepseek-runtime',
      deepseek: {}
    } as unknown as Parameters<typeof migrateLegacyAppSettings>[0])

    expect(migrated.agents?.kun?.imageGeneration).toEqual({
      enabled: false,
      providerId: '',
      protocol: 'openai-images',
      baseUrl: '',
      apiKey: '',
      model: '',
      defaultResolution: '1K',
      defaultSize: '',
      quality: 'auto',
      timeoutMs: 180000
    })
  })

  it('preserves the Codex responses image protocol during normalization', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      agents: {
        kun: {
          ...defaultKunRuntimeSettings(),
          imageGeneration: {
            ...defaultKunRuntimeSettings().imageGeneration,
            enabled: true,
            providerId: 'custom',
            protocol: 'codex-responses-image',
            baseUrl: 'https://chatgpt.com/backend-api/codex',
            apiKey: 'codex-access',
            model: 'gpt-image-2'
          }
        }
      }
    })

    expect(normalized.agents.kun.imageGeneration).toMatchObject({
      protocol: 'codex-responses-image',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      apiKey: 'codex-access',
      model: 'gpt-image-2'
    })
  })

  it('uses the current approval policy default for missing legacy local HTTP settings', () => {
    const migrated = migrateLegacyAppSettings({
      version: 1,
      agentProvider: 'deepseek-runtime',
      deepseek: {}
    } as unknown as Parameters<typeof migrateLegacyAppSettings>[0])

    expect(migrated.agents?.kun?.approvalPolicy).toBe(DEFAULT_APPROVAL_POLICY)
  })

  it('upgrades old persisted Kun defaults to the current defaults', () => {
    const migrated = migrateLegacyAppSettings({
      version: 1,
      agents: {
        kun: {
          dataDir: '~/.deepseekgui/coreagent',
          model: 'deepseek-chat'
        }
      }
    } as Parameters<typeof migrateLegacyAppSettings>[0])

    expect(migrated.agents?.kun).toEqual(expect.objectContaining({
      dataDir: DEFAULT_KUN_DATA_DIR,
      model: DEFAULT_KUN_MODEL
    }))
  })

  it('preserves a non-legacy Kun model override', () => {
    const migrated = migrateLegacyAppSettings({
      version: 1,
      agents: {
        kun: {
          dataDir: '/tmp/custom-kun',
          model: 'deepseek-v4-flash'
        }
      }
    } as Parameters<typeof migrateLegacyAppSettings>[0])

    expect(migrated.agents?.kun).toEqual(expect.objectContaining({
      dataDir: '/tmp/custom-kun',
      model: 'deepseek-v4-flash'
    }))
  })

  it('preserves custom model providers while migrating legacy settings', () => {
    const migrated = normalizeAppSettings({
      ...settings(),
      agentProvider: 'deepseek-runtime',
      provider: {
        apiKey: 'sk-default',
        baseUrl: 'https://api.deepseek.com',
        proxy: {
          enabled: true,
          url: 'http://127.0.0.1:7890'
        },
        providers: [
          ...defaultModelProviderSettings().providers,
          {
            id: 'custom-provider-2',
            name: 'Custom Provider',
            apiKey: 'sk-custom',
            baseUrl: 'https://custom.example/v1',
            endpointFormat: 'responses',
            useProxy: false,
            models: ['custom-model']
          }
        ]
      },
      agents: {
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: 'custom-provider-2',
          model: 'custom-model'
        }
      }
    } as unknown as AppSettingsV1)

    expect(migrated.provider.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'custom-provider-2',
          name: 'Custom Provider',
          apiKey: 'sk-custom',
          baseUrl: 'https://custom.example/v1',
          endpointFormat: 'responses',
          useProxy: false,
          models: ['custom-model']
        })
      ])
    )
    expect(migrated.agents.kun.providerId).toBe('custom-provider-2')
    expect(migrated.provider.proxy).toEqual({
      enabled: true,
      url: 'http://127.0.0.1:7890'
    })
    expect(resolveKunRuntimeSettings(migrated)).toEqual(
      expect.objectContaining({
        apiKey: 'sk-custom',
        baseUrl: 'https://custom.example/v1',
        endpointFormat: 'responses'
      })
    )
  })
})

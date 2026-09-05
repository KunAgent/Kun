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

describe('kun defaults', () => {
  it('keeps a single shared default data directory source', () => {
    expect(defaultKunRuntimeSettings().dataDir).toBe(DEFAULT_KUN_DATA_DIR)
  })

  it('defaults the assistant model to v4 pro', () => {
    expect(defaultKunRuntimeSettings().model).toBe(DEFAULT_KUN_MODEL)
  })

  it('defaults a fresh profile to full access with user review metadata', () => {
    expect(defaultKunRuntimeSettings()).toEqual(expect.objectContaining({
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access',
      approvalReviewer: 'user'
    }))
  })

  it('keeps compatibility defaults narrower than the fresh profile default', () => {
    expect(DEFAULT_APPROVAL_POLICY).toBe('on-request')
    expect(DEFAULT_SANDBOX_MODE).toBe('workspace-write')
  })

  it('defaults Agent Perspective capture off for newly created conversations', () => {
    expect(defaultKunRuntimeSettings().llmDebug).toEqual({
      defaultThreadCaptureEnabled: false
    })
  })

  it('maps unified tool permission modes to complete authority settings', () => {
    expect(kunToolPermissionModeSettings('ask-for-approval')).toEqual({
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      approvalReviewer: 'user'
    })
    expect(kunToolPermissionModeSettings('approve-for-me')).toEqual({
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      approvalReviewer: 'agent'
    })
    expect(kunToolPermissionModeSettings('full-access')).toEqual({
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access',
      approvalReviewer: 'user'
    })
    expect(kunToolPermissionModeFromSettings(defaultKunRuntimeSettings())).toBe('full-access')
    expect(kunToolPermissionModeFromSettings({
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      approvalReviewer: 'user'
    })).toBe('ask-for-approval')
    expect(kunToolPermissionModeFromSettings({
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      approvalReviewer: 'agent'
    })).toBe('approve-for-me')
  })

  it('preserves legacy approval and sandbox axes while defaulting a missing reviewer to user', () => {
    const { approvalReviewer: _approvalReviewer, ...legacyKun } = defaultKunRuntimeSettings()
    void _approvalReviewer
    const normalized = normalizeAppSettings({
      ...settings(),
      agents: {
        kun: {
          ...legacyKun,
          approvalPolicy: 'never',
          sandboxMode: 'read-only'
        }
      }
    } as unknown as AppSettingsV1)

    expect(normalized.agents.kun).toEqual(expect.objectContaining({
      approvalPolicy: 'never',
      sandboxMode: 'read-only',
      approvalReviewer: 'user'
    }))
    expect(kunToolPermissionModeFromSettings(normalized.agents.kun)).toBe('ask-for-approval')
  })

  it('normalizes unknown persisted reviewers to user and preserves agent reviewers', () => {
    const invalid = normalizeAppSettings({
      ...settings(),
      agents: {
        kun: {
          ...defaultKunRuntimeSettings(),
          approvalReviewer: 'operator'
        }
      }
    } as unknown as AppSettingsV1)
    const delegated = normalizeAppSettings({
      ...settings(),
      agents: {
        kun: {
          ...defaultKunRuntimeSettings(),
          approvalPolicy: 'on-request',
          sandboxMode: 'workspace-write',
          approvalReviewer: 'agent'
        }
      }
    })

    expect(invalid.agents.kun.approvalReviewer).toBe('user')
    expect(delegated.agents.kun.approvalReviewer).toBe('agent')
    expect(kunToolPermissionModeFromSettings(delegated.agents.kun)).toBe('approve-for-me')
  })

  it('defaults token economy mode to off', () => {
    expect(defaultKunRuntimeSettings().tokenEconomyMode).toBe(false)
    expect(defaultKunRuntimeSettings().tokenEconomy).toMatchObject({
      enabled: false,
      compressToolDescriptions: true,
      compressToolResults: true,
      conciseResponses: true,
      historyHygiene: {
        maxToolResultLines: 320,
        maxToolResultBytes: 32768,
        maxToolResultTokens: 8000,
        maxToolArgumentStringBytes: 8192,
        maxToolArgumentStringTokens: 2000,
        maxArrayItems: 80
      }
    })
  })

  it('defaults tool output limits to 500kb and 20000 lines', () => {
    expect(defaultKunRuntimeSettings().toolOutputLimits).toEqual({
      maxLines: DEFAULT_TOOL_OUTPUT_MAX_LINES,
      maxBytes: DEFAULT_TOOL_OUTPUT_MAX_BYTES
    })
    expect(defaultKunRuntimeSettings().toolOutputLimits.maxLines).toBe(20_000)
    expect(defaultKunRuntimeSettings().toolOutputLimits.maxBytes).toBe(500 * 1024)
  })

  it('defaults MCP search discovery to off', () => {
    expect(defaultKunRuntimeSettings().mcpSearch).toMatchObject({
      enabled: false,
      mode: 'auto',
      autoThresholdToolCount: 24,
      topKDefault: 5,
      topKMax: 10
    })
  })

  it('defaults image generation to off with empty provider fields', () => {
    expect(defaultKunRuntimeSettings().imageGeneration).toEqual({
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

  it('defaults media generation to off with empty provider fields', () => {
    expect(defaultKunRuntimeSettings().textToSpeech).toEqual({
      enabled: false,
      providerId: '',
      protocol: 'openai-speech',
      baseUrl: '',
      apiKey: '',
      model: '',
      voice: '',
      format: 'mp3',
      timeoutMs: 120000
    })
    expect(defaultKunRuntimeSettings().musicGeneration).toEqual({
      enabled: false,
      providerId: '',
      protocol: 'minimax-music',
      baseUrl: '',
      apiKey: '',
      model: '',
      format: 'mp3',
      timeoutMs: 300000
    })
    expect(defaultKunRuntimeSettings().videoGeneration).toEqual({
      enabled: false,
      providerId: '',
      protocol: 'minimax-video',
      baseUrl: '',
      apiKey: '',
      model: '',
      defaultDuration: 6,
      defaultResolution: '1080P',
      timeoutMs: 900000,
      pollIntervalMs: 10000
    })
  })

  it('defaults advanced Kun runtime tuning to conservative values', () => {
    expect(defaultKunRuntimeSettings()).toMatchObject({
      storage: {
        backend: 'hybrid',
        sqlitePath: ''
      },
      contextCompaction: {
        defaultSoftThreshold: 192000,
        defaultHardThreshold: 217600,
        summaryMode: 'model',
        summaryTimeoutMs: 15000,
        summaryMaxTokens: 2048,
        summaryInputMaxBytes: 98304
      },
      runtimeTuning: {
        defaultsVersion: KUN_RUNTIME_TUNING_DEFAULTS_VERSION,
        maxConcurrentTurns: 256,
        maxWallTimeMs: 86400000,
        streamIdleTimeoutMs: 450000,
        toolStorm: {
          enabled: true
        },
        toolArgumentRepair: {
          maxStringBytes: 524288
        }
      }
    })
  })
})

describe('log retention settings', () => {
  it('defaults local error log retention to 3 days', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      log: undefined
    } as unknown as AppSettingsV1)

    expect(normalized.log.retentionDays).toBe(DEFAULT_LOG_RETENTION_DAYS)
  })
})

describe('runtime model provider selection', () => {
  it('repairs a legacy provider/model mismatch when the model has one owner', () => {
    const raw = settings()
    const codexPreset = getModelProviderPreset('codex')
    const codex = codexPreset ? modelProviderPresetProfile(codexPreset) : null
    expect(codex).not.toBeNull()
    raw.provider.providers = [...raw.provider.providers, codex!]
    raw.agents.kun.providerId = 'deepseek'
    raw.agents.kun.model = 'gpt-5.3-codex-spark'

    const normalized = normalizeAppSettings(raw)

    expect(normalized.agents.kun.providerId).toBe('codex')
    expect(normalized.agents.kun.model).toBe('gpt-5.3-codex-spark')
  })

  it('falls back to the selected provider model instead of retaining an ambiguous mismatch', () => {
    const raw = settings()
    const codex = modelProviderPresetProfile(getModelProviderPreset('codex')!)
    const duplicate = {
      ...codex,
      id: 'codex-mirror',
      name: 'Codex Mirror'
    }
    raw.provider.providers = [...raw.provider.providers, codex, duplicate]
    raw.agents.kun.providerId = 'deepseek'
    raw.agents.kun.model = 'gpt-5.3-codex-spark'

    const normalized = normalizeAppSettings(raw)

    expect(normalized.agents.kun.providerId).toBe('deepseek')
    expect(normalized.agents.kun.model).toBe('deepseek-v4-flash')
  })

  it('repairs partial subagent profile selections into complete pairs', () => {
    const raw = settings()
    const codex = modelProviderPresetProfile(getModelProviderPreset('codex')!)
    raw.provider.providers = [...raw.provider.providers, codex]
    raw.agents.kun.subagents = {
      enabled: true,
      profiles: [
        {
          id: 'model-only', enabled: true, name: '', mode: 'subagent', toolPolicy: 'inherit',
          model: 'gpt-5.3-codex-spark'
        },
        {
          id: 'provider-only', enabled: true, name: '', mode: 'subagent', toolPolicy: 'inherit',
          providerId: 'deepseek'
        }
      ]
    }

    const normalized = normalizeAppSettings(raw)

    expect(normalized.agents.kun.subagents?.profiles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'model-only',
        model: 'gpt-5.3-codex-spark',
        providerId: 'codex'
      }),
      expect.objectContaining({
        id: 'provider-only',
        model: 'deepseek-v4-flash',
        providerId: 'deepseek'
      })
    ]))
  })
})

describe('composer send key settings', () => {
  it('defaults to enter send', () => {
    const raw = {
      ...settings(),
      composerSendKey: undefined
    } as unknown as AppSettingsV1

    expect(normalizeAppSettings(raw).composerSendKey).toBe('enter')
  })

  it('keeps shiftEnter when configured', () => {
    expect(normalizeAppSettings({
      ...settings(),
      composerSendKey: 'shiftEnter'
    }).composerSendKey).toBe('shiftEnter')
  })

  it('rejects unknown values', () => {
    expect(normalizeComposerSendKey('ctrlEnter')).toBe('enter')
    expect(normalizeComposerSendKey(null)).toBe('enter')
  })

  it('matches Enter or Shift+Enter send hotkeys', () => {
    const enter = { key: 'Enter', shiftKey: false, metaKey: false, ctrlKey: false }
    const shiftEnter = { key: 'Enter', shiftKey: true, metaKey: false, ctrlKey: false }
    const metaEnter = { key: 'Enter', shiftKey: false, metaKey: true, ctrlKey: false }

    expect(isComposerSendHotkey(enter, 'enter')).toBe(true)
    expect(isComposerSendHotkey(shiftEnter, 'enter')).toBe(false)
    expect(isComposerSendHotkey(enter, 'shiftEnter')).toBe(false)
    expect(isComposerSendHotkey(shiftEnter, 'shiftEnter')).toBe(true)
    expect(isComposerSendHotkey(metaEnter, 'enter')).toBe(false)
    expect(isComposerSendHotkey(metaEnter, 'shiftEnter')).toBe(false)
  })
})

describe('app behavior settings', () => {
  it('defaults desktop behavior to off', () => {
    const raw = {
      ...settings(),
      appBehavior: undefined
    } as unknown as AppSettingsV1

    expect(normalizeAppSettings(raw).appBehavior).toEqual({
      openAtLogin: false,
      startMinimized: false,
      keepAwake: false,
      useSystemTitleBar: false,
      closeAction: 'ask',
      closeToTray: false
    })
  })

  it('only keeps start minimized when open at login is enabled', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      appBehavior: {
        openAtLogin: false,
        startMinimized: true,
        keepAwake: true,
        useSystemTitleBar: true,
        closeToTray: true
      }
    })

    expect(normalized.appBehavior).toEqual({
      openAtLogin: false,
      startMinimized: false,
      keepAwake: true,
      useSystemTitleBar: true,
      closeAction: 'tray',
      closeToTray: true
    })
  })

  it('preserves and patches the keep-awake preference independently', () => {
    const current = normalizeAppSettings({
      ...settings(),
      appBehavior: {
        openAtLogin: false,
        startMinimized: false,
        keepAwake: true,
        closeToTray: false
      }
    })

    expect(current.appBehavior.keepAwake).toBe(true)
    expect(mergeAppBehaviorSettings(current.appBehavior, { keepAwake: false }))
      .toMatchObject({ keepAwake: false, openAtLogin: false, closeAction: 'ask' })
  })

  it('maps legacy closeToTray patches to explicit close actions', () => {
    const current = normalizeAppSettings({
      ...settings(),
      appBehavior: undefined
    } as unknown as AppSettingsV1)

    expect(current.appBehavior.closeAction).toBe('ask')
    expect(mergeAppBehaviorSettings(current.appBehavior, { closeToTray: true }).closeAction).toBe('tray')
    expect(mergeAppBehaviorSettings(current.appBehavior, { closeToTray: false }).closeAction).toBe('quit')
  })

  it('preserves the Linux system title bar preference through patches', () => {
    const current = normalizeAppSettings({
      ...settings(),
      appBehavior: undefined
    } as unknown as AppSettingsV1)

    expect(mergeAppBehaviorSettings(current.appBehavior, { useSystemTitleBar: true }))
      .toMatchObject({ useSystemTitleBar: true })
    expect(mergeAppBehaviorSettings(current.appBehavior, { useSystemTitleBar: false }))
      .toMatchObject({ useSystemTitleBar: false })
  })
})

describe('cursor spotlight settings', () => {
  it('defaults the interaction effect on and preserves an explicit opt-out', () => {
    expect(normalizeAppSettings({
      ...settings(),
      cursorSpotlight: undefined
    }).cursorSpotlight).toBe(true)
    expect(normalizeAppSettings({
      ...settings(),
      cursorSpotlight: false
    }).cursorSpotlight).toBe(false)
  })

  it('defaults, preserves, and validates the interaction effect color', () => {
    expect(normalizeAppSettings({
      ...settings(),
      cursorSpotlightColor: undefined
    }).cursorSpotlightColor).toBe(DEFAULT_CURSOR_SPOTLIGHT_COLOR)

    expect(normalizeAppSettings({
      ...settings(),
      cursorSpotlightColor: '  #FF8800  '
    }).cursorSpotlightColor).toBe('#ff8800')

    expect(normalizeAppSettings({
      ...settings(),
      cursorSpotlightColor: 'not-a-color'
    }).cursorSpotlightColor).toBe(DEFAULT_CURSOR_SPOTLIGHT_COLOR)
  })
})

describe('keyboard shortcut settings', () => {
  it('defaults shortcut overrides to empty', () => {
    const raw = {
      ...settings(),
      keyboardShortcuts: undefined
    } as unknown as AppSettingsV1

    expect(normalizeAppSettings(raw).keyboardShortcuts).toEqual({
      bindings: {}
    })
  })
})

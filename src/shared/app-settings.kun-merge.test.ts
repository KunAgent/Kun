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
  type ClawImProvider,
  type KunRuntimeSettingsV1
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

describe('mergeKunRuntimeSettings', () => {
  it('does not let an empty primary model wipe the current chat model', () => {
    const current = defaultKunRuntimeSettings()
    expect(current.model.trim().length).toBeGreaterThan(0)

    const next = mergeKunRuntimeSettings(current, {
      providerId: 'opencode-go',
      model: ''
    })

    expect(next.providerId).toBe('opencode-go')
    expect(next.model).toBe(current.model)
    expect(next.model.trim().length).toBeGreaterThan(0)
  })

  it('merges the new-conversation Agent Perspective capture default', () => {
    const current = defaultKunRuntimeSettings()
    const next = mergeKunRuntimeSettings(current, {
      llmDebug: { defaultThreadCaptureEnabled: true }
    })

    expect(next.llmDebug).toEqual({ defaultThreadCaptureEnabled: true })
    expect(current.llmDebug).toEqual({ defaultThreadCaptureEnabled: false })
  })

  it('normalizes bounded digest-bound project config grants and replaces the grant roster', () => {
    const digestA = 'a'.repeat(64)
    const digestB = 'B'.repeat(64)
    const current = mergeKunRuntimeSettings(defaultKunRuntimeSettings(), {
      projectConfig: {
        grants: [
          { workspaceRoot: ' /workspace/a ', configDigest: digestA },
          { workspaceRoot: '/workspace/b', configDigest: 'not-a-digest' }
        ]
      }
    })

    expect(current.projectConfig.grants).toEqual([
      { workspaceRoot: '/workspace/a', configDigest: digestA }
    ])

    const next = mergeKunRuntimeSettings(current, {
      projectConfig: {
        grants: [{ workspaceRoot: '/workspace/b', configDigest: digestB }]
      }
    })

    expect(next.projectConfig.grants).toEqual([
      { workspaceRoot: '/workspace/b', configDigest: 'b'.repeat(64) }
    ])
  })

  it('adds an empty project config grant list to legacy settings', () => {
    const raw = settings() as AppSettingsV1 & {
      agents: { kun: Omit<AppSettingsV1['agents']['kun'], 'projectConfig'> }
    }
    delete (raw.agents.kun as Partial<AppSettingsV1['agents']['kun']>).projectConfig

    expect(normalizeAppSettings(raw as AppSettingsV1).agents.kun.projectConfig).toEqual({ grants: [] })
  })

  it('merges a direct kun patch without the envelope wrapper', () => {
    const current = defaultKunRuntimeSettings()
    const next = mergeKunRuntimeSettings(current, {
      model: 'deepseek-reasoner',
      port: 19000,
      tokenEconomyMode: true
    })
    expect(next.model).toBe('deepseek-reasoner')
    expect(next.port).toBe(19000)
    expect(next.tokenEconomyMode).toBe(true)
    expect(next.tokenEconomy.enabled).toBe(true)
    expect(next.baseUrl).toBe(current.baseUrl)
  })

  it('deep-merges subagent settings while dropping the legacy cumulative limit', () => {
    const current = {
      ...defaultKunRuntimeSettings(),
      subagents: {
        enabled: true,
        useExistingAgents: true,
      maxParallel: 3,
      proactiveRetry: { enabled: true, maxAttempts: 3 },
        maxChildRuns: 12,
        defaultToolPolicy: 'inherit' as const,
        defaultProfile: 'researcher',
        profiles: [{
          id: 'researcher',
          enabled: true,
          name: 'Researcher',
          mode: 'subagent' as const,
          toolPolicy: 'readOnly' as const
        }]
      }
    } as unknown as KunRuntimeSettingsV1

    const limitsChanged = mergeKunRuntimeSettings(current, {
      subagents: { maxParallel: 5 }
    })
    expect(limitsChanged.subagents).toEqual({
      enabled: true,
      useExistingAgents: true,
      maxParallel: 5,
      proactiveRetry: { enabled: true, maxAttempts: 3 },
      defaultToolPolicy: 'inherit',
      defaultProfile: 'researcher',
      profiles: current.subagents?.profiles
    })
    expect(limitsChanged.subagents).not.toHaveProperty('maxChildRuns')

    const rosterCleared = mergeKunRuntimeSettings(limitsChanged, {
      subagents: { profiles: [] }
    })
    expect(rosterCleared.subagents).toEqual({
      enabled: true,
      useExistingAgents: true,
      maxParallel: 5,
      proactiveRetry: { enabled: true, maxAttempts: 3 },
      defaultToolPolicy: 'inherit',
      defaultProfile: 'researcher',
      profiles: []
    })

    const normalized = normalizeAppSettings({
      ...settings(),
      agents: { kun: current }
    })
    expect(normalized.agents.kun.subagents).not.toHaveProperty('maxChildRuns')

    const migrated = migrateLegacyAppSettings({
      ...settings(),
      agents: { kun: current }
    })
    expect(migrated.agents?.kun.subagents).not.toHaveProperty('maxChildRuns')
  })

  it('completes a partial first subagent patch with safe defaults', () => {
    const next = mergeKunRuntimeSettings(defaultKunRuntimeSettings(), {
      subagents: { enabled: false }
    })

    expect(next.subagents).toEqual({
      enabled: false,
      useExistingAgents: true,
      proactiveRetry: { enabled: true, maxAttempts: 3 },
      profiles: []
    })
    expect(normalizeAppSettings({
      ...settings(),
      agents: { kun: next }
    }).agents.kun.subagents).toEqual({
      enabled: false,
      useExistingAgents: true,
      proactiveRetry: { enabled: true, maxAttempts: 3 },
      profiles: []
    })
  })

  it('deep-merges token economy settings and keeps the legacy switch synced', () => {
    const current = defaultKunRuntimeSettings()
    const next = mergeKunRuntimeSettings(current, {
      tokenEconomy: {
        enabled: true,
        compressToolResults: false,
        historyHygiene: {
          maxToolResultLines: 120
        }
      }
    })

    expect(next.tokenEconomyMode).toBe(true)
    expect(next.tokenEconomy.enabled).toBe(true)
    expect(next.tokenEconomy.compressToolDescriptions).toBe(true)
    expect(next.tokenEconomy.compressToolResults).toBe(false)
    expect(next.tokenEconomy.historyHygiene.maxToolResultLines).toBe(120)
    expect(next.tokenEconomy.historyHygiene.maxToolResultBytes).toBe(
      current.tokenEconomy.historyHygiene.maxToolResultBytes
    )

    const legacySwitch = mergeKunRuntimeSettings(next, { tokenEconomyMode: false })
    expect(legacySwitch.tokenEconomyMode).toBe(false)
    expect(legacySwitch.tokenEconomy.enabled).toBe(false)
  })

  it('deep-merges tool output limits and normalizes out-of-range values', () => {
    const current = defaultKunRuntimeSettings()
    const next = mergeKunRuntimeSettings(current, {
      toolOutputLimits: {
        maxBytes: 2 * 1024 * 1024
      }
    })

    expect(next.toolOutputLimits.maxLines).toBe(current.toolOutputLimits.maxLines)
    expect(next.toolOutputLimits.maxBytes).toBe(2 * 1024 * 1024)

    const clamped = mergeKunRuntimeSettings(next, {
      toolOutputLimits: {
        maxLines: 9_999_999,
        maxBytes: 999 * 1024 * 1024
      }
    })
    expect(clamped.toolOutputLimits.maxLines).toBe(1_000_000)
    expect(clamped.toolOutputLimits.maxBytes).toBe(64 * 1024 * 1024)
  })

  it('deep-merges MCP search settings', () => {
    const current = defaultKunRuntimeSettings()
    const next = mergeKunRuntimeSettings(current, {
      mcpSearch: {
        enabled: true,
        mode: 'search',
        topKDefault: 3
      }
    })

    expect(next.mcpSearch.enabled).toBe(true)
    expect(next.mcpSearch.mode).toBe('search')
    expect(next.mcpSearch.topKDefault).toBe(3)
    expect(next.mcpSearch.topKMax).toBe(current.mcpSearch.topKMax)
  })

  it('preserves ask-for-approval when normalizing unified tool permission settings', () => {
    const current = defaultKunRuntimeSettings()
    const next = mergeKunRuntimeSettings(current, {
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      approvalReviewer: 'user'
    })

    expect(next.approvalPolicy).toBe('on-request')
    expect(next.sandboxMode).toBe('workspace-write')
    expect(next.approvalReviewer).toBe('user')
    expect(kunToolPermissionModeFromSettings(next)).toBe('ask-for-approval')
  })

  it('preserves approve-for-me when normalizing unified tool permission settings', () => {
    const current = defaultKunRuntimeSettings()
    const next = mergeKunRuntimeSettings(current, {
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      approvalReviewer: 'agent'
    })

    expect(next.approvalPolicy).toBe('on-request')
    expect(next.sandboxMode).toBe('workspace-write')
    expect(next.approvalReviewer).toBe('agent')
    expect(kunToolPermissionModeFromSettings(next)).toBe('approve-for-me')
  })

  it('preserves non-UI approval/sandbox combinations instead of canonicalizing them', () => {
    // The unified 3-mode selector cannot represent every raw authority snapshot.
    // mergeKunRuntimeSettings must NOT snap these to a canonical mode,
    // otherwise it would silently weaken a user's saved security posture.
    const current = defaultKunRuntimeSettings()

    const neverReadOnly = mergeKunRuntimeSettings(current, {
      approvalPolicy: 'never',
      sandboxMode: 'read-only'
    })
    expect(neverReadOnly.approvalPolicy).toBe('never')
    expect(neverReadOnly.sandboxMode).toBe('read-only')

    const suggest = mergeKunRuntimeSettings(current, { approvalPolicy: 'suggest' })
    expect(suggest.approvalPolicy).toBe('suggest')

    const externalSandbox = mergeKunRuntimeSettings(current, { sandboxMode: 'external-sandbox' })
    expect(externalSandbox.sandboxMode).toBe('external-sandbox')
  })

  it('deep-merges advanced Kun settings', () => {
    const current = defaultKunRuntimeSettings()
    const next = mergeKunRuntimeSettings(current, {
      storage: {
        sqlitePath: ' /tmp/kun.sqlite3 '
      },
      contextCompaction: {
        defaultSoftThreshold: 64000
      },
      runtimeTuning: {
        toolStorm: {
          enabled: false
        }
      }
    })

    expect(next.storage.backend).toBe('hybrid')
    expect(next.storage.sqlitePath).toBe('/tmp/kun.sqlite3')
    expect(next.contextCompaction.defaultSoftThreshold).toBe(64000)
    expect(next.contextCompaction.defaultHardThreshold).toBe(64000)
    expect(next.contextCompaction.summaryMode).toBe('model')
    expect(next.runtimeTuning.toolStorm.enabled).toBe(false)
    expect(next.runtimeTuning.toolArgumentRepair).toEqual(current.runtimeTuning.toolArgumentRepair)
    expect(next.runtimeTuning.maxConcurrentTurns).toBe(current.runtimeTuning.maxConcurrentTurns)
    expect(next.runtimeTuning.maxWallTimeMs).toBe(current.runtimeTuning.maxWallTimeMs)
    expect(next.runtimeTuning.streamIdleTimeoutMs).toBe(current.runtimeTuning.streamIdleTimeoutMs)
  })

  it('normalizes the maximum turn duration', () => {
    const current = defaultKunRuntimeSettings()
    expect(current.runtimeTuning.maxWallTimeMs).toBe(86_400_000)

    const set = mergeKunRuntimeSettings(current, {
      runtimeTuning: { maxWallTimeMs: 7_200_000 }
    })
    expect(set.runtimeTuning.maxWallTimeMs).toBe(7_200_000)
    expect(set.runtimeTuning.toolStorm).toEqual(current.runtimeTuning.toolStorm)

    expect(
      mergeKunRuntimeSettings(current, { runtimeTuning: { maxWallTimeMs: 0 } })
        .runtimeTuning.maxWallTimeMs
    ).toBe(86_400_000)
    expect(
      mergeKunRuntimeSettings(current, { runtimeTuning: { maxWallTimeMs: 999_999_999 } })
        .runtimeTuning.maxWallTimeMs
    ).toBe(86_400_000)
  })

  it('normalizes maximum concurrent turns to the supported range', () => {
    const current = defaultKunRuntimeSettings()
    expect(current.runtimeTuning.maxConcurrentTurns).toBe(256)

    expect(
      mergeKunRuntimeSettings(current, { runtimeTuning: { maxConcurrentTurns: 32 } })
        .runtimeTuning.maxConcurrentTurns
    ).toBe(32)
    expect(
      mergeKunRuntimeSettings(current, { runtimeTuning: { maxConcurrentTurns: 0 } })
        .runtimeTuning.maxConcurrentTurns
    ).toBe(256)
    expect(
      mergeKunRuntimeSettings(current, { runtimeTuning: { maxConcurrentTurns: 257 } })
        .runtimeTuning.maxConcurrentTurns
    ).toBe(256)
  })

  it('normalizes the stream idle timeout (0 disables, out-of-range clamps)', () => {
    const current = defaultKunRuntimeSettings()
    expect(current.runtimeTuning.streamIdleTimeoutMs).toBe(450000)

    const set = mergeKunRuntimeSettings(current, {
      runtimeTuning: { streamIdleTimeoutMs: 300000 }
    })
    expect(set.runtimeTuning.streamIdleTimeoutMs).toBe(300000)
    // Other knobs are untouched by a timeout-only patch.
    expect(set.runtimeTuning.toolStorm).toEqual(current.runtimeTuning.toolStorm)

    // 0 means "disabled" and is preserved rather than coerced to the default.
    expect(
      mergeKunRuntimeSettings(current, { runtimeTuning: { streamIdleTimeoutMs: 0 } })
        .runtimeTuning.streamIdleTimeoutMs
    ).toBe(0)

    // Negative falls back to the default; absurdly large clamps to the cap.
    expect(
      mergeKunRuntimeSettings(current, { runtimeTuning: { streamIdleTimeoutMs: -5 } })
        .runtimeTuning.streamIdleTimeoutMs
    ).toBe(450000)
    expect(
      mergeKunRuntimeSettings(current, { runtimeTuning: { streamIdleTimeoutMs: 999_999_999 } })
        .runtimeTuning.streamIdleTimeoutMs
    ).toBe(3_600_000)
  })

  it('migrates the unversioned stream idle default exactly once', () => {
    const current = settings()
    const { defaultsVersion: _defaultsVersion, ...legacyRuntimeTuning } =
      current.agents.kun.runtimeTuning
    void _defaultsVersion

    const migrated = normalizeAppSettings({
      ...current,
      agents: {
        kun: {
          ...current.agents.kun,
          runtimeTuning: {
            ...legacyRuntimeTuning,
            streamIdleTimeoutMs: 45_000
          }
        }
      }
    } as AppSettingsV1)

    expect(migrated.agents.kun.runtimeTuning).toMatchObject({
      defaultsVersion: KUN_RUNTIME_TUNING_DEFAULTS_VERSION,
      streamIdleTimeoutMs: DEFAULT_KUN_STREAM_IDLE_TIMEOUT_MS
    })
    expect(normalizeAppSettings(migrated).agents.kun.runtimeTuning).toEqual(
      migrated.agents.kun.runtimeTuning
    )
  })

  it('preserves custom, disabled, and already-versioned stream idle timeouts', () => {
    const current = settings()
    const { defaultsVersion: _defaultsVersion, ...legacyRuntimeTuning } =
      current.agents.kun.runtimeTuning
    void _defaultsVersion
    const normalizeTimeout = (
      streamIdleTimeoutMs: number,
      defaultsVersion?: number
    ) => normalizeAppSettings({
      ...current,
      agents: {
        kun: {
          ...current.agents.kun,
          runtimeTuning: {
            ...legacyRuntimeTuning,
            ...(defaultsVersion !== undefined ? { defaultsVersion } : {}),
            streamIdleTimeoutMs
          }
        }
      }
    } as AppSettingsV1).agents.kun.runtimeTuning

    expect(normalizeTimeout(120_000)).toMatchObject({
      defaultsVersion: KUN_RUNTIME_TUNING_DEFAULTS_VERSION,
      streamIdleTimeoutMs: 120_000
    })
    expect(normalizeTimeout(0)).toMatchObject({
      defaultsVersion: KUN_RUNTIME_TUNING_DEFAULTS_VERSION,
      streamIdleTimeoutMs: 0
    })
    expect(normalizeTimeout(45_000, KUN_RUNTIME_TUNING_DEFAULTS_VERSION)).toMatchObject({
      defaultsVersion: KUN_RUNTIME_TUNING_DEFAULTS_VERSION,
      streamIdleTimeoutMs: 45_000
    })
  })

  it('deep-merges image generation settings and normalizes invalid values', () => {
    const current = defaultKunRuntimeSettings()
    const next = mergeKunRuntimeSettings(current, {
      imageGeneration: {
        enabled: true,
        baseUrl: ' https://api.siliconflow.cn/v1 ',
        apiKey: 'sk-image',
        model: 'Kwai-Kolors/Kolors'
      }
    })

    expect(next.imageGeneration).toEqual({
      enabled: true,
      providerId: '',
      protocol: 'openai-images',
      baseUrl: 'https://api.siliconflow.cn/v1',
      apiKey: 'sk-image',
      model: 'Kwai-Kolors/Kolors',
      defaultResolution: '1K',
      defaultSize: '',
      quality: 'auto',
      timeoutMs: 180000
    })

    const sized = mergeKunRuntimeSettings(next, {
      imageGeneration: {
        defaultResolution: '2K',
        defaultSize: '1536x1024',
        quality: 'high',
        timeoutMs: 240000
      }
    })
    expect(sized.imageGeneration.defaultResolution).toBe('2K')
    expect(sized.imageGeneration.defaultSize).toBe('1536x1024')
    expect(sized.imageGeneration.quality).toBe('high')
    expect(sized.imageGeneration.timeoutMs).toBe(240000)
    expect(sized.imageGeneration.apiKey).toBe('sk-image')

    const invalidSize = mergeKunRuntimeSettings(sized, {
      imageGeneration: {
        defaultResolution: '8K' as never,
        defaultSize: 'huge',
        quality: 'maximum' as never,
        timeoutMs: -5
      }
    })
    expect(invalidSize.imageGeneration.defaultResolution).toBe('1K')
    expect(invalidSize.imageGeneration.defaultSize).toBe('')
    expect(invalidSize.imageGeneration.quality).toBe('auto')
    expect(invalidSize.imageGeneration.timeoutMs).toBe(180000)
  })

  it('deep-merges media generation settings and normalizes invalid values', () => {
    const current = defaultKunRuntimeSettings()
    const next = mergeKunRuntimeSettings(current, {
      textToSpeech: {
        enabled: true,
        protocol: 'minimax-t2a',
        baseUrl: ' https://api.minimax.io ',
        apiKey: 'sk-tts',
        model: 'speech-2.8-hd',
        voice: ' male-qn-qingse ',
        format: 'wav'
      },
      musicGeneration: {
        enabled: true,
        baseUrl: ' https://api.minimax.io ',
        apiKey: 'sk-music',
        model: 'music-2.6'
      },
      videoGeneration: {
        enabled: true,
        baseUrl: ' https://api.minimax.io ',
        apiKey: 'sk-video',
        model: 'MiniMax-Hailuo-2.3',
        defaultDuration: 10,
        pollIntervalMs: 20000
      }
    })

    expect(next.textToSpeech).toMatchObject({
      enabled: true,
      protocol: 'minimax-t2a',
      baseUrl: 'https://api.minimax.io',
      apiKey: 'sk-tts',
      model: 'speech-2.8-hd',
      voice: 'male-qn-qingse',
      format: 'wav'
    })
    expect(next.musicGeneration).toMatchObject({
      enabled: true,
      protocol: 'minimax-music',
      baseUrl: 'https://api.minimax.io',
      apiKey: 'sk-music',
      model: 'music-2.6',
      format: 'mp3'
    })
    expect(next.videoGeneration).toMatchObject({
      enabled: true,
      protocol: 'minimax-video',
      baseUrl: 'https://api.minimax.io',
      apiKey: 'sk-video',
      model: 'MiniMax-Hailuo-2.3',
      defaultDuration: 10,
      defaultResolution: '1080P',
      pollIntervalMs: 20000
    })

    const invalid = mergeKunRuntimeSettings(next, {
      textToSpeech: { format: 'aac', timeoutMs: -1 },
      videoGeneration: { defaultDuration: -1, pollIntervalMs: -1 }
    })
    expect(invalid.textToSpeech.format).toBe('mp3')
    expect(invalid.textToSpeech.timeoutMs).toBe(120000)
    expect(invalid.videoGeneration.defaultDuration).toBe(6)
    expect(invalid.videoGeneration.pollIntervalMs).toBe(10000)
  })

  it('defaults missing MiniMax media generation settings to the configured MiniMax provider', () => {
    const minimax = getModelProviderPreset('minimax')
    expect(minimax).not.toBeNull()
    const minimaxProfile = modelProviderPresetProfile(minimax!, 'sk-minimax')
    const {
      textToSpeech: _textToSpeech,
      musicGeneration: _musicGeneration,
      videoGeneration: _videoGeneration,
      ...legacyKun
    } = defaultKunRuntimeSettings()
    void _textToSpeech
    void _musicGeneration
    void _videoGeneration
    const normalized = normalizeAppSettings({
      ...settings(),
      provider: {
        ...defaultModelProviderSettings(),
        providers: [
          ...defaultModelProviderSettings().providers,
          minimaxProfile
        ]
      },
      agents: { kun: legacyKun as AppSettingsV1['agents']['kun'] }
    })
    const resolved = resolveKunRuntimeSettings(normalized)

    expect(normalized.agents.kun.textToSpeech).toEqual(expect.objectContaining({
      enabled: true,
      providerId: 'minimax',
      protocol: 'minimax-t2a',
      model: 'speech-2.8-hd'
    }))
    expect(normalized.agents.kun.musicGeneration).toEqual(expect.objectContaining({
      enabled: true,
      providerId: 'minimax',
      protocol: 'minimax-music',
      model: 'music-2.6'
    }))
    expect(normalized.agents.kun.videoGeneration).toEqual(expect.objectContaining({
      enabled: true,
      providerId: 'minimax',
      protocol: 'minimax-video',
      model: 'MiniMax-Hailuo-2.3'
    }))
    expect(resolved.textToSpeech.apiKey).toBe('sk-minimax')
    expect(resolved.musicGeneration.baseUrl).toBe('https://api.minimax.io')
    expect(resolved.videoGeneration.baseUrl).toBe('https://api.minimax.io')
  })
})

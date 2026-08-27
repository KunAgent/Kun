import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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

describe('schedule settings', () => {
  it('provides independent top-level schedule defaults', () => {
    const defaults = defaultScheduleSettings()

    expect(defaults.enabled).toBe(false)
    expect(defaults.keepAwake).toBe(false)
    expect(defaults.internal.port).toBe(DEFAULT_SCHEDULE_INTERNAL_PORT)
    expect(defaults.tasks).toEqual([])
  })

  it('keeps explicit enabled locks from the v0.2.37 settings shape', () => {
    const fixturePath = fileURLToPath(new URL(
      './__fixtures__/app-settings-schedule-v0.2.37.json',
      import.meta.url
    ))
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
      schedule: Parameters<typeof normalizeScheduleSettings>[0]
    }

    const normalized = normalizeScheduleSettings(fixture.schedule)

    expect(normalized.enabled).toBe(true)
    expect(normalized.tasks[0].enabled).toBe(true)
    expect(normalized.daemons.enabled).toBe(true)
    expect(normalized.daemons.items[0].enabled).toBe(true)
  })

  it('normalizes and merges schedule patches without reading legacy claw tasks', () => {
    const legacyTask = {
      id: 'legacy-claw-task',
      title: 'Legacy task',
      enabled: true,
      prompt: 'Old Claw task',
      workspaceRoot: '/tmp/workspace',
      clawChannelId: 'channel-1',
      model: 'auto',
      reasoningEffort: 'medium' as const,
      mode: 'agent' as const,
      schedule: { kind: 'daily' as const, everyMinutes: 60, timeOfDay: '08:00', atTime: '' },
      createdAt: '2026-06-02T00:00:00.000Z',
      updatedAt: '2026-06-02T00:00:00.000Z',
      lastRunAt: '',
      nextRunAt: '',
      lastStatus: 'idle' as const,
      lastMessage: '',
      lastThreadId: ''
    }
    const normalized = normalizeAppSettings({
      ...settings(),
      claw: {
        ...defaultClawSettings(),
        tasks: [legacyTask]
      },
      schedule: undefined as unknown as AppSettingsV1['schedule']
    })

    expect(normalized.claw.tasks).toHaveLength(1)
    expect(normalized.schedule.tasks).toEqual([])

    const merged = mergeScheduleSettings(normalizeScheduleSettings(undefined), {
      enabled: true,
      defaultWorkspaceRoot: ' /tmp/schedule ',
      internal: { port: 99, secret: ' secret ' },
      tasks: [{
        title: 'Daily',
        prompt: 'Run',
        schedule: { kind: 'daily', everyMinutes: 0, timeOfDay: 'bad', atTime: 'not-a-date' }
      }]
    })

    expect(merged.enabled).toBe(true)
    expect(merged.defaultWorkspaceRoot).toBe('/tmp/schedule')
    expect(merged.internal.port).toBe(10000)
    expect(merged.internal.secret).toBe('secret')
    expect(merged.tasks[0].schedule.everyMinutes).toBe(1)
    expect(merged.tasks[0].schedule.timeOfDay).toBe('09:00')
    expect(merged.tasks[0].schedule.atTime).toBe('')
    expect(merged.tasks[0].clawChannelId).toBe('')
    expect(merged.tasks[0].reasoningEffort).toBe('medium')
  })

  it('normalizes daemon settings and keeps legacy scheduled tasks untouched', () => {
    const normalized = normalizeScheduleSettings({
      enabled: true,
      tasks: [{ title: 'Existing', prompt: 'x', schedule: { kind: 'manual', everyMinutes: 60, timeOfDay: '09:00', atTime: '' } }],
      daemons: {
        enabled: true,
        items: [{
          id: 'd1',
          title: 'Market watcher',
          scriptPath: ' kb/daemon.py ',
          workspaceRoot: '/tmp/ws',
          threadId: 't-1',
          heartbeatIntervalSeconds: -5,
          silenceTimeoutSeconds: 99999,
          interpreter: 'bogus' as never,
          push: {
            enabled: true,
            channelId: 'ch-1',
            conversationId: 'cv-1'
          }
        }]
      }
    } as unknown as Parameters<typeof normalizeScheduleSettings>[0])

    expect(normalized.daemons.enabled).toBe(true)
    expect(normalized.daemons.items).toHaveLength(1)
    expect(normalized.tasks).toHaveLength(1)
    expect(normalized.tasks[0].title).toBe('Existing')
    const daemon = normalized.daemons.items[0]
    expect(daemon.id).toBe('d1')
    expect(daemon.scriptPath).toBe('kb/daemon.py')
    expect(daemon.workspaceRoot).toBe('/tmp/ws')
    expect(daemon.threadId).toBe('t-1')
    expect(daemon.heartbeatIntervalSeconds).toBe(5)
    expect(daemon.silenceTimeoutSeconds).toBe(86_400)
    expect(daemon.interpreter).toBe('auto')
    expect(daemon.push).toEqual({ enabled: true, channelId: 'ch-1', conversationId: 'cv-1' })
    expect(daemon.enabled).toBe(true)
  })

  it('defaults daemons to enabled and preserves explicit disable through merge', () => {
    expect(normalizeScheduleSettings(undefined).daemons).toEqual({ enabled: true, items: [] })
    expect(normalizeScheduleSettings({ daemons: { enabled: false, items: [] } }).daemons.enabled).toBe(false)

    const merged = mergeScheduleSettings(normalizeScheduleSettings(undefined), {
      daemons: {
        enabled: true,
        items: [{ title: 'D', scriptPath: 'd.py' }]
      }
    } as Parameters<typeof mergeScheduleSettings>[1])
    expect(merged.daemons.enabled).toBe(true)
    expect(merged.daemons.items[0].interpreter).toBe('auto')
    expect(merged.daemons.items[0].push.enabled).toBe(false)
    expect(merged.daemons.items[0].push.channelId).toBe('')
  })
})

describe('claw runtime prompts', () => {
  it('does not duplicate default Schedule MCP tool instructions in managed prompts', () => {
    const state = settings()
    state.claw.channels = [{
      id: 'channel-1',
      provider: 'feishu',
      label: 'kun',
      enabled: true,
      model: 'auto',
      threadId: '',
      workspaceRoot: '',
      conversations: [],
      agentProfile: {
        name: 'kun',
        description: '',
        identity: '',
        personality: '',
        userContext: '',
        replyRules: ''
      },
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z'
    }]

    const prompt = buildClawRuntimePrompt(state, 'hi', { channel: state.claw.channels[0] })

    expect(prompt).toContain('[Claw managed instructions]')
    expect(prompt).toContain('[Agent name]\nkun')
    expect(prompt).not.toContain('gui_schedule')
    expect(prompt).not.toContain('scheduled-task tools')
  })

  it('tells Claw agents to use the image tool when image generation is configured', () => {
    const state = settings()
    state.agents.kun.imageGeneration = {
      enabled: true,
      providerId: '',
      protocol: 'openai-images',
      baseUrl: 'https://images.example.test/v1',
      apiKey: 'sk-image',
      model: 'test-image-model',
      defaultResolution: '1K',
      defaultSize: '1024x1024',
      quality: 'auto',
      timeoutMs: 180000
    }

    const prompt = buildClawRuntimePrompt(state, 'draw a small logo')

    expect(prompt).toContain('Image generation is enabled for this Claw agent')
    expect(prompt).toContain('generate_image')
  })

  it('tells Claw agents to use media tools when media generation is configured', () => {
    const state = settings()
    state.agents.kun.textToSpeech = {
      enabled: true,
      providerId: '',
      protocol: 'minimax-t2a',
      baseUrl: 'https://api.minimax.io',
      apiKey: 'sk-speech',
      model: 'speech-2.8-hd',
      voice: 'male-qn-qingse',
      format: 'mp3',
      timeoutMs: 120000
    }
    state.agents.kun.musicGeneration = {
      enabled: true,
      providerId: '',
      protocol: 'minimax-music',
      baseUrl: 'https://api.minimax.io',
      apiKey: 'sk-music',
      model: 'music-2.6',
      format: 'mp3',
      timeoutMs: 300000
    }
    state.agents.kun.videoGeneration = {
      enabled: true,
      providerId: '',
      protocol: 'minimax-video',
      baseUrl: 'https://api.minimax.io',
      apiKey: 'sk-video',
      model: 'MiniMax-Hailuo-2.3',
      defaultDuration: 6,
      defaultResolution: '1080P',
      timeoutMs: 900000,
      pollIntervalMs: 10000
    }

    const prompt = buildClawRuntimePrompt(state, 'make a voiceover, jingle, and video')

    expect(prompt).toContain('Text-to-speech generation is enabled for this Claw agent')
    expect(prompt).toContain('generate_speech')
    expect(prompt).toContain('Music generation is enabled for this Claw agent')
    expect(prompt).toContain('generate_music')
    expect(prompt).toContain('Video generation is enabled for this Claw agent')
    expect(prompt).toContain('generate_video')
  })

  it('parses managed IM prompts into compact display text', () => {
    const parsed = parseClawUserPromptForDisplay([
      '[Claw managed instructions]',
      '',
      '[Claw IM agent instructions]',
      '',
      '[Agent name]',
      'kun',
      '',
      '---',
      '[Current user request]',
      '[Feishu / Lark inbound message]',
      'Chat type: p2p',
      'Sender: user-1',
      '',
      'hi'
    ].join('\n'))

    expect(parsed).toMatchObject({
      text: 'hi',
      managed: true,
      inbound: true,
      sender: 'user-1',
      chatType: 'p2p'
    })
  })
})

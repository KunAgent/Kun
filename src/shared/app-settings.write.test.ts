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
    remote: defaultRemoteAccessSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: '',
    chatWelcomeMessage: '',
    codeAgentPresets: [],
    disabledSkillIds: []
  }
}

describe('write inline completion runtime config', () => {
  it('falls back to the General baseUrl when write has no override', () => {
    const state = settings()
    state.provider.baseUrl = 'https://general.example/v1'
    expect(resolveWriteInlineCompletionBaseUrl(state)).toBe('https://general.example/v1')
  })

  it('preserves an explicit write-only baseUrl override', () => {
    const state = settings()
    state.provider.baseUrl = 'https://general.example/v1'
    state.write.inlineCompletion.baseUrl = 'https://write-only.example/v1'
    expect(resolveWriteInlineCompletionBaseUrl(state)).toBe('https://write-only.example/v1')
  })

  it('falls back to the kun model when write keeps the default inline model', () => {
    const state = settings()
    state.agents.kun.model = 'deepseek-chat'
    expect(resolveWriteInlineCompletionModel(state)).toBe('deepseek-chat')
  })

  it('keeps an explicit flash override when write disables inheritance', () => {
    const state = settings()
    state.agents.kun.model = 'deepseek-chat'
    state.write.inlineCompletion.inheritModel = false
    state.write.inlineCompletion.model = 'deepseek-v4-flash'

    expect(resolveWriteInlineCompletionModel(state)).toBe('deepseek-v4-flash')
  })

  it('preserves an explicit request model before any fallback', () => {
    const state = settings()
    state.agents.kun.model = 'deepseek-chat'
    expect(resolveWriteInlineCompletionModel(state, 'deepseek-v4-pro')).toBe('deepseek-v4-pro')
  })

  it('tolerates legacy write inline settings without new override fields', () => {
    const state = settings()
    state.provider.apiKey = 'general-key'
    state.provider.baseUrl = 'https://general.example/v1'
    state.agents.kun.model = 'deepseek-chat'
    const legacyInlineCompletion = { ...state.write.inlineCompletion } as Partial<AppSettingsV1['write']['inlineCompletion']>
    delete legacyInlineCompletion.apiKey
    delete legacyInlineCompletion.baseUrl
    delete legacyInlineCompletion.inheritModel
    delete legacyInlineCompletion.model
    state.write.inlineCompletion = legacyInlineCompletion as AppSettingsV1['write']['inlineCompletion']

    expect(resolveWriteInlineCompletionApiKey(state)).toBe('general-key')
    expect(resolveWriteInlineCompletionBaseUrl(state)).toBe('https://general.example/v1')
    expect(resolveWriteInlineCompletionModel(state)).toBe('deepseek-chat')
  })

  it('treats legacy flash defaults without an inherit flag as inherited', () => {
    const state = settings()
    state.agents.kun.model = 'deepseek-chat'
    const legacyInlineCompletion = {
      ...state.write.inlineCompletion,
      model: 'deepseek-v4-flash'
    } as Partial<AppSettingsV1['write']['inlineCompletion']>
    delete legacyInlineCompletion.inheritModel
    state.write.inlineCompletion = legacyInlineCompletion as AppSettingsV1['write']['inlineCompletion']

    expect(resolveWriteInlineCompletionModel(state)).toBe('deepseek-chat')
  })
})

describe('write selection assist settings', () => {
  it('keeps write auto-save enabled by default and preserves explicit opt-out', () => {
    expect(defaultWriteSettings().autoSaveEnabled).toBe(true)
    expect(defaultWriteSettings().autoSaveDelayMs).toBe(180_000)
    expect(normalizeWriteSettings({}).autoSaveEnabled).toBe(true)
    expect(normalizeWriteSettings({ autoSaveEnabled: false }).autoSaveEnabled).toBe(false)
    expect(normalizeWriteSettings({ autoSaveDelayMs: 30_000 }).autoSaveDelayMs).toBe(30_000)
    expect(normalizeWriteSettings({ autoSaveDelayMs: 1 }).autoSaveDelayMs).toBe(5_000)
    expect(normalizeWriteSettings({ autoSaveDelayMs: 3_600_000 }).autoSaveDelayMs).toBe(1_800_000)

    const next = mergeWriteSettings(defaultWriteSettings(), {
      autoSaveEnabled: false,
      autoSaveDelayMs: 120_000
    })
    expect(next.autoSaveEnabled).toBe(false)
    expect(next.autoSaveDelayMs).toBe(120_000)
  })

  it('defaults to the built-in quick actions with empty overrides', () => {
    const write = defaultWriteSettings()
    expect(write.selectionAssist.infographicPrompt).toBe('')
    expect(write.selectionAssist.quickActions).toEqual([
      { id: 'polish', label: '', prompt: '', mode: 'chat' },
      { id: 'explain', label: '', prompt: '', mode: 'chat' },
      { id: 'reformat', label: '', prompt: '', mode: 'edit' },
      { id: 'distill', label: '', prompt: '', mode: 'chat' },
      { id: 'bolder', label: '', prompt: '', mode: 'chat' },
      { id: 'quieter', label: '', prompt: '', mode: 'chat' },
      { id: 'critique', label: '', prompt: '', mode: 'chat' }
    ])
  })

  it('keeps the defaults when legacy settings lack selectionAssist', () => {
    const write = normalizeWriteSettings({ defaultWorkspaceRoot: '/tmp/w' })
    expect(write.selectionAssist).toEqual(defaultWriteSelectionAssistSettings())
  })

  it('replaces quick actions wholesale through a merge patch', () => {
    const current = defaultWriteSettings()
    const next = mergeWriteSettings(current, {
      selectionAssist: {
        quickActions: [{ id: 'polish', label: '提升写作', prompt: '改写得更好' }]
      }
    })
    expect(next.selectionAssist.quickActions).toEqual([
      { id: 'polish', label: '提升写作', prompt: '改写得更好', mode: 'chat' }
    ])
    expect(next.selectionAssist.infographicPrompt).toBe('')
  })

  it('honors an explicit quick action mode and defaults custom actions to chat', () => {
    const write = normalizeWriteSettings({
      selectionAssist: {
        quickActions: [
          { id: 'polish', label: '保留', prompt: '保留', mode: 'chat' },
          { id: 'custom-1', label: 'x', prompt: 'y' }
        ]
      }
    })
    expect(write.selectionAssist.quickActions).toEqual([
      { id: 'polish', label: '保留', prompt: '保留', mode: 'chat' },
      { id: 'custom-1', label: 'x', prompt: 'y', mode: 'chat' }
    ])
  })

  it('preserves quick actions when only the infographic prompt changes', () => {
    const current = mergeWriteSettings(defaultWriteSettings(), {
      selectionAssist: {
        quickActions: [{ id: 'custom-1', label: '重写', prompt: '重写这段' }]
      }
    })
    const next = mergeWriteSettings(current, {
      selectionAssist: { infographicPrompt: '手绘风格' }
    })
    expect(next.selectionAssist.infographicPrompt).toBe('手绘风格')
    expect(next.selectionAssist.quickActions).toEqual([
      { id: 'custom-1', label: '重写', prompt: '重写这段', mode: 'chat' }
    ])
  })

  it('carries the design and prototype prompts through normalization', () => {
    const write = normalizeWriteSettings({
      selectionAssist: {
        designDraftPrompt: '移动端高保真。',
        prototypePrompt: '暗色主题原型。'
      }
    })
    expect(write.selectionAssist.designDraftPrompt).toBe('移动端高保真。')
    expect(write.selectionAssist.prototypePrompt).toBe('暗色主题原型。')

    const next = mergeWriteSettings(defaultWriteSettings(), {
      selectionAssist: { prototypePrompt: '原型用 vue 风格组件。' }
    })
    expect(next.selectionAssist.prototypePrompt).toBe('原型用 vue 风格组件。')
    expect(next.selectionAssist.designDraftPrompt).toBe('')
  })

  it('drops duplicate and id-less quick actions but keeps unfinished custom rows', () => {
    const write = normalizeWriteSettings({
      selectionAssist: {
        quickActions: [
          { id: 'polish', label: '', prompt: '' },
          { id: 'polish', label: 'dupe', prompt: 'dupe' },
          { id: '', label: 'no-id', prompt: 'no-id' },
          { id: 'custom-1', label: '', prompt: '' }
        ]
      }
    })
    expect(write.selectionAssist.quickActions).toEqual([
      { id: 'polish', label: '', prompt: '', mode: 'chat' },
      { id: 'custom-1', label: '', prompt: '', mode: 'chat' }
    ])
  })

  it('does not trim label or prompt text during normalization', () => {
    const write = normalizeWriteSettings({
      selectionAssist: {
        quickActions: [{ id: 'polish', label: 'hello ', prompt: 'world ' }]
      }
    })
    expect(write.selectionAssist.quickActions[0]).toEqual({
      id: 'polish',
      label: 'hello ',
      prompt: 'world ',
      mode: 'chat'
    })
  })

  it('drops pristine retired built-ins and migrates pristine polish to the sidebar mode', () => {
    // Stored rows from before proofread was retired and polish moved to chat.
    const write = normalizeWriteSettings({
      selectionAssist: {
        quickActions: [
          { id: 'polish', label: '', prompt: '', mode: 'edit' },
          { id: 'proofread', label: '', prompt: '', mode: 'edit' },
          { id: 'explain', label: '', prompt: '', mode: 'chat' }
        ]
      }
    })
    expect(write.selectionAssist.quickActions).toEqual([
      { id: 'polish', label: '', prompt: '', mode: 'chat' },
      { id: 'explain', label: '', prompt: '', mode: 'chat' }
    ])
  })

  it('keeps customized retired or edit-mode rows as explicit user choices', () => {
    const write = normalizeWriteSettings({
      selectionAssist: {
        quickActions: [
          { id: 'proofread', label: '校对', prompt: '修正错别字', mode: 'edit' },
          { id: 'polish', label: '', prompt: '自定义润色提示', mode: 'edit' }
        ]
      }
    })
    expect(write.selectionAssist.quickActions).toEqual([
      { id: 'proofread', label: '校对', prompt: '修正错别字', mode: 'edit' },
      { id: 'polish', label: '', prompt: '自定义润色提示', mode: 'edit' }
    ])
  })
})

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

describe('write agent presets', () => {
  it('defaults to no agents (opt-in, ships no preset templates)', () => {
    expect(defaultWriteSettings().agentPresets).toEqual([])
  })

  it('drops pristine built-in templates left over from older builds', () => {
    expect(
      normalizeWriteAgentPresets([
        { id: 'coordinator', name: '', emoji: '🧭', persona: '' },
        { id: 'editor', name: '', emoji: '✒️', persona: '' }
      ])
    ).toEqual([])
  })

  it('keeps customized built-ins and user-defined agents', () => {
    expect(
      normalizeWriteAgentPresets([
        { id: 'coordinator', name: '我的统筹', emoji: '🧭', persona: '' },
        { id: 'custom-1', name: '', emoji: '🤖', persona: '专属人设' }
      ])
    ).toEqual([
      { id: 'coordinator', name: '我的统筹', emoji: '🧭', persona: '' },
      { id: 'custom-1', name: '', emoji: '🤖', persona: '专属人设' }
    ])
  })
})

describe('Fast Context settings', () => {
  it('defaults Fast Context to enabled with follow-main model and no fast', () => {
    const fastContext = defaultKunRuntimeSettings().fastContext
    expect(fastContext).toEqual({
      enabled: true,
      model: '',
      providerId: '',
      fast: false
    })
  })

  it('keeps lab.pptAgent defaults and merging', () => {
    const lab = defaultKunRuntimeSettings().lab
    expect(lab.pptAgent).toEqual({
      enabled: true,
      model: '',
      providerId: '',
      fast: false,
      imageFirst: true
    })

    const next = mergeKunRuntimeSettings(defaultKunRuntimeSettings(), {
      lab: {
        pptAgent: {
          enabled: false
        }
      }
    })
    expect(next.lab.pptAgent).toEqual({
      enabled: false,
      model: '',
      providerId: '',
      fast: false,
      imageFirst: true
    })

    const configured = mergeKunRuntimeSettings(defaultKunRuntimeSettings(), {
      lab: {
        pptAgent: {
          model: 'gpt-5.4',
          providerId: 'codex-2',
          reasoningEffort: 'high',
          fast: true
        }
      }
    })
    expect(configured.lab.pptAgent).toEqual({
      enabled: true,
      model: 'gpt-5.4',
      providerId: 'codex-2',
      reasoningEffort: 'high',
      fast: true,
      imageFirst: true
    })

    // Half-configured model override falls back to follow-main.
    const half = mergeKunRuntimeSettings(defaultKunRuntimeSettings(), {
      lab: {
        pptAgent: {
          model: 'gpt-5.4',
          providerId: ''
        }
      }
    })
    expect(half.lab.pptAgent.model).toBe('')
    expect(half.lab.pptAgent.providerId).toBe('')

    // Invalid reasoning effort is ignored.
    const bad = mergeKunRuntimeSettings(defaultKunRuntimeSettings(), {
      lab: {
        pptAgent: {
          model: 'gpt-5.4',
          providerId: 'codex-2',
          reasoningEffort: 'bogus' as never
        }
      }
    })
    expect(bad.lab.pptAgent.reasoningEffort).toBeUndefined()
  })

  it('merges top-level Fast Context patches field by field', () => {
    const current = defaultKunRuntimeSettings()
    const next = mergeKunRuntimeSettings(current, {
      fastContext: {
        enabled: false
      }
    })
    expect(next.fastContext).toEqual({
      enabled: false,
      model: '',
      providerId: '',
      fast: false
    })

    const configured = mergeKunRuntimeSettings(current, {
      fastContext: {
        model: 'gpt-5.4',
        providerId: 'codex-2',
        reasoningEffort: 'medium',
        fast: true
      }
    })
    expect(configured.fastContext).toEqual({
      enabled: true,
      model: 'gpt-5.4',
      providerId: 'codex-2',
      reasoningEffort: 'medium',
      fast: true
    })
  })

  it('migrates a historical Lab fastContext patch to the top level', () => {
    const next = mergeKunRuntimeSettings(defaultKunRuntimeSettings(), {
      lab: {
        fastContext: {
          model: 'gpt-5.4',
          providerId: 'codex-2'
        }
      } as never
    })
    expect(next.fastContext.model).toBe('gpt-5.4')
    expect(next.fastContext.providerId).toBe('codex-2')
  })

  it('drops a half-configured model override (follow-main fallback)', () => {
    const next = mergeKunRuntimeSettings(defaultKunRuntimeSettings(), {
      fastContext: {
        model: 'gpt-5.4',
        providerId: ''
      }
    })
    expect(next.fastContext.model).toBe('')
    expect(next.fastContext.providerId).toBe('')
  })

  it('ignores an invalid reasoning effort value', () => {
    const next = mergeKunRuntimeSettings(defaultKunRuntimeSettings(), {
      fastContext: {
        model: 'gpt-5.4',
        providerId: 'codex-2',
        reasoningEffort: 'bogus' as never
      }
    })
    expect(next.fastContext.reasoningEffort).toBeUndefined()
  })

  it('normalizes Fast Context through the full settings envelope', () => {
    const runtime = mergeKunRuntimeSettings(defaultKunRuntimeSettings(), {
      fastContext: {
        model: 'deepseek-v4-flash',
        providerId: 'deepseek',
        fast: true
      }
    })
    const normalized = normalizeAppSettings({
      ...settings(),
      agents: { kun: runtime }
    }).agents.kun.fastContext
    expect(normalized).toEqual({
      enabled: true,
      model: 'deepseek-v4-flash',
      providerId: 'deepseek',
      fast: true
    })
  })
})

import { describe, expect, it } from 'vitest'
import type { AppSettingsV1, KunRuntimeSettingsV1 } from '@shared/app-settings'
import { coerceRendererSettings, diffSettingsPatch, mergeSettings } from './settings-utils'

function settings(kunPatch: Partial<KunRuntimeSettingsV1> = {}): AppSettingsV1 {
  return coerceRendererSettings({
    agents: {
      kun: kunPatch
    }
  } as unknown as AppSettingsV1)
}

describe('coerceRendererSettings', () => {
  it('normalizes dark colors and merges one-field edits without resetting siblings', () => {
    const base = coerceRendererSettings({
      darkUiColors: { background: '#101010', border: '#202020', panel: '#303030' }
    } as AppSettingsV1)

    expect(mergeSettings(base, { darkUiColors: { border: '#AABBCC' } }).darkUiColors).toEqual({
      background: '#101010',
      border: '#aabbcc',
      panel: '#303030'
    })
    expect(coerceRendererSettings({ darkUiColors: { panel: 'bad' } } as AppSettingsV1).darkUiColors)
      .toEqual({ background: '#181818', border: '#272727', panel: '#2c2c2c' })
  })

  it('preserves the persisted initial setup completion flag', () => {
    expect(coerceRendererSettings({
      initialSetupCompleted: true
    } as AppSettingsV1).initialSetupCompleted).toBe(true)
  })

  it('normalizes legacy notification sources for the settings form', () => {
    expect(coerceRendererSettings({
      notifications: { turnComplete: true }
    } as AppSettingsV1).notifications).toEqual({
      turnComplete: true,
      mainAgentTurnComplete: true,
      subagentTurnComplete: false
    })
  })

  it('drops legacy cumulative subagent limits from the renderer settings snapshot', () => {
    const base = settings()
    const normalized = coerceRendererSettings({
      ...base,
      agents: {
        kun: {
          ...base.agents.kun,
          subagents: {
            enabled: true,
            maxParallel: 3,
            maxChildRuns: 12,
            profiles: []
          }
        }
      }
    } as unknown as AppSettingsV1)

    expect(normalized.agents.kun.subagents).toEqual({
      enabled: true,
      useExistingAgents: true,
      maxParallel: 3,
      proactiveRetry: { enabled: true, maxAttempts: 3 },
      profiles: []
    })
    expect(normalized.agents.kun.subagents).not.toHaveProperty('maxChildRuns')
  })
})

describe('diffSettingsPatch', () => {
  it('preserves the last valid model when the selected provider is cleared', () => {
    const base = settings({ providerId: 'custom-provider', model: 'custom-model' })
    const next = mergeSettings(base, {
      agents: { kun: { providerId: '' } }
    })

    expect(next.agents.kun).toMatchObject({
      providerId: '',
      model: 'custom-model'
    })
    const patch = diffSettingsPatch(base, next)
    expect(patch.agents?.kun).toEqual({ providerId: '' })
    expect(patch.agents?.kun).not.toHaveProperty('model')
  })

  it('omits an unchanged blank runtime token when another setting changes', () => {
    const base = settings({ runtimeToken: '' })
    const next: AppSettingsV1 = {
      ...base,
      theme: 'dark'
    }

    const patch = diffSettingsPatch(base, next)

    expect(patch).toEqual({ theme: 'dark' })
    expect(patch.agents).toBeUndefined()
  })

  it('preserves an explicit runtime token clear', () => {
    const base = settings({ runtimeToken: 'generated-token' })
    const next: AppSettingsV1 = {
      ...base,
      agents: {
        kun: {
          ...base.agents.kun,
          runtimeToken: ''
        }
      }
    }

    expect(diffSettingsPatch(base, next)).toEqual({
      agents: {
        kun: {
          runtimeToken: ''
        }
      }
    })
  })

  it('diffs nested provider fields without sending the full settings snapshot', () => {
    const base = settings()
    const next: AppSettingsV1 = {
      ...base,
      provider: {
        ...base.provider,
        apiKey: 'sk-next'
      }
    }

    expect(diffSettingsPatch(base, next)).toEqual({
      provider: {
        apiKey: 'sk-next'
      }
    })
  })

  it('preserves provider proxy siblings when applying a partial diff patch', () => {
    const base: AppSettingsV1 = {
      ...settings(),
      provider: {
        ...settings().provider,
        proxy: {
          enabled: true,
          url: 'http://127.0.0.1:7890'
        }
      }
    }
    const next: AppSettingsV1 = {
      ...base,
      provider: {
        ...base.provider,
        proxy: {
          ...base.provider.proxy,
          url: 'http://127.0.0.1:9999'
        }
      }
    }

    const patch = diffSettingsPatch(base, next)

    expect(patch).toEqual({
      provider: {
        proxy: {
          url: 'http://127.0.0.1:9999'
        }
      }
    })
    expect(mergeSettings(base, patch).provider.proxy).toEqual({
      enabled: true,
      url: 'http://127.0.0.1:9999'
    })
  })

  it('patches one notification source without changing the master or sibling source', () => {
    const base = settings()
    const next = mergeSettings(base, {
      notifications: { subagentTurnComplete: true }
    })
    const patch = diffSettingsPatch(base, next)

    expect(next.notifications).toEqual({
      turnComplete: true,
      mainAgentTurnComplete: true,
      subagentTurnComplete: true
    })
    expect(patch.notifications).toEqual({
      subagentTurnComplete: true
    })
  })

  it('round-trips a profiles-only subagent diff without losing sibling settings', () => {
    const base = coerceRendererSettings(settings({
      subagents: {
        enabled: true,
        maxParallel: 3,
        defaultToolPolicy: 'inherit',
        defaultProfile: 'researcher',
        profiles: [{
          id: 'researcher',
          enabled: true,
          name: 'Researcher',
          mode: 'subagent',
          toolPolicy: 'readOnly'
        }]
      }
    }))
    const replacement = {
      id: 'reviewer',
      enabled: true,
      name: 'Reviewer',
      mode: 'subagent' as const,
      toolPolicy: 'readOnly' as const,
      blockedSkills: ['unsafe-skill']
    }
    const next = mergeSettings(base, {
      agents: { kun: { subagents: { profiles: [replacement] } } }
    })

    const patch = diffSettingsPatch(base, next)

    expect(patch).toEqual({
      agents: { kun: { subagents: { profiles: [replacement] } } }
    })
    expect(mergeSettings(base, patch).agents.kun.subagents).toEqual({
      enabled: true,
      useExistingAgents: true,
      maxParallel: 3,
      proactiveRetry: { enabled: true, maxAttempts: 3 },
      defaultToolPolicy: 'inherit',
      defaultProfile: 'researcher',
      profiles: [replacement]
    })
  })

  it('emits explicit clear sentinels for normalized-away model and reasoning overrides', () => {
    const base = coerceRendererSettings(settings({
      smallModel: 'small-model',
      smallModelProviderId: 'provider-a',
      titleModel: 'title-model',
      titleProviderId: 'provider-a',
      summaryModel: 'summary-model',
      summaryProviderId: 'provider-a',
      codeReviewModel: 'review-model',
      codeReviewProviderId: 'provider-a',
      titleReasoningEffort: 'low',
      summaryReasoningEffort: 'medium',
      codeReviewReasoningEffort: 'high',
      contextCompaction: {
        ...settings().agents.kun.contextCompaction,
        summaryModel: 'compaction-model',
        summaryProviderId: 'provider-a'
      }
    }))
    const next = mergeSettings(base, {
      agents: {
        kun: {
          smallModel: '',
          smallModelProviderId: '',
          titleModel: '',
          titleProviderId: '',
          summaryModel: '',
          summaryProviderId: '',
          codeReviewModel: '',
          codeReviewProviderId: '',
          titleReasoningEffort: 'off',
          summaryReasoningEffort: 'off',
          codeReviewReasoningEffort: 'off',
          contextCompaction: {
            summaryModel: '',
            summaryProviderId: ''
          }
        }
      }
    })

    const patch = diffSettingsPatch(base, next)

    expect(patch).toEqual({
      agents: {
        kun: {
          smallModel: '',
          smallModelProviderId: '',
          titleModel: '',
          titleProviderId: '',
          summaryModel: '',
          summaryProviderId: '',
          codeReviewModel: '',
          codeReviewProviderId: '',
          titleReasoningEffort: 'off',
          summaryReasoningEffort: 'off',
          codeReviewReasoningEffort: 'off',
          contextCompaction: {
            summaryModel: '',
            summaryProviderId: ''
          }
        }
      }
    })
    const roundTripped = mergeSettings(base, patch).agents.kun
    expect(roundTripped.smallModel).toBeUndefined()
    expect(roundTripped.titleModel).toBeUndefined()
    expect(roundTripped.summaryModel).toBeUndefined()
    expect(roundTripped.codeReviewModel).toBeUndefined()
    expect(roundTripped.titleReasoningEffort).toBeUndefined()
    expect(roundTripped.summaryReasoningEffort).toBeUndefined()
    expect(roundTripped.codeReviewReasoningEffort).toBeUndefined()
    expect(roundTripped.contextCompaction.summaryModel).toBeUndefined()
    expect(roundTripped.contextCompaction.summaryProviderId).toBeUndefined()
  })
})

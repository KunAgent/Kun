import { describe, expect, it } from 'vitest'
import {
  buildExtensionModelGroups,
  buildComposerAssistantPickList,
  resolveComposerAssistantProviderId
} from './composer-model-selection'

describe('composer model selection helpers', () => {
  it('publishes MoA virtual models as a normal grouped provider', () => {
    expect(buildExtensionModelGroups([{
      providerId: 'moa',
      modelId: 'moa:balanced',
      label: 'Balanced review',
      capabilities: { input: ['text', 'image'], contextWindowTokens: 32_000 }
    }])).toEqual([expect.objectContaining({
      providerId: 'moa',
      modelIds: ['moa:balanced'],
      modelProfiles: {
        'moa:balanced': expect.objectContaining({
          inputModalities: ['text', 'image'],
          contextWindowTokens: 32_000
        })
      }
    })])
  })

  it('builds assistant pick lists from defaults and available models only', () => {
    expect(buildComposerAssistantPickList({
      defaultModelIds: ['auto', 'deepseek-chat'],
      composerPickList: ['claude-sonnet', ' auto ', 'deepseek-chat']
    })).toEqual(['deepseek-chat', 'claude-sonnet'])
  })

  it('keeps a stored provider when it still owns the selected model', () => {
    expect(resolveComposerAssistantProviderId({
      composerModelGroups: [{
        providerId: 'deepseek',
        label: 'DeepSeek',
        modelIds: ['DeepSeek-Chat']
      }],
      model: 'deepseek-chat',
      storedProviderId: 'deepseek'
    })).toBe('deepseek')
  })

  it('falls back to the provider that owns the model when the stored provider is stale', () => {
    expect(resolveComposerAssistantProviderId({
      composerModelGroups: [
        { providerId: 'old', label: 'Old', modelIds: ['old-model'] },
        { providerId: 'new', label: 'New', modelIds: ['new-model'] }
      ],
      model: 'new-model',
      storedProviderId: 'old'
    })).toBe('new')
  })
})

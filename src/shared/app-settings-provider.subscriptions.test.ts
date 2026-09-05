import { describe, expect, it } from 'vitest'
import {
  activeModelProviderNeedsApiKey,
  DEFAULT_DEEPSEEK_BASE_URL,
  defaultClawSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultMiniMaxMediaGenerationKunPatch,
  defaultModelProviderSettings,
  getModelProviderPreset,
  isComposerChatModelId,
  isImageGenerationModelId,
  isMusicGenerationModelId,
  isSpeechToTextModelId,
  isTextToSpeechModelId,
  isVideoGenerationModelId,
  modelProviderPresetProfile,
  modelProviderRequiresApiKey,
  modelProviderPresetAccountCount,
  modelProviderPresetAccountProfile,
  modelProviderTokenPlanProfile,
  resolveModelProviderPresetSource,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultTerminalSettings,
  defaultWriteSettings,
  defaultModelRequestRetrySettings,
  CHATGPT_SUBSCRIPTION_MODEL_IDS,
  GROK_SUBSCRIPTION_PROVIDER_ID,
  OLLAMA_CLOUD_MODEL_IDS,
  listMusicGenerationProviderProfiles,
  listSpeechToTextProviderProfiles,
  listTextToSpeechProviderProfiles,
  listVideoGenerationProviderProfiles,
  modelProviderModelProfilesForProvider,
  listModelProviderModelIds,
  modelSupportsImageInput,
  defaultDesignSettings,
  normalizeModelProviderSettings,
  projectExecutableModelRoutePools,
  resolveModelRouteTargetReference,
  resolveKunImageGenerationSettings,
  resolveKunMusicGenerationSettings,
  resolveModelProviderBaseUrl,
  resolveModelProviderProxyUrl,
  resolveKunRuntimeSettings,
  resolveKunSpeechToTextSettings,
  resolveKunTextToSpeechSettings,
  resolveKunVideoGenerationSettings,
  type AppSettingsV1,
  type ModelProviderModelProfileV1
} from './app-settings'
import { settings } from './app-settings-provider.test-support'

describe('ChatGPT subscription migration', () => {
  it('renames only the legacy default and upgrades exactly the legacy model set', () => {
    const normalized = normalizeModelProviderSettings({
      providers: [{
        id: 'codex',
        name: 'Codex (ChatGPT)',
        apiKey: 'oauth-json',
        baseUrl: 'https://chatgpt.com/backend-api/codex',
        endpointFormat: 'responses',
        useProxy: false,
        models: ['gpt-5.4-mini', 'gpt-5.5', 'gpt-5.3-codex-spark', 'gpt-5.4'],
        modelProfiles: {}
      }]
    })

    const provider = normalized.providers.find((item) => item.id === 'codex')!
    expect(provider.name).toBe('ChatGPT 订阅')
    expect(provider.baseUrl).toBe('https://chatgpt.com/backend-api/codex/responses')
    expect(provider.endpointFormat).toBe('custom_endpoint')
    expect(provider.models).toEqual(CHATGPT_SUBSCRIPTION_MODEL_IDS)
    for (const modelId of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
      expect(provider.modelProfiles[modelId]).toMatchObject({
        contextWindowTokens: 372_000,
        inputModalities: ['text', 'image'],
        outputModalities: ['text'],
        supportsToolCalling: true,
        responsesMode: 'lite',
        reasoning: {
          supportedEfforts: ['low', 'medium', 'high', 'max'],
          defaultEffort: 'high',
          requestProtocol: 'openai-responses'
        },
        serviceTiers: ['priority']
      })
    }
    expect(provider.modelProfiles['gpt-5.4-mini'].serviceTiers).toBeUndefined()
    expect(provider.modelProfiles['gpt-5.3-codex-spark'].serviceTiers).toBeUndefined()
  })

  it('removes stale priority metadata from unsupported Codex models', () => {
    const normalized = normalizeModelProviderSettings({
      providers: [{
        id: 'codex',
        name: 'ChatGPT 订阅',
        apiKey: 'oauth-json',
        baseUrl: 'https://chatgpt.com/backend-api/codex',
        endpointFormat: 'custom_endpoint',
        useProxy: false,
        models: ['gpt-5.4-mini'],
        modelProfiles: {
          'gpt-5.4-mini': {
            inputModalities: ['text', 'image'],
            outputModalities: ['text'],
            supportsToolCalling: true,
            messageParts: ['text', 'image_url'],
            serviceTiers: ['priority']
          }
        }
      }]
    })

    expect(
      normalized.providers.find((item) => item.id === 'codex')
        ?.modelProfiles['gpt-5.4-mini'].serviceTiers
    ).toBeUndefined()
  })

  it('keeps custom names and custom model collections unchanged', () => {
    const normalized = normalizeModelProviderSettings({
      providers: [{
        id: 'codex',
        name: 'Team subscription',
        apiKey: 'oauth-json',
        baseUrl: 'https://chatgpt.com/backend-api/codex',
        endpointFormat: 'responses',
        useProxy: false,
        models: ['gpt-5.5', 'team-model'],
        modelProfiles: {}
      }]
    })

    expect(normalized.providers.find((item) => item.id === 'codex')).toMatchObject({
      name: 'Team subscription',
      models: ['gpt-5.5', 'team-model'],
      baseUrl: 'https://chatgpt.com/backend-api/codex/responses',
      endpointFormat: 'custom_endpoint'
    })
  })
})

describe('Grok subscription media capabilities', () => {
  it('exposes the Grok Build image, video, and speech models on the subscription profile', () => {
    const preset = getModelProviderPreset(GROK_SUBSCRIPTION_PROVIDER_ID)
    expect(preset).toBeDefined()
    const provider = modelProviderPresetProfile(preset!, 'grok-oauth-json')

    expect(provider.image).toEqual({
      protocol: 'grok-imagine-image',
      baseUrl: 'https://api.x.ai/v1',
      models: ['grok-imagine-image-quality', 'grok-imagine-image']
    })
    expect(provider.video).toEqual({
      protocol: 'grok-imagine-video',
      baseUrl: 'https://api.x.ai/v1',
      models: ['grok-imagine-video-1.5-preview', 'grok-imagine-video']
    })
    expect(provider.speech).toEqual({
      protocol: 'xai-stt',
      baseUrl: 'https://api.x.ai/v1',
      models: ['grok-transcribe']
    })

    const defaults = defaultKunRuntimeSettings()
    const appSettings: AppSettingsV1 = {
      ...settings(),
      provider: {
        ...defaultModelProviderSettings(),
        providers: [
          ...defaultModelProviderSettings().providers.filter((item) => item.id !== provider.id),
          provider
        ]
      },
      agents: {
        kun: {
          ...defaults,
          videoGeneration: {
            ...defaults.videoGeneration,
            enabled: true,
            providerId: provider.id,
            defaultDuration: 8,
            defaultResolution: '1080P'
          }
        }
      }
    }
    expect(resolveKunVideoGenerationSettings(appSettings)).toMatchObject({
      protocol: 'grok-imagine-video',
      baseUrl: 'https://api.x.ai/v1',
      apiKey: 'grok-oauth-json',
      model: 'grok-imagine-video-1.5-preview',
      defaultDuration: 6,
      defaultResolution: '480P'
    })
  })

  it('upgrades stale stored Grok image and video protocols from the current preset', () => {
    const preset = getModelProviderPreset(GROK_SUBSCRIPTION_PROVIDER_ID)!
    const current = modelProviderPresetProfile(preset, 'grok-oauth-json')
    const normalized = normalizeModelProviderSettings({
      providers: [{
        ...current,
        image: {
          protocol: 'openai-images',
          baseUrl: 'https://api.x.ai/v1',
          models: ['grok-imagine-image', 'grok-imagine-image-quality']
        },
        video: {
          protocol: 'minimax-video',
          baseUrl: 'https://api.x.ai/v1',
          models: ['grok-imagine-video', 'grok-imagine-video-1.5-preview']
        }
      }]
    })
    const grok = normalized.providers.find((provider) => provider.id === GROK_SUBSCRIPTION_PROVIDER_ID)

    expect(grok?.image).toEqual(current.image)
    expect(grok?.video).toEqual(current.video)
  })

  it('preserves explicit media capabilities on a custom provider', () => {
    const image = {
      protocol: 'openai-images' as const,
      baseUrl: 'https://images.example/v1',
      models: ['custom-image']
    }
    const video = {
      protocol: 'minimax-video' as const,
      baseUrl: 'https://video.example/v1',
      models: ['custom-video']
    }
    const normalized = normalizeModelProviderSettings({
      providers: [{
        id: 'custom-media',
        name: 'Custom Media',
        apiKey: 'sk-custom',
        baseUrl: 'https://chat.example/v1',
        endpointFormat: 'chat_completions',
        useProxy: false,
        models: ['custom-chat'],
        modelProfiles: {},
        image,
        video
      }]
    })
    const custom = normalized.providers.find((provider) => provider.id === 'custom-media')

    expect(custom?.image).toEqual(image)
    expect(custom?.video).toEqual(video)
  })
})

describe('Volcano Ark media provider presets', () => {
  it('keeps standard API, Agent Plan, and Coding Plan gateways and catalogs distinct', () => {
    const standard = getModelProviderPreset('volcengine')
    const agentPlan = getModelProviderPreset('volcengine-agent-plan')
    const codingPlan = getModelProviderPreset('volcengine-coding-plan')

    expect(standard).toMatchObject({
      id: 'volcengine',
      name: 'Volcano Ark API',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      endpointFormat: 'chat_completions',
      image: {
        protocol: 'volcengine-ark-image',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        models: [
          'doubao-seedream-5-0-pro-260628',
          'doubao-seedream-5-0-260128',
          'doubao-seedream-5-0-lite-260128'
        ]
      },
      video: {
        protocol: 'volcengine-ark-video',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        models: [
          'doubao-seedance-2-0-260128',
          'doubao-seedance-2-0-fast-260128',
          'doubao-seedance-2-0-mini-260615'
        ]
      }
    })
    expect(standard?.category).toBeUndefined()
    expect(standard?.apiKeyUrl).toContain('/apiKey')

    expect(agentPlan).toMatchObject({
      id: 'volcengine-agent-plan',
      name: 'Volcano Ark Agent Plan',
      category: 'subscription',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3',
      endpointFormat: 'chat_completions',
      image: {
        protocol: 'volcengine-ark-image',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3',
        models: ['doubao-seedream-5.0-lite']
      },
      video: {
        protocol: 'volcengine-ark-video',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3',
        models: [
          'doubao-seedance-2.0',
          'doubao-seedance-2.0-fast',
          'doubao-seedance-2.0-mini'
        ]
      }
    })
    expect(agentPlan?.apiKeyUrl).toContain('advancedActiveKey=agentPlan')

    expect(codingPlan).toMatchObject({
      id: 'volcengine-coding-plan',
      name: 'Volcano Ark Coding Plan',
      category: 'subscription',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
      models: ['doubao-seed-1-6-250615', 'doubao-seed-1-6-flash-250828']
    })
    expect(codingPlan?.image).toBeUndefined()
    expect(codingPlan?.video).toBeUndefined()
  })

  it('resolves Agent Plan image and video settings with only its dedicated key', () => {
    const standard = modelProviderPresetProfile(
      getModelProviderPreset('volcengine')!,
      'standard-ark-key'
    )
    const agentPlan = modelProviderPresetProfile(
      getModelProviderPreset('volcengine-agent-plan')!,
      'agent-plan-key'
    )
    const codingPlan = modelProviderPresetProfile(
      getModelProviderPreset('volcengine-coding-plan')!,
      'coding-plan-key'
    )
    const defaults = defaultKunRuntimeSettings()
    const appSettings: AppSettingsV1 = {
      ...settings(),
      provider: {
        ...defaultModelProviderSettings(),
        providers: [
          ...defaultModelProviderSettings().providers,
          standard,
          agentPlan,
          codingPlan
        ]
      },
      agents: {
        kun: {
          ...defaults,
          imageGeneration: {
            ...defaults.imageGeneration,
            enabled: true,
            providerId: agentPlan.id,
            defaultResolution: '1K'
          },
          videoGeneration: {
            ...defaults.videoGeneration,
            enabled: true,
            providerId: agentPlan.id,
            defaultDuration: 30,
            defaultResolution: '768P'
          }
        }
      }
    }

    expect(resolveKunImageGenerationSettings(appSettings)).toMatchObject({
      enabled: true,
      providerId: 'volcengine-agent-plan',
      protocol: 'volcengine-ark-image',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3',
      apiKey: 'agent-plan-key',
      model: 'doubao-seedream-5.0-lite',
      defaultResolution: '2K'
    })
    expect(resolveKunVideoGenerationSettings(appSettings)).toMatchObject({
      enabled: true,
      providerId: 'volcengine-agent-plan',
      protocol: 'volcengine-ark-video',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3',
      apiKey: 'agent-plan-key',
      model: 'doubao-seedance-2.0',
      defaultDuration: 15,
      defaultResolution: '720P'
    })
    expect(resolveKunImageGenerationSettings({
      ...appSettings,
      agents: {
        kun: {
          ...appSettings.agents.kun,
          imageGeneration: {
            ...appSettings.agents.kun.imageGeneration,
            providerId: '',
            protocol: 'openai-images',
            defaultResolution: '4K'
          }
        }
      }
    }).defaultResolution).toBe('1K')
  })
})

describe('active model provider API-key status', () => {
  it('requires an API key when the active default provider has no effective key', () => {
    const state = settings()
    state.provider.providers = state.provider.providers.map((provider) =>
      provider.id === 'deepseek' ? { ...provider, apiKey: '' } : provider
    )
    state.agents.kun.providerId = 'deepseek'
    state.agents.kun.apiKey = ''

    expect(modelProviderRequiresApiKey(
      state.provider.providers.find((provider) => provider.id === 'deepseek')!
    )).toBe(true)
    expect(activeModelProviderNeedsApiKey(state)).toBe(true)
  })

  it('accepts the configured effective key for an active API-key provider', () => {
    const state = settings()
    state.provider.apiKey = 'sk-deepseek'
    state.provider.providers = state.provider.providers.map((provider) =>
      provider.id === 'deepseek' ? { ...provider, apiKey: 'sk-deepseek' } : provider
    )
    state.agents.kun.providerId = 'deepseek'

    expect(activeModelProviderNeedsApiKey(state)).toBe(false)
  })

  it('requires an API key for a custom HTTP provider without a preset source', () => {
    const state = settings()
    const customProvider = {
      ...state.provider.providers[0]!,
      id: 'custom-provider-2',
      name: 'Custom provider',
      presetSource: undefined,
      kind: 'http' as const,
      apiKey: '',
      baseUrl: 'https://api.example.com/v1'
    }
    state.provider.providers.push(customProvider)
    state.agents.kun.providerId = customProvider.id
    state.agents.kun.apiKey = ''

    expect(modelProviderRequiresApiKey(customProvider)).toBe(true)
    expect(activeModelProviderNeedsApiKey(state)).toBe(true)
  })

  it.each([
    ['claude-subscription', 'agent-sdk'],
    ['gemini-subscription', 'antigravity-cli'],
    ['gemini-cli-subscription', 'gemini-cli-api']
  ] as const)('accepts the keyless %s transport', (presetId, expectedKind) => {
    const preset = getModelProviderPreset(presetId)
    expect(preset).not.toBeNull()
    const profile = modelProviderPresetProfile(preset!, '')
    expect(profile.kind).toBe(expectedKind)
    expect(modelProviderRequiresApiKey(profile)).toBe(false)

    const state = settings()
    state.provider.providers.push(profile)
    state.agents.kun.providerId = profile.id
    state.agents.kun.apiKey = ''

    expect(activeModelProviderNeedsApiKey(state)).toBe(false)
  })

  it('still requires the Cursor dashboard key for the active Cursor SDK provider', () => {
    const preset = getModelProviderPreset('cursor-subscription')
    expect(preset).not.toBeNull()
    const profile = modelProviderPresetProfile(preset!, '')
    expect(modelProviderRequiresApiKey(profile)).toBe(true)

    const state = settings()
    state.provider.providers.push(profile)
    state.agents.kun.providerId = profile.id
    state.agents.kun.apiKey = ''

    expect(activeModelProviderNeedsApiKey(state)).toBe(true)
  })
})

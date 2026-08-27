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
  OPENCODE_FREE_MODEL_IDS,
  OPENCODE_FREE_PROVIDER_ID,
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

describe('provider presets', () => {
  it('includes optional LiteLLM and Vercel AI Gateway presets', () => {
    const litellm = getModelProviderPreset('litellm')
    const vercel = getModelProviderPreset('vercel-ai-gateway')

    expect(litellm).not.toBeNull()
    expect(litellm && modelProviderPresetProfile(litellm)).toMatchObject({
      id: 'litellm',
      name: 'LiteLLM',
      baseUrl: 'http://localhost:4000',
      endpointFormat: 'chat_completions',
      models: []
    })

    expect(vercel).not.toBeNull()
    expect(vercel && modelProviderPresetProfile(vercel)).toMatchObject({
      id: 'vercel-ai-gateway',
      name: 'Vercel AI Gateway',
      baseUrl: 'https://ai-gateway.vercel.sh/v1',
      endpointFormat: 'chat_completions',
      models: []
    })
    expect(vercel?.docsUrl).toBe(
      'https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions'
    )
  })

  it('includes LongCat, Zhipu, Z.ai, Kimi Code, and Moonshot presets', () => {
    const longcat = getModelProviderPreset('longcat')
    const zhipu = getModelProviderPreset('zhipu-coding-plan')
    const zai = getModelProviderPreset('zai-coding-plan')
    const kimiCode = getModelProviderPreset('kimi-code')
    const moonshotCn = getModelProviderPreset('moonshot-cn')
    const moonshotGlobal = getModelProviderPreset('moonshot-global')

    expect(longcat && modelProviderPresetProfile(longcat)).toMatchObject({
      id: 'longcat',
      name: 'LongCat',
      baseUrl: 'https://api.longcat.chat/openai',
      endpointFormat: 'chat_completions',
      models: ['LongCat-2.0-Preview'],
      modelProfiles: {
        'LongCat-2.0-Preview': expect.objectContaining({
          contextWindowTokens: 1_000_000,
          supportsToolCalling: true,
          inputModalities: ['text']
        })
      }
    })

    expect(zhipu && modelProviderPresetProfile(zhipu)).toMatchObject({
      id: 'zhipu-coding-plan',
      name: 'Zhipu Coding Plan',
      baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions',
      endpointFormat: 'custom_endpoint',
      models: ['glm-5.3', 'glm-5.3-flash', 'glm-5.2', 'glm-5.1', 'glm-5-turbo', 'glm-4.7', 'glm-4.5-air'],
      modelProfiles: {
        'glm-5.3': expect.objectContaining({
          contextWindowTokens: 1_000_000,
          pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0,
            cacheReadUsdPerMillion: 0, cacheWriteUsdPerMillion: 0 }
        }),
        'glm-5.3-flash': expect.objectContaining({
          contextWindowTokens: 200_000,
          inputModalities: ['text', 'image'],
          pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0,
            cacheReadUsdPerMillion: 0, cacheWriteUsdPerMillion: 0 }
        }),
        'glm-5.2': expect.objectContaining({
          contextWindowTokens: 1_000_000,
          supportsToolCalling: true,
          inputModalities: ['text']
        }),
        'glm-5.1': expect.objectContaining({
          contextWindowTokens: 200_000,
          supportsToolCalling: true
        })
      }
    })
    expect(zhipu && modelProviderPresetProfile(zhipu).modelProfiles['glm-5.2'].reasoning)
      .toEqual({
        supportedEfforts: ['off', 'high', 'max'],
        defaultEffort: 'max',
        requestProtocol: 'glm-chat-completions'
      })

    expect(zai && modelProviderPresetProfile(zai)).toMatchObject({
      id: 'zai-coding-plan',
      name: 'Z.ai Coding Plan',
      baseUrl: 'https://api.z.ai/api/coding/paas/v4/chat/completions',
      endpointFormat: 'custom_endpoint',
      models: ['glm-5.3', 'glm-5.2', 'glm-5.1', 'glm-5', 'glm-5-turbo', 'glm-4.7', 'glm-4.5-air'],
      modelProfiles: {
        'glm-5.3': expect.objectContaining({
          contextWindowTokens: 1_000_000,
          pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0,
            cacheReadUsdPerMillion: 0, cacheWriteUsdPerMillion: 0 }
        }),
        'glm-5.2': expect.objectContaining({
          contextWindowTokens: 1_000_000,
          supportsToolCalling: true,
          inputModalities: ['text']
        }),
        'glm-5': expect.objectContaining({
          contextWindowTokens: 200_000,
          supportsToolCalling: true,
          inputModalities: ['text']
        })
      }
    })
    expect(zai && modelProviderPresetProfile(zai).modelProfiles['glm-5.2'].reasoning)
      .toEqual({
        supportedEfforts: ['off', 'high', 'max'],
        defaultEffort: 'max',
        requestProtocol: 'glm-chat-completions'
      })

    expect(kimiCode && modelProviderPresetProfile(kimiCode)).toMatchObject({
      id: 'kimi-code',
      name: 'Kimi Code',
      baseUrl: 'https://api.kimi.com/coding/v1',
      endpointFormat: 'chat_completions',
      models: ['k3', 'kimi-for-coding', 'kimi-for-coding-highspeed'],
      modelProfiles: {
        k3: expect.objectContaining({
          supportsToolCalling: true,
          inputModalities: ['text', 'image'],
          reasoning: {
            supportedEfforts: ['low', 'high', 'max'],
            defaultEffort: 'high',
            requestProtocol: 'openai-chat-completions'
          }
        }),
        'kimi-for-coding': expect.objectContaining({
          supportsToolCalling: true,
          inputModalities: ['text']
        })
      }
    })

    for (const preset of [moonshotCn, moonshotGlobal]) {
      const profile = preset && modelProviderPresetProfile(preset)
      expect(profile).toMatchObject({
        endpointFormat: 'chat_completions',
        models: [
          'kimi-k2.7-code',
          'kimi-k2.6',
          'kimi-k2.5',
          'moonshot-v1-128k',
          'moonshot-v1-32k',
          'moonshot-v1-8k'
        ],
        modelProfiles: {
          'kimi-k2.7-code': expect.objectContaining({
            supportsToolCalling: true,
            inputModalities: ['text', 'image'],
            messageParts: ['text', 'image_url']
          }),
          'moonshot-v1-128k': expect.objectContaining({
            contextWindowTokens: 128_000,
            inputModalities: ['text']
          })
        }
      })
      expect(profile && modelSupportsImageInput(profile.modelProfiles['kimi-k2.7-code']))
        .toBe(true)
    }
    expect(moonshotCn && modelProviderPresetProfile(moonshotCn).baseUrl)
      .toBe('https://api.moonshot.cn/v1')
    expect(moonshotGlobal && modelProviderPresetProfile(moonshotGlobal).baseUrl)
      .toBe('https://api.moonshot.ai/v1')
  })

  it('resolves new OpenAI-compatible presets through the selected provider', () => {
    const cases = [
      ['longcat', 'https://api.longcat.chat/openai', 'LongCat-2.0-Preview'],
      ['zhipu-coding-plan', 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions', 'glm-5.2', 'custom_endpoint'],
      ['zai-coding-plan', 'https://api.z.ai/api/coding/paas/v4/chat/completions', 'glm-5.1', 'custom_endpoint'],
      ['kimi-code', 'https://api.kimi.com/coding/v1', 'kimi-for-coding'],
      ['moonshot-cn', 'https://api.moonshot.cn/v1', 'kimi-k2.7-code'],
      ['moonshot-global', 'https://api.moonshot.ai/v1', 'kimi-k2.7-code']
    ] as const

    for (const [presetId, baseUrl, model, endpointFormat = 'chat_completions'] of cases) {
      const preset = getModelProviderPreset(presetId)
      expect(preset).not.toBeNull()
      const profile = modelProviderPresetProfile(preset!, `sk-${presetId}`)
      const resolved = resolveKunRuntimeSettings({
        ...settings(),
        provider: {
          ...defaultModelProviderSettings(),
          providers: [
            ...defaultModelProviderSettings().providers,
            profile
          ]
        },
        agents: {
          kun: {
            ...defaultKunRuntimeSettings(),
            providerId: profile.id,
            model
          }
        }
      })

      expect(resolved).toEqual(expect.objectContaining({
        apiKey: `sk-${presetId}`,
        baseUrl,
        endpointFormat,
        model
      }))
      expect(resolved.modelProfiles[model.toLowerCase()]).toEqual(expect.objectContaining({
        supportsToolCalling: true
      }))
    }
  })

  it('ships OpenCore Free as a no-key built-in provider with ten retries', () => {
    const preset = getModelProviderPreset(OPENCODE_FREE_PROVIDER_ID)
    expect(preset).toMatchObject({
      id: OPENCODE_FREE_PROVIDER_ID,
      name: 'OpenCore Free',
      baseUrl: 'https://opencode.ai/zen/v1',
      endpointFormat: 'chat_completions',
      defaultRetryMaxAttempts: 10,
      models: [...OPENCODE_FREE_MODEL_IDS]
    })

    const profile = modelProviderPresetProfile(preset!)
    expect(profile.retry?.maxAttempts).toBe(10)
    expect(profile.modelProfiles['kimi-k2.5-free']).toMatchObject({
      contextWindowTokens: 262_144,
      maxOutputTokens: 262_144,
      inputModalities: ['text', 'image']
    })
    expect(modelProviderRequiresApiKey(profile)).toBe(false)

    const defaults = defaultModelProviderSettings()
    expect(defaults.providers.find((provider) => provider.id === OPENCODE_FREE_PROVIDER_ID))
      .toMatchObject({ retry: { maxAttempts: 10 } })

    const normalized = normalizeModelProviderSettings({ providers: [] })
    expect(normalized.providers.find((provider) => provider.id === OPENCODE_FREE_PROVIDER_ID))
      .toMatchObject({ retry: { maxAttempts: 10 } })
  })

  it('repairs a stored OpenCore Free profile to the built-in free preset', () => {
    const normalized = normalizeModelProviderSettings({
      providers: [{
        id: OPENCODE_FREE_PROVIDER_ID,
        name: 'opencode-free',
        apiKey: '',
        baseUrl: 'https://opencode.ai/zen/v1',
        endpointFormat: 'chat_completions',
        models: ['gpt-5-nano'],
        modelProfiles: {}
      }]
    }).providers.find((provider) => provider.id === OPENCODE_FREE_PROVIDER_ID)

    expect(normalized).toMatchObject({
      presetSource: { presetId: OPENCODE_FREE_PROVIDER_ID, mode: 'api' },
      name: 'opencode-free',
      retry: { maxAttempts: 10 }
    })
    expect(normalized && modelProviderRequiresApiKey(normalized)).toBe(false)
  })

  it('preserves explicit OpenCore Free retry settings during normalization', () => {
    const profile = modelProviderPresetProfile(getModelProviderPreset(OPENCODE_FREE_PROVIDER_ID)!)
    const normalized = normalizeModelProviderSettings({
      providers: [{
        ...profile,
        retry: { maxAttempts: 2, initialDelayMs: 3_000, httpStatusCodes: [429, 500, 502, 503, 504], defaultsVersion: 1 }
      }]
    }).providers.find((provider) => provider.id === OPENCODE_FREE_PROVIDER_ID)

    expect(normalized?.retry?.maxAttempts).toBe(2)
  })

  it('keeps per-model endpointFormat overrides on the OpenCode Go preset', () => {
    const preset = getModelProviderPreset('opencode-go')
    expect(preset).not.toBeNull()
    const profile = modelProviderPresetProfile(preset!, 'sk-opencode')
    // MiniMax / Qwen route over Anthropic Messages...
    expect(profile.modelProfiles['minimax-m3'].endpointFormat).toBe('messages')
    expect(profile.modelProfiles['qwen3.7-max'].endpointFormat).toBe('messages')
    // ...while chat-completions models carry no override (they inherit).
    expect(profile.modelProfiles['glm-5.1'].endpointFormat).toBeUndefined()
    expect(profile.modelProfiles['kimi-k2.7'].endpointFormat).toBeUndefined()

    // The override survives the full settings normalization round-trip.
    const resolved = resolveKunRuntimeSettings({
      ...settings(),
      provider: {
        ...defaultModelProviderSettings(),
        providers: [...defaultModelProviderSettings().providers, profile]
      },
      agents: {
        kun: { ...defaultKunRuntimeSettings(), providerId: profile.id, model: 'minimax-m3' }
      }
    })
    expect(resolved.modelProfiles['minimax-m3'].endpointFormat).toBe('messages')
    expect(resolved.modelProfiles['glm-5.1'].endpointFormat).toBeUndefined()
  })

  it('keeps current OpenCode Go GLM models reasoning-selectable', () => {
    const preset = getModelProviderPreset('opencode-go')
    expect(preset).not.toBeNull()
    const profile = modelProviderPresetProfile(preset!, 'sk-opencode')

    expect(profile.models).toContain('glm-5.2')
    for (const modelId of ['glm-5.2', 'glm-5.1', 'glm-5']) {
      expect(profile.modelProfiles[modelId]?.reasoning).toEqual({
        supportedEfforts: ['off', 'high', 'max'],
        defaultEffort: 'max',
        requestProtocol: 'glm-chat-completions'
      })
    }
  })

  it('publishes and narrowly repairs the OpenCode Go Grok 4.5 capacity profile', () => {
    const preset = getModelProviderPreset('opencode-go')!
    const profile = modelProviderPresetProfile(preset, 'sk-opencode')

    expect(profile.models).toContain('grok-4.5')
    expect(profile.modelProfiles['grok-4.5']).toMatchObject({
      contextWindowTokens: 500_000,
      maxOutputTokens: 64_000,
      inputModalities: ['text', 'image'],
      reasoning: {
        supportedEfforts: ['low', 'medium', 'high'],
        defaultEffort: 'medium',
        requestProtocol: 'openai-chat-completions'
      }
    })

    profile.modelProfiles['grok-4.5'] = {
      ...profile.modelProfiles['grok-4.5']!,
      contextWindowTokens: 256_000,
      maxOutputTokens: 500_000
    }
    const repaired = normalizeModelProviderSettings({
      providers: [profile]
    }).providers.find((provider) => provider.id === 'opencode-go')
    expect(repaired?.modelProfiles['grok-4.5']).toMatchObject({
      contextWindowTokens: 500_000,
      maxOutputTokens: 64_000
    })

    profile.modelProfiles['grok-4.5'] = {
      ...profile.modelProfiles['grok-4.5']!,
      contextWindowTokens: 300_000,
      maxOutputTokens: 80_000
    }
    const preserved = normalizeModelProviderSettings({
      providers: [profile]
    }).providers.find((provider) => provider.id === 'opencode-go')
    expect(preserved?.modelProfiles['grok-4.5']).toMatchObject({
      contextWindowTokens: 300_000,
      maxOutputTokens: 80_000
    })
  })

  it('upgrades the obsolete generated single-auto GLM capability', () => {
    const preset = getModelProviderPreset('opencode-go')!
    const profile = modelProviderPresetProfile(preset, 'sk-opencode')
    profile.modelProfiles['glm-5.2'] = {
      ...profile.modelProfiles['glm-5.2']!,
      reasoning: {
        supportedEfforts: ['auto'],
        defaultEffort: 'auto',
        requestProtocol: 'none'
      }
    }

    const normalized = normalizeModelProviderSettings({
      providers: [profile]
    }).providers.find((provider) => provider.id === 'opencode-go')

    expect(normalized?.modelProfiles['glm-5.2']?.reasoning).toEqual({
      supportedEfforts: ['off', 'high', 'max'],
      defaultEffort: 'max',
      requestProtocol: 'glm-chat-completions'
    })
  })

  it('upgrades old placeholder reasoning protocols and the Kimi K3 transport', () => {
    const aliyun = modelProviderPresetProfile(getModelProviderPreset('aliyun')!, 'sk-aliyun')
    aliyun.modelProfiles['qwq-plus'] = {
      ...aliyun.modelProfiles['qwq-plus']!,
      reasoning: {
        supportedEfforts: ['auto', 'off'],
        defaultEffort: 'auto',
        requestProtocol: 'none'
      }
    }
    const kimi = modelProviderPresetProfile(getModelProviderPreset('kimi-code')!, 'sk-kimi')
    kimi.modelProfiles.k3 = {
      ...kimi.modelProfiles.k3!,
      reasoning: {
        supportedEfforts: ['off', 'low', 'medium', 'high', 'max'],
        defaultEffort: 'high',
        requestProtocol: 'openai-responses'
      }
    }

    const normalized = normalizeModelProviderSettings({ providers: [aliyun, kimi] }).providers
    expect(normalized.find((provider) => provider.id === 'aliyun')
      ?.modelProfiles['qwq-plus']?.reasoning?.requestProtocol).toBe('qwen-chat-completions')
    expect(normalized.find((provider) => provider.id === 'kimi-code')
      ?.modelProfiles.k3?.reasoning).toEqual({
        supportedEfforts: ['low', 'high', 'max'],
        defaultEffort: 'high',
        requestProtocol: 'openai-chat-completions'
      })
  })

  it('adds K3 when normalizing the legacy Kimi Code model catalog', () => {
    const normalized = normalizeModelProviderSettings({
      providers: [{
        ...modelProviderPresetProfile(getModelProviderPreset('kimi-code')!, 'sk-kimi'),
        models: ['kimi-for-coding', 'kimi-for-coding-highspeed']
      }]
    }).providers.find((provider) => provider.id === 'kimi-code')

    expect(normalized?.models).toEqual(['k3', 'kimi-for-coding', 'kimi-for-coding-highspeed'])
    expect(normalized?.modelProfiles.k3?.reasoning?.requestProtocol)
      .toBe('openai-chat-completions')
  })

  it.each([
    ['claude-subscription', 'claude-sonnet-4-6', 'anthropic-thinking'],
    ['kimi-code', 'k3', 'openai-chat-completions'],
    ['volcengine-coding-plan', 'doubao-seed-1-6-250615', 'thinking-toggle-chat-completions'],
    ['xiaomi', 'mimo-v2.5-pro', 'mimo-chat-completions'],
    ['minimax', 'MiniMax-M3', 'anthropic-thinking'],
    ['aliyun', 'qwq-plus', 'qwen-chat-completions'],
    ['tencentcloud', 'hunyuan-t1-latest', 'thinking-toggle-chat-completions'],
    ['codex', 'gpt-5.6-luna', 'openai-responses'],
    ['grok-subscription', 'grok-4.5', 'openai-responses']
  ])('publishes the audited %s/%s reasoning protocol', (
    presetId,
    model,
    requestProtocol
  ) => {
    const preset = getModelProviderPreset(presetId)
    expect(preset).not.toBeNull()
    expect(modelProviderPresetProfile(preset!).modelProfiles[model]?.reasoning?.requestProtocol)
      .toBe(requestProtocol)
  })

  it('keeps OpenCode Go DeepSeek v4 profiles aligned with DeepSeek defaults (#658)', () => {
    const preset = getModelProviderPreset('opencode-go')
    expect(preset).not.toBeNull()
    const profile = modelProviderPresetProfile(preset!, 'sk-opencode')

    for (const modelId of ['deepseek-v4-pro', 'deepseek-v4-flash']) {
      expect(profile.modelProfiles[modelId]).toMatchObject({
        contextWindowTokens: 1_000_000,
        reasoning: {
          supportedEfforts: ['off', 'high', 'max'],
          defaultEffort: 'max',
          requestProtocol: 'deepseek-chat-completions'
        }
      })
    }

    const resolved = resolveKunRuntimeSettings({
      ...settings(),
      provider: {
        ...defaultModelProviderSettings(),
        providers: [...defaultModelProviderSettings().providers, profile]
      },
      agents: {
        kun: { ...defaultKunRuntimeSettings(), providerId: profile.id, model: 'deepseek-v4-pro' }
      }
    })
    expect(resolved.modelProfiles['deepseek-v4-pro']).toEqual(profile.modelProfiles['deepseek-v4-pro'])
    expect(resolved.modelProfiles['deepseek-v4-flash']).toEqual(profile.modelProfiles['deepseek-v4-flash'])
  })
})

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
  type ModelProviderModelProfileV1,
  type ModelProviderModelPricingV1
} from './app-settings'
import { normalizeModelProviderModelProfile } from './app-settings-provider-capabilities'
import { settings } from './app-settings-provider.test-support'

describe('model provider settings', () => {
  it('drops out-of-range model limits while preserving valid metadata and exact boundaries', () => {
    expect(normalizeModelProviderModelProfile({
      contextWindowTokens: 1_020_000,
      maxOutputTokens: 1_020_000,
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      supportsToolCalling: true,
      messageParts: ['text', 'image_url']
    })).toEqual(expect.objectContaining({
      contextWindowTokens: 1_020_000,
      inputModalities: ['text', 'image'],
      messageParts: ['text', 'image_url']
    }))
    expect(normalizeModelProviderModelProfile({
      contextWindowTokens: 1_020_000,
      maxOutputTokens: 1_020_000
    }).maxOutputTokens).toBeUndefined()
    expect(normalizeModelProviderModelProfile({
      contextWindowTokens: 10_000_000,
      maxOutputTokens: 1_000_000
    })).toEqual(expect.objectContaining({
      contextWindowTokens: 10_000_000,
      maxOutputTokens: 1_000_000
    }))
  })

  it('keeps valid catalog pricing and drops incomplete or negative pricing', () => {
    expect(normalizeModelProviderModelProfile({
      pricing: {
        inputUsdPerMillion: 1,
        outputUsdPerMillion: 2,
        cacheReadUsdPerMillion: 0.1,
        cacheWriteUsdPerMillion: 1.5
      }
    }).pricing).toEqual({
      inputUsdPerMillion: 1,
      outputUsdPerMillion: 2,
      cacheReadUsdPerMillion: 0.1,
      cacheWriteUsdPerMillion: 1.5
    })
    expect(normalizeModelProviderModelProfile({
      pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 }
    }).pricing).toEqual({
      inputUsdPerMillion: 0,
      outputUsdPerMillion: 0
    })
    expect(normalizeModelProviderModelProfile({
      pricing: { inputUsdPerMillion: 1, outputUsdPerMillion: 2 }
    }).pricing).toEqual({ inputUsdPerMillion: 1, outputUsdPerMillion: 2 })
    expect(normalizeModelProviderModelProfile({
      pricing: { inputUsdPerMillion: 1 } as unknown as ModelProviderModelProfileV1['pricing']
    }).pricing).toBeUndefined()
    expect(normalizeModelProviderModelProfile({
      pricing: { outputUsdPerMillion: 2 } as unknown as ModelProviderModelProfileV1['pricing']
    }).pricing).toBeUndefined()
    expect(normalizeModelProviderModelProfile({
      pricing: { inputUsdPerMillion: -1, outputUsdPerMillion: 2 }
    }).pricing).toBeUndefined()
    expect(normalizeModelProviderModelProfile({
      pricing: {
        inputUsdPerMillion: Number.NaN,
        outputUsdPerMillion: 2,
        cacheReadUsdPerMillion: 0.1
      }
    }).pricing).toBeUndefined()
  })

it('backfills preset model capabilities for stale stored providers', () => {
    const base = settings()
    const resolved = resolveKunRuntimeSettings({
      ...base,
      provider: {
        ...base.provider,
        providers: [
          ...base.provider.providers,
          {
            id: 'xiaomi-token-plan',
            name: 'Xiaomi Token Plan',
            apiKey: 'tp-key',
            baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
            endpointFormat: 'chat_completions',
            useProxy: false,
            models: ['mimo-v2-omni', 'mimo-v2.5', 'mimo-v2.5-pro'],
            modelProfiles: {}
          }
        ]
      },
      agents: {
        kun: {
          ...base.agents.kun,
          providerId: 'xiaomi-token-plan',
          model: 'mimo-v2.5'
        }
      }
    })

    expect(modelSupportsImageInput(resolved.modelProfiles['mimo-v2.5'])).toBe(true)
    expect(modelSupportsImageInput(resolved.modelProfiles['mimo-v2-omni'])).toBe(true)
    expect(resolved.modelProfiles['mimo-v2.5-pro']).toBeDefined()
  })

  it('preserves user-edited fields while filling newly added preset capabilities', () => {
    const codex = getModelProviderPreset('codex')
    expect(codex).not.toBeNull()
    const codexProfile = modelProviderPresetProfile(codex!, 'sk-codex')
    const editedProfile: ModelProviderModelProfileV1 = {
      contextWindowTokens: 256_000,
      maxOutputTokens: 32_000,
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsToolCalling: false,
      messageParts: ['text']
    }
    const resolved = resolveKunRuntimeSettings({
      ...settings(),
      provider: {
        ...defaultModelProviderSettings(),
        providers: [
          ...defaultModelProviderSettings().providers,
          {
            ...codexProfile,
            modelProfiles: {
              ...codexProfile.modelProfiles,
              'gpt-5.5': editedProfile
            }
          }
        ]
      },
      agents: {
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: codexProfile.id,
          model: 'gpt-5.5'
        }
      }
    })

    expect(resolved.modelProfiles['gpt-5.5']).toMatchObject({
      ...editedProfile,
      reasoning: {
        supportedEfforts: ['low', 'medium', 'high', 'max'],
        defaultEffort: 'high',
        requestProtocol: 'openai-responses'
      }
    })
  })

  it('resolves Xiaomi speech-to-text through provider speech capability', () => {
    const xiaomi = getModelProviderPreset('xiaomi')
    expect(xiaomi).not.toBeNull()
    const xiaomiProfile = modelProviderPresetProfile(xiaomi!, 'sk-xiaomi')
    const base = {
      ...settings(),
      provider: {
        ...defaultModelProviderSettings(),
        providers: [
          ...defaultModelProviderSettings().providers,
          xiaomiProfile
        ]
      },
      agents: {
        kun: {
          ...defaultKunRuntimeSettings(),
          speechToText: {
            ...defaultKunRuntimeSettings().speechToText,
            enabled: true,
            providerId: xiaomiProfile.id
          }
        }
      }
    }

    expect(listSpeechToTextProviderProfiles(base).map((profile) => profile.id)).toEqual(['xiaomi'])
    expect(resolveKunSpeechToTextSettings(base)).toEqual(expect.objectContaining({
      enabled: true,
      providerId: 'xiaomi',
      protocol: 'mimo-asr',
      baseUrl: 'https://api.xiaomimimo.com/v1',
      apiKey: 'sk-xiaomi',
      model: 'mimo-v2.5-asr'
    }))
  })

  it('resolves Grok and Gemini CLI subscription speech without mixing Cursor models', () => {
    const grokProfile = modelProviderPresetProfile(
      getModelProviderPreset('grok-subscription')!,
      'grok-oauth-json'
    )
    const geminiCliProfile = modelProviderPresetProfile(
      getModelProviderPreset('gemini-cli-subscription')!,
      ''
    )
    const cursorProfile = {
      ...modelProviderPresetProfile(
        getModelProviderPreset('cursor-subscription')!,
        'cursor-secret'
      ),
      speech: {
        protocol: 'openai-transcriptions' as const,
        baseUrl: '',
        models: ['gemini-2.5-flash']
      }
    }
    const appSettings = {
      ...settings(),
      provider: {
        ...defaultModelProviderSettings(),
        providers: [
          ...defaultModelProviderSettings().providers,
          grokProfile,
          geminiCliProfile,
          cursorProfile
        ]
      },
      agents: {
        kun: {
          ...defaultKunRuntimeSettings(),
          speechToText: {
            ...defaultKunRuntimeSettings().speechToText,
            enabled: true,
            providerId: geminiCliProfile.id,
            model: 'gemini-2.5-flash'
          }
        }
      }
    }

    expect(listSpeechToTextProviderProfiles(appSettings).map((profile) => profile.id))
      .toEqual(['grok-subscription', 'gemini-cli-subscription'])
    expect(resolveKunSpeechToTextSettings(appSettings)).toEqual(expect.objectContaining({
      enabled: true,
      providerId: 'gemini-cli-subscription',
      protocol: 'gemini-cli-audio',
      baseUrl: '',
      apiKey: '',
      model: 'gemini-2.5-flash'
    }))
  })

  it('resolves provider-backed speech, music and video generation settings', () => {
    const minimax = getModelProviderPreset('minimax')
    const xiaomi = getModelProviderPreset('xiaomi')
    expect(minimax).not.toBeNull()
    expect(xiaomi).not.toBeNull()
    const minimaxProfile = modelProviderPresetProfile(minimax!, 'sk-minimax')
    const xiaomiProfile = modelProviderPresetProfile(xiaomi!, 'sk-xiaomi')
    const base = {
      ...settings(),
      provider: {
        ...defaultModelProviderSettings(),
        providers: [
          ...defaultModelProviderSettings().providers,
          minimaxProfile,
          xiaomiProfile
        ]
      },
      agents: {
        kun: {
          ...defaultKunRuntimeSettings(),
          textToSpeech: {
            ...defaultKunRuntimeSettings().textToSpeech,
            enabled: true,
            providerId: minimaxProfile.id,
            baseUrl: 'https://stale-tts.example/v1',
            apiKey: 'sk-stale-tts',
            model: 'stale-voice-model'
          },
          musicGeneration: {
            ...defaultKunRuntimeSettings().musicGeneration,
            enabled: true,
            providerId: minimaxProfile.id,
            baseUrl: 'https://stale-music.example/v1',
            apiKey: 'sk-stale-music',
            model: 'stale-music-model'
          },
          videoGeneration: {
            ...defaultKunRuntimeSettings().videoGeneration,
            enabled: true,
            providerId: minimaxProfile.id,
            baseUrl: 'https://stale-video.example/v1',
            apiKey: 'sk-stale-video',
            model: 'stale-video-model'
          }
        }
      }
    }

    expect(listTextToSpeechProviderProfiles(base).map((profile) => profile.id)).toEqual(['minimax', 'xiaomi'])
    expect(listMusicGenerationProviderProfiles(base).map((profile) => profile.id)).toEqual(['minimax'])
    expect(listVideoGenerationProviderProfiles(base).map((profile) => profile.id)).toEqual(['minimax'])
    expect(resolveKunTextToSpeechSettings(base)).toEqual(expect.objectContaining({
      enabled: true,
      providerId: 'minimax',
      protocol: 'minimax-t2a',
      baseUrl: 'https://api.minimax.io',
      apiKey: 'sk-minimax',
      model: 'speech-2.8-hd'
    }))
    expect(resolveKunMusicGenerationSettings(base)).toEqual(expect.objectContaining({
      enabled: true,
      providerId: 'minimax',
      protocol: 'minimax-music',
      baseUrl: 'https://api.minimax.io',
      apiKey: 'sk-minimax',
      model: 'music-2.6'
    }))
    expect(resolveKunVideoGenerationSettings(base)).toEqual(expect.objectContaining({
      enabled: true,
      providerId: 'minimax',
      protocol: 'minimax-video',
      baseUrl: 'https://api.minimax.io',
      apiKey: 'sk-minimax',
      model: 'MiniMax-Hailuo-2.3'
    }))
  })

  it('repairs stale Xiaomi token plan speech endpoint and TTS model overrides', () => {
    const xiaomi = getModelProviderPreset('xiaomi')
    expect(xiaomi).not.toBeNull()
    const xiaomiTokenPlanProfile = modelProviderTokenPlanProfile(xiaomi!, 'tp-xiaomi')
    expect(xiaomiTokenPlanProfile).not.toBeNull()
    const staleTokenPlanProfile = {
      ...xiaomiTokenPlanProfile!,
      speech: {
        ...xiaomiTokenPlanProfile!.speech!,
        baseUrl: 'https://api.xiaomimimo.com/v1'
      }
    }
    const resolved = resolveKunSpeechToTextSettings({
      ...settings(),
      provider: {
        ...defaultModelProviderSettings(),
        providers: [
          ...defaultModelProviderSettings().providers,
          staleTokenPlanProfile
        ]
      },
      agents: {
        kun: {
          ...defaultKunRuntimeSettings(),
          speechToText: {
            ...defaultKunRuntimeSettings().speechToText,
            enabled: true,
            providerId: staleTokenPlanProfile.id,
            model: 'mimo-v2.5-tts'
          }
        }
      }
    })

    expect(resolved).toEqual(expect.objectContaining({
      enabled: true,
      providerId: 'xiaomi-token-plan',
      protocol: 'mimo-asr',
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
      apiKey: 'tp-xiaomi',
      model: 'mimo-v2.5-asr'
    }))
  })

  it('keeps custom speech-to-text settings when no provider is selected', () => {
    const resolved = resolveKunSpeechToTextSettings({
      ...settings(),
      agents: {
        kun: {
          ...defaultKunRuntimeSettings(),
          speechToText: {
            ...defaultKunRuntimeSettings().speechToText,
            enabled: true,
            providerId: '',
            protocol: 'openai-transcriptions',
            baseUrl: 'https://speech.example/v1',
            apiKey: 'sk-speech',
            model: 'whisper-1',
            language: 'zh',
            timeoutMs: 30_000
          }
        }
      }
    })

    expect(resolved).toEqual(expect.objectContaining({
      enabled: true,
      providerId: '',
      protocol: 'openai-transcriptions',
      baseUrl: 'https://speech.example/v1',
      apiKey: 'sk-speech',
      model: 'whisper-1',
      language: 'zh'
    }))
  })

  it('does not attach a provider credential to an undeclared media route', () => {
    const base = settings()
    const runtime = defaultKunRuntimeSettings()
    const providerId = base.provider.providers[0]!.id
    const state: AppSettingsV1 = {
      ...base,
      agents: {
        kun: {
          ...runtime,
          imageGeneration: {
            ...runtime.imageGeneration,
            providerId,
            baseUrl: 'https://attacker.invalid/images',
            apiKey: 'stale-image-secret'
          },
          speechToText: {
            ...runtime.speechToText,
            providerId,
            baseUrl: 'https://attacker.invalid/audio',
            apiKey: 'stale-stt-secret'
          },
          textToSpeech: {
            ...runtime.textToSpeech,
            providerId,
            baseUrl: 'https://attacker.invalid/speech',
            apiKey: 'stale-tts-secret'
          },
          musicGeneration: {
            ...runtime.musicGeneration,
            providerId,
            baseUrl: 'https://attacker.invalid/music',
            apiKey: 'stale-music-secret'
          },
          videoGeneration: {
            ...runtime.videoGeneration,
            providerId,
            baseUrl: 'https://attacker.invalid/video',
            apiKey: 'stale-video-secret'
          }
        }
      }
    }

    for (const resolved of [
      resolveKunImageGenerationSettings(state),
      resolveKunSpeechToTextSettings(state),
      resolveKunTextToSpeechSettings(state),
      resolveKunMusicGenerationSettings(state),
      resolveKunVideoGenerationSettings(state)
    ]) {
      expect(resolved.providerId).toBe('')
      expect(resolved.apiKey).toBe('')
    }
  })

  it('preserves a cleared default base URL while resolving the official runtime endpoint', () => {
    const state = settings()
    const normalized = normalizeModelProviderSettings({
      ...state.provider,
      baseUrl: '',
      providers: state.provider.providers.map((provider) =>
        provider.id === 'deepseek'
          ? { ...provider, baseUrl: '' }
          : provider
      )
    })

    expect(normalized.baseUrl).toBe('')
    expect(normalized.providers.find((provider) => provider.id === 'deepseek')?.baseUrl).toBe('')
    expect(resolveModelProviderBaseUrl({ ...state, provider: normalized })).toBe(DEFAULT_DEEPSEEK_BASE_URL)
  })

  it('keeps deprecated DeepSeek models out of the default provider list', () => {
    const defaultModels = defaultModelProviderSettings().providers[0].models

    expect(defaultModels).toEqual(['deepseek-v4-pro', 'deepseek-v4-flash'])
    expect(defaultModels).not.toContain('deepseek-chat')
    expect(defaultModels).not.toContain('deepseek-reasoner')
  })
})

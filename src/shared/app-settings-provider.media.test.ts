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

describe('model provider settings', () => {
  it('resolves MiniMax image generation through provider image capability', () => {
    const minimax = getModelProviderPreset('minimax')
    expect(minimax).not.toBeNull()
    const minimaxProfile = modelProviderPresetProfile(minimax!, 'sk-minimax')
    const resolved = resolveKunImageGenerationSettings({
      ...settings(),
      provider: {
        ...defaultModelProviderSettings(),
        providers: [
          ...defaultModelProviderSettings().providers,
          minimaxProfile
        ]
      },
      agents: {
        kun: {
          ...defaultKunRuntimeSettings(),
          imageGeneration: {
            ...defaultKunRuntimeSettings().imageGeneration,
            enabled: true,
            providerId: minimaxProfile.id,
            baseUrl: 'https://stale-image.example/v1',
            apiKey: 'sk-stale-image',
            model: 'stale-image-model'
          }
        }
      }
    })

    expect(resolved).toEqual(expect.objectContaining({
      enabled: true,
      providerId: 'minimax',
      protocol: 'minimax-image',
      baseUrl: 'https://api.minimaxi.com',
      apiKey: 'sk-minimax',
      model: 'image-01'
    }))
  })

  it('resolves MiniMax token plan image generation through provider image capability', () => {
    const minimax = getModelProviderPreset('minimax')
    expect(minimax).not.toBeNull()
    const minimaxTokenPlanProfile = modelProviderTokenPlanProfile(minimax!, 'mm-tp-key')
    expect(minimaxTokenPlanProfile).toMatchObject({
      id: 'minimax-token-plan',
      image: {
        protocol: 'minimax-image',
        baseUrl: 'https://api.minimaxi.com',
        models: ['image-01', 'image-01-live']
      }
    })
    const resolved = resolveKunImageGenerationSettings({
      ...settings(),
      provider: {
        ...defaultModelProviderSettings(),
        providers: [
          ...defaultModelProviderSettings().providers,
          minimaxTokenPlanProfile!
        ]
      },
      agents: {
        kun: {
          ...defaultKunRuntimeSettings(),
          imageGeneration: {
            ...defaultKunRuntimeSettings().imageGeneration,
            enabled: true,
            providerId: minimaxTokenPlanProfile!.id
          }
        }
      }
    })

    expect(resolved).toEqual(expect.objectContaining({
      enabled: true,
      providerId: 'minimax-token-plan',
      protocol: 'minimax-image',
      baseUrl: 'https://api.minimaxi.com',
      apiKey: 'mm-tp-key',
      model: 'image-01'
    }))
  })

  it('resolves Codex subscription image generation through provider image capability', () => {
    const codex = getModelProviderPreset('codex')
    expect(codex).not.toBeNull()
    const codexKey = JSON.stringify({
      kind: 'codex-oauth',
      accessToken: 'codex-access',
      refreshToken: 'codex-refresh',
      expiresAt: Date.now() + 3600_000,
      accountId: 'acct_123',
      email: 'user@example.com'
    })
    const codexProfile = modelProviderPresetProfile(codex!, codexKey)
    expect(codexProfile).toMatchObject({
      id: 'codex',
      image: {
        protocol: 'codex-responses-image',
        baseUrl: 'https://chatgpt.com/backend-api/codex',
        models: ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini']
      }
    })

    const resolved = resolveKunImageGenerationSettings({
      ...settings(),
      provider: {
        ...defaultModelProviderSettings(),
        providers: [
          ...defaultModelProviderSettings().providers,
          codexProfile
        ]
      },
      agents: {
        kun: {
          ...defaultKunRuntimeSettings(),
          imageGeneration: {
            ...defaultKunRuntimeSettings().imageGeneration,
            enabled: true,
            providerId: codexProfile.id
          }
        }
      }
    })

    expect(resolved).toEqual(expect.objectContaining({
      enabled: true,
      providerId: 'codex',
      protocol: 'codex-responses-image',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      apiKey: codexKey,
      model: 'gpt-image-2'
    }))
  })

  it('uses 1M context defaults for Codex GPT 5.x models', () => {
    const codex = getModelProviderPreset('codex')
    expect(codex).not.toBeNull()
    const codexProfile = modelProviderPresetProfile(codex!, 'sk-codex')
    for (const modelId of ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini']) {
      expect(codexProfile.modelProfiles[modelId]).toEqual(expect.objectContaining({
        contextWindowTokens: 1_000_000
      }))
    }

    const resolved = resolveKunRuntimeSettings({
      ...settings(),
      provider: {
        ...defaultModelProviderSettings(),
        providers: [
          ...defaultModelProviderSettings().providers,
          codexProfile
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

    expect(resolved.modelProfiles['gpt-5.5'].contextWindowTokens).toBe(1_000_000)
  })

  it('routes MiniMax token plan media capabilities through the selected region host', () => {
    const minimax = getModelProviderPreset('minimax')
    expect(minimax).not.toBeNull()
    const cnProfile = modelProviderTokenPlanProfile(minimax!, 'sk-cp-cn', 'https://api.minimaxi.com/anthropic')
    const globalProfile = modelProviderTokenPlanProfile(minimax!, 'sk-cp-global', 'https://api.minimax.io/anthropic')
    expect(cnProfile).toMatchObject({
      image: { baseUrl: 'https://api.minimaxi.com' },
      textToSpeech: { baseUrl: 'https://api.minimaxi.com' },
      music: { baseUrl: 'https://api.minimaxi.com' },
      video: { baseUrl: 'https://api.minimaxi.com' }
    })
    expect(globalProfile).toMatchObject({
      image: { baseUrl: 'https://api.minimax.io' },
      textToSpeech: { baseUrl: 'https://api.minimax.io' },
      music: { baseUrl: 'https://api.minimax.io' },
      video: { baseUrl: 'https://api.minimax.io' }
    })

    const staleGlobalCapabilityOnCnProfile = {
      ...cnProfile!,
      image: { ...cnProfile!.image!, baseUrl: 'https://api.minimax.io' },
      textToSpeech: { ...cnProfile!.textToSpeech!, baseUrl: 'https://api.minimax.io' },
      music: { ...cnProfile!.music!, baseUrl: 'https://api.minimax.io' },
      video: { ...cnProfile!.video!, baseUrl: 'https://api.minimax.io' }
    }
    const state = {
      ...settings(),
      provider: {
        ...defaultModelProviderSettings(),
        providers: [
          ...defaultModelProviderSettings().providers,
          staleGlobalCapabilityOnCnProfile
        ]
      },
      agents: {
        kun: {
          ...defaultKunRuntimeSettings(),
          imageGeneration: {
            ...defaultKunRuntimeSettings().imageGeneration,
            enabled: true,
            providerId: staleGlobalCapabilityOnCnProfile.id
          },
          textToSpeech: {
            ...defaultKunRuntimeSettings().textToSpeech,
            enabled: true,
            providerId: staleGlobalCapabilityOnCnProfile.id
          },
          musicGeneration: {
            ...defaultKunRuntimeSettings().musicGeneration,
            enabled: true,
            providerId: staleGlobalCapabilityOnCnProfile.id
          },
          videoGeneration: {
            ...defaultKunRuntimeSettings().videoGeneration,
            enabled: true,
            providerId: staleGlobalCapabilityOnCnProfile.id
          }
        }
      }
    }

    expect(resolveKunImageGenerationSettings(state).baseUrl).toBe('https://api.minimaxi.com')
    expect(resolveKunTextToSpeechSettings(state).baseUrl).toBe('https://api.minimaxi.com')
    expect(resolveKunMusicGenerationSettings(state).baseUrl).toBe('https://api.minimaxi.com')
    expect(resolveKunVideoGenerationSettings(state).baseUrl).toBe('https://api.minimaxi.com')
  })

  it('exposes the Xiaomi preset speech capability', () => {
    const xiaomi = getModelProviderPreset('xiaomi')
    expect(xiaomi && modelProviderPresetProfile(xiaomi)).toMatchObject({
      id: 'xiaomi',
      speech: {
        protocol: 'mimo-asr',
        baseUrl: 'https://api.xiaomimimo.com/v1',
        models: ['mimo-v2.5-asr']
      },
      textToSpeech: {
        protocol: 'mimo-tts',
        baseUrl: 'https://api.xiaomimimo.com/v1',
        models: ['mimo-v2.5-tts', 'mimo-v2.5-tts-voicedesign', 'mimo-v2.5-tts-voiceclone']
      }
    })
  })

  it('keeps speech-only models out of the composer model list', () => {
    const base = settings()
    const resolved = listModelProviderModelIds({
      ...base,
      provider: {
        ...base.provider,
        providers: [
          ...base.provider.providers,
          {
            id: 'voice-lab',
            name: 'Voice Lab',
            apiKey: 'sk-voice',
            baseUrl: 'https://voice.example/v1',
            endpointFormat: 'chat_completions',
            useProxy: false,
            models: ['voice-chat', 'mimo-v2.5-asr', 'whisper-1'],
            modelProfiles: {},
            speech: {
              protocol: 'openai-transcriptions',
              baseUrl: 'https://voice.example/v1',
              models: ['whisper-1']
            }
          }
        ]
      }
    })

    expect(resolved).toContain('voice-chat')
    expect(resolved).not.toContain('mimo-v2.5-asr')
    expect(resolved).not.toContain('whisper-1')
  })

  it('classifies speech and image model ids without treating TTS as ASR', () => {
    expect(isSpeechToTextModelId('mimo-v2.5-asr')).toBe(true)
    expect(isSpeechToTextModelId('whisper-1')).toBe(true)
    expect(isSpeechToTextModelId('mimo-v2.5-tts')).toBe(false)
    expect(isTextToSpeechModelId('mimo-v2.5-tts')).toBe(true)
    expect(isTextToSpeechModelId('speech-2.8-hd')).toBe(true)
    expect(isMusicGenerationModelId('music-cover')).toBe(true)
    expect(isVideoGenerationModelId('MiniMax-Hailuo-2.3')).toBe(true)
    expect(isComposerChatModelId('mimo-v2.5-tts')).toBe(false)
    expect(isComposerChatModelId('speech-2.8-hd')).toBe(false)
    expect(isComposerChatModelId('music-2.6')).toBe(false)
    expect(isComposerChatModelId('MiniMax-Hailuo-2.3')).toBe(false)
    expect(isImageGenerationModelId('gpt-image-1')).toBe(true)
    expect(isImageGenerationModelId('seedream-4-0-250828')).toBe(true)
    expect(isImageGenerationModelId('text-embedding-3-large')).toBe(false)
  })

  it('keeps image-generation and other non-text models out of the composer model list', () => {
    const base = settings()
    const resolved = listModelProviderModelIds({
      ...base,
      provider: {
        ...base.provider,
        providers: [
          ...base.provider.providers,
          {
            id: 'art-lab',
            name: 'Art Lab',
            apiKey: 'sk-art',
            baseUrl: 'https://art.example/v1',
            endpointFormat: 'chat_completions',
            useProxy: false,
            models: [
              'art-chat',
              'paint-house',
              'banana-canvas',
              'seedream-4-0-250828',
              'text-embedding-3-large'
            ],
            modelProfiles: {
              'banana-canvas': {
                inputModalities: ['text'],
                outputModalities: ['image'],
                supportsToolCalling: false,
                messageParts: ['text']
              }
            },
            image: {
              protocol: 'openai-images',
              baseUrl: 'https://art.example/v1',
              models: ['paint-house']
            }
          }
        ]
      }
    })

    expect(resolved).toContain('art-chat')
    expect(resolved).not.toContain('paint-house')
    expect(resolved).not.toContain('banana-canvas')
    expect(resolved).not.toContain('seedream-4-0-250828')
    expect(resolved).not.toContain('text-embedding-3-large')
  })
})

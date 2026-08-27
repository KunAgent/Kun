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
  OPENCODE_FREE_PROVIDER_ID,
  listMusicGenerationProviderProfiles,
  listSpeechToTextProviderProfiles,
  listTextToSpeechProviderProfiles,
  listVideoGenerationProviderProfiles,
  modelProviderModelProfilesForProvider,
  listModelProviderModelIds,
  modelSupportsImageInput,
  defaultDesignSettings,
  isLocalModelProxyPort,
  localModelProxyPort,
  localModelProxyUrl,
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
  it('resolves an empty key so keyless OpenCore Free requests stay anonymous', () => {
    const state = settings()
    const openCodeFree = state.provider.providers.find((provider) => provider.id === OPENCODE_FREE_PROVIDER_ID)!
    state.agents.kun.providerId = OPENCODE_FREE_PROVIDER_ID
    state.agents.kun.apiKey = 'sk-stale-runtime'

    const runtime = resolveKunRuntimeSettings(state)

    expect(openCodeFree.apiKey).toBe('')
    // A stale runtime key must not leak into the anonymous free tier either.
    expect(runtime.apiKey).toBe('')
  })

  it('uses a configured OpenCore Free key instead of staying anonymous', () => {
    const state = settings()
    state.provider.providers = state.provider.providers.map((provider) =>
      provider.id === OPENCODE_FREE_PROVIDER_ID ? { ...provider, apiKey: 'sk-zen' } : provider
    )
    state.agents.kun.providerId = OPENCODE_FREE_PROVIDER_ID

    expect(resolveKunRuntimeSettings(state).apiKey).toBe('sk-zen')
  })

  it('resolves Kun runtime credentials from the selected provider', () => {
    const state = settings()
    state.agents.kun.apiKey = 'sk-stale-runtime'
    state.agents.kun.baseUrl = 'https://stale-runtime.example/v1'
    const runtime = resolveKunRuntimeSettings(state)

    expect(runtime.apiKey).toBe('sk-custom')
    expect(runtime.baseUrl).toBe('https://custom.example/v1')
    expect(runtime.endpointFormat).toBe('messages')
  })

  it('normalizes and resolves model request proxy settings', () => {
    const provider = normalizeModelProviderSettings({
      proxy: {
        enabled: true,
        url: ' socks5://127.0.0.1:1080 '
      }
    })

    expect(provider.proxy).toEqual({
      enabled: true,
      url: 'socks5://127.0.0.1:1080'
    })

    const state = settings()
    state.provider.proxy = provider.proxy
    expect(resolveModelProviderProxyUrl(state)).toBe('socks5://127.0.0.1:1080')
  })

  it('converts a local model proxy port into the transport URL', () => {
    expect(localModelProxyUrl('10808')).toBe('http://127.0.0.1:10808')
    expect(localModelProxyPort('http://127.0.0.1:10808')).toBe('10808')
    expect(localModelProxyPort('http://127.0.0.1:10808/')).toBe('10808')
    expect(isLocalModelProxyPort('10808')).toBe(true)
    expect(isLocalModelProxyPort('0')).toBe(false)
    expect(isLocalModelProxyPort('65536')).toBe(false)
    expect(localModelProxyPort('socks5://127.0.0.1:10808')).toBe('10808')
    expect(localModelProxyPort('socks5://proxy.example:10808')).toBe('')

    const state = settings()
    state.provider.proxy = { enabled: true, url: localModelProxyUrl('10808') }
    expect(resolveModelProviderProxyUrl(state)).toBe('http://127.0.0.1:10808/')
  })

  it('keeps the raw proxy URL in storage but refuses to apply invalid protocols', () => {
    const provider = normalizeModelProviderSettings({
      proxy: {
        enabled: true,
        url: 'ftp://127.0.0.1:2121'
      }
    })

    // Storage keeps exactly what the user typed (so editing is never destroyed)…
    expect(provider.proxy).toEqual({
      enabled: true,
      url: 'ftp://127.0.0.1:2121'
    })

    // …but an unsupported proxy protocol is not applied to outbound requests.
    const state = settings()
    state.provider.proxy = provider.proxy
    expect(resolveModelProviderProxyUrl(state)).toBe('')
  })

  it('does not blank partial proxy URLs while typing (regression for #600)', () => {
    // Intermediate values as the user types "http://127.0.0.1:7890"; none of
    // them may be wiped to '' by the per-keystroke normalizer.
    for (const partial of ['h', 'http:', 'http://127.0.0.1', 'http://127.0.0.1:78']) {
      const provider = normalizeModelProviderSettings({ proxy: { enabled: true, url: partial } })
      expect(provider.proxy.url).toBe(partial)
      expect(provider.proxy.enabled).toBe(true)
    }

    // A completed URL applies cleanly; a port is optional.
    const withPort = settings()
    withPort.provider.proxy = normalizeModelProviderSettings({
      proxy: { enabled: true, url: 'http://127.0.0.1:7890' }
    }).proxy
    expect(resolveModelProviderProxyUrl(withPort)).toBe('http://127.0.0.1:7890/')

    const noPort = settings()
    noPort.provider.proxy = normalizeModelProviderSettings({
      proxy: { enabled: true, url: 'http://proxy.lan' }
    }).proxy
    expect(resolveModelProviderProxyUrl(noPort)).toBe('http://proxy.lan/')
  })

  it('keeps legacy Kun runtime credential overrides only when no provider is selected', () => {
    const state = settings()
    state.agents.kun.providerId = ''
    state.agents.kun.apiKey = 'sk-legacy-runtime'
    state.agents.kun.baseUrl = 'https://legacy-runtime.example/v1'
    const runtime = resolveKunRuntimeSettings(state)

    expect(runtime.apiKey).toBe('sk-legacy-runtime')
    expect(runtime.baseUrl).toBe('https://legacy-runtime.example/v1')
  })

  it('falls back to the runtime apiKey when the selected provider profile is keyless (issue #329)', () => {
    const state = settings()
    state.provider.providers = state.provider.providers.map((provider) =>
      provider.id === 'custom' ? { ...provider, apiKey: '' } : provider
    )
    state.agents.kun.providerId = 'custom'
    state.agents.kun.apiKey = 'sk-runtime-fallback'
    const runtime = resolveKunRuntimeSettings(state)

    // The keyless provider must not erase a configured key — otherwise the
    // settings-apply gate reads "no API key" and strands a healthy runtime.
    expect(runtime.apiKey).toBe('sk-runtime-fallback')
  })

  it('uses a 256k context window for custom provider models without explicit context metadata', () => {
    const state = settings()
    state.provider.providers = state.provider.providers.map((provider) =>
      provider.id === 'custom'
        ? {
            ...provider,
            modelProfiles: {
              'custom-model': {
                inputModalities: ['text'],
                outputModalities: ['text'],
                supportsToolCalling: true,
                messageParts: ['text']
              }
            }
          }
        : provider
    )

    expect(modelProviderModelProfilesForProvider(state, 'custom')['custom-model'].contextWindowTokens)
      .toBe(256_000)
  })

  it('keeps same-id model profiles scoped to the selected provider', () => {
    const state = settings()
    state.provider.providers = state.provider.providers.map((provider) => ({
      ...provider,
      models: [...provider.models, 'shared-model'],
      modelProfiles: {
        ...provider.modelProfiles,
        'shared-model': {
          inputModalities: ['text'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text'],
          endpointFormat: provider.id === 'custom' ? 'messages' : 'responses'
        }
      }
    }))
    state.agents.kun.providerId = 'custom'
    state.agents.kun.model = 'shared-model'

    expect(resolveKunRuntimeSettings(state).modelProfiles['shared-model']).toMatchObject({
      endpointFormat: 'messages'
    })
    expect(modelProviderModelProfilesForProvider(state, 'deepseek')['shared-model']).toMatchObject({
      endpointFormat: 'responses'
    })
  })

  it('preserves per-model max output tokens in custom provider profiles', () => {
    const normalized = normalizeModelProviderSettings({
      providers: [{
        id: 'custom',
        name: 'Custom',
        apiKey: 'sk-custom',
        baseUrl: 'https://custom.example/v1',
        endpointFormat: 'chat_completions',
        models: ['writer'],
        modelProfiles: {
          writer: {
            contextWindowTokens: 256_000,
            maxOutputTokens: 32_000,
            inputModalities: ['text'],
            outputModalities: ['text'],
            supportsToolCalling: true,
            messageParts: ['text']
          }
        }
      }]
    })

    const custom = normalized.providers.find((provider) => provider.id === 'custom')
    expect(custom?.modelProfiles.writer.maxOutputTokens).toBe(32_000)
  })

  it('creates Xiaomi and MiniMax provider presets for Kun runtime profiles', () => {
    const xiaomi = getModelProviderPreset('xiaomi')
    const minimax = getModelProviderPreset('minimax')

    expect(xiaomi && modelProviderPresetProfile(xiaomi)).toMatchObject({
      id: 'xiaomi',
      name: 'Xiaomi',
      baseUrl: 'https://api.xiaomimimo.com/v1',
      endpointFormat: 'chat_completions',
      models: expect.arrayContaining(['mimo-v2.5-pro']),
      modelProfiles: {
        'mimo-v2.5': expect.objectContaining({
          inputModalities: expect.arrayContaining(['image']),
          messageParts: expect.arrayContaining(['image_url']),
          reasoning: expect.objectContaining({
            supportedEfforts: ['off', 'low', 'medium', 'high'],
            defaultEffort: 'high',
            requestProtocol: 'mimo-chat-completions'
          })
        }),
        'mimo-v2-omni': expect.objectContaining({
          inputModalities: expect.arrayContaining(['image'])
        })
      }
    })
    expect(xiaomi && modelProviderPresetProfile(xiaomi).models.slice(0, 2)).toEqual([
      'mimo-v2.5-pro',
      'mimo-v2.5'
    ])
    expect(minimax && modelProviderPresetProfile(minimax)).toMatchObject({
      id: 'minimax',
      name: 'MiniMax',
      baseUrl: 'https://api.minimaxi.com/anthropic',
      endpointFormat: 'messages',
      models: expect.arrayContaining(['MiniMax-M2.5', 'MiniMax-M3']),
      image: {
        protocol: 'minimax-image',
        baseUrl: 'https://api.minimaxi.com',
        models: ['image-01', 'image-01-live']
      },
      textToSpeech: {
        protocol: 'minimax-t2a',
        baseUrl: 'https://api.minimax.io',
        models: ['speech-2.8-hd', 'speech-2.8-turbo']
      },
      music: {
        protocol: 'minimax-music',
        baseUrl: 'https://api.minimax.io',
        models: ['music-2.6', 'music-cover', 'music-2.6-free', 'music-cover-free']
      },
      video: {
        protocol: 'minimax-video',
        baseUrl: 'https://api.minimax.io',
        models: ['MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-2.3-Fast']
      },
      modelProfiles: {
        'MiniMax-M3': expect.objectContaining({
          inputModalities: expect.arrayContaining(['image']),
          messageParts: expect.arrayContaining(['image_url']),
          reasoning: expect.objectContaining({
            supportedEfforts: ['auto', 'off'],
            defaultEffort: 'auto',
            requestProtocol: 'anthropic-thinking'
          })
        }),
        'MiniMax-M2.5': expect.objectContaining({
          reasoning: expect.objectContaining({
            supportedEfforts: ['auto'],
            defaultEffort: 'auto',
            requestProtocol: 'none'
          })
        })
      }
    })
  })

  it('resolves MiniMax preset credentials through the selected provider', () => {
    const minimax = getModelProviderPreset('minimax')
    expect(minimax).not.toBeNull()
    const minimaxProfile = modelProviderPresetProfile(minimax!, 'sk-minimax')
    const resolved = resolveKunRuntimeSettings({
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
          providerId: minimaxProfile.id,
          model: minimaxProfile.models[0]
        }
      }
    })

    expect(resolved).toEqual(expect.objectContaining({
      apiKey: 'sk-minimax',
      baseUrl: 'https://api.minimaxi.com/anthropic',
      endpointFormat: 'messages',
      imageGeneration: expect.objectContaining({
        enabled: false,
        protocol: 'openai-images'
      }),
      model: 'MiniMax-M3',
      modelProfiles: expect.objectContaining({
        'minimax-m3': expect.objectContaining({
          inputModalities: expect.arrayContaining(['image'])
        })
      })
    }))
    expect(modelSupportsImageInput(resolved.modelProfiles['minimax-m3'])).toBe(true)
  })

  it('builds default media generation settings for configured MiniMax providers', () => {
    const minimax = getModelProviderPreset('minimax')
    expect(minimax).not.toBeNull()
    const minimaxProfile = modelProviderPresetProfile(minimax!, 'sk-minimax')
    const patch = defaultMiniMaxMediaGenerationKunPatch({
      providers: [
        ...defaultModelProviderSettings().providers,
        minimaxProfile
      ],
      currentKun: defaultKunRuntimeSettings()
    })

    expect(patch).toEqual(expect.objectContaining({
      textToSpeech: expect.objectContaining({
        enabled: true,
        providerId: 'minimax',
        protocol: 'minimax-t2a',
        model: 'speech-2.8-hd'
      }),
      musicGeneration: expect.objectContaining({
        enabled: true,
        providerId: 'minimax',
        protocol: 'minimax-music',
        model: 'music-2.6'
      }),
      videoGeneration: expect.objectContaining({
        enabled: true,
        providerId: 'minimax',
        protocol: 'minimax-video',
        model: 'MiniMax-Hailuo-2.3'
      })
    }))
  })

  it('prefers the active MiniMax token plan profile when backfilling media defaults', () => {
    const minimax = getModelProviderPreset('minimax')
    expect(minimax).not.toBeNull()
    const minimaxProfile = modelProviderPresetProfile(minimax!, 'sk-minimax')
    const tokenPlanProfile = modelProviderTokenPlanProfile(minimax!, 'sk-cp-minimax')
    expect(tokenPlanProfile).not.toBeNull()
    const patch = defaultMiniMaxMediaGenerationKunPatch({
      providers: [
        ...defaultModelProviderSettings().providers,
        minimaxProfile,
        tokenPlanProfile!
      ],
      currentKun: {
        ...defaultKunRuntimeSettings(),
        providerId: tokenPlanProfile!.id
      }
    })

    expect(patch).toEqual(expect.objectContaining({
      textToSpeech: expect.objectContaining({ providerId: 'minimax-token-plan' }),
      musicGeneration: expect.objectContaining({ providerId: 'minimax-token-plan' }),
      videoGeneration: expect.objectContaining({ providerId: 'minimax-token-plan' })
    }))
  })

  it('backfills MiniMax media defaults from presets without overriding explicit settings', () => {
    const staleMiniMax = {
      id: 'minimax',
      name: 'MiniMax',
      apiKey: 'sk-minimax',
      baseUrl: 'https://api.minimaxi.com/anthropic',
      endpointFormat: 'messages' as const,
      models: ['MiniMax-M3'],
      modelProfiles: {}
    }
    const patch = defaultMiniMaxMediaGenerationKunPatch({
      providers: [
        ...defaultModelProviderSettings().providers,
        staleMiniMax
      ],
      currentKun: {
        ...defaultKunRuntimeSettings(),
        textToSpeech: {
          ...defaultKunRuntimeSettings().textToSpeech,
          providerId: 'voice-lab'
        }
      },
      kunPatch: {
        musicGeneration: { enabled: false }
      }
    })

    expect(patch).toEqual({
      videoGeneration: expect.objectContaining({
        enabled: true,
        providerId: 'minimax',
        protocol: 'minimax-video',
        model: 'MiniMax-Hailuo-2.3'
      })
    })
  })

  it('resolves media generation through stale MiniMax preset providers after capability backfill', () => {
    const staleMiniMax = {
      id: 'minimax',
      name: 'MiniMax',
      apiKey: 'sk-minimax',
      baseUrl: 'https://api.minimaxi.com/anthropic',
      endpointFormat: 'messages' as const,
      models: ['MiniMax-M3'],
      modelProfiles: {}
    }
    const state = {
      ...settings(),
      provider: {
        ...defaultModelProviderSettings(),
        providers: [
          ...defaultModelProviderSettings().providers,
          staleMiniMax
        ]
      },
      agents: {
        kun: {
          ...defaultKunRuntimeSettings(),
          textToSpeech: {
            ...defaultKunRuntimeSettings().textToSpeech,
            enabled: true,
            providerId: 'minimax'
          },
          musicGeneration: {
            ...defaultKunRuntimeSettings().musicGeneration,
            enabled: true,
            providerId: 'minimax'
          },
          videoGeneration: {
            ...defaultKunRuntimeSettings().videoGeneration,
            enabled: true,
            providerId: 'minimax'
          }
        }
      }
    }

    expect(listTextToSpeechProviderProfiles(state).map((profile) => profile.id)).toContain('minimax')
    expect(resolveKunTextToSpeechSettings(state)).toEqual(expect.objectContaining({
      baseUrl: 'https://api.minimax.io',
      apiKey: 'sk-minimax',
      model: 'speech-2.8-hd'
    }))
    expect(resolveKunMusicGenerationSettings(state)).toEqual(expect.objectContaining({
      baseUrl: 'https://api.minimax.io',
      apiKey: 'sk-minimax',
      model: 'music-2.6'
    }))
    expect(resolveKunVideoGenerationSettings(state)).toEqual(expect.objectContaining({
      baseUrl: 'https://api.minimax.io',
      apiKey: 'sk-minimax',
      model: 'MiniMax-Hailuo-2.3'
    }))
  })
})

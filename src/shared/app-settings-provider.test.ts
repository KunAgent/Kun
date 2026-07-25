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

describe('model provider retry settings', () => {
  it('adds default retry settings to default providers', () => {
    const settings = defaultModelProviderSettings()

    expect(settings.providers[0].retry).toEqual(defaultModelRequestRetrySettings())
  })

  it('normalizes retry attempts, delay, and HTTP status codes', () => {
    const settings = normalizeModelProviderSettings({
      providers: [
        {
          id: 'custom',
          name: 'Custom',
          apiKey: 'k',
          baseUrl: 'https://example.com/v1',
          endpointFormat: 'chat_completions',
          retry: {
            maxAttempts: 99,
            initialDelayMs: 700_000,
            httpStatusCodes: [503, 429, 200, 503, 599]
          },
          models: ['m'],
          modelProfiles: {}
        }
      ]
    })

    const provider = settings.providers.find((item) => item.id === 'custom')
    expect(provider?.retry).toEqual({
      maxAttempts: 10,
      initialDelayMs: 600_000,
      httpStatusCodes: [429, 503, 599]
    })
  })
})

describe('Gemini subscription provider preset', () => {
  it('uses the official Antigravity CLI transport and current subscription models', () => {
    const preset = getModelProviderPreset('gemini-subscription')
    expect(preset).not.toBeNull()
    const profile = modelProviderPresetProfile(preset!, '')
    const normalized = normalizeModelProviderSettings({ providers: [profile] })
    expect(normalized.providers.find((provider) => provider.id === profile.id)).toMatchObject({
      kind: 'antigravity-cli',
      baseUrl: '',
      endpointFormat: 'custom_endpoint',
      models: expect.arrayContaining(['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.1-pro'])
    })
  })

  it('keeps the Gemini CLI direct API transport and models separate from Antigravity', () => {
    const preset = getModelProviderPreset('gemini-cli-subscription')
    expect(preset).not.toBeNull()
    const profile = modelProviderPresetProfile(preset!, 'must-not-be-stored')
    const normalized = normalizeModelProviderSettings({ providers: [profile] })
    expect(
      normalized.providers.find((provider) => provider.id === 'gemini-cli-subscription')
    ).toMatchObject({
      name: 'Gemini CLI 订阅（API）',
      kind: 'gemini-cli-api',
      apiKey: '',
      baseUrl: '',
      endpointFormat: 'custom_endpoint',
      retry: expect.objectContaining({
        maxAttempts: 3,
        httpStatusCodes: expect.arrayContaining([429, 503])
      }),
      speech: {
        protocol: 'gemini-cli-audio',
        baseUrl: '',
        models: expect.arrayContaining(['gemini-2.5-flash'])
      },
      models: expect.arrayContaining([
        'gemini-3.1-pro-preview',
        'gemini-3-flash-preview',
        'gemini-3.1-flash-lite',
        'gemini-2.5-pro',
        'gemini-2.5-flash'
      ])
    })
    expect(
      normalized.providers.find((provider) => provider.id === 'gemini-cli-subscription')?.models
    ).not.toContain('gemini-3.6-flash')
  })

  it('migrates the retired Code Assist transport to Antigravity CLI', () => {
    const normalized = normalizeModelProviderSettings({
      providers: [{
        ...modelProviderPresetProfile(getModelProviderPreset('gemini-subscription')!, ''),
        kind: 'gemini-code-assist'
      }]
    })
    expect(
      normalized.providers.find((provider) => provider.id === 'gemini-subscription')
    ).toMatchObject({
      kind: 'antigravity-cli',
      apiKey: '',
      models: ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.1-pro']
    })
  })
})

describe('Cursor subscription provider preset', () => {
  it('uses the official Cursor SDK transport with an auto fallback model', () => {
    const preset = getModelProviderPreset('cursor-subscription')
    expect(preset).not.toBeNull()
    expect(preset?.apiKeyUrl).toBe('https://cursor.com/dashboard/api?section=user-keys#user-api-keys')
    const profile = modelProviderPresetProfile(preset!, 'cursor-secret')
    const normalized = normalizeModelProviderSettings({ providers: [profile] })
    expect(normalized.providers.find((provider) => provider.id === profile.id)).toMatchObject({
      kind: 'cursor-sdk',
      apiKey: 'cursor-secret',
      baseUrl: '',
      endpointFormat: 'custom_endpoint',
      models: ['auto'],
      modelProfiles: {
        auto: {
          reasoning: {
            supportedEfforts: ['auto'],
            defaultEffort: 'auto',
            requestProtocol: 'none'
          }
        }
      }
    })
  })

  it('removes stale speech capability metadata because Cursor has no transcription API', () => {
    const profile = {
      ...modelProviderPresetProfile(getModelProviderPreset('cursor-subscription')!, 'cursor-secret'),
      speech: {
        protocol: 'openai-transcriptions' as const,
        baseUrl: '',
        models: ['gemini-2.5-flash']
      }
    }
    const normalized = normalizeModelProviderSettings({ providers: [profile] })

    expect(
      normalized.providers.find((provider) => provider.id === 'cursor-subscription')?.speech
    ).toBeUndefined()
  })
})

describe('legacy subscription transport migration', () => {
  it.each([
    ['claude-subscription', 'agent-sdk'],
    ['cursor-subscription', 'cursor-sdk'],
    ['gemini-subscription', 'antigravity-cli'],
    ['gemini-cli-subscription', 'gemini-cli-api']
  ] as const)('restores %s to its delegated transport when kind is missing', (providerId, kind) => {
    const profile = modelProviderPresetProfile(getModelProviderPreset(providerId)!, '')
    const { kind: _removedKind, ...legacyProfile } = profile
    const normalized = normalizeModelProviderSettings({ providers: [legacyProfile] })

    expect(normalized.providers.find((provider) => provider.id === providerId))
      .toMatchObject({ kind })
  })

  it('drops a retired Gemini API credential when restoring Antigravity CLI', () => {
    const profile = modelProviderPresetProfile(getModelProviderPreset('gemini-subscription')!, '')
    const { kind: _removedKind, ...legacyProfile } = profile
    const normalized = normalizeModelProviderSettings({
      providers: [{ ...legacyProfile, apiKey: 'retired-code-assist-secret' }]
    })

    expect(normalized.providers.find((provider) => provider.id === 'gemini-subscription'))
      .toMatchObject({ kind: 'antigravity-cli', apiKey: '' })
  })
})

describe('model route pool settings', () => {
  it('normalizes legacy settings to an empty route catalog', () => {
    const settings = normalizeModelProviderSettings(undefined)
    expect(settings.routePools).toEqual([])
    expect(settings.localGateway).toEqual({ enabled: false, name: 'Kun API' })
  })

  it('persists a custom local gateway provider name', () => {
    expect(normalizeModelProviderSettings({
      localGateway: { enabled: true, name: '  Team Relay  ' }
    }).localGateway).toEqual({ enabled: true, name: 'Team Relay' })
  })

  it('keeps valid concrete targets and allows a routed alias to match a concrete model', () => {
    const settings = normalizeModelProviderSettings({
      providers: [{ id: 'provider-a', name: 'A', baseUrl: 'https://a.example', models: ['kimi-k3'] }],
      routePools: [{
        id: 'pool', name: 'Pool', modelId: 'kimi-auto', enabled: true, strategy: 'adaptive',
        targets: [{ id: 'a', providerId: 'provider-a', modelId: 'kimi-k3', enabled: true, weight: 200 }],
        failurePolicy: { failoverHttpStatusCodes: [429], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: true },
        healthPolicy: { failureThreshold: 3, cooldownMs: 60_000, halfOpenMaxAttempts: 1 }
      }, {
        id: 'collision', name: 'Collision', modelId: 'kimi-k3', enabled: true, strategy: 'priority',
        targets: [{ id: 'b', providerId: 'provider-a', modelId: 'kimi-k3', enabled: true, weight: 1 }],
        failurePolicy: { failoverHttpStatusCodes: [429], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: true },
        healthPolicy: { failureThreshold: 3, cooldownMs: 60_000, halfOpenMaxAttempts: 1 }
      }]
    })
    expect(settings.routePools[0]).toMatchObject({ enabled: true, strategy: 'adaptive', targets: [{ providerId: 'provider-a', weight: 100 }] })
    expect(settings.routePools[1]).toMatchObject({ modelId: 'kimi-k3', enabled: true })
  })

  it('preserves dangling targets while excluding them from the executable projection', () => {
    const settings = normalizeModelProviderSettings({
      providers: [{ id: 'provider-a', name: 'A', baseUrl: 'https://a.example', models: ['kimi-k3'] }],
      routePools: [{
        id: 'pool', name: 'Pool', modelId: 'kimi-auto', enabled: true, strategy: 'priority',
        targets: [
          { id: 'valid', providerId: 'provider-a', modelId: 'kimi-k3', enabled: true, weight: 1 },
          { id: 'provider-missing', providerId: 'provider-gone', modelId: 'kimi-k3', enabled: true, weight: 1 },
          { id: 'model-missing', providerId: 'provider-a', modelId: 'kimi-removed', enabled: true, weight: 1 }
        ],
        failurePolicy: { failoverHttpStatusCodes: [429], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: true },
        healthPolicy: { failureThreshold: 3, cooldownMs: 60_000, halfOpenMaxAttempts: 1 }
      }]
    })

    expect(settings.routePools[0].targets).toHaveLength(3)
    expect(resolveModelRouteTargetReference(settings.routePools[0].targets[0], settings.providers).status).toBe('valid')
    expect(resolveModelRouteTargetReference(settings.routePools[0].targets[1], settings.providers).status).toBe('provider-missing')
    expect(resolveModelRouteTargetReference(settings.routePools[0].targets[2], settings.providers).status).toBe('model-missing')
    expect(projectExecutableModelRoutePools(settings)[0]).toMatchObject({
      enabled: true,
      targets: [{ id: 'valid', providerId: 'provider-a', modelId: 'kimi-k3' }]
    })

    const withoutProvider = normalizeModelProviderSettings({
      ...settings,
      providers: [],
      routePools: settings.routePools
    })
    expect(withoutProvider.routePools[0]).toMatchObject({ enabled: true })
    expect(withoutProvider.routePools[0].targets).toHaveLength(3)
    expect(projectExecutableModelRoutePools(withoutProvider)[0]).toMatchObject({ enabled: false, targets: [] })
  })
})

describe('ChatGPT subscription migration', () => {
  it('renames only the legacy default and upgrades exactly the legacy model set', () => {
    const normalized = normalizeModelProviderSettings({
      providers: [{
        id: 'codex',
        name: 'Codex (ChatGPT)',
        apiKey: 'oauth-json',
        baseUrl: 'https://chatgpt.com/backend-api/codex',
        endpointFormat: 'responses',
        models: ['gpt-5.4-mini', 'gpt-5.5', 'gpt-5.3-codex-spark', 'gpt-5.4'],
        modelProfiles: {}
      }]
    })

    const provider = normalized.providers.find((item) => item.id === 'codex')!
    expect(provider.name).toBe('ChatGPT 订阅')
    expect(provider.models).toEqual(CHATGPT_SUBSCRIPTION_MODEL_IDS)
    for (const modelId of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
      expect(provider.modelProfiles[modelId]).toMatchObject({
        contextWindowTokens: 372_000,
        inputModalities: ['text', 'image'],
        outputModalities: ['text'],
        supportsToolCalling: true,
        responsesMode: 'lite'
      })
    }
  })

  it('keeps custom names and custom model collections unchanged', () => {
    const normalized = normalizeModelProviderSettings({
      providers: [{
        id: 'codex',
        name: 'Team subscription',
        apiKey: 'oauth-json',
        baseUrl: 'https://chatgpt.com/backend-api/codex',
        endpointFormat: 'responses',
        models: ['gpt-5.5', 'team-model'],
        modelProfiles: {}
      }]
    })

    expect(normalized.providers.find((item) => item.id === 'codex')).toMatchObject({
      name: 'Team subscription',
      models: ['gpt-5.5', 'team-model']
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
})

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 0.82,
    chatContentMaxWidthPx: 896,
    composerSendKey: 'enter',
    provider: {
      ...defaultModelProviderSettings(),
      providers: [
        ...defaultModelProviderSettings().providers,
        {
          id: 'custom',
          name: 'Custom Provider',
          apiKey: 'sk-custom',
          baseUrl: 'https://custom.example/v1',
          endpointFormat: 'messages',
          models: ['custom-model'],
          modelProfiles: {}
        }
      ]
    },
    agents: {
      kun: {
        ...defaultKunRuntimeSettings(),
        providerId: 'custom',
        model: 'custom-model'
      }
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
    disabledSkillIds: []
  }
}

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

describe('model provider settings', () => {
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

  it('preserves user-edited profiles for preset provider models', () => {
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

    expect(resolved.modelProfiles['gpt-5.5']).toEqual(editedProfile)
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

describe('multi-account provider presets', () => {
  it('allocates stable numbered identities for repeated subscription accounts', () => {
    const kimi = getModelProviderPreset('kimi-code')
    expect(kimi).not.toBeNull()

    const first = modelProviderPresetAccountProfile(kimi!, 'api', [])!
    const second = modelProviderPresetAccountProfile(kimi!, 'api', [first])!
    const renamedSecond = { ...second, name: 'Work Kimi' }
    const third = modelProviderPresetAccountProfile(kimi!, 'api', [first, renamedSecond])!

    expect(first).toMatchObject({
      id: 'kimi-code',
      name: 'Kimi Code',
      presetSource: { presetId: 'kimi-code', mode: 'api' }
    })
    expect(second).toMatchObject({
      id: 'kimi-code-2',
      name: 'Kimi Code 2',
      presetSource: { presetId: 'kimi-code', mode: 'api' }
    })
    expect(third).toMatchObject({ id: 'kimi-code-3', name: 'Kimi Code 3' })
    expect(modelProviderPresetAccountCount(kimi!, 'api', [first, renamedSecond, third])).toBe(3)
  })

  it('avoids global id and display-name collisions while preserving family ordinals', () => {
    const kimi = getModelProviderPreset('kimi-code')!
    const first = modelProviderPresetAccountProfile(kimi, 'api', [])!
    const collisions = [
      first,
      { ...first, id: 'custom-kimi', name: 'Kimi Code 2', presetSource: undefined },
      { ...first, id: 'kimi-code-2', name: 'Unrelated', presetSource: undefined }
    ]

    expect(modelProviderPresetAccountProfile(kimi, 'api', collisions)).toMatchObject({
      id: 'kimi-code-3',
      name: 'Kimi Code 3'
    })
  })

  it('allocates independent Token Plan accounts and retains their preset capabilities', () => {
    const minimax = getModelProviderPreset('minimax')
    expect(minimax?.tokenPlan).toBeDefined()
    const first = modelProviderPresetAccountProfile(minimax!, 'token-plan', [])!
    const second = {
      ...modelProviderPresetAccountProfile(minimax!, 'token-plan', [first])!,
      apiKey: 'sk-second',
      modelProfiles: {}
    }
    const normalized = normalizeModelProviderSettings({ providers: [first, second] })
    const resolved = normalized.providers.find((provider) => provider.id === 'minimax-token-plan-2')!

    expect(first).toMatchObject({
      id: 'minimax-token-plan',
      name: 'MiniMax Token Plan',
      presetSource: { presetId: 'minimax', mode: 'token-plan' }
    })
    expect(resolved).toMatchObject({
      id: 'minimax-token-plan-2',
      name: 'MiniMax Token Plan 2',
      apiKey: 'sk-second',
      presetSource: { presetId: 'minimax', mode: 'token-plan' },
      textToSpeech: expect.objectContaining({ models: expect.arrayContaining(['speech-2.8-hd']) })
    })
    expect(resolved.modelProfiles['minimax-m3']).toEqual(expect.objectContaining({
      supportsToolCalling: true,
      inputModalities: expect.arrayContaining(['image'])
    }))
  })

  it('backfills legacy canonical sources and keeps duplicate account credentials independent', () => {
    const kimi = getModelProviderPreset('kimi-code')!
    const first = { ...modelProviderPresetAccountProfile(kimi, 'api', [])!, apiKey: 'sk-first' }
    const second = {
      ...modelProviderPresetAccountProfile(kimi, 'api', [first])!,
      apiKey: 'sk-second',
      modelProfiles: {}
    }
    const state = settings()
    state.provider = normalizeModelProviderSettings({
      providers: [
        { ...first, presetSource: undefined },
        second
      ]
    })
    state.agents.kun = {
      ...defaultKunRuntimeSettings(),
      providerId: second.id,
      model: second.models[0]
    }

    const normalizedFirst = state.provider.providers.find((provider) => provider.id === first.id)!
    const normalizedSecond = state.provider.providers.find((provider) => provider.id === second.id)!
    expect(resolveModelProviderPresetSource(normalizedFirst)).toMatchObject({
      preset: expect.objectContaining({ id: 'kimi-code' }),
      mode: 'api'
    })
    expect(normalizedFirst.presetSource).toEqual({ presetId: 'kimi-code', mode: 'api' })
    expect(normalizedFirst.apiKey).toBe('sk-first')
    expect(normalizedSecond.apiKey).toBe('sk-second')
    expect(normalizedSecond.modelProfiles['kimi-for-coding']).toEqual(expect.objectContaining({
      supportsToolCalling: true
    }))
    expect(resolveKunRuntimeSettings(state)).toMatchObject({
      apiKey: 'sk-second',
      baseUrl: 'https://api.kimi.com/coding/v1',
      model: 'kimi-for-coding'
    })
  })

  it('does not grant preset behavior to an invalid duplicate source', () => {
    const normalized = normalizeModelProviderSettings({
      providers: [{
        id: 'fake-plan-2',
        name: 'Fake plan',
        presetSource: { presetId: 'missing-preset', mode: 'token-plan' },
        apiKey: 'sk-fake',
        baseUrl: 'https://fake.example/v1',
        endpointFormat: 'chat_completions',
        models: ['fake-model'],
        modelProfiles: {}
      }]
    }).providers.find((provider) => provider.id === 'fake-plan-2')!

    expect(normalized.presetSource).toBeUndefined()
    expect(normalized.modelProfiles).toEqual({})
  })
})

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
      models: ['glm-5.2', 'glm-5.1', 'glm-5-turbo', 'glm-4.7', 'glm-4.5-air'],
      modelProfiles: {
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
      models: ['glm-5.2', 'glm-5.1', 'glm-5', 'glm-5-turbo', 'glm-4.7', 'glm-4.5-air'],
      modelProfiles: {
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
      models: ['kimi-for-coding'],
      modelProfiles: {
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

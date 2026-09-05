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
  MODEL_REQUEST_RETRY_DEFAULTS_VERSION,
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

describe('model provider retry settings', () => {
  it('adds default retry settings to default providers', () => {
    const settings = defaultModelProviderSettings()

    expect(settings.providers[0].retry).toEqual(defaultModelRequestRetrySettings())
    expect(settings.providers[0]?.retry).toEqual({
      maxAttempts: 5,
      initialDelayMs: 3_000,
      httpStatusCodes: [429, 500, 502, 503, 504],
      defaultsVersion: MODEL_REQUEST_RETRY_DEFAULTS_VERSION
    })
  })

  it('uses the common five-retry default for new ChatGPT subscription profiles', () => {
    const preset = getModelProviderPreset('codex')
    expect(preset).not.toBeNull()

    expect(modelProviderPresetProfile(preset!, '').retry).toMatchObject({
      maxAttempts: 5,
      httpStatusCodes: [429, 500, 502, 503, 504],
      defaultsVersion: MODEL_REQUEST_RETRY_DEFAULTS_VERSION
    })
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
          useProxy: false,
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
      httpStatusCodes: [429, 503, 599],
      defaultsVersion: MODEL_REQUEST_RETRY_DEFAULTS_VERSION
    })
  })

  it('upgrades an unversioned legacy status list without changing its retry budget', () => {
    const settings = normalizeModelProviderSettings({
      providers: [{
        id: 'legacy',
        name: 'Legacy',
        apiKey: 'k',
        baseUrl: 'https://example.com/v1',
        endpointFormat: 'chat_completions',
        useProxy: false,
        retry: { maxAttempts: 3, initialDelayMs: 9_000, httpStatusCodes: [429, 503] },
        models: ['m'],
        modelProfiles: {}
      }]
    })

    expect(settings.providers.find((provider) => provider.id === 'legacy')?.retry).toEqual({
      maxAttempts: 3,
      initialDelayMs: 9_000,
      httpStatusCodes: [429, 500, 502, 503, 504],
      defaultsVersion: MODEL_REQUEST_RETRY_DEFAULTS_VERSION
    })
  })

  it('upgrades a stale zero retry budget to the current default', () => {
    const settings = normalizeModelProviderSettings({
      providers: [{
        id: 'legacy-zero',
        name: 'Legacy Zero',
        apiKey: 'k',
        baseUrl: 'https://example.com/v1',
        endpointFormat: 'chat_completions',
        useProxy: false,
        retry: { maxAttempts: 0, initialDelayMs: 3_000, httpStatusCodes: [429, 503] },
        models: ['m'],
        modelProfiles: {}
      }]
    })

    expect(settings.providers.find((provider) => provider.id === 'legacy-zero')?.retry).toMatchObject({
      maxAttempts: 5,
      httpStatusCodes: [429, 500, 502, 503, 504],
      defaultsVersion: MODEL_REQUEST_RETRY_DEFAULTS_VERSION
    })
  })

  it('preserves a current-version explicit retry opt-out', () => {
    const settings = normalizeModelProviderSettings({
      providers: [{
        id: 'disabled',
        name: 'Disabled',
        apiKey: 'k',
        baseUrl: 'https://example.com/v1',
        endpointFormat: 'chat_completions',
        useProxy: false,
        retry: {
          maxAttempts: 0,
          initialDelayMs: 3_000,
          httpStatusCodes: [429, 500, 502, 503, 504],
          defaultsVersion: MODEL_REQUEST_RETRY_DEFAULTS_VERSION
        },
        models: ['m'],
        modelProfiles: {}
      }]
    })

    expect(settings.providers.find((provider) => provider.id === 'disabled')?.retry).toMatchObject({
      maxAttempts: 0,
      defaultsVersion: MODEL_REQUEST_RETRY_DEFAULTS_VERSION
    })
  })

  it('preserves a current-version explicit narrow status list', () => {
    const settings = normalizeModelProviderSettings({
      providers: [{
        id: 'explicit',
        name: 'Explicit',
        apiKey: 'k',
        baseUrl: 'https://example.com/v1',
        endpointFormat: 'chat_completions',
        useProxy: false,
        retry: {
          maxAttempts: 5,
          initialDelayMs: 3_000,
          httpStatusCodes: [429, 503],
          defaultsVersion: MODEL_REQUEST_RETRY_DEFAULTS_VERSION
        },
        models: ['m'],
        modelProfiles: {}
      }]
    })

    expect(settings.providers.find((provider) => provider.id === 'explicit')?.retry).toEqual({
      maxAttempts: 5,
      initialDelayMs: 3_000,
      httpStatusCodes: [429, 503],
      defaultsVersion: MODEL_REQUEST_RETRY_DEFAULTS_VERSION
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
      useProxy: false,
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
      useProxy: false,
      retry: expect.objectContaining({
        maxAttempts: 5,
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
      useProxy: false,
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

  it('removes stale media capabilities that are absent from the current subscription preset', () => {
    const profile = {
      ...modelProviderPresetProfile(getModelProviderPreset('cursor-subscription')!, 'cursor-secret'),
      image: {
        protocol: 'openai-images' as const,
        baseUrl: 'https://stale-images.example/v1',
        models: ['stale-image']
      },
      speech: {
        protocol: 'openai-transcriptions' as const,
        baseUrl: '',
        models: ['gemini-2.5-flash']
      },
      video: {
        protocol: 'minimax-video' as const,
        baseUrl: 'https://stale-video.example/v1',
        models: ['stale-video']
      }
    }
    const normalized = normalizeModelProviderSettings({ providers: [profile] })
    const cursor = normalized.providers.find((provider) => provider.id === 'cursor-subscription')

    expect(cursor?.image).toBeUndefined()
    expect(cursor?.speech).toBeUndefined()
    expect(cursor?.video).toBeUndefined()
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

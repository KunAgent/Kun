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

describe('multi-account provider presets', () => {
  it('defines Ollama Cloud as a key-backed United States subscription with stable accounts', () => {
    const ollama = getModelProviderPreset('ollama')
    expect(ollama).toMatchObject({
      id: 'ollama',
      name: 'Ollama Cloud',
      category: 'subscription',
      subscriptionRegion: 'united-states',
      baseUrl: 'https://ollama.com/v1',
      endpointFormat: 'chat_completions',
      models: [...OLLAMA_CLOUD_MODEL_IDS],
      docsUrl: 'https://docs.ollama.com/cloud',
      apiKeyUrl: 'https://ollama.com/settings/keys'
    })

    const first = modelProviderPresetAccountProfile(ollama!, 'api', [])!
    const second = modelProviderPresetAccountProfile(ollama!, 'api', [first])!
    expect(first).toMatchObject({
      id: 'ollama',
      name: 'Ollama Cloud',
      presetSource: { presetId: 'ollama', mode: 'api' },
      baseUrl: 'https://ollama.com/v1',
      endpointFormat: 'chat_completions',
      useProxy: false,
      models: [...OLLAMA_CLOUD_MODEL_IDS]
    })
    expect(first.models).toContain('gpt-oss:120b')
    expect(modelProviderRequiresApiKey(first)).toBe(true)
    expect(second).toMatchObject({
      id: 'ollama-2',
      name: 'Ollama Cloud 2',
      presetSource: { presetId: 'ollama', mode: 'api' }
    })
  })

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
      model: 'k3'
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
        useProxy: false,
        models: ['fake-model'],
        modelProfiles: {}
      }]
    }).providers.find((provider) => provider.id === 'fake-plan-2')!

    expect(normalized.presetSource).toBeUndefined()
    expect(normalized.modelProfiles).toEqual({})
  })
})

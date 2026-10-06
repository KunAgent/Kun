import { describe, expect, it } from 'vitest'
import type { ModelProviderProfileV1 } from '@shared/app-settings'
import {
  applyProviderModelForm,
  chatModelIdLooksNonText,
  classifyProviderModelIds,
  defaultReasoningProtocolForProvider,
  describeContextWindowTokens,
  newProviderModelForm,
  parseContextWindowInput,
  parsePricingInput,
  providerModelFormForExisting,
  providerModelListEntries,
  removeProviderModel,
  validateProviderModelForm,
  type ProviderModelForm
} from './provider-model-editor'

function provider(overrides: Partial<ModelProviderProfileV1> = {}): ModelProviderProfileV1 {
  return {
    id: 'custom-provider-1',
    name: 'Custom',
    apiKey: 'sk-test',
    baseUrl: 'https://api.example.com/v1',
    endpointFormat: 'chat_completions',
    useProxy: false,
    models: ['model-a'],
    modelProfiles: {},
    ...overrides
  }
}

function chatForm(
  target: ModelProviderProfileV1,
  overrides: Partial<ProviderModelForm> = {}
): ProviderModelForm {
  return { ...newProviderModelForm('chat', target), ...overrides }
}

describe('provider-model-editor', () => {
  it('defaults new chat models to the conservative 32k context window', () => {
    expect(newProviderModelForm('chat', provider()).contextWindowTokens).toBe(32_000)
  })

  it('derives the reasoning protocol from the provider connection', () => {
    expect(defaultReasoningProtocolForProvider(provider())).toBe('deepseek-chat-completions')
    expect(
      defaultReasoningProtocolForProvider(provider({ endpointFormat: 'messages' }))
    ).toBe('anthropic-thinking')
    expect(
      defaultReasoningProtocolForProvider(provider({ endpointFormat: 'responses' }))
    ).toBe('openai-responses')
    expect(
      defaultReasoningProtocolForProvider(
        provider({ id: 'xiaomi', baseUrl: 'https://api.xiaomimimo.com/v1' })
      )
    ).toBe('mimo-chat-completions')
    expect(
      defaultReasoningProtocolForProvider(
        provider({ id: 'zhipu-coding-plan', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4' })
      )
    ).toBe('glm-chat-completions')
    expect(
      defaultReasoningProtocolForProvider(
        provider({ id: 'custom-zai', baseUrl: 'https://api.z.ai/api/coding/paas/v4' })
      )
    ).toBe('glm-chat-completions')
  })

  it('adds a chat model with a normalized capability profile', () => {
    const target = provider()
    const next = applyProviderModelForm(target, chatForm(target, {
      modelId: 'New-Model',
      contextWindowTokens: 256_000,
      maxOutputTokens: 16_000,
      visionInput: true,
      supportsToolCalling: false
    }))
    expect(next.modelProfiles['new-model'].evidence?.contextWindowTokens).toMatchObject({ source: 'user', status: 'declared' })
    expect(next.modelProfiles['new-model'].evidence?.pricing?.status).toBe('unknown')
    expect(next.models).toContain('New-Model')
    const profile = next.modelProfiles['new-model']
    expect(profile).toMatchObject({
      contextWindowTokens: 256_000,
      maxOutputTokens: 16_000,
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      supportsToolCalling: false,
      messageParts: ['text', 'image_url'],
    })
  })

  it('writes reasoning capability with a valid default effort', () => {
    const target = provider()
    const next = applyProviderModelForm(target, chatForm(target, {
      modelId: 'thinker',
      reasoningEnabled: true,
      reasoningEfforts: ['max', 'off', 'high'],
      reasoningDefaultEffort: 'medium',
      reasoningProtocol: 'deepseek-chat-completions'
    }))
    expect(next.modelProfiles['thinker'].reasoning).toEqual({
      supportedEfforts: ['off', 'high', 'max'],
      defaultEffort: 'max',
      requestProtocol: 'deepseek-chat-completions'
    })
  })

  it('keeps catalog pricing and service tiers when editing a chat model', () => {
    const target = provider({
      models: ['priced-model'],
      modelProfiles: {
        'priced-model': {
          inputModalities: ['text'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text'],
          pricing: {
            inputUsdPerMillion: 0.15,
            outputUsdPerMillion: 0.6,
            cacheReadUsdPerMillion: 0.015
          },
          serviceTiers: ['priority']
        }
      }
    })
    const form = {
      ...providerModelFormForExisting(target, 'chat', 'priced-model'),
      modelId: 'renamed-model'
    }
    const next = applyProviderModelForm(target, form)
    expect(next.modelProfiles['priced-model']).toBeUndefined()
    expect(next.modelProfiles['renamed-model']).toMatchObject({
      pricing: {
        inputUsdPerMillion: 0.15,
        outputUsdPerMillion: 0.6,
        cacheReadUsdPerMillion: 0.015
      },
      serviceTiers: ['priority']
    })
  })

  it('prefills pricing fields from an existing chat profile', () => {
    const target = provider({
      models: ['priced'],
      modelProfiles: {
        priced: {
          inputModalities: ['text'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text'],
          pricing: {
            inputUsdPerMillion: 0.3,
            outputUsdPerMillion: 1.2,
            cacheReadUsdPerMillion: 0.03
          }
        }
      }
    })
    expect(providerModelFormForExisting(target, 'chat', 'priced').pricing).toEqual({
      inputUsdPerMillion: 0.3,
      outputUsdPerMillion: 1.2,
      cacheReadUsdPerMillion: 0.03,
      cacheWriteUsdPerMillion: null
    })
    // Models without stored pricing start with the empty (no-price) state.
    expect(providerModelFormForExisting(provider(), 'chat', 'model-a').pricing).toBeNull()
  })

  it('writes pricing into the saved chat profile', () => {
    const target = provider()
    const form = chatForm(target, {
      modelId: 'priced',
      pricing: {
        inputUsdPerMillion: 0.3,
        outputUsdPerMillion: 1.2,
        cacheReadUsdPerMillion: 0.03,
        cacheWriteUsdPerMillion: 0.45
      }
    })
    expect(validateProviderModelForm(form, target)).toEqual([])
    const next = applyProviderModelForm(target, form)
    expect(next.modelProfiles['priced'].pricing).toEqual({
      inputUsdPerMillion: 0.3,
      outputUsdPerMillion: 1.2,
      cacheReadUsdPerMillion: 0.03,
      cacheWriteUsdPerMillion: 0.45
    })
  })

  it('treats empty pricing as a legal no-price state and drops cleared pricing', () => {
    const target = provider({
      models: ['priced'],
      modelProfiles: {
        priced: {
          inputModalities: ['text'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text'],
          pricing: { inputUsdPerMillion: 0.3, outputUsdPerMillion: 1.2 }
        }
      }
    })
    const cleared = { ...providerModelFormForExisting(target, 'chat', 'priced'), pricing: null }
    expect(validateProviderModelForm(cleared, target)).toEqual([])
    expect(applyProviderModelForm(target, cleared).modelProfiles['priced'].pricing).toBeUndefined()

    const fresh = chatForm(provider(), { modelId: 'unpriced', pricing: null })
    expect(applyProviderModelForm(provider(), fresh).modelProfiles['unpriced'].pricing)
      .toBeUndefined()
  })

  it('rejects half-filled, negative or unparsable pricing', () => {
    const target = provider()
    const pricingCases: ProviderModelForm['pricing'][] = [
      // only one of the required pair
      {
        inputUsdPerMillion: 0.3,
        outputUsdPerMillion: null,
        cacheReadUsdPerMillion: null,
        cacheWriteUsdPerMillion: null
      },
      // negative price
      {
        inputUsdPerMillion: -0.5,
        outputUsdPerMillion: 1,
        cacheReadUsdPerMillion: null,
        cacheWriteUsdPerMillion: null
      },
      // unparsable required field (NaN marker)
      {
        inputUsdPerMillion: Number.NaN,
        outputUsdPerMillion: 1,
        cacheReadUsdPerMillion: null,
        cacheWriteUsdPerMillion: null
      },
      // unparsable optional cache field
      {
        inputUsdPerMillion: 0.3,
        outputUsdPerMillion: 1.2,
        cacheReadUsdPerMillion: Number.NaN,
        cacheWriteUsdPerMillion: null
      },
      // cache-only input without the required pair
      {
        inputUsdPerMillion: null,
        outputUsdPerMillion: null,
        cacheReadUsdPerMillion: 0.03,
        cacheWriteUsdPerMillion: null
      }
    ]
    for (const pricing of pricingCases) {
      expect(validateProviderModelForm(chatForm(target, { modelId: 'bad', pricing }), target))
        .toContainEqual({ code: 'invalidPricing' })
    }
    // Zero prices are legal (free tier).
    expect(validateProviderModelForm(chatForm(target, {
      modelId: 'free',
      pricing: {
        inputUsdPerMillion: 0,
        outputUsdPerMillion: 0,
        cacheReadUsdPerMillion: null,
        cacheWriteUsdPerMillion: null
      }
    }), target)).toEqual([])
  })

  it('parses pricing text input', () => {
    expect(parsePricingInput('')).toBeNull()
    expect(parsePricingInput('   ')).toBeNull()
    expect(parsePricingInput('0.15')).toBe(0.15)
    expect(parsePricingInput('$0.50')).toBe(0.5)
    expect(parsePricingInput('1.5e-3')).toBe(0.0015)
    expect(parsePricingInput('abc')).toBeNaN()
    expect(parsePricingInput('-1')).toBe(-1)
  })

  it('renames a chat model and drops the previous profile entry', () => {
    const target = provider({
      models: ['old-name'],
      modelProfiles: {
        'old-name': {
          inputModalities: ['text'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text']
        }
      }
    })
    const form = { ...providerModelFormForExisting(target, 'chat', 'old-name'), modelId: 'new-name' }
    const next = applyProviderModelForm(target, form)
    expect(next.models).toEqual(['new-name'])
    expect(next.modelProfiles['old-name']).toBeUndefined()
    expect(next.modelProfiles['new-name']).toBeDefined()
  })

  it('prefills the form from an existing chat profile', () => {
    const target = provider({
      models: ['seeing-thinker'],
      modelProfiles: {
        'seeing-thinker': {
          aliases: ['st-alias'],
          contextWindowTokens: 1_000_000,
          maxOutputTokens: 32_000,
          inputModalities: ['text', 'image'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text', 'image_url'],
          reasoning: {
            supportedEfforts: ['off', 'high'],
            defaultEffort: 'high',
            requestProtocol: 'mimo-chat-completions'
          }
        }
      }
    })
    const form = providerModelFormForExisting(target, 'chat', 'seeing-thinker')
    expect(form.contextWindowTokens).toBe(1_000_000)
    expect(form.maxOutputTokens).toBe(32_000)
    expect(form.visionInput).toBe(true)
    expect(form.reasoningEnabled).toBe(true)
    expect(form.reasoningEfforts).toEqual(['off', 'high'])
    expect(form.reasoningDefaultEffort).toBe('high')
    expect(form.reasoningProtocol).toBe('mimo-chat-completions')
    expect(form.aliases).toEqual(['st-alias'])
  })

  it('creates the image capability when adding the first image model', () => {
    const target = provider()
    const form = { ...newProviderModelForm('image', target), modelId: 'image-01' }
    const next = applyProviderModelForm(target, form)
    expect(next.image).toEqual({
      protocol: 'openai-images',
      baseUrl: 'https://api.example.com/v1',
      models: ['image-01']
    })
  })

  it('appends speech models to the existing capability', () => {
    const target = provider({
      speech: { protocol: 'mimo-asr', baseUrl: 'https://speech.example.com', models: ['asr-1'] }
    })
    const form = { ...newProviderModelForm('speech', target), modelId: 'asr-2' }
    const next = applyProviderModelForm(target, form)
    expect(next.speech?.models).toEqual(['asr-1', 'asr-2'])
    expect(next.speech?.protocol).toBe('mimo-asr')
  })

  it('creates media generation capabilities when adding non-chat models', () => {
    const target = provider()
    const withTts = applyProviderModelForm(target, {
      ...newProviderModelForm('tts', target),
      modelId: 'speech-2.8-hd'
    })
    expect(withTts.textToSpeech).toEqual({
      protocol: 'openai-speech',
      baseUrl: 'https://api.example.com/v1',
      models: ['speech-2.8-hd']
    })

    const withMusic = applyProviderModelForm(withTts, {
      ...newProviderModelForm('music', withTts),
      modelId: 'music-2.6'
    })
    expect(withMusic.music).toEqual({
      protocol: 'minimax-music',
      baseUrl: 'https://api.example.com/v1',
      models: ['music-2.6']
    })

    const withVideo = applyProviderModelForm(withMusic, {
      ...newProviderModelForm('video', withMusic),
      modelId: 'MiniMax-Hailuo-2.3'
    })
    expect(withVideo.video).toEqual({
      protocol: 'minimax-video',
      baseUrl: 'https://api.example.com/v1',
      models: ['MiniMax-Hailuo-2.3']
    })
  })

  it('lists provider models across chat, image, speech and media capabilities', () => {
    const target = provider({
      models: ['chat-model'],
      image: { protocol: 'openai-images', baseUrl: 'https://api.example.com/v1', models: ['image-01'] },
      speech: { protocol: 'mimo-asr', baseUrl: 'https://api.example.com/v1', models: ['mimo-v2.5-asr'] },
      textToSpeech: { protocol: 'mimo-tts', baseUrl: 'https://api.example.com/v1', models: ['mimo-v2.5-tts'] },
      music: { protocol: 'minimax-music', baseUrl: 'https://api.example.com/v1', models: ['music-2.6'] },
      video: { protocol: 'minimax-video', baseUrl: 'https://api.example.com/v1', models: ['MiniMax-Hailuo-2.3'] }
    })

    expect(providerModelListEntries(target)).toEqual([
      { kind: 'chat', modelId: 'chat-model' },
      { kind: 'image', modelId: 'image-01' },
      { kind: 'speech', modelId: 'mimo-v2.5-asr' },
      { kind: 'tts', modelId: 'mimo-v2.5-tts' },
      { kind: 'music', modelId: 'music-2.6' },
      { kind: 'video', modelId: 'MiniMax-Hailuo-2.3' }
    ])
  })

  it('classifies fetched provider model ids by capability', () => {
    const target = provider({
      image: { protocol: 'openai-images', baseUrl: 'https://api.example.com/v1', models: ['banana-canvas'] },
      speech: { protocol: 'openai-transcriptions', baseUrl: 'https://api.example.com/v1', models: ['legacy-asr'] }
    })

    expect(classifyProviderModelIds(target, [
      'chat-capable',
      'mimo-v2.5-asr',
      'whisper-1',
      'gpt-image-1',
      'banana-canvas',
      'mimo-v2.5-tts',
      'speech-2.8-hd',
      'music-2.6',
      'MiniMax-Hailuo-2.3',
      'text-embedding-3-large',
      'chat-capable'
    ])).toEqual({
      chat: ['chat-capable'],
      image: ['gpt-image-1', 'banana-canvas'],
      speech: ['mimo-v2.5-asr', 'whisper-1'],
      tts: ['mimo-v2.5-tts', 'speech-2.8-hd'],
      music: ['music-2.6'],
      video: ['MiniMax-Hailuo-2.3']
    })
  })

  it('removes chat models together with their profiles, case-insensitively', () => {
    const target = provider({
      models: ['Model-A'],
      modelProfiles: {
        'model-a': {
          inputModalities: ['text'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text']
        }
      }
    })
    const next = removeProviderModel(target, 'chat', 'model-a')
    expect(next.models).toEqual([])
    expect(next.modelProfiles['model-a']).toBeUndefined()
  })

  it('validates ids, duplicates across kinds, context window and efforts', () => {
    const target = provider({
      models: ['chat-1'],
      image: { protocol: 'openai-images', baseUrl: 'https://api.example.com/v1', models: ['img-1'] }
    })
    expect(validateProviderModelForm(chatForm(target, { modelId: '  ' }), target))
      .toContainEqual({ code: 'missingId' })
    expect(validateProviderModelForm(chatForm(target, { modelId: 'CHAT-1' }), target))
      .toContainEqual({ code: 'duplicate', kind: 'chat' })
    expect(validateProviderModelForm(chatForm(target, { modelId: 'img-1' }), target))
      .toContainEqual({ code: 'duplicate', kind: 'image' })
    expect(validateProviderModelForm(
      chatForm(target, { modelId: 'chat-1', originalModelId: 'chat-1' }),
      target
    )).toEqual([])
    expect(validateProviderModelForm(
      chatForm(target, { modelId: 'ok', contextWindowTokens: -5 }),
      target
    )).toContainEqual({ code: 'invalidContextWindow' })
    expect(validateProviderModelForm(
      chatForm(target, { modelId: 'ok', maxOutputTokens: 0 }),
      target
    )).toContainEqual({ code: 'invalidMaxOutput' })
    expect(validateProviderModelForm(
      chatForm(target, { modelId: 'ok', contextWindowTokens: 10_000_001 }),
      target
    )).toContainEqual({ code: 'contextWindowTooLarge', maximum: 10_000_000 })
    expect(validateProviderModelForm(
      chatForm(target, { modelId: 'ok', maxOutputTokens: 1_000_001 }),
      target
    )).toContainEqual({ code: 'maxOutputTooLarge', maximum: 1_000_000 })
    expect(validateProviderModelForm(
      chatForm(target, {
        modelId: 'ok',
        contextWindowTokens: 10_000_000,
        maxOutputTokens: 1_000_000
      }),
      target
    )).toEqual([])
    expect(validateProviderModelForm(
      chatForm(target, { modelId: 'ok', reasoningEnabled: true, reasoningEfforts: [] }),
      target
    )).toContainEqual({ code: 'noReasoningEfforts' })
  })

  it('records explicit parallel, structured, and streaming declarations while preserving unknown fields', () => {
    const target = provider(), form = chatForm(target, { modelId: 'declared', parallelTools: false, structuredOutput: true, streaming: null })
    const declared = applyProviderModelForm(target, form).modelProfiles.declared
    expect(declared).toMatchObject({ parallelTools: false, structuredOutput: true })
    expect(declared.streaming).toBeUndefined()
    expect(declared.evidence?.parallelTools).toMatchObject({ source: 'user', status: 'declared' })
    expect(declared.evidence?.structuredOutput).toMatchObject({ source: 'user', status: 'declared' })
    expect(declared.evidence?.streaming?.status).toBe('unknown')
  })
  it('warns when a chat model id matches non-text patterns', () => {
    const target = provider()
    expect(chatModelIdLooksNonText(chatForm(target, { modelId: 'flux-image-pro' }))).toBe(true)
    expect(chatModelIdLooksNonText(chatForm(target, { modelId: 'deepseek-v4-pro' }))).toBe(false)
  })

  it('parses and formats context window shorthand', () => {
    expect(parseContextWindowInput('128k')).toBe(128_000)
    expect(parseContextWindowInput('1M')).toBe(1_000_000)
    expect(parseContextWindowInput('200,000')).toBe(200_000)
    expect(parseContextWindowInput('0.5m')).toBe(500_000)
    expect(parseContextWindowInput('')).toBeNull()
    expect(parseContextWindowInput('many')).toBeNull()
    expect(describeContextWindowTokens(128_000)).toBe('128K')
    expect(describeContextWindowTokens(1_000_000)).toBe('1M')
    expect(describeContextWindowTokens(24_512)).toBe('24512')
  })
})

import { describe, expect, it } from 'vitest'
import type {
  ModelProviderModelProfileV1,
  ModelProviderProfileV1
} from '@shared/app-settings'
import type { ModelsDevCatalogResult } from '@shared/kun-gui-api'
import {
  buildProviderModelImportEntries,
  defaultSelectedProviderModelImportKeys,
  enrichCursorProviderModelProfiles,
  enrichProviderModelProfiles,
  mergeProviderModelIdsCaseInsensitive,
  providerModelImportEntryKey,
  providerModelImportResult
} from './provider-model-import'

function provider(overrides: Partial<ModelProviderProfileV1> = {}): ModelProviderProfileV1 {
  return {
    id: 'acme',
    name: 'Acme',
    apiKey: 'sk-test',
    baseUrl: 'https://api.example.com/v1',
    endpointFormat: 'chat_completions',
    useProxy: false,
    models: [],
    modelProfiles: {},
    ...overrides
  }
}

function catalog(
  models: Extract<ModelsDevCatalogResult, { status: 'ok' }>['models'],
  matchMode: 'catalog' | 'enrichment-only' = 'catalog'
): ModelsDevCatalogResult {
  return {
    status: 'ok',
    providerKey: 'acme',
    providerName: 'Acme',
    matchMode,
    stale: false,
    models
  }
}

describe('provider model import merging', () => {
  it('deduplicates ids case-insensitively, preserves API casing, and leaves catalog-only rows unchecked', () => {
    const entries = buildProviderModelImportEntries(
      provider(),
      ['Model-A', 'model-a', 'api-only'],
      catalog([
        {
          id: 'model-a',
          inputModalities: ['text', 'image'],
          outputModalities: ['text'],
          toolCalling: true
        },
        {
          id: 'catalog-only',
          inputModalities: ['text'],
          outputModalities: ['text']
        }
      ])
    )

    expect(entries.map((entry) => entry.modelId)).toEqual(['Model-A', 'api-only', 'catalog-only'])
    expect(entries[0]?.sources).toEqual(['provider-api', 'models-dev'])
    expect(entries[2]?.sources).toEqual(['models-dev'])
    const selected = defaultSelectedProviderModelImportKeys(entries)
    expect(selected).toEqual(new Set([
      providerModelImportEntryKey('chat', 'Model-A'),
      providerModelImportEntryKey('chat', 'api-only')
    ]))
  })

  it('uses catalog modalities for endpoint classification before id fallback', () => {
    const entries = buildProviderModelImportEntries(provider(), [], catalog([
      { id: 'visual-maker', inputModalities: ['text'], outputModalities: ['image'] },
      { id: 'sound-reader', inputModalities: ['audio'], outputModalities: ['text'] },
      { id: 'omni-chat', inputModalities: ['text', 'image', 'audio'], outputModalities: ['text'] },
      { id: 'voice-maker', inputModalities: ['text'], outputModalities: ['audio'] },
      { id: 'movie-maker', inputModalities: ['text'], outputModalities: ['video'] },
      { id: 'music-2.6', inputModalities: ['text'], outputModalities: ['audio'] }
    ]))
    expect(entries.map(({ modelId, kind }) => [modelId, kind])).toEqual([
      ['visual-maker', 'image'],
      ['sound-reader', 'speech'],
      ['omni-chat', 'chat'],
      ['voice-maker', 'tts'],
      ['movie-maker', 'video'],
      ['music-2.6', 'music']
    ])
  })

  it('reclassifies an existing speech entry as multimodal chat from explicit catalog metadata', () => {
    const target = provider({
      speech: {
        protocol: 'openai-transcriptions',
        baseUrl: 'https://api.example.com/v1',
        models: ['omni-chat']
      }
    })
    const entries = buildProviderModelImportEntries(target, ['omni-chat'], catalog([{
      id: 'omni-chat',
      inputModalities: ['text', 'image', 'audio'],
      outputModalities: ['text'],
      toolCalling: true
    }]))

    expect(entries[0]).toMatchObject({ kind: 'chat', alreadyExists: false })
    const picked = providerModelImportResult(
      entries,
      defaultSelectedProviderModelImportKeys(entries)
    )
    const profiles = enrichProviderModelProfiles(target, picked.chat, picked.catalogModels)
    expect(picked.chat).toEqual(['omni-chat'])
    expect(picked.speech).toEqual([])
    expect(profiles['omni-chat']).toMatchObject({
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      messageParts: ['text', 'image_url']
    })
  })

  it('keeps enrichment-only catalog rows limited to provider-confirmed ids', () => {
    const entries = buildProviderModelImportEntries(provider(), ['model-a'], catalog([
      { id: 'model-a', inputModalities: ['text'], outputModalities: ['text'] },
      { id: 'catalog-only', inputModalities: ['text'], outputModalities: ['text'] }
    ], 'enrichment-only'))
    expect(entries.map((entry) => entry.modelId)).toEqual(['model-a'])
    expect(entries[0]?.sources).toEqual(['provider-api', 'models-dev'])
  })

  it('imports Ollama Cloud API models while using its catalog only for matching metadata', () => {
    const ollama = provider({
      id: 'ollama',
      name: 'Ollama Cloud',
      baseUrl: 'https://ollama.com/v1'
    })
    const entries = buildProviderModelImportEntries(
      ollama,
      ['gpt-oss:120b', 'ollama-new:model'],
      {
        status: 'ok',
        providerKey: 'ollama-cloud',
        providerName: 'Ollama Cloud',
        matchMode: 'enrichment-only',
        stale: false,
        models: [
          {
            id: 'gpt-oss:120b',
            reasoning: true,
            toolCalling: true,
            inputModalities: ['text'],
            outputModalities: ['text'],
            contextWindowTokens: 131_072,
            maxOutputTokens: 32_768
          },
          {
            id: 'catalog-only',
            inputModalities: ['text'],
            outputModalities: ['text']
          }
        ]
      }
    )

    expect(entries.map((entry) => entry.modelId)).toEqual([
      'gpt-oss:120b',
      'ollama-new:model'
    ])
    expect(entries[0]).toMatchObject({
      sources: ['provider-api', 'models-dev'],
      catalog: {
        id: 'gpt-oss:120b',
        contextWindowTokens: 131_072,
        maxOutputTokens: 32_768
      }
    })
    expect(entries[1]?.sources).toEqual(['provider-api'])

    const picked = providerModelImportResult(
      entries,
      defaultSelectedProviderModelImportKeys(entries)
    )
    const profiles = enrichProviderModelProfiles(ollama, picked.chat, picked.catalogModels)
    expect(picked.chat).toEqual(['gpt-oss:120b', 'ollama-new:model'])
    expect(profiles['gpt-oss:120b']).toMatchObject({
      contextWindowTokens: 131_072,
      maxOutputTokens: 32_768,
      supportsToolCalling: true,
      reasoning: {
        supportedEfforts: ['auto'],
        defaultEffort: 'auto',
        requestProtocol: 'none'
      }
    })
    expect(profiles['ollama-new:model']).toBeUndefined()
  })

  it('can preselect existing ids when the provider list is authoritative', () => {
    const entries = buildProviderModelImportEntries(
      provider({ models: ['old-model', 'current-model'] }),
      ['current-model', 'new-model'],
      catalog([], 'enrichment-only')
    )

    expect(defaultSelectedProviderModelImportKeys(entries, true)).toEqual(new Set([
      providerModelImportEntryKey('chat', 'current-model'),
      providerModelImportEntryKey('chat', 'new-model')
    ]))
  })

  it('returns metadata only for selected rows', () => {
    const entries = buildProviderModelImportEntries(provider(), ['model-a'], catalog([
      { id: 'model-a', inputModalities: ['text'], outputModalities: ['text'] },
      { id: 'catalog-only', inputModalities: ['text'], outputModalities: ['text'] }
    ]))
    const selected = new Set([providerModelImportEntryKey('chat', 'catalog-only')])
    expect(providerModelImportResult(entries, selected)).toEqual({
      chat: ['catalog-only'],
      image: [],
      speech: [],
      tts: [],
      music: [],
      video: [],
      catalogModels: [{
        id: 'catalog-only',
        inputModalities: ['text'],
        outputModalities: ['text']
      }]
    })
  })

  it('merges stored ids without case-only duplicates', () => {
    expect(mergeProviderModelIdsCaseInsensitive(
      ['Existing-Model'],
      ['existing-model', 'New-Model']
    )).toEqual(['Existing-Model', 'New-Model'])
  })
})

describe('models.dev profile enrichment', () => {
  it('adds the Cursor SDK adaptive reasoning default even without catalog metadata', () => {
    const target = provider({ modelProfiles: {} })
    const next = enrichCursorProviderModelProfiles(
      target,
      ['auto', 'composer-2.5'],
      []
    )

    expect(next.auto).toEqual({
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsToolCalling: true,
      messageParts: ['text'],
      reasoning: {
        supportedEfforts: ['auto'],
        defaultEffort: 'auto',
        requestProtocol: 'none'
      }
    })
    expect(next['composer-2.5']?.reasoning).toEqual({
      supportedEfforts: ['auto'],
      defaultEffort: 'auto',
      requestProtocol: 'none'
    })
  })

  it('creates a runtime-safe profile for a new imported chat model', () => {
    const target = provider()
    const next = enrichProviderModelProfiles(
      target,
      ['vision-model'],
      [{
        id: 'vision-model',
        providerKey: 'google',
        inputModalities: ['text', 'image', 'pdf'],
        outputModalities: ['text'],
        contextWindowTokens: 256_000,
        maxOutputTokens: 32_000,
        toolCalling: false,
        reasoning: true,
        description: 'Display-only field'
      }],
      { 'Vision-Model': ['vision-latest'] }
    )
    expect(next['vision-model']).toEqual({
      aliases: ['vision-latest'],
      contextWindowTokens: 256_000,
      maxOutputTokens: 32_000,
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      supportsToolCalling: false,
      messageParts: ['text', 'image_url'],
      reasoning: {
        supportedEfforts: ['auto'],
        defaultEffort: 'auto',
        requestProtocol: 'none'
      }
    })
    expect(next['vision-model']).not.toHaveProperty('description')
  })

  it('refreshes catalog limits on an existing profile and preserves behavior fields', () => {
    const explicitProfile: ModelProviderModelProfileV1 = {
      aliases: ['writer'],
      maxOutputTokens: 4_096,
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsToolCalling: false,
      messageParts: ['text'],
      endpointFormat: 'messages',
      responsesMode: 'lite',
      reasoning: {
        supportedEfforts: ['off', 'high'],
        defaultEffort: 'high',
        requestProtocol: 'anthropic-thinking'
      }
    }
    const target = provider({ modelProfiles: { 'Model-A': explicitProfile } })
    const next = enrichProviderModelProfiles(target, ['model-a'], [{
      id: 'MODEL-A',
      inputModalities: ['text', 'image'],
      outputModalities: ['text', 'image'],
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 128_000,
      toolCalling: true
    }])
    expect(next['Model-A']).toEqual({
      ...explicitProfile,
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 128_000
    })
  })

  it('returns the original profile map when catalog limits are unchanged', () => {
    const profile: ModelProviderModelProfileV1 = {
      contextWindowTokens: 128_000,
      maxOutputTokens: 8_000,
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsToolCalling: true,
      messageParts: ['text']
    }
    const target = provider({ modelProfiles: { 'model-a': profile } })
    expect(enrichProviderModelProfiles(target, ['model-a'], [{
      id: 'model-a',
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindowTokens: 128_000,
      maxOutputTokens: 8_000,
      toolCalling: false
    }])).toBe(target.modelProfiles)
  })

  it('refreshes catalog pricing on an existing profile when it differs', () => {
    const profile: ModelProviderModelProfileV1 = {
      contextWindowTokens: 128_000,
      maxOutputTokens: 8_000,
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsToolCalling: true,
      messageParts: ['text']
    }
    const target = provider({ modelProfiles: { 'model-a': profile } })
    const next = enrichProviderModelProfiles(target, ['model-a'], [{
      id: 'model-a',
      inputModalities: ['text'],
      outputModalities: ['text'],
      contextWindowTokens: 128_000,
      maxOutputTokens: 8_000,
      pricing: { inputUsdPerMillion: 2, outputUsdPerMillion: 6 }
    }])
    expect(next['model-a']?.pricing).toEqual({
      inputUsdPerMillion: 2,
      outputUsdPerMillion: 6
    })
    // Unchanged pricing keeps the original profile map identity.
    expect(enrichProviderModelProfiles(target, ['model-a'], [{
      id: 'model-a',
      inputModalities: ['text'],
      outputModalities: ['text'],
      contextWindowTokens: 128_000,
      maxOutputTokens: 8_000
    }])).toBe(target.modelProfiles)
  })

  it('hydrates existing unprofiled models with current models.dev capabilities', () => {
    const target = provider({ models: ['glm-5.2', 'kimi-k2.5'] })
    const entries = buildProviderModelImportEntries(
      target,
      ['glm-5.2', 'kimi-k2.5'],
      catalog([
        {
          id: 'glm-5.2',
          inputModalities: ['text'],
          outputModalities: ['text'],
          contextWindowTokens: 1_000_000,
          maxOutputTokens: 131_072,
          reasoning: true,
          toolCalling: true,
          pricing: {
            inputUsdPerMillion: 1,
            outputUsdPerMillion: 3,
            cacheReadUsdPerMillion: 0.1
          }
        },
        {
          id: 'kimi-k2.5',
          inputModalities: ['text', 'image', 'video'],
          outputModalities: ['text'],
          contextWindowTokens: 262_144,
          maxOutputTokens: 65_536,
          reasoning: true,
          toolCalling: true
        }
      ])
    )
    const result = providerModelImportResult(entries, new Set())
    const next = enrichProviderModelProfiles(target, target.models, result.catalogModels)

    expect(next['glm-5.2']).toMatchObject({
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 131_072,
      inputModalities: ['text'],
      supportsToolCalling: true,
      reasoning: { requestProtocol: 'none' },
      pricing: {
        inputUsdPerMillion: 1,
        outputUsdPerMillion: 3,
        cacheReadUsdPerMillion: 0.1
      }
    })
    expect(next['kimi-k2.5']).toMatchObject({
      contextWindowTokens: 262_144,
      maxOutputTokens: 65_536,
      inputModalities: ['text', 'image'],
      messageParts: ['text', 'image_url'],
      supportsToolCalling: true,
      reasoning: { requestProtocol: 'none' }
    })
  })

  it('returns metadata for matching existing rows even when no new model is selected', () => {
    const entries = buildProviderModelImportEntries(
      provider({ models: ['glm-5.2'] }),
      ['glm-5.2'],
      catalog([{
        id: 'glm-5.2',
        inputModalities: ['text'],
        outputModalities: ['text'],
        contextWindowTokens: 1_000_000,
        maxOutputTokens: 131_072,
        reasoning: true,
        toolCalling: true
      }])
    )

    expect(providerModelImportResult(entries, new Set()).catalogModels).toHaveLength(1)
  })
})

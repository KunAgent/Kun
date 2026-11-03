import { describe, expect, it } from 'vitest'
import type { ModelProviderModelProfileV1, ModelProviderProfileV1 } from '@shared/app-settings'
import { metadataEvidence } from '../../../../kun/src/contracts/model-metadata-evidence.js'
import { resolveModelMetadata, setModelMetadataOverride, withModelObservation } from '../../../../kun/src/services/model-metadata-resolver.js'
import { applyProviderModelForm, providerModelFormForExisting } from './provider-model-editor'
import { enrichProviderModelProfiles } from './provider-model-import'
import { applyProviderModelImport, mergeDiscoveredModelProfile } from './use-provider-probe-operations'

const empty: ModelProviderModelProfileV1 = { inputModalities: ['text'], outputModalities: ['text'],
  messageParts: ['text'], supportsToolCalling: true, evidence: metadataEvidence({}, 'adapter') }
const provider = (profile: ModelProviderModelProfileV1): ModelProviderProfileV1 => ({
  id: 'fixture', name: 'Fixture', baseUrl: 'https://example.test/v1', apiKey: '', endpointFormat: 'chat_completions',
  useProxy: false, models: ['original'], modelProfiles: { original: profile }
})

describe('model metadata editor and import flow', () => {
  it('renaming preserves automatic capability provenance and native effort mappings', () => {
    const original = withModelObservation(empty, { id: 'provider', source: 'provider', values: {
      contextWindowTokens: 200_000, maxInputTokens: 180_000,
      reasoning: { supportedEfforts: ['high', 'max'], defaultEffort: 'max', requestProtocol: 'openai-responses',
        nativeEfforts: ['high', 'xhigh'], nativeDefaultEffort: 'xhigh', effortMapping: { high: 'high', max: 'xhigh' } }
    } })
    const target = provider(original)
    const form = providerModelFormForExisting(target, 'chat', 'original')
    const updated = applyProviderModelForm(target, { ...form, modelId: 'renamed' }).modelProfiles.renamed
    expect(updated.metadata?.overrides).toEqual({})
    expect(updated.reasoning?.effortMapping?.max).toBe('xhigh')
    expect(updated.evidence?.contextWindowTokens?.source).toBe('provider')
  })
  it('shows the original configured limit even when the runtime snapshot is clamped', () => {
    const upstream = withModelObservation(empty, { id: 'account', source: 'provider', values: { contextWindowTokens: 128_000 } })
    const configured = setModelMetadataOverride(upstream, 'contextWindowTokens', 256_000)
    const target = provider(resolveModelMetadata(configured))
    const form = providerModelFormForExisting(target, 'chat', 'original')
    expect(form.contextWindowTokens).toBe(256_000)
    const saved = applyProviderModelForm(target, form).modelProfiles.original
    expect(saved.metadata?.overrides.contextWindowTokens).toBe(256_000)
    expect(resolveModelMetadata(saved).contextWindowTokens).toBe(128_000)
  })
  it('restoring automatic clears only the selected override', () => {
    const upstream = withModelObservation(empty, { id: 'account', source: 'provider', values: { contextWindowTokens: 200_000, maxOutputTokens: 32_000 } })
    const configured = setModelMetadataOverride(setModelMetadataOverride(upstream, 'contextWindowTokens', 128_000), 'maxOutputTokens', 4_096)
    const target = provider(configured)
    const form = providerModelFormForExisting(target, 'chat', 'original')
    const saved = applyProviderModelForm(target, { ...form, clearedOverrides: ['contextWindowTokens'] }).modelProfiles.original
    expect(saved.metadata?.overrides).toEqual({ maxOutputTokens: 4_096 })
    expect(resolveModelMetadata(saved).contextWindowTokens).toBe(200_000)
  })
  it('keeps inferred cross-provider limits as suggestions until explicitly adopted', () => {
    const catalog = { id: 'original', inputModalities: ['text'] as const, outputModalities: ['text'] as const,
      contextWindowTokens: 1_000_000, matchSpecificity: 'cross-provider' as const }
    const profiles = enrichProviderModelProfiles(provider(empty), ['original'], [{ ...catalog, inputModalities: ['text'], outputModalities: ['text'] }])
    expect(resolveModelMetadata(profiles.original).contextWindowTokens).toBeUndefined()
    const target = provider(profiles.original)
    const form = providerModelFormForExisting(target, 'chat', 'original')
    const saved = applyProviderModelForm(target, { ...form, contextWindowTokens: 1_000_000,
      adoptedSuggestions: { contextWindowTokens: 'models.dev:original' } }).modelProfiles.original
    expect(saved.metadata?.overrides.contextWindowTokens).toBe(1_000_000)
    expect(saved.metadata?.overrideEvidence?.contextWindowTokens?.sourceId).toBe('models.dev:original')
  })
  it('replaces migrated catalog observations instead of letting old exact facts defeat current suggestions', () => {
    const old = { ...empty, contextWindowTokens: 1_000_000,
      evidence: metadataEvidence({ contextWindowTokens: 1_000_000 }, 'catalog', '2025-01-01T00:00:00.000Z') }
    const profiles = enrichProviderModelProfiles(provider(old), ['original'], [{ id: 'original', inputModalities: ['text'], outputModalities: ['text'],
      contextWindowTokens: 200_000, matchSpecificity: 'family' }])
    expect(resolveModelMetadata(profiles.original).contextWindowTokens).toBeUndefined()
    expect(profiles.original.metadata?.observations).toHaveLength(1)
  })

  it('refreshes observations without deleting models or overwriting user limits', () => {
    const target = provider(setModelMetadataOverride(empty, 'maxOutputTokens', 4_096))
    const result = applyProviderModelImport(target, { chat: ['new'], image: [], speech: [], tts: [], music: [], video: [], catalogModels: [] }, true)
    expect(result.models).toEqual(['original', 'new'])
    const refreshed = mergeDiscoveredModelProfile(target.modelProfiles.original, { ...empty, maxOutputTokens: 128_000,
      evidence: metadataEvidence({ maxOutputTokens: 128_000 }, 'provider') })!
    expect(refreshed.maxOutputTokens).toBe(4_096)
    expect(refreshed.metadata?.observations.some((row) => row.values.maxOutputTokens === 128_000)).toBe(true)
  })
})

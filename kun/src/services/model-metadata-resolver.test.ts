import { describe, expect, it } from 'vitest'
import { ModelCapabilityMetadata, type ModelCapabilityFacts, type ModelMetadataObservation } from '../contracts/capabilities-core.js'
import { capabilityFieldKnown, metadataEvidence } from '../contracts/model-metadata-evidence.js'
import { adoptModelMetadataSuggestion, clearModelMetadataOverride, migrateModelMetadata,
  resolveModelMetadata, setModelMetadataOverride, withModelObservation } from './model-metadata-resolver.js'

const blank = () => ({ id: 'exact-model', inputModalities: ['text'] as const, outputModalities: ['text'] as const,
  messageParts: ['text'] as const, supportsToolCalling: true, evidence: metadataEvidence({}, 'adapter') })
const observation = (id: string, source: ModelMetadataObservation['source'], values: ModelCapabilityFacts,
  extra: Partial<ModelMetadataObservation> = {}): ModelMetadataObservation => ({ id, source, values,
  evidence: metadataEvidence(values, source), match: 'exact', observedAt: '2026-10-08T00:00:00.000Z', ...extra })

describe('model metadata migration and resolution', () => {
  it('preserves user 128K/4096 values across catalog replacement, serialization and repeated migration', () => {
    const original = { ...blank(), contextWindowTokens: 128_000, maxOutputTokens: 4096,
      evidence: metadataEvidence({ contextWindowTokens: 128_000, maxOutputTokens: 4096 }, 'user') }
    let profile = withModelObservation(original, observation('public', 'catalog', {
      contextWindowTokens: 1_000_000, maxOutputTokens: 128_000
    }))
    for (let index = 0; index < 3; index++) {
      profile = migrateModelMetadata(JSON.parse(JSON.stringify(profile)))
      profile = withModelObservation(profile, observation('public', 'catalog', {
        contextWindowTokens: 1_000_000 + index, maxOutputTokens: 128_000 + index
      }))
      expect(profile).toMatchObject({ contextWindowTokens: 128_000, maxOutputTokens: 4096 })
      expect(profile.metadata?.overrides).toEqual({ contextWindowTokens: 128_000, maxOutputTokens: 4096 })
      const effective = resolveModelMetadata(profile)
      expect(effective).toMatchObject({ contextWindowTokens: 128_000, maxOutputTokens: 4096 })
      expect(effective.metadataResolution?.contextWindowTokens).toMatchObject({ automaticValue: 1_000_000 + index,
        configuredValue: 128_000, effectiveValue: 128_000, reason: 'user-limit' })
      expect(profile.metadata?.observations).toHaveLength(1)
    }
    expect(original).not.toHaveProperty('metadata')
  })
  it('keeps raw preferences above account limits but sends the smaller known limit', () => {
    let profile = setModelMetadataOverride(blank(), 'contextWindowTokens', 1_000_000)
    profile = setModelMetadataOverride(profile, 'maxInputTokens', 900_000)
    profile = setModelMetadataOverride(profile, 'maxOutputTokens', 128_000)
    profile = withModelObservation(profile, observation('account', 'provider', {
      contextWindowTokens: 128_000, maxInputTokens: 96_000, maxOutputTokens: 4096
    }))
    expect(profile.metadata?.overrides).toEqual({ contextWindowTokens: 1_000_000, maxInputTokens: 900_000, maxOutputTokens: 128_000 })
    expect(profile.contextWindowTokens).toBe(1_000_000)
    const effective = resolveModelMetadata(profile)
    expect(effective).toMatchObject({ contextWindowTokens: 128_000, maxInputTokens: 96_000, maxOutputTokens: 4096 })
    expect(effective.metadataResolution?.maxOutputTokens).toMatchObject({ configuredValue: 128_000,
      automaticValue: 4096, effectiveValue: 4096, source: 'provider', reason: 'provider-limit' })
  })
  it('ranks sources per field and never lets lower priority true replace explicit false', () => {
    let profile = withModelObservation(blank(), observation('directory', 'catalog', {
      contextWindowTokens: 1_000_000, maxInputTokens: 800_000, supportsToolCalling: true
    }))
    profile = withModelObservation(profile, observation('adapter', 'adapter', { contextWindowTokens: 256_000 }))
    profile = withModelObservation(profile, observation('account', 'provider', { contextWindowTokens: 128_000, supportsToolCalling: false }))
    profile = setModelMetadataOverride(profile, 'supportsToolCalling', true)
    expect(resolveModelMetadata(profile)).toMatchObject({ contextWindowTokens: 128_000, maxInputTokens: 128_000, supportsToolCalling: false })
    expect(resolveModelMetadata(profile).metadataResolution?.supportsToolCalling?.reason).toBe('unsupported')
    expect(profile.metadata?.overrides.supportsToolCalling).toBe(true)
  })
  it('preserves explicit false and empty tier arrays while leaving unknown facts unknown', () => {
    const values = { supportsToolCalling: false, serviceTiers: [], maxOutputTokens: 4096 } satisfies ModelCapabilityFacts
    const row = observation('account', 'provider', values)
    row.evidence!.maxOutputTokens = { source: 'provider', status: 'unknown' }
    const result = resolveModelMetadata(withModelObservation(blank(), row))
    expect(result.supportsToolCalling).toBe(false)
    expect(result.serviceTiers).toEqual([])
    expect(result.maxOutputTokens).toBeUndefined()
    expect(capabilityFieldKnown(result, 'maxOutputTokens')).toBe(false)
    expect(capabilityFieldKnown(result, 'inputModalities')).toBe(false)
    expect(result.metadata?.overrides).toEqual({})
  })
  it('does not promote operational defaults omitted from an existing evidence map', () => {
    const profile = withModelObservation(blank(), observation('adapter', 'adapter', {
      contextWindowTokens: 128_000, supportsToolCalling: true
    }, { evidence: { contextWindowTokens: { source: 'adapter', status: 'declared' } } }))
    const effective = resolveModelMetadata(profile)
    expect(effective.contextWindowTokens).toBe(128_000)
    expect(capabilityFieldKnown(effective, 'supportsToolCalling')).toBe(false)
    expect(effective.metadataResolution?.supportsToolCalling?.effectiveValue).toBeUndefined()
  })
  it('does not promote a family-matched field bundled with an exact catalog observation', () => {
    const profile = withModelObservation(blank(), observation('directory', 'catalog', {
      contextWindowTokens: 128_000, maxOutputTokens: 128_000
    }, { evidence: { contextWindowTokens: { source: 'catalog', status: 'declared', match: 'exact' },
      maxOutputTokens: { source: 'catalog', status: 'declared', match: 'family' } } }))
    const effective = resolveModelMetadata(profile)
    expect(effective.contextWindowTokens).toBe(128_000)
    expect(effective.maxOutputTokens).toBeUndefined()
  })
  it('requires adoption of family and alias catalog facts and clears back to automatic', () => {
    let profile = withModelObservation(blank(), observation('same-family', 'catalog', {
      contextWindowTokens: 1_000_000, maxOutputTokens: 128_000
    }, { match: 'family' }))
    profile = withModelObservation(profile, observation('renamed', 'catalog', { maxInputTokens: 900_000 }, { match: 'alias' }))
    expect(resolveModelMetadata(profile).contextWindowTokens).toBeUndefined()
    expect(resolveModelMetadata(profile).maxInputTokens).toBeUndefined()
    expect(resolveModelMetadata(profile).metadataResolution?.contextWindowTokens?.reason).toBe('suggestion-only')
    profile = adoptModelMetadataSuggestion(profile, 'same-family', ['contextWindowTokens'])
    expect(resolveModelMetadata(profile).contextWindowTokens).toBe(1_000_000)
    expect(profile.metadata?.overrides).toEqual({ contextWindowTokens: 1_000_000 })
    expect(profile.metadata?.overrideEvidence?.contextWindowTokens).toMatchObject({ source: 'user', sourceId: 'same-family', match: 'family' })
    profile = clearModelMetadataOverride(profile, 'contextWindowTokens')
    expect(resolveModelMetadata(profile).contextWindowTokens).toBeUndefined()
    expect(profile.metadata?.overrides).toEqual({})
    expect(profile.metadata?.observations).toHaveLength(2)
  })
  it('does not turn other automatic fields into overrides when one field changes', () => {
    let profile = withModelObservation(blank(), observation('account', 'provider', { contextWindowTokens: 128_000,
      maxInputTokens: 100_000, maxOutputTokens: 8192, supportsToolCalling: true }))
    profile = setModelMetadataOverride(profile, 'maxOutputTokens', 4096)
    expect(profile.metadata?.overrides).toEqual({ maxOutputTokens: 4096 })
    profile = withModelObservation(profile, observation('account', 'provider', { contextWindowTokens: 256_000,
      maxInputTokens: 200_000, maxOutputTokens: 16_384, supportsToolCalling: false }))
    expect(resolveModelMetadata(profile)).toMatchObject({ contextWindowTokens: 256_000, maxInputTokens: 200_000,
      maxOutputTokens: 4096, supportsToolCalling: false })
    profile = clearModelMetadataOverride(profile, 'maxOutputTokens')
    expect(profile.maxOutputTokens).toBe(16_384)
    expect(profile.metadata?.overrides).toEqual({})
  })
  it('records explicit clears so inherited preferences cannot resurrect after a refresh', () => {
    let profile = setModelMetadataOverride(blank(), 'maxOutputTokens', 4096)
    profile = clearModelMetadataOverride(profile, 'maxOutputTokens')
    profile = clearModelMetadataOverride(profile, 'maxOutputTokens')
    expect(profile.metadata?.clearedOverrides).toEqual(['maxOutputTokens'])
    profile = migrateModelMetadata(JSON.parse(JSON.stringify(profile)))
    expect(profile.metadata?.clearedOverrides).toEqual(['maxOutputTokens'])
    profile = setModelMetadataOverride(profile, 'maxOutputTokens', 2048)
    expect(profile.metadata?.clearedOverrides).not.toContain('maxOutputTokens')
    expect(profile.metadata?.overrides.maxOutputTokens).toBe(2048)
  })
  it('protects historical explicit facts while not migrating normalization defaults into user overrides', () => {
    const legacy = migrateModelMetadata({ contextWindowTokens: 128_000, maxOutputTokens: 4096 })
    expect(legacy.metadata.overrides).toEqual({ contextWindowTokens: 128_000, maxOutputTokens: 4096 })
    expect(legacy.metadata.overrideEvidence?.contextWindowTokens?.source).toBe('legacy')
    expect(migrateModelMetadata(blank()).metadata.overrides).toEqual({})
    expect(migrateModelMetadata(legacy)).toEqual(legacy)
  })
  it('drops individual invalid optional observed values without rejecting the model descriptor', () => {
    const invalid = { contextWindowTokens: -1, maxInputTokens: Number.NaN, supportsToolCalling: false,
      maxOutputTokens: 4096 } as ModelCapabilityFacts
    const profile = withModelObservation(blank(), observation('account', 'provider', invalid))
    expect(resolveModelMetadata(profile)).toMatchObject({ supportsToolCalling: false, maxOutputTokens: 4096 })
    expect(resolveModelMetadata(profile).contextWindowTokens).toBeUndefined()
    expect(resolveModelMetadata(profile).maxInputTokens).toBeUndefined()
  })
  it('cannot reintroduce oversized values from existing nested metadata after flat normalization', () => {
    const stored = { ...blank(), metadata: { schemaVersion: 1 as const,
      overrides: { maxOutputTokens: 2_000_000, contextWindowTokens: 20_000_000, supportsToolCalling: false },
      observations: [observation('account', 'provider', { contextWindowTokens: 30_000_000, maxInputTokens: 1_000_000 })] } }
    const effective = resolveModelMetadata(stored)
    expect(effective.maxOutputTokens).toBeUndefined()
    expect(effective.contextWindowTokens).toBeUndefined()
    expect(effective.maxInputTokens).toBe(1_000_000)
    expect(effective.metadata?.overrides).toEqual({ supportsToolCalling: false })
    expect(() => setModelMetadataOverride(blank(), 'maxOutputTokens', 2_000_000)).toThrow()
    expect(() => setModelMetadataOverride(blank(), 'contextWindowTokens', 20_000_000)).toThrow()
  })
  it('retains native effort mappings when a user restricts account-supported efforts', () => {
    const upstream = { supportedEfforts: ['low', 'high', 'max'] as const, defaultEffort: 'max' as const,
      requestProtocol: 'openai-responses' as const, nativeEfforts: ['low', 'high', 'xhigh'], nativeDefaultEffort: 'xhigh', effortMapping: { max: 'xhigh' } }
    let profile = withModelObservation(blank(), observation('account', 'provider', { reasoning: { ...upstream, supportedEfforts: [...upstream.supportedEfforts] } }))
    profile = setModelMetadataOverride(profile, 'reasoning', { supportedEfforts: ['medium', 'max'], defaultEffort: 'medium', requestProtocol: 'openai-responses' })
    expect(resolveModelMetadata(profile).reasoning).toMatchObject({ supportedEfforts: ['max'], defaultEffort: 'max',
      nativeDefaultEffort: 'xhigh', effortMapping: { max: 'xhigh' } })
    profile = withModelObservation(profile, observation('account', 'provider', { supportsReasoning: false }))
    expect(resolveModelMetadata(profile).reasoning).toBeUndefined()
    expect(profile.metadata?.overrides.reasoning).toBeDefined()
  })
  it('does not automatically take a transport protocol from public catalog facts', () => {
    const profile = withModelObservation(blank(), observation('directory', 'catalog', { endpointFormat: 'messages' }))
    expect(resolveModelMetadata(profile).endpointFormat).toBeUndefined()
  })
  it('keeps directory reasoning levels informational until a trusted transport mapping exists', () => {
    const directory = { supportedEfforts: ['low', 'high'] as const, defaultEffort: 'high' as const,
      requestProtocol: 'anthropic-thinking' as const }
    const profile = withModelObservation(blank(), observation('directory', 'catalog', {
      reasoning: { ...directory, supportedEfforts: [...directory.supportedEfforts] }
    }))
    const effective = resolveModelMetadata(profile)
    expect(effective.reasoning?.requestProtocol).toBe('none')
    expect(effective.metadataResolution?.reasoning?.effectiveValue).toEqual(effective.reasoning)
  })
  it('preserves an explicit user requestProtocol none despite a known adapter mapping', () => {
    const adapter = { supportedEfforts: ['low', 'high'] as const, defaultEffort: 'high' as const,
      requestProtocol: 'openai-chat-completions' as const }
    let profile = withModelObservation(blank(), observation('adapter', 'adapter', {
      reasoning: { ...adapter, supportedEfforts: [...adapter.supportedEfforts] }
    }))
    profile = setModelMetadataOverride(profile, 'reasoning', { supportedEfforts: ['auto'], defaultEffort: 'auto', requestProtocol: 'none' })
    expect(resolveModelMetadata(profile).reasoning?.requestProtocol).toBe('none')
  })
  it('keeps an unsupported empty modality intersection schema-valid', () => {
    let profile = withModelObservation(blank(), observation('account', 'provider', { inputModalities: ['text'], messageParts: ['text'] }))
    profile = setModelMetadataOverride(profile, 'inputModalities', ['image'])
    const effective = resolveModelMetadata(profile)
    expect(effective.inputModalities).toEqual([])
    expect(ModelCapabilityMetadata.safeParse(effective).success).toBe(true)
  })
  it('preserves source account binding when migrating an old provider observation', () => {
    const profile = migrateModelMetadata({ maxInputTokens: 128_000, evidence: {
      maxInputTokens: { source: 'provider' as const, status: 'declared' as const,
        scope: 'old-account', observedAt: '2026-10-07T00:00:00.000Z', stale: true }
    } })
    expect(profile.metadata.observations[0]).toMatchObject({ scope: 'old-account', observedAt: '2026-10-07T00:00:00.000Z', stale: true })
  })
})

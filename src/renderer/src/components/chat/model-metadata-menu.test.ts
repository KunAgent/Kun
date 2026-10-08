import { describe, expect, it } from 'vitest'
import type { ModelProviderModelProfileV1 } from '@shared/app-settings'
import { modelProviderModelProfile, modelReasoningEfforts } from '@shared/app-settings-provider-core'
import { metadataEvidence } from '../../../../../kun/src/contracts/model-metadata-evidence.js'
import { withModelObservation, setModelMetadataOverride } from '../../../../../kun/src/services/model-metadata-resolver.js'
import { modelProfileForModel, modelProfileForSelection, normalizeComposerReasoningEffort, reasoningOptionsForModel } from './floating-composer-model-picker-logic'

const empty: ModelProviderModelProfileV1 = { inputModalities: ['text'], outputModalities: ['text'], messageParts: ['text'],
  supportsToolCalling: true, evidence: metadataEvidence({}, 'adapter') }

describe('effective capabilities in model menus', () => {
  it('uses the account limit and allowed efforts while retaining the saved user preference', () => {
    const automatic = withModelObservation(empty, { id: 'account', source: 'provider', values: {
      contextWindowTokens: 128_000, reasoning: { supportedEfforts: ['high', 'max'], defaultEffort: 'high', requestProtocol: 'openai-responses' }
    } })
    const profile = setModelMetadataOverride(setModelMetadataOverride(automatic, 'contextWindowTokens', 256_000), 'reasoning', {
      supportedEfforts: ['low', 'medium', 'high', 'max'], defaultEffort: 'medium', requestProtocol: 'openai-responses'
    })
    const provider = { modelProfiles: { model: { ...profile, aliases: ['alias'] } } }
    expect(modelProviderModelProfile(provider, 'model')?.contextWindowTokens).toBe(128_000)
    expect(modelProfileForModel(provider, 'alias')?.contextWindowTokens).toBe(128_000)
    expect(modelReasoningEfforts(profile)?.supportedEfforts).toEqual(['high', 'max'])
    expect(reasoningOptionsForModel(profile).map((option) => option.id)).toEqual(['high', 'max'])
    expect(normalizeComposerReasoningEffort('medium', profile)).toBe('high')
    expect(profile.metadata?.overrides.contextWindowTokens).toBe(256_000)
  })
  it('does not invent depth settings for unknown or boolean-only reasoning', () => {
    expect(reasoningOptionsForModel(undefined).map((option) => option.id)).toEqual(['auto'])
    expect(reasoningOptionsForModel({ supportsReasoning: true }).map((option) => option.id)).toEqual(['auto'])
    expect(normalizeComposerReasoningEffort('max', { supportsReasoning: true })).toBe('auto')
    expect(reasoningOptionsForModel({ supportsReasoning: false }).map((option) => option.id)).toEqual(['off'])
    expect(normalizeComposerReasoningEffort('max', { supportsReasoning: false })).toBe('off')
  })
  it('does not borrow another connection profile when the selected account has no metadata', () => {
    expect(modelProfileForSelection([
      { providerId: 'selected', label: 'Selected', modelIds: ['model'], modelProfiles: {} },
      { providerId: 'other', label: 'Other', modelIds: ['model'], modelProfiles: { model: { ...empty, contextWindowTokens: 1_000_000 } } }
    ], 'model', 'selected')).toBeUndefined()
  })
})

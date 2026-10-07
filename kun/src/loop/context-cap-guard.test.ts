import { describe, expect, it } from 'vitest'
import { metadataEvidence } from '../contracts/model-metadata-evidence.js'
import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import {
  assumedWindowOutputBudget,
  contextWindowIsAssumed,
  describeContextCapFailure,
  sourceResultBudgetTokensFor
} from './context-cap-guard.js'
import { modelCapabilitiesForModel, modelContextProfilesFromConfig } from './model-context-profile.js'
import { mergeModelContextProfiles } from './model-context-profile-merge.js'

const declared: ModelCapabilityMetadata = {
  id: 'declared',
  inputModalities: ['text'],
  outputModalities: ['text'],
  supportsToolCalling: true,
  contextWindowTokens: 32_000,
  messageParts: ['text']
}
const assumed: ModelCapabilityMetadata = { ...declared, id: 'assumed', evidence: metadataEvidence({}, 'adapter') }
const over = { inputTokens: 44_000, outputBudgetTokens: 1, outputReserveTokens: 6_800, requestHardCapTokens: 27_200 }

describe('context cap guard', () => {
  it('treats an unregistered model window as assumed and a declared one as fact', () => {
    expect(contextWindowIsAssumed(modelCapabilitiesForModel('never-heard-of-it', []))).toBe(true)
    expect(contextWindowIsAssumed(declared)).toBe(false)
  })

  it('relaxes the guard only for an assumed window that the request outgrew', () => {
    expect(assumedWindowOutputBudget(assumed, over)).toBe(6_800)
    expect(assumedWindowOutputBudget(declared, over)).toBeUndefined()
    expect(assumedWindowOutputBudget(assumed, { ...over, inputTokens: 1_000 })).toBeUndefined()
  })

  it('gives source tools a usable page when an assumed window is already full', () => {
    const budget = { inputTokens: 44_000, outputReserveTokens: 6_800, requestHardCapTokens: 27_200 }
    expect(sourceResultBudgetTokensFor(declared, budget)).toBe(0)
    expect(sourceResultBudgetTokensFor(assumed, budget)).toBe(8_000)
    expect(sourceResultBudgetTokensFor(assumed, { ...budget, inputTokens: 1_000 })).toBe(19_400)
  })

  it('names the reason when a declared cap is still exceeded', () => {
    const failure = describeContextCapFailure({
      ...over, fallbackCompactionAttempted: true, fallbackCompactionApplied: false
    })
    expect(failure.reason).toBe('no_compactable_history')
    expect(failure.message).toContain('request exceeds the 27200-token context cap')
    expect(failure.message).toContain('over by 16801')
  })
})

describe('mergeModelContextProfiles', () => {
  const global = modelContextProfilesFromConfig({
    models: { profiles: { 'deepseek-v4.1-flash-expires-on-0910': { contextWindowTokens: 1_000_000 } } }
  })
  const scoped = modelContextProfilesFromConfig({ models: { profiles: {} } })

  it('lets a global profile cover a model the provider does not describe', () => {
    const model = 'deepseek-v4.1-flash-expires-on-0910'
    expect(modelCapabilitiesForModel(model, scoped).contextWindowTokens).toBe(32_000)
    expect(modelCapabilitiesForModel(model, mergeModelContextProfiles(scoped, global)).contextWindowTokens)
      .toBe(1_000_000)
  })

  it('keeps the provider-scoped profile when both describe the model', () => {
    const model = 'deepseek-v4.1-flash-expires-on-0910'
    const provider = modelContextProfilesFromConfig({
      models: { profiles: { [model]: { contextWindowTokens: 128_000 } } }
    })
    expect(modelCapabilitiesForModel(model, mergeModelContextProfiles(provider, global)).contextWindowTokens)
      .toBe(128_000)
  })

  it('returns the provider profiles untouched when nothing is missing', () => {
    expect(mergeModelContextProfiles(global, global)).toBe(global)
    expect(mergeModelContextProfiles(scoped, [])).toBe(scoped)
  })
})

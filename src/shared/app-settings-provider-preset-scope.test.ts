import { describe, expect, it } from 'vitest'
import { getModelProviderPreset, modelProviderPresetProfile } from './app-settings'
import { defaultModelProviderProfile, normalizeModelProviderProfile } from './app-settings-provider-profiles'
import { resolveModelMetadata, setModelMetadataOverride } from '../../kun/src/services/model-metadata-resolver.js'

describe('preset capability endpoint scope', () => {
  it('scopes the built-in DeepSeek default independently from catalog preset identities', () => {
    const official = normalizeModelProviderProfile(defaultModelProviderProfile('', 'https://api.deepseek.com'))!
    expect(resolveModelMetadata(official.modelProfiles['deepseek-v4-pro']).contextWindowTokens).toBe(1_000_000)
    const foreign = normalizeModelProviderProfile({ ...official, baseUrl: 'https://relay.example/v1' })!
    expect(resolveModelMetadata(foreign.modelProfiles['deepseek-v4-pro']).contextWindowTokens).toBeUndefined()
  })

  it('removes identified preset observations after the connection uses a foreign endpoint', () => {
    const preset = modelProviderPresetProfile(getModelProviderPreset('opencode-go')!, '')
    const saved = normalizeModelProviderProfile(preset)!
    expect(resolveModelMetadata(saved.modelProfiles['deepseek-v4-pro']).contextWindowTokens).toBe(1_000_000)
    const changed = normalizeModelProviderProfile({ ...saved, baseUrl: 'https://relay.example/v1' })!
    expect(resolveModelMetadata(changed.modelProfiles['deepseek-v4-pro']).contextWindowTokens).toBeUndefined()
    expect(changed.modelProfiles['deepseek-v4-pro'].metadata?.observations.some((row) => row.source === 'adapter')).toBe(false)
  })
  it('keeps explicit user limits and unknown historical values across endpoint changes', () => {
    const preset = modelProviderPresetProfile(getModelProviderPreset('opencode-go')!, '')
    const profile = setModelMetadataOverride(preset.modelProfiles['deepseek-v4-pro'], 'contextWindowTokens', 128_000)
    const changed = normalizeModelProviderProfile({ ...preset, baseUrl: 'https://relay.example/v1', modelProfiles: { 'deepseek-v4-pro': profile } })!
    expect(changed.modelProfiles['deepseek-v4-pro'].metadata?.overrides.contextWindowTokens).toBe(128_000)
    expect(resolveModelMetadata(changed.modelProfiles['deepseek-v4-pro']).contextWindowTokens).toBe(128_000)
  })
  it('invalidates preset metadata for a foreign protocol-specific override too', () => {
    const preset = modelProviderPresetProfile(getModelProviderPreset('opencode-go')!, '')
    const changed = normalizeModelProviderProfile({ ...preset, endpoints: { chat_completions: 'https://relay.example/v1' } })!
    expect(resolveModelMetadata(changed.modelProfiles['deepseek-v4-pro']).contextWindowTokens).toBeUndefined()
  })
})

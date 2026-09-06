import { describe, expect, it } from 'vitest'
import {
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  mergeModelProviderSettings,
  normalizeModelProviderSettings
} from '@shared/app-settings'
import {
  modelProviderDeletionKunPatch,
  modelProvidersSettingsPatch
} from './settings-section-providers-profile'

describe('explicit built-in provider deletion', () => {
  it.each(['deepseek', 'opencode-free'])('keeps %s removed across saves and reloads', (id) => {
    const current = defaultModelProviderSettings()
    current.apiKey = 'legacy-default-key'
    const remaining = current.providers.filter((provider) => provider.id !== id)
    const patch = modelProvidersSettingsPatch({ provider: current, providers: remaining })
    const saved = mergeModelProviderSettings(current, patch.provider)
    const reloaded = normalizeModelProviderSettings(JSON.parse(JSON.stringify(saved)))

    expect(reloaded.providers.map((provider) => provider.id)).toEqual(remaining.map((provider) => provider.id))
    expect(reloaded.excludedBuiltinProviderIds).toEqual([id])
    if (id === 'deepseek') expect(reloaded.apiKey).toBe('')
    expect(mergeModelProviderSettings(reloaded, { proxy: { enabled: false } }).providers)
      .toEqual(reloaded.providers)
  })

  it('allows an empty provider list after explicit deletion without changing first-run defaults', () => {
    const current = defaultModelProviderSettings()
    const patch = modelProvidersSettingsPatch({ provider: current, providers: [] })
    const saved = mergeModelProviderSettings(current, patch.provider)
    expect(normalizeModelProviderSettings(JSON.parse(JSON.stringify(saved))).providers).toEqual([])
    expect(normalizeModelProviderSettings(undefined).providers).toHaveLength(2)
    expect(normalizeModelProviderSettings({ providers: [] }).providers).toHaveLength(2)
  })

  it.each(['deepseek', 'opencode-free'])('allows %s to be explicitly added again', (id) => {
    const current = normalizeModelProviderSettings({
      providers: [], excludedBuiltinProviderIds: ['deepseek', 'opencode-free']
    })
    const added = defaultModelProviderSettings().providers.find((provider) => provider.id === id)!
    const patch = modelProvidersSettingsPatch({ provider: current, providers: [added] })
    const restored = mergeModelProviderSettings(current, patch.provider)
    expect(restored.providers.map((provider) => provider.id)).toEqual([id])
    expect(restored.excludedBuiltinProviderIds).not.toContain(id)
  })

  it.each(['deepseek', ''])('clears the last provider and legacy credentials for selection "%s"', (providerId) => {
    const currentKun = { ...defaultKunRuntimeSettings(), providerId, apiKey: 'old-key' }
    expect(modelProviderDeletionKunPatch({ currentKun, deletedProviderIds: new Set(['deepseek']) }))
      .toMatchObject({ providerId: '', apiKey: '', baseUrl: '' })
  })
})

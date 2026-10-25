import { describe, expect, it } from 'vitest'
import { delegatedContextProfile } from './delegated-context-profile.js'
import { modelContextProfilesByProvider } from './runtime-factory-model.js'
import {
  DEFAULT_CONTEXT_THRESHOLDS,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  modelCapabilitiesForModel,
  modelContextProfilesFromConfig
} from '../loop/model-context-profile.js'
import type { KunServeRuntimeOptions } from './runtime-factory-types.js'

const CLAUDE_PROVIDER = 'claude-subscription'

// Mirrors what the GUI writes for the Claude subscription preset: the window is
// declared on the provider (`modelCapabilities` + `modelProfiles`), not in the
// global built-in profile table.
const providers: NonNullable<KunServeRuntimeOptions['providers']> = {
  [CLAUDE_PROVIDER]: {
    apiKey: '',
    baseUrl: 'https://api.anthropic.com',
    kind: 'agent-sdk',
    presetSource: CLAUDE_PROVIDER,
    models: ['claude-haiku-4-5', 'claude-sonnet-4-6'],
    modelCapabilities: {
      'claude-haiku-4-5': {
        id: 'claude-haiku-4-5',
        contextWindowTokens: 200_000,
        inputModalities: ['text', 'image'],
        outputModalities: ['text'],
        supportsToolCalling: true,
        messageParts: ['text']
      }
    },
    modelProfiles: {
      'claude-haiku-4-5': { contextWindowTokens: 200_000 }
    }
  }
}

function resolve(model: string, providerId?: string) {
  const globalProfiles = modelContextProfilesFromConfig({})
  const byProvider = modelContextProfilesByProvider(providers)
  return delegatedContextProfile({
    model,
    ...(providerId ? { providerId } : {}),
    defaults: DEFAULT_CONTEXT_THRESHOLDS,
    providers,
    profilesForProvider: (id) =>
      id ? byProvider.get(id.trim().toLowerCase()) ?? globalProfiles : globalProfiles,
    modelCapabilities: (model, id) => modelCapabilitiesForModel(
      model,
      id ? byProvider.get(id.trim().toLowerCase()) ?? globalProfiles : globalProfiles
    )
  })
}

describe('delegatedContextProfile', () => {
  it('uses the provider-declared window for a third-party agent model', () => {
    const profile = resolve('claude-haiku-4-5', CLAUDE_PROVIDER)

    expect(profile.contextWindowTokens).toBe(200_000)
    // Thresholds follow the declared window, not the assumed default window.
    expect(profile.softThresholdTokens).toBeLessThan(DEFAULT_CONTEXT_THRESHOLDS.softThreshold)
    expect(profile.softThresholdTokens).toBe(150_000)
    expect(profile.hardThresholdTokens).toBeLessThanOrEqual(200_000)
  })

  it('falls back to the assumed default window when no provider scope is known', () => {
    const profile = resolve('claude-haiku-4-5')

    expect(profile.contextWindowTokens).toBe(DEFAULT_CONTEXT_WINDOW_TOKENS)
  })

  it('does not leak one provider\'s window into an unrelated provider', () => {
    const profile = resolve('claude-haiku-4-5', 'some-other-provider')

    expect(profile.contextWindowTokens).toBe(DEFAULT_CONTEXT_WINDOW_TOKENS)
  })
})

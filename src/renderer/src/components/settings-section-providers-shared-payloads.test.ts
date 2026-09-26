import { describe, expect, it } from 'vitest'
import type { ModelProviderProfileV1 } from '@shared/app-settings'
import {
  sharedConnectionConnectFields,
  sharedConnectionProfilePatch
} from './settings-section-providers-shared-payloads'

function provider(overrides: Partial<ModelProviderProfileV1> = {}): ModelProviderProfileV1 {
  return {
    id: 'relay-1',
    name: 'Relay',
    apiKey: 'sk-test',
    baseUrl: 'https://relay.example.com/v1',
    endpointFormat: 'chat_completions',
    useProxy: false,
    retry: { enabled: false, maxAttempts: 0, initialDelayMs: 0, maxDelayMs: 0 },
    models: [],
    modelProfiles: {},
    ...overrides
  } as ModelProviderProfileV1
}

describe('sharedConnectionProfilePatch', () => {
  it('carries per-protocol endpoint overrides', () => {
    const patch = sharedConnectionProfilePatch(provider({
      endpoints: {
        chat_completions: 'https://relay.example.com/openai/v1',
        messages: 'https://relay.example.com/anthropic'
      }
    }))
    expect(patch.endpoints).toEqual({
      chat_completions: 'https://relay.example.com/openai/v1',
      messages: 'https://relay.example.com/anthropic'
    })
  })

  it('sends an empty endpoints record when overrides are cleared', () => {
    expect(sharedConnectionProfilePatch(provider()).endpoints).toEqual({})
    expect(sharedConnectionProfilePatch(provider({ endpoints: {} })).endpoints).toEqual({})
  })
})

describe('sharedConnectionConnectFields', () => {
  it('forwards endpoint overrides on connect', () => {
    const fields = sharedConnectionConnectFields(provider({
      endpoints: { responses: 'https://relay.example.com/oai/responses' }
    }))
    expect(fields).toMatchObject({
      id: 'relay-1',
      baseUrl: 'https://relay.example.com/v1',
      endpointFormat: 'chat_completions',
      endpoints: { responses: 'https://relay.example.com/oai/responses' }
    })
  })

  it('omits endpoints noise when the provider has none', () => {
    expect(sharedConnectionConnectFields(provider())).not.toHaveProperty('endpoints')
  })
})

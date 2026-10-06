import { describe, expect, it } from 'vitest'
import { PROVIDER_CATALOG, validateProviderCatalog } from './index.js'

const descriptor = { schemaVersion: 1, id: 'custom-api', name: 'Custom API', category: 'api',
  kind: 'http', authFlow: 'api-key', authType: 'api-key', baseUrl: 'https://example.test/v1',
  endpointFormat: 'chat_completions', models: [], docsUrl: 'https://example.test/docs',
  credentialUrl: 'https://example.test/keys' }

describe('declarative provider definitions', () => {
  it('validates the complete builtin catalog without losing connection defaults', () => {
    expect(PROVIDER_CATALOG.length).toBeGreaterThan(40)
    expect(PROVIDER_CATALOG.find((entry) => entry.id === 'litellm')).toMatchObject({
      kind: 'http', baseUrl: 'http://localhost:4000', endpointFormat: 'chat_completions'
    })
    expect(validateProviderCatalog([descriptor])[0]).not.toHaveProperty('schemaVersion')
  })
  it('rejects duplicate identities, executable hooks, credentials and unsupported protocols', () => {
    expect(() => validateProviderCatalog([descriptor, descriptor])).toThrow('duplicate')
    for (const patch of [{ apiKey: 'secret' }, { execute: 'command' }, { endpointFormat: 'unknown' },
      { baseUrl: 'https://name:secret@example.test' }, { models: ['same', 'same'] }, { schemaVersion: 2 }]) {
      expect(() => validateProviderCatalog([{ ...descriptor, ...patch }])).toThrow()
    }
  })
})

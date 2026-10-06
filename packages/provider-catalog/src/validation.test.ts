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
      { baseUrl: 'https://name:secret@example.test' }, { models: ['same', 'same'] }, { schemaVersion: 3 }, { regions: [] }, { endpoints: {} }]) {
      expect(() => validateProviderCatalog([{ ...descriptor, ...patch }])).toThrow()
    }
  })
  it('accepts schema v2 picker, endpoint and observation metadata only under v2', () => {
    const v2 = { ...descriptor, schemaVersion: 2, origin: 'relay', balance: 'new-api', headerHints: ['x-workspace'],
      endpoints: { chat_completions: 'https://example.test/v1', messages: 'https://example.test' },
      regions: [{ id: 'cn', name: 'China', baseUrl: 'https://example.test/v1' }, { id: 'eu', baseUrl: 'https://eu.example.test/v1' }] }
    expect(validateProviderCatalog([v2])[0]).toMatchObject({ origin: 'relay', balance: 'new-api' })
    expect(() => validateProviderCatalog([{ ...v2, schemaVersion: 1 }])).toThrow('Unknown provider field')
    expect(() => validateProviderCatalog([{ ...v2, headerHints: ['Authorization'] }])).toThrow('credential')
    expect(() => validateProviderCatalog([{ ...v2, regions: [{ id: 'eu', baseUrl: 'https://eu.example.test/v1' }] }]))
      .toThrow('first')
    expect(() => validateProviderCatalog([{ ...v2, endpoints: { chat_completions: 'https://example.test/v1?key=1' } }])).toThrow()
    expect(() => validateProviderCatalog([{ ...v2, noList: true }])).toThrow('declare its models')
    expect(() => validateProviderCatalog([{ ...v2, balance: 'scrape' }])).toThrow('balance')
  })
})

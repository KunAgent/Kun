import { describe, expect, it } from 'vitest'
import {
  createProviderCapabilityCacheKey,
  ProviderCapabilityCache
} from './provider-capability-cache.js'

describe('createProviderCapabilityCacheKey', () => {
  it('normalizes non-secret provider configuration and strips URL query/hash', () => {
    const key = createProviderCapabilityCacheKey({
      providerId: '  openai  ',
      accountId: ' account-1 ',
      baseUrl: 'https://api.example.com/v1?api_key=should-not-be-cached#model',
      endpointFormat: ' chat ',
      credentialVersion: ' 3 ',
      providerVersion: '2026-07'
    })
    expect(key).toBe(
      JSON.stringify({
        providerId: 'openai',
        accountId: 'account-1',
        baseUrl: 'https://api.example.com/v1',
        endpointFormat: 'chat',
        credentialVersion: '3',
        providerVersion: '2026-07'
      })
    )
    expect(key).not.toContain('should-not-be-cached')
  })

  it('rejects credentials, malformed URLs, and control characters', () => {
    expect(() => createProviderCapabilityCacheKey({ providerId: 'openai', baseUrl: 'https://user:pass@example.com' })).toThrow()
    expect(() => createProviderCapabilityCacheKey({ providerId: 'openai', baseUrl: 'not-a-url' })).toThrow()
    expect(() => createProviderCapabilityCacheKey({ providerId: 'openai\n' })).toThrow()
    expect(() => createProviderCapabilityCacheKey({ providerId: '\topenai' })).toThrow()
  })
})

describe('ProviderCapabilityCache', () => {
  const key = { providerId: 'openai', baseUrl: 'https://api.example.com/v1', credentialVersion: '1' }

  it('returns fresh values and expires them after the configured TTL', () => {
    let now = 100
    const cache = new ProviderCapabilityCache({ ttlMs: 10, now: () => now })
    cache.set(key, { vision: true })
    expect(cache.get(key)).toEqual({ vision: true })
    now = 110
    expect(cache.get(key)).toBeUndefined()
    expect(cache.size).toBe(0)
  })

  it('does not count expired entries before they are read', () => {
    let now = 0
    const cache = new ProviderCapabilityCache({ ttlMs: 10, now: () => now })
    cache.set(key, { vision: true })
    now = 10
    expect(cache.size).toBe(0)
  })

  it('invalidates explicitly and separates credential/config fingerprints', () => {
    const cache = new ProviderCapabilityCache<{ models: string[] }>()
    cache.set(key, { models: ['a'] })
    expect(cache.get({ ...key, credentialVersion: '2' })).toBeUndefined()
    expect(cache.invalidate(key)).toBe(true)
    expect(cache.invalidate(key)).toBe(false)
  })

  it('evicts the least recently touched entry when capacity is reached', () => {
    let now = 0
    const cache = new ProviderCapabilityCache({ maxEntries: 2, now: () => now })
    const first = { providerId: 'first' }
    const second = { providerId: 'second' }
    const third = { providerId: 'third' }
    cache.set(first, 1)
    now = 1
    cache.set(second, 2)
    now = 2
    expect(cache.get(first)).toBe(1)
    now = 3
    cache.set(third, 3)
    expect(cache.get(second)).toBeUndefined()
    expect(cache.get(first)).toBe(1)
    expect(cache.get(third)).toBe(3)
  })

  it('rejects unbounded cache options', () => {
    expect(() => new ProviderCapabilityCache({ ttlMs: 0 })).toThrow()
    expect(() => new ProviderCapabilityCache({ maxEntries: 0 })).toThrow()
    expect(() => new ProviderCapabilityCache({ maxEntries: 1025 })).toThrow()
  })
})

import { describe, expect, it } from 'vitest'
import { normalizeProviderBalanceEndpoint, validBalanceKeyHeader } from './provider-balance-endpoint'
import { normalizeModelProviderProfile } from './app-settings-provider-profiles'

const base = 'https://api.relay.example/v1'

describe('provider balance endpoint', () => {
  it('keeps an HTTPS endpoint on the provider host with its unit and key header', () => {
    expect(normalizeProviderBalanceEndpoint({ balanceUrl: 'https://api.relay.example/balance#/data/left', balanceUnit: ' credits ',
      balanceKeyHeader: 'X-Api-Key' }, base)).toEqual({ balanceUrl: 'https://api.relay.example/balance#/data/left', balanceUnit: 'credits', balanceKeyHeader: 'X-Api-Key' })
  })
  it('drops another host unless that exact host was confirmed', () => {
    expect(normalizeProviderBalanceEndpoint({ balanceUrl: 'https://console.relay.example/wallet' }, base)).toEqual({})
    expect(normalizeProviderBalanceEndpoint({ balanceUrl: 'https://console.relay.example/wallet', balanceHost: 'other.example' }, base)).toEqual({})
    expect(normalizeProviderBalanceEndpoint({ balanceUrl: 'https://console.relay.example/wallet', balanceHost: 'Console.Relay.Example' }, base))
      .toEqual({ balanceUrl: 'https://console.relay.example/wallet', balanceHost: 'console.relay.example' })
    // A confirmation left behind after the URL moves back to the provider host is dropped.
    expect(normalizeProviderBalanceEndpoint({ balanceUrl: 'https://api.relay.example/b', balanceHost: 'console.relay.example' }, base))
      .toEqual({ balanceUrl: 'https://api.relay.example/b' })
  })
  it('refuses plain HTTP, embedded credentials, odd units and headers a request already owns', () => {
    expect(normalizeProviderBalanceEndpoint({ balanceUrl: 'http://api.relay.example/b' }, base)).toEqual({})
    expect(normalizeProviderBalanceEndpoint({ balanceUrl: 'https://u:p@api.relay.example/b' }, base)).toEqual({})
    expect(normalizeProviderBalanceEndpoint({ balanceUrl: 'https://api.relay.example/b', balanceUnit: '<b>' }, base)).toEqual({ balanceUrl: 'https://api.relay.example/b' })
    expect(validBalanceKeyHeader('X-Api-Key')).toBe(true)
    for (const name of ['Authorization', 'host', 'Cookie', 'bad header']) expect(validBalanceKeyHeader(name)).toBe(false)
  })
  it('survives the provider profile normalizer', () => {
    const profile = normalizeModelProviderProfile({ id: 'relay', name: 'Relay', baseUrl: base, apiKey: 'k',
      balanceUrl: 'https://console.relay.example/wallet', balanceHost: 'console.relay.example', balanceUnit: '¥' })
    expect(profile).toMatchObject({ balanceUrl: 'https://console.relay.example/wallet', balanceHost: 'console.relay.example', balanceUnit: '¥' })
  })
})

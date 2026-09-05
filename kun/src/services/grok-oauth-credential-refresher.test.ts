import { describe, expect, it, vi } from 'vitest'
import {
  GrokOAuthCredentialRefresher,
  parseStoredGrokOAuthCredentials,
  type RefreshableLegacyCredentialStore
} from './grok-oauth-credential-refresher.js'

const NOW = Date.parse('2026-07-23T00:00:00.000Z')

function encodedCredentials(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    kind: 'grok-oauth',
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
    expiresAt: NOW - 1,
    issuer: 'https://auth.x.ai',
    clientId: 'client-id',
    ...overrides
  })
}

function memoryStore(initial: string): RefreshableLegacyCredentialStore & {
  current: string
  updates: string[]
} {
  return {
    current: initial,
    updates: [],
    async resolveApiKey() {
      return { apiKey: this.current }
    },
    async updateResolvedApiKey(_sourceId, expectedApiKey, apiKey) {
      if (this.current !== expectedApiKey) return false
      this.current = apiKey
      this.updates.push(apiKey)
      return true
    }
  }
}

function tokenFetch(): { fetchImpl: typeof fetch; tokenPosts: ReturnType<typeof vi.fn> } {
  const tokenPosts = vi.fn()
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/.well-known/openid-configuration')) {
      return Response.json({ token_endpoint: 'https://auth.x.ai/oauth2/token' })
    }
    tokenPosts(String(init?.body ?? ''))
    return Response.json({
      access_token: 'new-access',
      expires_in: 3600
    })
  }) as unknown as typeof fetch
  return { fetchImpl, tokenPosts }
}

describe('GrokOAuthCredentialRefresher', () => {
  it('refreshes an expired protected credential once and persists the rotated value', async () => {
    const store = memoryStore(encodedCredentials())
    const { fetchImpl, tokenPosts } = tokenFetch()
    const refresher = new GrokOAuthCredentialRefresher(store, {
      fetchImpl,
      nowMs: () => NOW
    })

    const [first, second] = await Promise.all([
      refresher.resolve('settings:provider:grok-subscription'),
      refresher.resolve('settings:provider:grok-subscription')
    ])

    expect(tokenPosts).toHaveBeenCalledTimes(1)
    expect(new URLSearchParams(tokenPosts.mock.calls[0]?.[0]).get('refresh_token')).toBe('old-refresh')
    expect(first.refreshable).toBe(true)
    expect(second.refreshable).toBe(true)
    expect(store.updates).toHaveLength(1)
    expect(parseStoredGrokOAuthCredentials(store.current)).toMatchObject({
      accessToken: 'new-access',
      refreshToken: 'old-refresh',
      expiresAt: NOW + 3_600_000
    })
  })

  it('forces one refresh after a rejected access token even when its expiry is in the future', async () => {
    const store = memoryStore(encodedCredentials({ expiresAt: NOW + 3_600_000 }))
    const { fetchImpl, tokenPosts } = tokenFetch()
    const refresher = new GrokOAuthCredentialRefresher(store, {
      fetchImpl,
      nowMs: () => NOW
    })

    await refresher.resolve('settings:provider:grok-subscription', 'old-access')
    await refresher.resolve('settings:provider:grok-subscription', 'old-access')

    expect(tokenPosts).toHaveBeenCalledTimes(1)
    expect(parseStoredGrokOAuthCredentials(store.current)?.accessToken).toBe('new-access')
  })

  it('resolves the refresh transport from the owning credential source', async () => {
    const sourceId = 'settings:provider:grok-subscription'
    const store = memoryStore(encodedCredentials())
    const fallbackFetch = vi.fn() as unknown as typeof fetch
    const { fetchImpl, tokenPosts } = tokenFetch()
    const fetchForSource = vi.fn(async () => fetchImpl)
    const refresher = new GrokOAuthCredentialRefresher(store, {
      fetchImpl: fallbackFetch,
      fetchForSource,
      nowMs: () => NOW
    })

    await refresher.resolve(sourceId)

    expect(fetchForSource).toHaveBeenCalledWith(sourceId)
    expect(tokenPosts).toHaveBeenCalledTimes(1)
    expect(fallbackFetch).not.toHaveBeenCalled()
  })

  it('leaves plain API keys unchanged and non-refreshable', async () => {
    const store = memoryStore('sk-plain')
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const refresher = new GrokOAuthCredentialRefresher(store, { fetchImpl })

    await expect(refresher.resolve('settings:provider:plain')).resolves.toEqual({
      rawApiKey: 'sk-plain',
      refreshable: false
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(store.updates).toHaveLength(0)
  })
})

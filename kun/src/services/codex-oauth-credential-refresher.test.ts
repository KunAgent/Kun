import { describe, expect, it, vi } from 'vitest'
import { CompatModelClient } from '../adapters/model/compat-model-client.js'
import type { ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import { materializeLegacyProviderCredential } from './legacy-provider-credential-migration.js'
import {
  CODEX_OAUTH_CLIENT_ID,
  CODEX_OAUTH_TOKEN_ENDPOINT,
  CodexOAuthCredentialRefresher,
  parseStoredCodexOAuthCredentials,
  refreshStoredCodexOAuthCredentials,
  type CodexRefreshableCredentialStore
} from './codex-oauth-credential-refresher.js'

const NOW = Date.parse('2026-07-24T15:00:00.000Z')
const SOURCE_ID = 'settings:provider:codex'

function encodedCredentials(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    kind: 'codex-oauth',
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
    expiresAt: NOW - 1,
    accountId: 'acct-old',
    email: 'old@example.com',
    ...overrides
  })
}

function memoryStore(initial: string): CodexRefreshableCredentialStore & {
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

function tokenFetch(response: Record<string, unknown> = {
  access_token: 'new-access',
  expires_in: 3600
}): { fetchImpl: typeof fetch; tokenPosts: ReturnType<typeof vi.fn> } {
  const tokenPosts = vi.fn()
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    expect(String(input)).toBe(CODEX_OAUTH_TOKEN_ENDPOINT)
    tokenPosts(String(init?.body ?? ''))
    return Response.json(response)
  }) as unknown as typeof fetch
  return { fetchImpl, tokenPosts }
}

function modelRequest(): ModelRequest {
  return {
    threadId: 'thread-codex-refresh',
    turnId: 'turn-codex-refresh',
    model: 'gpt-5.6-sol',
    systemPrompt: 'You are a helpful assistant.',
    prefix: [],
    history: [],
    tools: [],
    abortSignal: new AbortController().signal
  }
}

async function drain(iterable: AsyncIterable<ModelStreamChunk>): Promise<ModelStreamChunk[]> {
  const chunks: ModelStreamChunk[] = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

describe('CodexOAuthCredentialRefresher', () => {
  it('refreshes one expired protected credential for concurrent callers and persists it', async () => {
    const store = memoryStore(encodedCredentials())
    const { fetchImpl, tokenPosts } = tokenFetch()
    const refresher = new CodexOAuthCredentialRefresher(store, {
      fetchImpl,
      nowMs: () => NOW
    })

    const [first, second] = await Promise.all([
      refresher.resolve(SOURCE_ID),
      refresher.resolve(SOURCE_ID)
    ])

    expect(tokenPosts).toHaveBeenCalledTimes(1)
    const tokenBody = new URLSearchParams(tokenPosts.mock.calls[0]?.[0])
    expect(tokenBody.get('grant_type')).toBe('refresh_token')
    expect(tokenBody.get('refresh_token')).toBe('old-refresh')
    expect(tokenBody.get('client_id')).toBe(CODEX_OAUTH_CLIENT_ID)
    expect(first.refreshable).toBe(true)
    expect(second.refreshable).toBe(true)
    expect(store.updates).toHaveLength(1)
    expect(parseStoredCodexOAuthCredentials(store.current)).toMatchObject({
      accessToken: 'new-access',
      refreshToken: 'old-refresh',
      expiresAt: NOW + 3_600_000,
      accountId: 'acct-old',
      email: 'old@example.com'
    })
  })

  it('reuses an unexpired credential outside the early-invalidation window', async () => {
    const store = memoryStore(encodedCredentials({ expiresAt: NOW + 10 * 60_000 }))
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const refresher = new CodexOAuthCredentialRefresher(store, {
      fetchImpl,
      nowMs: () => NOW
    })

    const resolved = await refresher.resolve(SOURCE_ID)

    expect(resolved).toEqual({
      rawApiKey: store.current,
      refreshable: true
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(store.updates).toHaveLength(0)
  })

  it('refreshes inside the early-invalidation window', async () => {
    const store = memoryStore(encodedCredentials({ expiresAt: NOW + 4 * 60_000 }))
    const { fetchImpl, tokenPosts } = tokenFetch()
    const refresher = new CodexOAuthCredentialRefresher(store, {
      fetchImpl,
      nowMs: () => NOW
    })

    await refresher.resolve(SOURCE_ID)

    expect(tokenPosts).toHaveBeenCalledTimes(1)
    expect(parseStoredCodexOAuthCredentials(store.current)?.accessToken).toBe('new-access')
  })

  it('resolves the refresh transport from the owning credential source', async () => {
    const store = memoryStore(encodedCredentials())
    const fallbackFetch = vi.fn() as unknown as typeof fetch
    const { fetchImpl, tokenPosts } = tokenFetch()
    const fetchForSource = vi.fn(async () => fetchImpl)
    const refresher = new CodexOAuthCredentialRefresher(store, {
      fetchImpl: fallbackFetch,
      fetchForSource,
      nowMs: () => NOW
    })

    await refresher.resolve(SOURCE_ID)

    expect(fetchForSource).toHaveBeenCalledWith(SOURCE_ID)
    expect(tokenPosts).toHaveBeenCalledTimes(1)
    expect(fallbackFetch).not.toHaveBeenCalled()
  })

  it('forces a refresh for the rejected bearer and reuses an already rotated credential', async () => {
    const store = memoryStore(encodedCredentials({ expiresAt: NOW + 3_600_000 }))
    const { fetchImpl, tokenPosts } = tokenFetch()
    const refresher = new CodexOAuthCredentialRefresher(store, {
      fetchImpl,
      nowMs: () => NOW
    })

    await refresher.resolve(SOURCE_ID, 'old-access')
    const reused = await refresher.resolve(SOURCE_ID, 'old-access')

    expect(tokenPosts).toHaveBeenCalledTimes(1)
    expect(parseStoredCodexOAuthCredentials(reused.rawApiKey)?.accessToken).toBe('new-access')
  })

  it('leaves plain API keys unchanged and non-refreshable', async () => {
    const store = memoryStore('sk-plain')
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const refresher = new CodexOAuthCredentialRefresher(store, { fetchImpl })

    await expect(refresher.resolve('settings:provider:plain')).resolves.toEqual({
      rawApiKey: 'sk-plain',
      refreshable: false
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(store.updates).toHaveLength(0)
  })

  it('preserves secrets when the endpoint omits a refresh token but redacts them from failures', async () => {
    const credentials = parseStoredCodexOAuthCredentials(encodedCredentials())
    expect(credentials).not.toBeNull()
    if (!credentials) return

    const refreshed = await refreshStoredCodexOAuthCredentials(
      credentials,
      tokenFetch({ access_token: 'new-access', expires_in: 3600 }).fetchImpl,
      () => NOW
    )
    expect(refreshed.refreshToken).toBe('old-refresh')

    const failingFetch = vi.fn(async () => Response.json({
      error: 'invalid_grant',
      error_description: 'old-access and old-refresh were rejected'
    }, { status: 400 })) as unknown as typeof fetch
    await expect(
      refreshStoredCodexOAuthCredentials(credentials, failingFetch, () => NOW)
    ).rejects.toThrow('Codex subscription token refresh failed (400): invalid_grant: [redacted] and [redacted] were rejected')
  })

  it('recovers a real model-client 401 through the protected Codex resolver', async () => {
    const store = memoryStore(encodedCredentials({ expiresAt: NOW + 3_600_000 }))
    const authorization: string[] = []
    let tokenRequests = 0
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === CODEX_OAUTH_TOKEN_ENDPOINT) {
        tokenRequests += 1
        return Response.json({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 3600
        })
      }
      const bearer = new Headers(init?.headers).get('authorization') ?? ''
      authorization.push(bearer)
      return bearer === 'Bearer old-access'
        ? Response.json({ error: 'expired' }, { status: 401 })
        : Response.json({ output_text: 'ok', status: 'completed' })
    }) as unknown as typeof fetch
    const refresher = new CodexOAuthCredentialRefresher(store, {
      fetchImpl,
      nowMs: () => NOW
    })
    const client = new CompatModelClient({
      baseUrl: 'https://chatgpt.com/backend-api/codex/responses',
      apiKey: 'old-access',
      model: 'gpt-5.6-sol',
      endpointFormat: 'custom_endpoint',
      nonStreaming: true,
      fetchImpl,
      resolveCredentials: async (rejectedAccessToken?: string) => {
        const resolved = await refresher.resolve(SOURCE_ID, rejectedAccessToken)
        return {
          ...materializeLegacyProviderCredential(resolved.rawApiKey),
          refreshable: resolved.refreshable
        }
      }
    })

    const chunks = await drain(client.stream(modelRequest()))

    expect(authorization).toEqual(['Bearer old-access', 'Bearer new-access'])
    expect(tokenRequests).toBe(1)
    expect(parseStoredCodexOAuthCredentials(store.current)).toMatchObject({
      accessToken: 'new-access',
      refreshToken: 'new-refresh'
    })
    expect(chunks.at(-1)).toEqual({ kind: 'completed', stopReason: 'stop' })
    expect(chunks.some((chunk) => chunk.kind === 'error')).toBe(false)
  })
})

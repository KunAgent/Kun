import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExtensionCredentialStore } from './extension-credential-store.js'
import { ModelConnectionRegistry } from './model-connection-registry.js'
import { ModelConnectionOAuthService } from './model-connection-oauth.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function jwt(claims: Record<string, unknown>): string {
  return `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.x`
}

describe('ModelConnectionOAuthService', () => {
  it('completes ChatGPT device auth without returning tokens to the caller', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-oauth-'))
    roots.push(dataDir)
    const registry = new ModelConnectionRegistry({
      dataDir,
      credentials: new ExtensionCredentialStore({ dataDir, profileId: 'oauth-test' })
    })
    await registry.initialize()
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ device_auth_id: 'device-1', user_code: 'ABCD', interval: 1 }))
      .mockResolvedValueOnce(Response.json({ authorization_code: 'auth-1', code_verifier: 'verifier-1' }))
      .mockResolvedValueOnce(Response.json({
        access_token: jwt({ chatgpt_account_id: 'account-1', email: 'test@example.com' }),
        refresh_token: 'refresh-secret',
        expires_in: 3600
      }))
    const service = new ModelConnectionOAuthService({ registry, fetch: fetchMock })

    const started = await service.start({ expectedRevision: 0, provider: 'chatgpt' })
    expect(started).toMatchObject({ status: 'pending', userCode: 'ABCD' })
    const completed = await service.status(started.sessionId)

    expect(completed.status).toBe('connected')
    expect(completed.snapshot?.defaultProviderId).toBe('codex')
    expect(JSON.stringify(completed)).not.toContain('refresh-secret')
    expect(JSON.stringify(completed)).not.toContain('access_token')
    service.close()
  })

  it('reconnects an existing ChatGPT profile without allocating a duplicate provider', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-oauth-reconnect-'))
    roots.push(dataDir)
    const registry = new ModelConnectionRegistry({
      dataDir,
      credentials: new ExtensionCredentialStore({ dataDir, profileId: 'oauth-test' })
    })
    const existing = await registry.connectAuthenticated({
      expectedRevision: 0,
      id: 'codex',
      name: 'ChatGPT subscription',
      presetSource: 'codex',
      kind: 'http',
      authType: 'oauth',
      baseUrl: 'https://chatgpt.com/backend-api/codex/responses',
      endpointFormat: 'custom_endpoint',
      credential: JSON.stringify({
        kind: 'codex-oauth',
        accessToken: 'expired-access',
        refreshToken: 'expired-refresh',
        expiresAt: 1,
        accountId: 'account-1'
      }),
      models: ['gpt-5.6-sol'],
      selectedModel: 'gpt-5.6-sol',
      select: true
    })
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ device_auth_id: 'device-2', user_code: 'EFGH', interval: 1 }))
      .mockResolvedValueOnce(Response.json({ authorization_code: 'auth-2', code_verifier: 'verifier-2' }))
      .mockResolvedValueOnce(Response.json({
        access_token: jwt({ chatgpt_account_id: 'account-1', email: 'test@example.com' }),
        refresh_token: 'rotated-refresh-secret',
        expires_in: 3600
      }))
    const service = new ModelConnectionOAuthService({ registry, fetch: fetchMock })

    const started = await service.start({
      expectedRevision: existing.revision,
      provider: 'chatgpt'
    })
    const completed = await service.status(started.sessionId)

    expect(completed.status).toBe('connected')
    expect(completed.snapshot?.providers).toHaveLength(1)
    expect(completed.snapshot?.providers[0]).toMatchObject({
      id: 'codex',
      accountId: 'account:codex'
    })
    expect(JSON.stringify(completed)).not.toContain('rotated-refresh-secret')
    service.close()
  })

  it('rejects an OAuth start against a stale registry revision', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-oauth-conflict-'))
    roots.push(dataDir)
    const registry = new ModelConnectionRegistry({
      dataDir,
      credentials: new ExtensionCredentialStore({ dataDir, profileId: 'oauth-test' })
    })
    await registry.initialize()
    await registry.connect({
      expectedRevision: 0, name: 'API', kind: 'http', authType: 'api-key',
      baseUrl: 'https://example.com/v1', credential: 'secret', models: ['m'],
      selectedModel: 'm', probe: false
    })
    const service = new ModelConnectionOAuthService({ registry })
    await expect(service.start({ expectedRevision: 0, provider: 'chatgpt' }))
      .rejects.toThrow('registry revision changed')
  })

  it('fails closed before OAuth discovery when the selected proxy is invalid', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-oauth-invalid-proxy-'))
    roots.push(dataDir)
    const registry = new ModelConnectionRegistry({
      dataDir,
      credentials: new ExtensionCredentialStore({ dataDir, profileId: 'oauth-test' })
    })
    const snapshot = await registry.initialize([], {
      proxy: { enabled: true, url: 'invalid-proxy' }
    })
    const fetchMock = vi.fn<typeof fetch>()
    const service = new ModelConnectionOAuthService({ registry, fetch: fetchMock })

    await expect(service.start({
      expectedRevision: snapshot.revision,
      provider: 'chatgpt',
      useProxy: true
    })).rejects.toMatchObject({ code: 'provider_proxy_invalid' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts a pasted Grok callback URL and commits the shared GUI catalog without exposing tokens', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-oauth-grok-'))
    roots.push(dataDir)
    const registry = new ModelConnectionRegistry({
      dataDir,
      credentials: new ExtensionCredentialStore({ dataDir, profileId: 'oauth-test' })
    })
    await registry.initialize()
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({
        authorization_endpoint: 'https://auth.x.ai/authorize',
        token_endpoint: 'https://auth.x.ai/oauth/token'
      }))
      .mockResolvedValueOnce(Response.json({
        access_token: jwt({ sub: 'grok-user', email: 'grok@example.com' }),
        refresh_token: 'grok-refresh-secret',
        expires_in: 3600
      }))
    const service = new ModelConnectionOAuthService({ registry, fetch: fetchMock })

    const started = await service.start({ expectedRevision: 0, provider: 'grok' })
    const state = new URL(started.url!).searchParams.get('state')
    expect(state).toBeTruthy()
    const completed = await service.submit(
      started.sessionId,
      `http://127.0.0.1:65535/callback?code=browser-code-secret&state=${state}`
    )

    expect(completed).toMatchObject({
      status: 'connected',
      snapshot: {
        defaultProviderId: 'grok-subscription',
        defaultModel: 'grok-4.5',
        providers: [expect.objectContaining({
          id: 'grok-subscription',
          name: 'Grok 订阅',
          baseUrl: 'https://cli-chat-proxy.grok.com/v1',
          endpointFormat: 'responses',
          models: [
            'grok-4.5',
            'grok-4-1-fast-reasoning',
            'grok-4-1-fast-non-reasoning',
            'grok-code-fast-1'
          ]
        })]
      }
    })
    expect(JSON.stringify(completed)).not.toContain('browser-code-secret')
    expect(JSON.stringify(completed)).not.toContain('grok-refresh-secret')
    service.close()
  })
})

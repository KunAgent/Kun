import { describe, expect, it, vi } from 'vitest'
import type { AppSettingsV1, ModelProviderProfileV1 } from '../shared/app-settings'
import {
  classifyProviderQuotaProbe,
  listProviderQuotas,
  parseDeepSeekQuota,
  parseKimiCodeQuota,
  parseMiniMaxQuota,
  parseMoonshotQuota,
  parseOpenAiQuota,
  parseOpenRouterQuota,
  parseZaiQuota
} from './provider-quota'
import {
  decodeAntigravityUnifiedOAuth,
  parseClaudeSubscriptionQuota,
  parseCodexSubscriptionQuota,
  parseCursorSubscriptionQuota,
  parseGrokSubscriptionQuota,
  parseGoogleCodeAssistQuota
} from './provider-subscription-quota'

function provider(
  id: string,
  name: string,
  baseUrl: string,
  apiKey = 'secret-key',
  presetId?: string
): ModelProviderProfileV1 {
  return {
    id,
    name,
    ...(presetId ? { presetSource: { presetId, mode: 'api' as const } } : {}),
    apiKey,
    baseUrl,
    endpointFormat: 'chat_completions',
    models: ['test-model'],
    modelProfiles: {
      'test-model': {
        inputModalities: ['text'],
        outputModalities: ['text'],
        supportsToolCalling: true,
        messageParts: ['text']
      }
    }
  }
}

function settings(providers: ModelProviderProfileV1[], proxyUrl = ''): AppSettingsV1 {
  const defaultProvider = providers.find((item) => item.id === 'deepseek')
  return {
    provider: {
      apiKey: defaultProvider?.apiKey ?? '',
      baseUrl: defaultProvider?.baseUrl ?? 'https://api.deepseek.com',
      providers,
      proxy: { enabled: Boolean(proxyUrl), url: proxyUrl }
    }
  } as unknown as AppSettingsV1
}

function subscriptionProvider(
  id: string,
  kind: 'agent-sdk' | 'cursor-sdk' | 'antigravity-cli' | 'gemini-cli-api' | 'http'
): ModelProviderProfileV1 {
  return {
    ...provider(id, id, id === 'codex'
      ? 'https://chatgpt.com/backend-api/codex/responses'
      : id === 'claude-subscription'
        ? 'https://api.anthropic.com'
        : '', '', id),
    kind,
    endpointFormat: 'custom_endpoint'
  }
}

function grokBillingFrame(
  usedPercent: number,
  resetEpoch: number
): Uint8Array<ArrayBuffer> {
  const float = Buffer.alloc(4)
  float.writeFloatLE(usedPercent)
  const varint: number[] = []
  let remaining = resetEpoch
  do {
    const next = remaining % 128
    remaining = Math.floor(remaining / 128)
    varint.push(next | (remaining > 0 ? 0x80 : 0))
  } while (remaining > 0)
  const payload = Buffer.concat([
    Buffer.from([0x0d]),
    float,
    Buffer.from([0x10, ...varint])
  ])
  const frame = Buffer.alloc(5 + payload.length)
  frame.writeUInt32BE(payload.length, 1)
  payload.copy(frame, 5)
  const output = new Uint8Array(frame.length)
  output.set(frame)
  return output
}

describe('provider quota registry and refresh', () => {
  it('requires exact known hostnames for custom providers', () => {
    expect(classifyProviderQuotaProbe(
      provider('custom-openai', 'OpenAI', 'https://api.openai.com/v1')
    )?.kind).toBe('openai')
    expect(classifyProviderQuotaProbe(
      provider('hostile', 'Hostile', 'https://attacker.example/api.openai.com/v1')
    )).toBeNull()
    expect(classifyProviderQuotaProbe(
      provider('deepseek-proxy', 'DeepSeek proxy', 'https://gateway.example/v1', 'gateway-key', 'deepseek')
    )).toBeNull()
  })

  it('recognizes subscription probes only by their stable preset identity and expected kind', () => {
    expect(classifyProviderQuotaProbe(
      subscriptionProvider('claude-subscription', 'agent-sdk')
    )?.kind).toBe('claude-subscription')
    expect(classifyProviderQuotaProbe(
      subscriptionProvider('codex', 'http')
    )?.kind).toBe('codex-subscription')
    expect(classifyProviderQuotaProbe(provider(
      'opencode-go',
      'OpenCode Go',
      'https://opencode.ai/zen/go/v1',
      '',
      'opencode-go'
    ))?.kind).toBe('opencode-go-local')
    expect(classifyProviderQuotaProbe(
      provider(
        'codex',
        'ChatGPT subscription',
        'https://chatgpt.com/backend-api/codex/responses',
        '',
        'codex'
      )
    )?.kind).toBe('codex-subscription')
    expect(classifyProviderQuotaProbe(
      provider(
        'grok-subscription',
        'Grok subscription',
        'https://cli-chat-proxy.grok.com/v1',
        '',
        'grok-subscription'
      )
    )?.kind).toBe('grok-subscription')
    expect(classifyProviderQuotaProbe(
      provider(
        'kimi-code',
        'Kimi Code',
        'https://api.kimi.com/coding/v1',
        'kimi-key',
        'kimi-code'
      )
    )?.kind).toBe('kimi-code')
    expect(classifyProviderQuotaProbe(
      subscriptionProvider('cursor-subscription', 'cursor-sdk')
    )?.kind).toBe('cursor-subscription')
    expect(classifyProviderQuotaProbe(
      subscriptionProvider('gemini-subscription', 'antigravity-cli')
    )?.kind).toBe('antigravity-subscription')
    expect(classifyProviderQuotaProbe(
      subscriptionProvider('gemini-subscription-2', 'antigravity-cli')
    )?.kind).toBe('antigravity-subscription')
    expect(classifyProviderQuotaProbe({
      ...subscriptionProvider('claude-subscription', 'agent-sdk'),
      kind: 'http'
    })).toBeNull()
    expect(classifyProviderQuotaProbe({
      ...subscriptionProvider('codex', 'http'),
      kind: 'agent-sdk'
    })).toBeNull()
  })

  it('keeps every configured provider separate and does not request unsupported or keyless entries', async () => {
    const fetcher = vi.fn(async (url: string | URL, _: RequestInit | undefined, proxyUrl: string) => {
      expect(proxyUrl).toBe('http://127.0.0.1:7890/')
      expect(url.toString()).toBe('https://api.deepseek.com/user/balance')
      return new Response(JSON.stringify({
        balance_infos: [{ currency: 'CNY', total_balance: '9.5' }]
      }))
    })
    const result = await listProviderQuotas(settings([
      provider('deepseek', 'DeepSeek One', 'https://api.deepseek.com', 'secret-one', 'deepseek'),
      provider('deepseek-two', 'DeepSeek Two', 'https://api.deepseek.com', '', 'deepseek'),
      provider('unknown', 'Unknown', 'https://example.test/v1')
    ], 'http://127.0.0.1:7890'), fetcher)

    expect(result.entries.map((entry) => [entry.providerId, entry.status])).toEqual([
      ['deepseek', 'available'],
      ['deepseek-two', 'missing_credentials'],
      ['unknown', 'unsupported']
    ])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(result)).not.toContain('secret-one')
  })

  it('isolates a provider HTTP failure from successful providers', async () => {
    const fetcher = vi.fn(async (url: string | URL) => {
      if (url.toString().includes('openrouter.ai')) {
        return new Response('sensitive upstream body', { status: 500 })
      }
      return new Response(JSON.stringify({
        balance_infos: [{ currency: 'CNY', total_balance: '2' }]
      }))
    })
    const result = await listProviderQuotas(settings([
      provider('deepseek', 'DeepSeek', 'https://api.deepseek.com'),
      provider('openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1')
    ]), fetcher)

    expect(result.entries[0]).toMatchObject({ providerId: 'deepseek', status: 'available' })
    expect(result.entries[1]).toMatchObject({
      providerId: 'openrouter',
      status: 'error',
      message: 'The provider quota endpoint returned HTTP 500.'
    })
    expect(JSON.stringify(result)).not.toContain('sensitive upstream body')
  })

  it('uses existing subscription login state and fixed read-only endpoints', async () => {
    const fetcher = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const requestUrl = url.toString()
      const headers = new Headers(init?.headers)
      if (requestUrl.endsWith('/api/oauth/usage')) {
        expect(headers.get('authorization')).toBe('Bearer claude-secret')
        expect(headers.get('anthropic-beta')).toBe('oauth-2025-04-20')
        return new Response(JSON.stringify({
          five_hour: { utilization: 10, resets_at: '2027-01-15T10:00:00Z' }
        }))
      }
      if (requestUrl.endsWith('/wham/usage')) {
        expect(headers.get('authorization')).toBe('Bearer codex-secret')
        expect(headers.get('chatgpt-account-id')).toBe('acct-test')
        return new Response(JSON.stringify({
          plan_type: 'plus',
          rate_limit: {
            primary_window: {
              used_percent: 20,
              reset_at: 1_800_000_000,
              limit_window_seconds: 18_000
            }
          }
        }))
      }
      if (requestUrl.endsWith('/wham/rate-limit-reset-credits')) {
        expect(headers.get('authorization')).toBe('Bearer codex-secret')
        expect(headers.get('chatgpt-account-id')).toBe('acct-test')
        return new Response(JSON.stringify({
          available_count: 2,
          credits: [{
            id: 'credit-1',
            reset_type: 'codex_rate_limits',
            status: 'available',
            granted_at: '2026-06-17T00:00:00Z',
            expires_at: '2999-07-17T00:00:00Z',
            title: 'Full reset (Weekly + 5 hr)'
          }]
        }))
      }
      if (requestUrl.endsWith('/api/usage-summary')) {
        expect(headers.get('cookie')).toBe('WorkosCursorSessionToken=session-secret')
        return new Response(JSON.stringify({
          membershipType: 'pro',
          individualUsage: {
            plan: { enabled: true, used: 100, limit: 2_000, remaining: 1_900 }
          }
        }))
      }
      if (requestUrl.endsWith(':loadCodeAssist')) {
        expect(headers.get('authorization')).toBe('Bearer google-secret')
        return new Response(JSON.stringify({
          currentTier: { id: 'standard-tier', name: 'standard' },
          cloudaicompanionProject: 'project-test'
        }))
      }
      if (requestUrl.endsWith(':retrieveUserQuota')) {
        return new Response(JSON.stringify({
          buckets: [{ modelId: 'gemini-pro', remainingFraction: 0.8 }]
        }))
      }
      throw new Error(`Unexpected URL: ${requestUrl}`)
    })
    const result = await listProviderQuotas(settings([
      subscriptionProvider('claude-subscription', 'agent-sdk'),
      subscriptionProvider('codex', 'http'),
      subscriptionProvider('cursor-subscription', 'cursor-sdk'),
      subscriptionProvider('gemini-subscription', 'antigravity-cli')
    ]), fetcher, {
      resolveClaudeToken: async () => 'claude-secret',
      resolveCodexCredential: async () => ({
        accessToken: 'codex-secret',
        accountId: 'acct-test'
      }),
      resolveCursorSession: async () => ({
        cookieHeader: 'WorkosCursorSessionToken=session-secret'
      }),
      resolveAntigravityCredential: async () => ({
        accessToken: 'google-secret',
        accountEmail: 'account@example.test'
      })
    })

    expect(result.entries
      .filter((entry) => entry.providerId !== 'deepseek')
      .map((entry) => [entry.providerId, entry.status])).toEqual([
      ['claude-subscription', 'available'],
      ['codex', 'available'],
      ['cursor-subscription', 'available'],
      ['gemini-subscription', 'available']
    ])
    const codexEntry = result.entries.find((entry) => entry.providerId === 'codex')
    expect(codexEntry?.metrics.find((metric) => metric.id === 'reset-credits')).toMatchObject({
      label: 'Rate-limit resets',
      unit: 'credits',
      remaining: 2,
      resetsAt: '2999-07-17T00:00:00.000Z'
    })
    expect(JSON.stringify(result)).not.toMatch(/claude-secret|codex-secret|session-secret|google-secret/)
  })

  it('queries ChatGPT, Kimi Code, and Grok presets that omit an explicit HTTP kind', async () => {
    const fetcher = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const requestUrl = url.toString()
      const headers = new Headers(init?.headers)
      if (requestUrl.endsWith('/wham/usage')) {
        expect(headers.get('authorization')).toBe('Bearer codex-secret')
        return new Response(JSON.stringify({
          plan_type: 'pro',
          rate_limit: {
            primary_window: {
              used_percent: 15,
              reset_at: 1_900_000_000,
              limit_window_seconds: 18_000
            }
          },
          rate_limit_reset_credits: { available_count: 1 }
        }))
      }
      if (requestUrl.endsWith('/wham/rate-limit-reset-credits')) {
        return new Response('upstream unavailable', { status: 500 })
      }
      if (requestUrl.endsWith('/coding/v1/usages')) {
        expect(headers.get('authorization')).toBe('Bearer kimi-secret')
        return new Response(JSON.stringify({
          usage: { limit: '1000', used: '250', remaining: '750' },
          limits: []
        }))
      }
      if (requestUrl.includes('GetGrokCreditsConfig')) {
        expect(headers.get('authorization')).toBe('Bearer grok-secret')
        expect(headers.get('content-type')).toBe('application/grpc-web+proto')
        expect(Array.from(init?.body as Uint8Array)).toEqual([0, 0, 0, 0, 0])
        return new Response(grokBillingFrame(32, 1_900_000_000), {
          headers: { 'Content-Type': 'application/grpc-web+proto' }
        })
      }
      throw new Error(`Unexpected URL: ${requestUrl}`)
    })
    const result = await listProviderQuotas(settings([
      provider(
        'codex',
        'ChatGPT subscription',
        'https://chatgpt.com/backend-api/codex/responses',
        '',
        'codex'
      ),
      provider(
        'kimi-code',
        'Kimi Code',
        'https://api.kimi.com/coding/v1',
        'kimi-secret',
        'kimi-code'
      ),
      provider(
        'grok-subscription',
        'Grok subscription',
        'https://cli-chat-proxy.grok.com/v1',
        '',
        'grok-subscription'
      )
    ]), fetcher, {
      resolveCodexCredential: async () => ({ accessToken: 'codex-secret' }),
      resolveGrokCredential: async () => ({
        accessToken: 'grok-secret',
        email: 'grok@example.test'
      })
    })

    expect(result.entries
      .filter((entry) => [
        'codex',
        'kimi-code',
        'grok-subscription'
      ].includes(entry.providerId))
      .map((entry) => [
        entry.providerId,
        entry.status,
        entry.metrics[0]?.usedPercent
      ])).toEqual([
      ['codex', 'available', 15],
      ['kimi-code', 'available', 25],
      ['grok-subscription', 'available', 32]
    ])
    // A failed details request degrades to the count embedded in the usage response.
    const codexEntry = result.entries.find((entry) => entry.providerId === 'codex')
    expect(codexEntry?.status).toBe('available')
    expect(codexEntry?.metrics.find((metric) => metric.id === 'reset-credits')).toMatchObject({
      label: 'Rate-limit resets',
      remaining: 1
    })
    expect(JSON.stringify(result)).not.toMatch(/codex-secret|kimi-secret|grok-secret/)
  })

  it('refreshes an expired configured Codex login before querying quota', async () => {
    const refreshFetch = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe('https://auth.openai.com/oauth/token')
      return Response.json({
        access_token: 'codex-refreshed-access',
        refresh_token: 'codex-refreshed-refresh',
        expires_in: 3_600
      })
    })
    vi.stubGlobal('fetch', refreshFetch)
    const fetcher = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe('Bearer codex-refreshed-access')
      expect(headers.get('chatgpt-account-id')).toBe('acct-refresh')
      expect(headers.get('user-agent')).toMatch(/^codex_cli_rs\//)
      if (String(url).endsWith('/wham/rate-limit-reset-credits')) {
        return Response.json({ available_count: 0, credits: [] })
      }
      return Response.json({
        plan_type: 'plus',
        rate_limit: {
          primary_window: {
            used_percent: 21,
            reset_at: 1_900_000_000,
            limit_window_seconds: 18_000
          }
        }
      })
    })

    try {
      const codex = subscriptionProvider('codex', 'http')
      codex.apiKey = JSON.stringify({
        kind: 'codex-oauth',
        accessToken: 'codex-expired-access',
        refreshToken: 'codex-expired-refresh',
        expiresAt: Date.now() - 60_000,
        accountId: 'acct-refresh'
      })
      const result = await listProviderQuotas(settings([codex]), fetcher)

      expect(result.entries.find((entry) => entry.providerId === 'codex')).toMatchObject({
        providerId: 'codex',
        status: 'available',
        metrics: [expect.objectContaining({ id: 'primary', usedPercent: 21 })]
      })
      expect(refreshFetch).toHaveBeenCalledTimes(1)
      expect(fetcher).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('refreshes and retries once when Codex rejects a current access token', async () => {
    const resolveCodexCredential = vi.fn(async (
      _provider: ModelProviderProfileV1,
      rejectedAccessToken?: string
    ) => rejectedAccessToken
      ? { accessToken: 'codex-retry-access', accountId: 'acct-retry' }
      : { accessToken: 'codex-rejected-access', accountId: 'acct-retry' })
    const fetcher = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get('authorization')
      if (String(url).endsWith('/wham/rate-limit-reset-credits')) {
        expect(authorization).not.toBe('Bearer codex-rejected-access')
        return Response.json({ available_count: 0, credits: [] })
      }
      if (authorization === 'Bearer codex-rejected-access') {
        return new Response('expired', { status: 401 })
      }
      expect(authorization).toBe('Bearer codex-retry-access')
      return Response.json({
        plan_type: 'pro',
        rate_limit: {
          primary_window: {
            used_percent: 7,
            reset_at: 1_900_000_000,
            limit_window_seconds: 18_000
          }
        }
      })
    })

    const result = await listProviderQuotas(settings([
      subscriptionProvider('codex', 'http')
    ]), fetcher, { resolveCodexCredential })

    expect(result.entries.find((entry) => entry.providerId === 'codex')).toMatchObject({
      providerId: 'codex',
      status: 'available',
      metrics: [expect.objectContaining({ id: 'primary', usedPercent: 7 })]
    })
    expect(resolveCodexCredential).toHaveBeenNthCalledWith(2, expect.anything(), 'codex-rejected-access')
    // Usage + reset-credit details on the rejected token, then again on the retry token.
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('refreshes and retries once when Grok rejects a current access token', async () => {
    const resolveGrokCredential = vi.fn(async (
      _provider: ModelProviderProfileV1,
      rejectedAccessToken?: string
    ) => rejectedAccessToken
      ? { accessToken: 'grok-retry-access' }
      : { accessToken: 'grok-rejected-access' })
    const fetcher = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get('authorization')
      if (authorization === 'Bearer grok-rejected-access') {
        return new Response('expired', { status: 401 })
      }
      expect(authorization).toBe('Bearer grok-retry-access')
      return new Response(grokBillingFrame(18, 1_900_000_000), {
        headers: { 'Content-Type': 'application/grpc-web+proto' }
      })
    })

    const result = await listProviderQuotas(settings([
      subscriptionProvider('grok-subscription', 'http')
    ]), fetcher, { resolveGrokCredential })

    expect(result.entries.find((entry) => entry.providerId === 'grok-subscription')).toMatchObject({
      status: 'available',
      metrics: [expect.objectContaining({ id: 'credits', usedPercent: 18 })]
    })
    expect(resolveGrokCredential).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'grok-rejected-access',
      expect.objectContaining({ fetcher })
    )
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('reports the Gemini CLI migration reason instead of a generic authorization error', async () => {
    const fetcher = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toContain(':loadCodeAssist')
      const headers = new Headers(init?.headers)
      expect(headers.get('user-agent')).toBe('google-gemini-cli')
      expect(JSON.parse(String(init?.body))).toMatchObject({
        metadata: { ideType: 'IDE_UNSPECIFIED', pluginType: 'GEMINI' }
      })
      return Response.json({
        allowedTiers: [{ id: 'standard-tier' }],
        ineligibleTiers: [{
          reasonMessage: 'This client is no longer supported. Migrate to Antigravity.'
        }]
      })
    })

    const result = await listProviderQuotas(settings([
      subscriptionProvider('gemini-cli-subscription', 'gemini-cli-api')
    ]), fetcher, {
      resolveGeminiCliToken: async () => 'gemini-cli-access'
    })

    expect(result.entries.find((entry) => entry.providerId === 'gemini-cli-subscription')).toMatchObject({
      status: 'error',
      message: 'This client is no longer supported. Migrate to Antigravity.'
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('reports a missing subscription login without making a request', async () => {
    const fetcher = vi.fn()
    const result = await listProviderQuotas(settings([
      subscriptionProvider('claude-subscription', 'agent-sdk')
    ]), fetcher, {
      resolveClaudeToken: async () => undefined
    })
    expect(result.entries.find((entry) => entry.providerId === 'claude-subscription')).toMatchObject({
      providerId: 'claude-subscription',
      status: 'missing_credentials'
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('reads OpenCode Go local usage without requiring an API key or network request', async () => {
    const fetcher = vi.fn()
    const result = await listProviderQuotas(settings([
      provider(
        'opencode-go',
        'OpenCode Go',
        'https://opencode.ai/zen/go/v1',
        '',
        'opencode-go'
      )
    ]), fetcher, {
      resolveOpenCodeGoCookie: async () => undefined,
      resolveOpenCodeGoQuota: async () => ({
        summary: 'Local estimate · $12 / $30 / $60 plan limits',
        metrics: [{
          id: 'weekly',
          label: 'Weekly usage',
          unit: 'USD',
          used: 9,
          limit: 30,
          remaining: 21,
          usedPercent: 30
        }]
      })
    })

    expect(result.entries.find((entry) => entry.providerId === 'opencode-go')).toMatchObject({
      providerId: 'opencode-go',
      status: 'available',
      source: 'OpenCode Go local usage estimate',
      summary: 'Local estimate · $12 / $30 / $60 plan limits',
      metrics: [expect.objectContaining({ id: 'weekly', usedPercent: 30 })]
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('explains when OpenCode Go has no local usage history yet', async () => {
    const result = await listProviderQuotas(settings([
      provider(
        'opencode-go',
        'OpenCode Go',
        'https://opencode.ai/zen/go/v1',
        '',
        'opencode-go'
      )
    ]), vi.fn(), {
      resolveOpenCodeGoCookie: async () => undefined,
      resolveOpenCodeGoQuota: async () => undefined
    })

    expect(result.entries.find((entry) => entry.providerId === 'opencode-go')).toMatchObject({
      status: 'missing_credentials',
      message: 'Sign in to opencode.ai in your browser, or use OpenCode Go locally first so its usage history exists.'
    })
  })
})

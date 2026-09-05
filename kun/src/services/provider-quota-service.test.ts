import { describe, expect, it, vi } from 'vitest'
import {
  ProviderQuotaService,
  classifyProviderQuotaProbe,
  parseDeepSeekQuota,
  parseKimiCodeQuota,
  parseMiniMaxQuota,
  parseMoonshotQuota,
  parseOpenAiQuota,
  parseOpenRouterQuota,
  parseZaiQuota
} from './provider-quota-service.js'
import type { ProviderQuotaProbeProfile } from './provider-subscription-quota.js'

const profile = (
  overrides: Partial<ProviderQuotaProbeProfile> = {}
): ProviderQuotaProbeProfile => ({
  id: 'deepseek',
  name: 'DeepSeek',
  presetId: 'deepseek',
  kind: 'http',
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'quota-secret',
  ...overrides
})

function grokBillingFrame(usedPercent: number, resetEpoch: number): Uint8Array<ArrayBuffer> {
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

describe('ProviderQuotaService', () => {
  it('classifies only exact supported provider hosts and subscription presets', () => {
    expect(classifyProviderQuotaProbe(profile())?.kind).toBe('deepseek')
    expect(classifyProviderQuotaProbe(profile({
      id: 'openrouter',
      presetId: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1'
    }))?.kind).toBe('openrouter')
    expect(classifyProviderQuotaProbe(profile({
      id: 'claude-subscription',
      presetId: 'claude-subscription',
      kind: 'agent-sdk',
      baseUrl: undefined
    }))?.kind).toBe('claude-subscription')
    expect(classifyProviderQuotaProbe(profile({
      id: 'opencode-go',
      name: 'OpenCode Go',
      presetId: 'opencode-go',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      apiKey: ''
    }))?.kind).toBe('opencode-go-local')
    expect(classifyProviderQuotaProbe(profile({
      id: 'grok-subscription',
      name: 'Grok',
      presetId: 'grok-subscription',
      baseUrl: 'https://cli-chat-proxy.grok.com/v1'
    }))?.kind).toBe('grok-subscription')
    expect(classifyProviderQuotaProbe(profile({
      id: 'gemini-subscription-2',
      name: 'Antigravity clone',
      presetId: 'gemini-subscription-2',
      kind: 'antigravity-cli',
      baseUrl: undefined,
      apiKey: ''
    }))?.kind).toBe('antigravity-subscription')
    expect(classifyProviderQuotaProbe(profile({
      id: 'kimi-code',
      name: 'Kimi Code',
      presetId: 'kimi-code',
      baseUrl: 'https://api.kimi.com/coding/v1'
    }))?.kind).toBe('kimi-code')
    expect(classifyProviderQuotaProbe(profile({
      id: 'lookalike',
      presetId: undefined,
      baseUrl: 'https://api.deepseek.com.attacker.example'
    }))).toBeNull()
  })

  it('returns mixed provider results without leaking credentials or failing the list', async () => {
    const fetcher = vi.fn(async (
      input: string | URL,
      init: RequestInit | undefined,
      _proxyUrl: string
    ) => {
      const url = String(input)
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer quota-secret')
      if (url === 'https://api.deepseek.com/user/balance') {
        return Response.json({
          is_available: true,
          balance_infos: [{
            currency: 'CNY',
            total_balance: '40.76',
            granted_balance: '0',
            topped_up_balance: '40.76'
          }]
        })
      }
      return new Response('denied quota-secret', { status: 503 })
    })
    const service = new ProviderQuotaService({
      loadSource: async () => ({
        profiles: [
          profile({ proxyUrl: 'http://127.0.0.1:7890' }),
          profile({
            id: 'moonshot',
            name: 'Moonshot',
            presetId: 'moonshot',
            baseUrl: 'https://api.moonshot.cn'
          }),
          profile({
            id: 'custom',
            name: 'Custom provider',
            presetId: undefined,
            baseUrl: 'https://models.example.com/v1'
          }),
          profile({
            id: 'openrouter',
            name: 'OpenRouter',
            presetId: 'openrouter',
            baseUrl: 'https://openrouter.ai/api/v1',
            apiKey: ''
          })
        ],
        proxyUrl: 'http://legacy-global-must-not-apply:9999'
      }),
      fetcher,
      nowIso: () => '2026-07-28T01:31:00.000Z'
    })

    const result = await service.list()

    expect(result.entries.map((entry) => [entry.providerId, entry.status])).toEqual([
      ['deepseek', 'available'],
      ['moonshot', 'error'],
      ['custom', 'unsupported'],
      ['openrouter', 'missing_credentials']
    ])
    expect(result.entries[0]?.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'balance', remaining: 40.76, unit: 'CNY' })
    ]))
    expect(JSON.stringify(result)).not.toContain('quota-secret')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls.map((call) => call[2])).toEqual(expect.arrayContaining([
      'http://127.0.0.1:7890',
      ''
    ]))
  })

  it('shows OpenCode Go local usage in the TUI quota service without an API key', async () => {
    const fetcher = vi.fn()
    const service = new ProviderQuotaService({
      loadSource: async () => ({
        profiles: [profile({
          id: 'opencode-go',
          name: 'OpenCode Go',
          presetId: 'opencode-go',
          baseUrl: 'https://opencode.ai/zen/go/v1',
          apiKey: ''
        })],
        proxyUrl: ''
      }),
      fetcher,
      nowIso: () => '2026-07-28T01:31:00.000Z',
      subscriptionRuntime: {
        resolveOpenCodeGoCookie: async () => undefined,
        resolveOpenCodeGoQuota: async () => ({
          summary: 'Local estimate · $12 / $30 / $60 plan limits',
          metrics: [{
            id: 'five-hour',
            label: '5-hour usage',
            unit: 'USD',
            used: 3,
            limit: 12,
            remaining: 9,
            usedPercent: 25
          }]
        })
      }
    })

    await expect(service.list()).resolves.toMatchObject({
      entries: [{
        providerId: 'opencode-go',
        status: 'available',
        source: 'OpenCode Go local usage estimate',
        metrics: [expect.objectContaining({ id: 'five-hour', usedPercent: 25 })]
      }]
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('shows OpenCode Go subscription usage when the browser cookie resolves', async () => {
    const fetcher = vi.fn(async (
      input: string | URL,
      init: RequestInit | undefined
    ) => {
      const url = String(input)
      if (url.includes('/_server')) {
        return Response.json({ workspaces: [{ id: 'wrk_web123' }] })
      }
      return Response.json({
        rollingUsage: { usagePercent: 22, resetInSec: 1800 },
        weeklyUsage: { used: 9, limit: 30, resetInSec: 604800 },
        monthlyUsage: { used: 11, limit: 60, resetsAt: '2026-08-01T00:00:00.000Z' }
      })
    })
    const service = new ProviderQuotaService({
      loadSource: async () => ({
        profiles: [profile({
          id: 'opencode-go',
          name: 'OpenCode Go',
          presetId: 'opencode-go',
          baseUrl: 'https://opencode.ai/zen/go/v1',
          apiKey: ''
        })],
        proxyUrl: ''
      }),
      fetcher,
      nowIso: () => '2026-07-28T01:31:00.000Z',
      subscriptionRuntime: {
        resolveOpenCodeGoCookie: async () => 'auth=session-token',
        resolveOpenCodeGoQuota: async () => undefined,
        fetchOpenCodeGoWebQuota: async (cookieHeader, context) => {
          const wrap = ((input: string | URL | Request, init?: RequestInit) =>
            context.fetcher(
              typeof input === 'string' || input instanceof URL ? input : input.url,
              init,
              context.proxyUrl
            )) as typeof fetch
          const { fetchOpenCodeGoWebQuota } = await import('./opencode-go-web-quota.js')
          return fetchOpenCodeGoWebQuota({ cookieHeader, fetcher: wrap })
        }
      }
    })

    await expect(service.list()).resolves.toMatchObject({
      entries: [{
        providerId: 'opencode-go',
        status: 'available',
        source: 'OpenCode Go subscription usage',
        summary: 'OpenCode Go subscription · wrk_web123',
        metrics: expect.arrayContaining([
          expect.objectContaining({ id: 'five-hour', usedPercent: 22 }),
          expect.objectContaining({ id: 'weekly', usedPercent: 30 })
        ])
      }]
    })
    expect(fetcher).toHaveBeenCalled()
  })

  it('falls back to local usage when the web quota request fails', async () => {
    const fetcher = vi.fn(async () => new Response('denied', { status: 401 }))
    const service = new ProviderQuotaService({
      loadSource: async () => ({
        profiles: [profile({
          id: 'opencode-go',
          name: 'OpenCode Go',
          presetId: 'opencode-go',
          baseUrl: 'https://opencode.ai/zen/go/v1',
          apiKey: ''
        })],
        proxyUrl: ''
      }),
      fetcher,
      nowIso: () => '2026-07-28T01:31:00.000Z',
      subscriptionRuntime: {
        resolveOpenCodeGoCookie: async () => 'auth=session-token',
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
        }),
        fetchOpenCodeGoWebQuota: async (cookieHeader, context) => {
          const wrap = ((input: string | URL | Request, init?: RequestInit) =>
            context.fetcher(
              typeof input === 'string' || input instanceof URL ? input : input.url,
              init,
              context.proxyUrl
            )) as typeof fetch
          const { fetchOpenCodeGoWebQuota } = await import('./opencode-go-web-quota.js')
          return fetchOpenCodeGoWebQuota({ cookieHeader, fetcher: wrap })
        }
      }
    })

    await expect(service.list()).resolves.toMatchObject({
      entries: [{
        providerId: 'opencode-go',
        status: 'available',
        source: 'OpenCode Go local usage estimate',
        metrics: [expect.objectContaining({ id: 'weekly', usedPercent: 30 })]
      }]
    })
  })

  it('reports missing credentials when neither web nor local usage is available', async () => {
    const service = new ProviderQuotaService({
      loadSource: async () => ({
        profiles: [profile({
          id: 'opencode-go',
          name: 'OpenCode Go',
          presetId: 'opencode-go',
          baseUrl: 'https://opencode.ai/zen/go/v1',
          apiKey: ''
        })],
        proxyUrl: ''
      }),
      fetcher: vi.fn(),
      nowIso: () => '2026-07-28T01:31:00.000Z',
      subscriptionRuntime: {
        resolveOpenCodeGoCookie: async () => undefined,
        resolveOpenCodeGoQuota: async () => undefined
      }
    })

    await expect(service.list()).resolves.toMatchObject({
      entries: [{
        providerId: 'opencode-go',
        status: 'missing_credentials',
        message: 'Sign in to opencode.ai in your browser, or use OpenCode Go locally first so its usage history exists.'
      }]
    })
  })

  it('refreshes and retries a rejected Codex quota credential', async () => {
    const resolveCodexCredential = vi.fn(async (
      _provider: ProviderQuotaProbeProfile,
      rejectedAccessToken?: string
    ) => rejectedAccessToken
      ? { accessToken: 'codex-retry-access', accountId: 'acct-retry' }
      : { accessToken: 'codex-rejected-access', accountId: 'acct-retry' })
    const fetcher = vi.fn(async (
      _input: string | URL,
      init: RequestInit | undefined
    ) => {
      const authorization = new Headers(init?.headers).get('authorization')
      if (authorization === 'Bearer codex-rejected-access') {
        return new Response('expired', { status: 403 })
      }
      expect(authorization).toBe('Bearer codex-retry-access')
      expect(new Headers(init?.headers).get('user-agent')).toMatch(/^codex_cli_rs\//)
      return Response.json({
        plan_type: 'pro',
        rate_limit: {
          primary_window: {
            used_percent: 9,
            reset_at: 1_900_000_000,
            limit_window_seconds: 18_000
          }
        }
      })
    })
    const service = new ProviderQuotaService({
      loadSource: async () => ({
        profiles: [profile({
          id: 'codex',
          name: 'Codex',
          presetId: 'codex',
          baseUrl: 'https://chatgpt.com/backend-api/codex/responses',
          apiKey: ''
        })],
        proxyUrl: ''
      }),
      fetcher,
      subscriptionRuntime: { resolveCodexCredential }
    })

    await expect(service.list()).resolves.toMatchObject({
      entries: [{
        providerId: 'codex',
        status: 'available',
        metrics: [expect.objectContaining({ id: 'primary', usedPercent: 9 })]
      }]
    })
    expect(resolveCodexCredential).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'codex-rejected-access',
      expect.objectContaining({ fetcher, proxyUrl: '' })
    )
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('refreshes and retries a rejected Grok quota credential', async () => {
    const resolveGrokCredential = vi.fn(async (
      _provider: ProviderQuotaProbeProfile,
      rejectedAccessToken?: string
    ) => rejectedAccessToken
      ? { accessToken: 'grok-retry-access' }
      : { accessToken: 'grok-rejected-access' })
    const fetcher = vi.fn(async (
      _input: string | URL,
      init: RequestInit | undefined
    ) => {
      const authorization = new Headers(init?.headers).get('authorization')
      if (authorization === 'Bearer grok-rejected-access') {
        return new Response('expired', { status: 403 })
      }
      expect(authorization).toBe('Bearer grok-retry-access')
      return new Response(grokBillingFrame(14, 1_900_000_000), {
        headers: { 'Content-Type': 'application/grpc-web+proto' }
      })
    })
    const service = new ProviderQuotaService({
      loadSource: async () => ({
        profiles: [profile({
          id: 'grok-subscription',
          name: 'Grok',
          presetId: 'grok-subscription',
          baseUrl: 'https://cli-chat-proxy.grok.com/v1',
          apiKey: ''
        })],
        proxyUrl: ''
      }),
      fetcher,
      subscriptionRuntime: { resolveGrokCredential }
    })

    await expect(service.list()).resolves.toMatchObject({
      entries: [{
        providerId: 'grok-subscription',
        status: 'available',
        metrics: [expect.objectContaining({ id: 'credits', usedPercent: 14 })]
      }]
    })
    expect(resolveGrokCredential).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'grok-rejected-access',
      expect.objectContaining({ fetcher, proxyUrl: '' })
    )
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('reports the Gemini CLI migration reason before requesting quota', async () => {
    const fetcher = vi.fn(async (
      input: string | URL,
      init: RequestInit | undefined
    ) => {
      expect(String(input)).toContain(':loadCodeAssist')
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
    const service = new ProviderQuotaService({
      loadSource: async () => ({
        profiles: [profile({
          id: 'gemini-cli-subscription',
          name: 'Gemini CLI',
          presetId: 'gemini-cli-subscription',
          kind: 'gemini-cli-api',
          baseUrl: undefined,
          apiKey: ''
        })],
        proxyUrl: ''
      }),
      fetcher,
      subscriptionRuntime: {
        resolveGeminiCliToken: async () => 'gemini-cli-access'
      }
    })

    await expect(service.list()).resolves.toMatchObject({
      entries: [{
        providerId: 'gemini-cli-subscription',
        status: 'error',
        message: 'This client is no longer supported. Migrate to Antigravity.'
      }]
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

})

describe('provider quota response parsers', () => {
  it('parses API-key account balances and usage windows', () => {
    expect(parseDeepSeekQuota({
      balance_infos: [{
        currency: 'CNY',
        total_balance: '10.5',
        topped_up_balance: '8',
        granted_balance: '2.5'
      }]
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'balance', remaining: 10.5 }),
      expect.objectContaining({ id: 'granted-balance', remaining: 2.5 })
    ]))

    expect(parseOpenRouterQuota(
      { data: { total_credits: 20, total_usage: 5 } },
      { data: { limit: 10, usage: 2 } }
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'credits', limit: 20, used: 5, usedPercent: 25 }),
      expect.objectContaining({ id: 'key-budget', limit: 10, used: 2 })
    ]))

    expect(parseMoonshotQuota({
      code: 0,
      status: true,
      data: { available_balance: 7, cash_balance: 5, voucher_balance: 2 }
    })[0]).toMatchObject({ id: 'available-balance', remaining: 7 })
  })

  it('parses coding-plan, credit-grant, and model allowance responses', () => {
    expect(parseZaiQuota({
      code: 200,
      success: true,
      data: {
        planName: 'Pro',
        limits: [{
          type: 'TOKENS_LIMIT',
          usage: 1_000,
          remaining: 250,
          percentage: 75,
          nextResetTime: 1_775_000_000_000
        }]
      }
    })).toMatchObject({
      summary: 'Pro',
      metrics: [expect.objectContaining({ used: 750, limit: 1_000, remaining: 250, usedPercent: 75 })]
    })

    expect(parseMiniMaxQuota({
      data: {
        current_subscribe_title: 'Coding Plan',
        model_remains: [{
          model_name: 'MiniMax-M2',
          end_time: 1_775_003_600_000,
          current_interval_usage_count: 80,
          current_interval_total_count: 100,
          current_interval_remaining_percent: 80
        }]
      }
    })).toMatchObject({
      summary: 'Coding Plan',
      metrics: [expect.objectContaining({ remaining: 80, limit: 100 })]
    })

    expect(parseOpenAiQuota({
      total_granted: 18,
      total_used: 3,
      total_available: 15
    })[0]).toMatchObject({ id: 'credits', limit: 18, used: 3, remaining: 15 })

    expect(parseKimiCodeQuota({
      usage: { limit: 2_048, remaining: 1_673, resetTime: '2027-01-09T15:23:13.373Z' },
      limits: [{
        window: { duration: 300, timeUnit: 'MINUTE' },
        detail: { limit: 200, remaining: 181 }
      }]
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'weekly', used: 375, limit: 2_048 }),
      expect.objectContaining({ id: 'rate-limit-0', usedPercent: 9.5 })
    ]))
  })

  it('keeps usable Z.ai quota type variants visible', () => {
    const result = parseZaiQuota({
      code: 200,
      success: true,
      data: {
        level: 'pro',
        limits: [
          { type: 'WEEKLY_TOKENS_LIMIT', percentage: 135, usage: 1_000 },
          { percentage: -5 }
        ]
      }
    })
    expect(result).toEqual({
      summary: 'pro',
      metrics: [
        {
          id: 'weekly-tokens-limit-0',
          label: 'Weekly tokens limit quota',
          unit: 'percent',
          usedPercent: 100
        },
        { id: 'quota-1', label: 'Quota 2', unit: 'percent', usedPercent: 0 }
      ]
    })
    expect(() => parseZaiQuota({
      code: 200,
      success: true,
      data: { limits: [] }
    })).toThrow('Z.ai did not return a recognized quota limit.')
    expect(() => parseZaiQuota({
      code: 200,
      success: true,
      data: { limits: [{ type: 'FUTURE_LIMIT', percentage: 'unknown' }] }
    })).toThrow('Z.ai did not return a recognized quota limit.')
  })

  it('normalizes credit-based Z.ai Coding Plan windows', () => {
    const result = parseZaiQuota({
      code: 200,
      success: true,
      data: {
        level: 'lite',
        limits: [
          {
            type: 'CREDIT_LIMIT', unit: 3, number: 5, usage: 2_000,
            currentValue: 71, remaining: 1_929, percentage: 3,
            nextResetTime: 1_786_073_946_574
          },
          {
            type: 'CREDIT_LIMIT', unit: 6, number: 1, usage: 10_000,
            currentValue: 71, remaining: 9_929, percentage: 1,
            nextResetTime: 1_786_660_486_998
          }
        ]
      }
    })
    expect(result).toMatchObject({
      summary: 'lite',
      metrics: [
        {
          id: 'credit_limit-0', label: '5-hour credit quota', unit: 'credits',
          used: 71, limit: 2_000, remaining: 1_929, usedPercent: 3.55,
          resetsAt: new Date(1_786_073_946_574).toISOString()
        },
        {
          id: 'credit_limit-1', label: '1-week credit quota', unit: 'credits',
          used: 71, limit: 10_000, remaining: 9_929,
          resetsAt: new Date(1_786_660_486_998).toISOString()
        }
      ]
    })
    expect(result.metrics[1]?.usedPercent).toBeCloseTo(0.71, 8)
  })
})

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

describe('provider quota parsers', () => {
  it('normalizes DeepSeek monetary balances', () => {
    expect(parseDeepSeekQuota({
      is_available: true,
      balance_infos: [{
        currency: 'CNY',
        total_balance: '12.50',
        granted_balance: '2.50',
        topped_up_balance: '10.00'
      }]
    })).toEqual([
      { id: 'balance', label: 'Account balance', unit: 'CNY', remaining: 12.5 },
      { id: 'paid-balance', label: 'Paid balance', unit: 'CNY', remaining: 10 },
      { id: 'granted-balance', label: 'Granted balance', unit: 'CNY', remaining: 2.5 }
    ])
  })

  it('normalizes OpenRouter credits and an optional API-key budget', () => {
    expect(parseOpenRouterQuota(
      { data: { total_credits: 100, total_usage: 25 } },
      { data: { limit: 20, usage: 5 } }
    )).toEqual([
      {
        id: 'credits',
        label: 'Credits',
        unit: 'USD',
        used: 25,
        limit: 100,
        remaining: 75,
        usedPercent: 25
      },
      {
        id: 'key-budget',
        label: 'API key budget',
        unit: 'USD',
        used: 5,
        limit: 20,
        remaining: 15,
        usedPercent: 25
      }
    ])
  })

  it('normalizes Moonshot balance components', () => {
    expect(parseMoonshotQuota({
      code: 0,
      status: true,
      data: { available_balance: 8.5, cash_balance: 6, voucher_balance: 2.5 }
    })).toHaveLength(3)
  })

  it('normalizes Z.ai token and request windows', () => {
    const result = parseZaiQuota({
      code: 200,
      success: true,
      data: {
        planName: 'Lite plan',
        limits: [{
          type: 'TOKENS_LIMIT',
          unit: 3,
          number: 5,
          usage: 1000,
          currentValue: 250,
          remaining: 750,
          percentage: 25,
          nextResetTime: 1_800_000_000_000
        }]
      }
    })
    expect(result.summary).toBe('Lite plan')
    expect(result.metrics[0]).toMatchObject({
      label: '5-hour token quota',
      unit: 'tokens',
      used: 250,
      limit: 1000,
      remaining: 750,
      usedPercent: 25,
      resetsAt: '2027-01-15T08:00:00.000Z'
    })
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

  it('normalizes MiniMax interval and weekly remains', () => {
    const result = parseMiniMaxQuota({
      base_resp: { status_code: 0 },
      current_subscribe_title: 'Coding Plan Plus',
      model_remains: [{
        model_name: 'MiniMax-M2.5',
        current_interval_total_count: 100,
        current_interval_usage_count: 60,
        current_interval_remaining_percent: 60,
        end_time: 1_800_000_000,
        current_weekly_total_count: 1000,
        current_weekly_usage_count: 700,
        current_weekly_remaining_percent: 70,
        weekly_end_time: 1_800_086_400
      }]
    })
    expect(result.summary).toBe('Coding Plan Plus')
    expect(result.metrics).toEqual([
      {
        id: 'interval-0',
        label: 'MiniMax-M2.5 interval quota',
        unit: 'requests',
        used: 40,
        limit: 100,
        remaining: 60,
        usedPercent: 40,
        resetsAt: '2027-01-15T08:00:00.000Z'
      },
      {
        id: 'weekly-0',
        label: 'MiniMax-M2.5 weekly quota',
        unit: 'requests',
        used: 300,
        limit: 1000,
        remaining: 700,
        usedPercent: 30,
        resetsAt: '2027-01-16T08:00:00.000Z'
      }
    ])
  })

  it('handles MiniMax percentage-only windows and skips unavailable quota lanes', () => {
    const result = parseMiniMaxQuota({
      model_remains: [{
        model_name: 'general',
        current_interval_total_count: 0,
        current_interval_usage_count: 0,
        current_interval_remaining_percent: 96,
        current_interval_status: 1,
        end_time: 1_800_000_000_000,
        current_weekly_total_count: 0,
        current_weekly_usage_count: 0,
        current_weekly_remaining_percent: 70,
        current_weekly_status: 1,
        weekly_end_time: 1_800_086_400_000
      }, {
        model_name: 'video',
        current_interval_total_count: 0,
        current_interval_usage_count: 0,
        current_interval_remaining_percent: 100,
        current_interval_status: 3
      }],
      base_resp: { status_code: 0 }
    })

    expect(result.metrics).toEqual([
      {
        id: 'interval-0',
        label: 'general interval quota',
        unit: 'requests',
        usedPercent: 4,
        resetsAt: '2027-01-15T08:00:00.000Z'
      },
      {
        id: 'weekly-0',
        label: 'general weekly quota',
        unit: 'requests',
        usedPercent: 30,
        resetsAt: '2027-01-16T08:00:00.000Z'
      }
    ])
  })

  it('normalizes OpenAI credit grants without inventing missing fields', () => {
    expect(parseOpenAiQuota({
      total_granted: 50,
      total_used: 10,
      total_available: 40,
      grants: { data: [] }
    })[0]).toEqual({
      id: 'credits',
      label: 'Credits',
      unit: 'USD',
      used: 10,
      limit: 50,
      remaining: 40,
      usedPercent: 20
    })
  })

  it('normalizes Kimi Code weekly and five-hour request quotas', () => {
    expect(parseKimiCodeQuota({
      usage: {
        limit: '2048',
        used: '375',
        remaining: '1673',
        resetTime: '2027-01-09T15:23:13.373329235Z'
      },
      limits: [{
        window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
        detail: {
          limit: '200',
          remaining: '181',
          reset_at: '2027-01-06T15:05:24.374187075Z'
        }
      }]
    })).toEqual([
      {
        id: 'weekly',
        label: 'Weekly request quota',
        unit: 'requests',
        used: 375,
        limit: 2048,
        remaining: 1673,
        usedPercent: 18.310546875,
        resetsAt: '2027-01-09T15:23:13.373Z'
      },
      {
        id: 'rate-limit-0',
        label: '5-hour rate limit',
        unit: 'requests',
        used: 19,
        limit: 200,
        remaining: 181,
        usedPercent: 9.5,
        resetsAt: '2027-01-06T15:05:24.374Z'
      }
    ])
  })

  it('normalizes Grok gRPC-web billing frames', () => {
    expect(parseGrokSubscriptionQuota(
      grokBillingFrame(42.5, 1_900_000_000),
      new Date('2027-01-01T00:00:00Z')
    )).toEqual([{
      id: 'credits',
      label: 'Credits usage',
      unit: 'percent',
      usedPercent: 42.5,
      resetsAt: '2030-03-17T17:46:40.000Z'
    }])
  })

  it('normalizes Claude and Codex subscription usage windows', () => {
    expect(parseClaudeSubscriptionQuota({
      five_hour: { utilization: 35, resets_at: '2027-01-15T09:00:00Z' },
      seven_day: { utilization: 20, resets_at: '2027-01-20T09:00:00Z' }
    })).toEqual([
      {
        id: 'five-hour',
        label: '5-hour usage',
        unit: 'percent',
        usedPercent: 35,
        resetsAt: '2027-01-15T09:00:00.000Z'
      },
      {
        id: 'seven-day',
        label: '7-day usage',
        unit: 'percent',
        usedPercent: 20,
        resetsAt: '2027-01-20T09:00:00.000Z'
      }
    ])

    expect(parseCodexSubscriptionQuota({
      plan_type: 'plus',
      rate_limit: {
        primary_window: {
          used_percent: 45,
          reset_at: 1_800_000_000,
          limit_window_seconds: 18_000
        },
        secondary_window: {
          used_percent: 12,
          reset_at: 1_800_086_400,
          limit_window_seconds: 604_800
        }
      },
      additional_rate_limits: [{
        limit_name: 'codex_spark',
        rate_limit: {
          primary_window: {
            used_percent: 7,
            reset_at: 1_800_172_800,
            limit_window_seconds: 604_800
          }
        }
      }]
    })).toMatchObject({
      summary: 'plus',
      metrics: [
        { id: 'primary', label: '5-hour usage', usedPercent: 45 },
        { id: 'secondary', label: '1-week usage', usedPercent: 12 },
        {
          id: 'additional-0-primary',
          label: 'Spark - 1-week usage',
          usedPercent: 7
        }
      ]
    })
  })

  it('maps Codex rate-limit reset credits into a display metric', () => {
    const usage = {
      plan_type: 'pro',
      rate_limit: {
        primary_window: {
          used_percent: 45,
          reset_at: 1_800_000_000,
          limit_window_seconds: 18_000
        }
      },
      rate_limit_reset_credits: { available_count: 3 }
    }
    expect(parseCodexSubscriptionQuota(usage)).toMatchObject({
      metrics: [
        { id: 'primary' },
        {
          id: 'reset-credits',
          label: 'Rate-limit resets',
          unit: 'credits',
          remaining: 3
        }
      ]
    })
    const withoutCredits = parseCodexSubscriptionQuota(usage).metrics
      .find((metric) => metric.id === 'reset-credits')
    expect(withoutCredits?.resetsAt).toBeUndefined()

    const details = {
      available_count: 2,
      total_earned_count: 4,
      credits: [
        {
          id: 'credit-1',
          reset_type: 'codex_rate_limits',
          status: 'available',
          granted_at: '2026-06-17T00:00:00Z',
          expires_at: '2999-07-17T00:00:00Z',
          title: 'Full reset (Weekly + 5 hr)'
        },
        {
          id: 'credit-2',
          reset_type: 'codex_rate_limits',
          status: 'redeemed',
          granted_at: '2026-06-18T00:00:00Z',
          expires_at: '2999-08-17T00:00:00Z'
        },
        {
          id: 'credit-3',
          reset_type: 'codex_rate_limits',
          status: 'available',
          granted_at: '2026-06-19T00:00:00Z',
          expires_at: '2000-01-01T00:00:00Z'
        }
      ]
    }
    const withDetails = parseCodexSubscriptionQuota(usage, details).metrics
      .find((metric) => metric.id === 'reset-credits')
    expect(withDetails).toMatchObject({ remaining: 2, unit: 'credits' })
    expect(withDetails?.resetsAt).toBe('2999-07-17T00:00:00.000Z')

    const zeroed = parseCodexSubscriptionQuota({
      ...usage,
      rate_limit_reset_credits: { available_count: 0 }
    }).metrics
    expect(zeroed.some((metric) => metric.id === 'reset-credits')).toBe(false)

    const baseline = parseCodexSubscriptionQuota({
      plan_type: 'plus',
      rate_limit: {
        primary_window: {
          used_percent: 45,
          reset_at: 1_800_000_000,
          limit_window_seconds: 18_000
        }
      }
    }).metrics
    expect(baseline.some((metric) => metric.id === 'reset-credits')).toBe(false)
  })

  it('normalizes Cursor and Google subscription allowances', () => {
    expect(parseCursorSubscriptionQuota({
      billingCycleEnd: '2027-02-01T00:00:00Z',
      membershipType: 'pro',
      individualUsage: {
        plan: {
          enabled: true,
          used: 750,
          limit: 2_000,
          remaining: 1_250,
          totalPercentUsed: 37.5
        },
        onDemand: { enabled: true, used: 125, limit: 1_000, remaining: 875 }
      }
    })).toMatchObject({
      summary: 'pro',
      metrics: [
        {
          id: 'included-plan',
          unit: 'USD',
          used: 7.5,
          limit: 20,
          remaining: 12.5,
          usedPercent: 37.5
        },
        {
          id: 'on-demand',
          used: 1.25,
          limit: 10,
          remaining: 8.75
        }
      ]
    })

    expect(parseGoogleCodeAssistQuota({
      buckets: [{
        modelId: 'gemini-pro',
        remainingFraction: 0.65,
        resetTime: '2027-01-16T00:00:00Z'
      }]
    })).toEqual([{
      id: 'bucket-0',
      label: 'gemini-pro',
      unit: 'percent',
      usedPercent: 35,
      resetsAt: '2027-01-16T00:00:00.000Z'
    }])
  })

  it('decodes the official Antigravity unified OAuth protobuf without exposing it', () => {
    const field = (number: number, value: string | Buffer): Buffer => {
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value)
      const varint = (input: number): Buffer => {
        const output: number[] = []
        let remaining = input
        do {
          const byte = remaining & 0x7f
          remaining = Math.floor(remaining / 128)
          output.push(remaining ? byte | 0x80 : byte)
        } while (remaining)
        return Buffer.from(output)
      }
      return Buffer.concat([varint((number << 3) | 2), varint(bytes.length), bytes])
    }
    const tokenInfo = Buffer.concat([
      field(1, 'ya29.test-access-token'),
      field(3, '1//test-refresh-token')
    ]).toString('base64')
    const wrapper = field(1, tokenInfo)
    const entry = Buffer.concat([
      field(1, 'oauthTokenInfoSentinelKey'),
      field(2, wrapper)
    ])
    const encoded = field(1, entry).toString('base64')

    expect(decodeAntigravityUnifiedOAuth(encoded)).toEqual({
      accessToken: 'ya29.test-access-token',
      refreshToken: '1//test-refresh-token'
    })
  })
})

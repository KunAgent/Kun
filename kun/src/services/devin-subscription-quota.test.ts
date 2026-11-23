import { describe, expect, it, vi } from 'vitest'
import { HarnessesConfigSchema } from '../config/kun-config-harnesses.js'
import { DEVIN_DEFINITION } from '../harness/providers/devin.js'
import {
  appendNativeDevinQuotaProfile,
  clearDevinLocalLoginCache,
  devinCredentialsTomlPath,
  parseDevinCredentialsToml,
  parseDevinSubscriptionQuota,
  resolveDevinQuotaCredential
} from './devin-subscription-quota.js'
import { nativeComposerSubscriptionProfile } from './native-composer-subscription-quota.js'
import { scopedQuotaFetch } from './provider-quota-security.js'
import { ProviderQuotaService, classifyProviderQuotaProbe } from './provider-quota-service-core.js'
import type { ProviderQuotaFetch, ProviderQuotaProbeProfile } from './provider-subscription-quota-service.js'

describe('Devin subscription quota credentials and parser', () => {
  it('resolves credentials.toml across platforms and enforces official API hosts', async () => {
    clearDevinLocalLoginCache()
    expect(devinCredentialsTomlPath({
      platform: 'darwin',
      home: '/Users/alice',
      env: {}
    })).toBe('/Users/alice/.local/share/devin/credentials.toml')

    expect(devinCredentialsTomlPath({
      platform: 'win32',
      home: 'C:\\Users\\alice',
      env: { APPDATA: 'C:\\Users\\alice\\AppData\\Roaming' }
    })).toContain('devin')

    const parsed = parseDevinCredentialsToml([
      '# Managed by devin auth login',
      'windsurf_api_key = "sk-ws-test-token"',
      'api_server_url = "https://server.codeium.com"',
      'devin_webapp_host = "app.devin.ai"'
    ].join('\n'))
    expect(parsed).toEqual({
      apiKey: 'sk-ws-test-token',
      apiServerUrl: 'https://server.codeium.com'
    })

    await expect(resolveDevinQuotaCredential(undefined, {
      platform: 'darwin',
      home: '/Users/alice',
      env: {},
      readText: async () => 'windsurf_api_key = "sk-ws-toml"\napi_server_url = "https://server-beta.codeium.com/"\n'
    })).resolves.toEqual({
      apiKey: 'sk-ws-toml',
      apiServerUrl: 'https://server-beta.codeium.com'
    })

    // Rejects third-party relay server URLs and non-windsurf ACP_BACKEND overrides.
    await expect(resolveDevinQuotaCredential(undefined, {
      platform: 'darwin',
      home: '/Users/alice',
      env: {},
      readText: async () => 'windsurf_api_key = "sk-ws-toml"\napi_server_url = "https://relay.attacker.test"\n'
    })).resolves.toBeUndefined()

    await expect(resolveDevinQuotaCredential(undefined, {
      platform: 'darwin',
      home: '/Users/alice',
      env: { ACP_BACKEND: 'openai', WINDSURF_API_KEY: 'sk-ws-env' },
      readText: async () => ''
    })).resolves.toBeUndefined()
  })

  it('automatically appends native:devin when enabled or signed in locally, unless disabled', async () => {
    const withLogin = await appendNativeDevinQuotaProfile(
      [],
      { harnesses: HarnessesConfigSchema.parse({}) },
      {
        detectLogin: async () => ({
          configured: true,
          fingerprint: 'abcdef0123456789fedcba',
          apiServerUrl: 'https://server.codeium.com'
        })
      }
    )
    expect(withLogin).toEqual([
      expect.objectContaining({
        id: 'native:devin',
        name: 'Devin',
        accountId: 'native:abcdef0123456789',
        presetId: 'devin-subscription',
        kind: 'http',
        authType: 'subscription',
        baseUrl: 'https://server.codeium.com',
        configured: true
      })
    ])

    // Does not duplicate an existing Devin profile or append when disabled.
    const deduplicated = await appendNativeDevinQuotaProfile(
      withLogin,
      { harnesses: HarnessesConfigSchema.parse({}) },
      {
        detectLogin: async () => ({
          configured: true,
          fingerprint: 'abcdef0123456789fedcba',
          apiServerUrl: 'https://server.codeium.com'
        })
      }
    )
    expect(deduplicated).toHaveLength(1)

    const disabled = await appendNativeDevinQuotaProfile(
      [],
      { harnesses: HarnessesConfigSchema.parse({ disabledIds: ['devin'], defaultHarnessId: 'devin' }) },
      {
        detectLogin: async () => ({
          configured: true,
          fingerprint: 'abcdef0123456789fedcba',
          apiServerUrl: 'https://server.codeium.com'
        })
      }
    )
    expect(disabled).toEqual([])
  })

  it('parses rolling Daily/Weekly quota windows while ignoring -1 credit sentinels and negative micros', () => {
    const parsed = parseDevinSubscriptionQuota({
      userStatus: {
        email: 'dev@example.com',
        teamsTier: 'TEAMS_TIER_DEVIN_PRO',
        planStatus: {
          planStart: '2026-11-10T17:24:15Z',
          planEnd: '2026-12-10T17:24:15Z',
          availablePromptCredits: -1,
          dailyQuotaRemainingPercent: 62,
          dailyQuotaResetAtUnix: '1794816000',
          weeklyQuotaRemainingPercent: 81,
          weeklyQuotaResetAtUnix: '1795334400',
          overageBalanceMicros: '-37800',
          planInfo: {
            planName: 'Pro',
            teamsTier: 'TEAMS_TIER_DEVIN_PRO',
            billingStrategy: 'BILLING_STRATEGY_QUOTA',
            monthlyPromptCredits: -1
          }
        }
      }
    })
    expect(parsed.summary).toBe('Pro · dev@example.com')
    expect(parsed.metrics).toEqual([
      {
        id: 'daily',
        label: 'Daily quota',
        unit: 'percent',
        usedPercent: 38,
        windowSeconds: 86_400,
        resetsAt: new Date(1_794_816_000 * 1_000).toISOString()
      },
      {
        id: 'weekly',
        label: 'Weekly quota',
        unit: 'percent',
        usedPercent: 19,
        windowSeconds: 604_800,
        resetsAt: new Date(1_795_334_400 * 1_000).toISOString()
      }
    ])
  })

  it('parses Monthly ACU, spend, top-up, credits, and positive extra usage balance', () => {
    const parsed = parseDevinSubscriptionQuota({
      userStatus: {
        email: 'team@example.com',
        planStatus: {
          planEnd: '2026-12-01T00:00:00.000Z',
          acuConsumed: 12.5,
          acuLimit: 50,
          dollarsConsumed: 40,
          dollarsLimit: 200,
          availablePromptCredits: 350,
          overageBalanceMicros: '12500000',
          topUpStatus: {
            topUpEnabled: true,
            monthlyTopUpAmount: 100,
            topUpSpent: 25
          },
          planInfo: {
            teamsTier: 'TEAMS_TIER_DEVIN_TEAM',
            hideDailyQuota: true,
            monthlyPromptCredits: 500
          }
        }
      }
    })
    expect(parsed.summary).toBe('Team · team@example.com')
    expect(parsed.metrics).toEqual([
      {
        id: 'monthly-acu',
        label: 'Monthly ACU',
        unit: 'ACU',
        used: 12.5,
        limit: 50,
        remaining: 37.5,
        usedPercent: 25,
        windowSeconds: 2_592_000,
        resetsAt: '2026-12-01T00:00:00.000Z'
      },
      {
        id: 'monthly-spend',
        label: 'Monthly spend',
        unit: 'USD',
        used: 40,
        limit: 200,
        remaining: 160,
        usedPercent: 20,
        windowSeconds: 2_592_000,
        resetsAt: '2026-12-01T00:00:00.000Z'
      },
      {
        id: 'monthly-top-up',
        label: 'Monthly top-up',
        unit: 'USD',
        used: 25,
        limit: 100,
        remaining: 75,
        usedPercent: 25,
        resetsAt: '2026-12-01T00:00:00.000Z'
      },
      {
        id: 'prompt-credits',
        label: 'Prompt credits',
        unit: 'credits',
        used: 150,
        limit: 500,
        remaining: 350,
        usedPercent: 30,
        windowSeconds: 2_592_000,
        resetsAt: '2026-12-01T00:00:00.000Z'
      },
      {
        id: 'overage-balance',
        label: 'Extra usage balance',
        unit: 'USD',
        remaining: 12.5
      }
    ])
  })

  it('serves Devin quota in both ProviderQuotaService.list and composer subscription queries', async () => {
    const devinProfile: ProviderQuotaProbeProfile = {
      id: 'native:devin',
      name: 'Devin',
      presetId: 'devin-subscription',
      kind: 'http',
      authType: 'subscription',
      baseUrl: 'https://server.codeium.com',
      apiKey: 'sk-ws-live',
      configured: true
    }
    expect(classifyProviderQuotaProbe(devinProfile)).toEqual({
      kind: 'devin-subscription',
      source: 'Devin subscription quota API',
      dashboardUrl: 'https://app.devin.ai/settings/usage'
    })
    expect(classifyProviderQuotaProbe({
      ...devinProfile,
      baseUrl: 'https://relay.attacker.test'
    })).toBeNull()

    const fetcher = vi.fn<ProviderQuotaFetch>(async (url, init) => {
      expect(String(url)).toBe(
        'https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus'
      )
      expect(new Headers(init?.headers).get('Connect-Protocol-Version')).toBe('1')
      const body = JSON.parse(String(init?.body ?? '{}')) as { metadata?: { apiKey?: string } }
      expect(body.metadata?.apiKey).toBe('sk-ws-live')
      return Response.json({
        userStatus: {
          email: 'dev@example.com',
          planStatus: {
            dailyQuotaRemainingPercent: 70,
            dailyQuotaResetAtUnix: '1794816000',
            weeklyQuotaRemainingPercent: 85,
            weeklyQuotaResetAtUnix: '1795334400',
            planInfo: { planName: 'Pro' }
          }
        }
      })
    })
    const scoped = scopedQuotaFetch(fetcher, devinProfile, 'devin-subscription')
    await expect(
      scoped('https://evil.test/GetUserStatus', { method: 'POST', body: '{}' }, '')
    ).rejects.toThrow('adapter credential scope')

    const nativeProfile = await nativeComposerSubscriptionProfile({
      definition: DEVIN_DEFINITION,
      baseEnv: { HOME: '/Users/alice' },
      platform: 'darwin',
      readText: async () => 'windsurf_api_key = "sk-ws-live"\n'
    })
    expect(nativeProfile).toMatchObject({
      id: 'native:devin',
      presetId: 'devin-subscription',
      baseUrl: 'https://server.codeium.com',
      apiKey: 'sk-ws-live'
    })

    const service = new ProviderQuotaService({
      loadSource: async () => ({ profiles: [{ ...devinProfile, apiKey: '' }] }),
      fetcher,
      subscriptionRuntime: {
        resolveDevinCredential: async () => ({
          apiKey: 'sk-ws-live',
          apiServerUrl: 'https://server.codeium.com'
        })
      }
    })
    const listed = await service.list()
    expect(listed.entries).toEqual([
      expect.objectContaining({
        providerId: 'native:devin',
        providerName: 'Devin',
        presetId: 'devin-subscription',
        status: 'available',
        summary: 'Pro · dev@example.com',
        dashboardUrl: 'https://app.devin.ai/settings/usage',
        metrics: [
          expect.objectContaining({ id: 'daily', usedPercent: 30, windowSeconds: 86_400 }),
          expect.objectContaining({ id: 'weekly', usedPercent: 15, windowSeconds: 604_800 })
        ]
      })
    ])

    const composer = await service.subscription(
      { harnessId: 'devin', credentialMode: 'native-login', providerId: 'default' },
      async () => nativeProfile
    )
    expect(composer.entry).toMatchObject({
      providerId: 'native:devin',
      status: 'available',
      summary: 'Pro · dev@example.com',
      metrics: [
        expect.objectContaining({ id: 'daily', usedPercent: 30 }),
        expect.objectContaining({ id: 'weekly', usedPercent: 15 })
      ]
    })
    expect(JSON.stringify(composer)).not.toContain('sk-ws-live')
  })
})

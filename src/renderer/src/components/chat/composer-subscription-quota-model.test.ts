import { describe, expect, it } from 'vitest'
import type { ProviderQuotaEntry } from '@shared/provider-quota'
import { composerQuotaWindowLabel, composerQuotaWindows } from './composer-subscription-quota-model'
import { composerSubscriptionSelection } from './composer-subscription-selection'

const entry = (metrics: ProviderQuotaEntry['metrics'], status: ProviderQuotaEntry['status'] = 'available'): ProviderQuotaEntry => ({ providerId: 'test', providerName: 'Test', status, metrics })

describe('composer subscription evidence', () => {
  it('keeps 0% remaining, orders real windows, and omits unknown/nonfinite usage', () => {
    const result = composerQuotaWindows(entry([
      { id: 'weekly', label: 'Weekly', unit: 'percent', usedPercent: 50, windowSeconds: 604_800 },
      { id: 'primary', label: 'Primary', unit: 'percent', usedPercent: 100, windowSeconds: 18_000 },
      { id: 'unknown', label: 'Unknown', unit: 'percent' },
      { id: 'bad', label: 'Bad', unit: 'percent', usedPercent: Number.NaN },
      { id: 'balance', label: 'API balance', unit: 'USD', usedPercent: 40, limit: 10, remaining: 6 },
      { id: 'invalid-limit', label: 'Invalid', unit: 'percent', limit: Infinity, used: 4 }
    ]))
    expect(result.map(({ metric, remainingPercent }) => [metric.id, remainingPercent])).toEqual([['primary', 0], ['weekly', 50]])
    for (const status of ['unsupported', 'missing_credentials', 'error'] as const) {
      expect(composerQuotaWindows(entry([{ id: 'old', label: 'Old', unit: 'percent', usedPercent: 1 }], status))).toEqual([])
    }
  })

  it('displays exact sub-hour and fractional-hour periods without guessing primary', () => {
    const t = (key: string, values?: Record<string, unknown>): string => `${key}${values ? `:${values.count}` : ''}`
    const metric = { id: 'primary', label: 'Primary', unit: 'percent' }
    expect(composerQuotaWindowLabel(metric, t)).toBe('Primary')
    expect(composerQuotaWindowLabel({ ...metric, windowSeconds: 1_800 }, t)).toBe('subscriptionQuota.windowMinutes:30')
    expect(composerQuotaWindowLabel({ ...metric, windowSeconds: 27_000 }, t)).toBe('subscriptionQuota.windowHours:7.5')
    expect(composerQuotaWindowLabel({ ...metric, windowSeconds: 18_000 }, t)).toBe('subscriptionQuota.windowHours:5')
    expect(composerQuotaWindowLabel({ ...metric, windowSeconds: 604_800 }, t)).toBe('subscriptionQuota.weekly')
  })

  it('matches native send routing instead of guessing an account from the model name', () => {
    const input = { enabled: true, harnessId: 'codex', credentialMode: 'native-login', model: 'gpt', modelGroups: [
      { providerId: 'http-account', label: 'API key', accountId: 'api-account', modelIds: ['gpt'] }
    ] }
    expect(composerSubscriptionSelection(input)).toEqual({ harnessId: 'codex', credentialMode: 'native-login', providerId: 'default' })
    expect(composerSubscriptionSelection({ ...input, providerId: 'personal-native' })?.providerId).toBe('personal-native')
    expect(composerSubscriptionSelection({ ...input, credentialMode: 'provider', providerId: 'http-account' })?.accountId).toBe('api-account')
    expect(composerSubscriptionSelection({ ...input, enabled: false })).toBeUndefined()
    expect(composerSubscriptionSelection({ ...input, credentialMode: 'kun-gateway' })).toBeUndefined()
    expect(composerSubscriptionSelection({ ...input, harnessId: 'kun' })).toBeUndefined()
  })
})


it('labels a one-week window without a stray numeric scope', () => {
  expect(composerQuotaWindowLabel({ id: 'primary', label: '1 week', unit: 'percent', usedPercent: 37, windowSeconds: 604800 },
    key => key === 'subscriptionQuota.weekly' ? 'Weekly' : key)).toBe('Weekly')
})

it('shows the Claude global weekly limit only once when the provider returns both formats', () => {
  const windows = composerQuotaWindows({ providerId: 'claude', providerName: 'Claude', presetId: 'claude-subscription', status: 'available', metrics: [
    { id: 'seven-day', label: '7-day usage', unit: 'percent', usedPercent: 66, windowSeconds: 604800 },
    { id: 'limit-1', label: 'weekly_all', unit: 'percent', usedPercent: 66 }
  ] })
  expect(windows).toHaveLength(1)
  expect(windows[0].remainingPercent).toBe(34)
})

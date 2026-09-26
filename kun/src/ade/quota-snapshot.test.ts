import { describe, expect, it, vi } from 'vitest'
import type { ProviderQuotaListResponse } from '../contracts/provider-quota.js'
import {
  createQuotaSnapshot,
  quotaEntryFor,
  quotaProviderIdFor,
  quotaUsedPercent
} from './quota-snapshot.js'

const response = (usedPercent?: number): ProviderQuotaListResponse => ({
  entries: [{
    providerId: 'claude-subscription',
    providerName: 'Claude',
    presetId: 'claude-subscription',
    status: 'available',
    metrics: usedPercent === undefined
      ? []
      : [{ id: 'session', label: '5h window', unit: '%', usedPercent }]
  }],
  refreshedAt: '2026-01-01T00:00:00.000Z'
})

describe('createQuotaSnapshot', () => {
  it('caches a successful list for the TTL window', async () => {
    let now = 1_000
    const list = vi.fn(async () => response(10))
    const snapshot = createQuotaSnapshot({ list, nowMs: () => now })
    expect(await snapshot()).not.toBeNull()
    expect(await snapshot()).not.toBeNull()
    expect(list).toHaveBeenCalledTimes(1)
    now += 60_001
    expect(await snapshot()).not.toBeNull()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('returns null on probe failure instead of throwing', async () => {
    const list = vi.fn(async () => { throw new Error('probe offline') })
    const snapshot = createQuotaSnapshot({ list })
    await expect(snapshot()).resolves.toBeNull()
    await expect(snapshot()).resolves.toBeNull()
    // Failed snapshots are cached within the TTL like successful ones.
    expect(list).toHaveBeenCalledTimes(1)
  })
})

describe('quotaProviderIdFor', () => {
  it('maps native-login harnesses to their subscription preset id', () => {
    expect(quotaProviderIdFor({
      harnessId: 'claude-code', model: 'm', credentialMode: 'native-login'
    })).toBe('claude-subscription')
    expect(quotaProviderIdFor({
      harnessId: 'antigravity', model: 'm', credentialMode: 'native-login'
    })).toBe('gemini-subscription')
    expect(quotaProviderIdFor({
      harnessId: 'gemini-cli', model: 'm', credentialMode: 'native-login'
    })).toBe('gemini-cli-subscription')
    expect(quotaProviderIdFor({
      harnessId: 'cursor', model: 'm', credentialMode: 'native-login'
    })).toBe('cursor-subscription')
  })

  it('uses route.providerId for provider and kun-gateway routes', () => {
    expect(quotaProviderIdFor({
      harnessId: 'kun', model: 'm', providerId: 'deepseek', credentialMode: 'provider'
    })).toBe('deepseek')
    expect(quotaProviderIdFor({
      harnessId: 'claude-code', model: 'm', providerId: 'p1', credentialMode: 'kun-gateway'
    })).toBe('p1')
    expect(quotaProviderIdFor({
      harnessId: 'kun', model: 'm', credentialMode: 'provider'
    })).toBeUndefined()
  })
})

describe('quotaEntryFor / quotaUsedPercent', () => {
  it('matches by presetId when providerId differs', () => {
    const entry = quotaEntryFor(response(42), {
      harnessId: 'claude-code', model: 'm', credentialMode: 'native-login'
    })
    expect(entry?.providerId).toBe('claude-subscription')
    expect(quotaUsedPercent(entry!)).toBe(42)
    expect(quotaUsedPercent({
      providerId: 'x', providerName: 'X', status: 'available', metrics: []
    })).toBeUndefined()
  })
})

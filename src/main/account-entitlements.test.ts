import { describe, expect, it } from 'vitest'
import { readAccountEntitlements, requireAccountFeature } from './account-entitlements'
import type { ArtAccountAccess } from './art-assets/account-access'
const owner = '11111111-1111-1111-1111-111111111111'
const snapshot = (userId = owner) => ({ version: 1, userId, tier: 'plus', effectiveTier: 'plus', status: 'active', expiresAt: null, revision: 1, checkedAt: new Date().toISOString(), features: { mobileRemote: true, personalAssistant: false } })
const account: ArtAccountAccess = {
  getState: async () => ({ status: 'authenticated', error: null, user: { id: owner, name: 'Owner', email: 'owner@example.test', avatarUrl: null } }),
  accessToken: async () => 'test-token', expire: async () => {}, onState: () => () => {}
}
describe('account membership reader', () => {
  it('loads only the current account with a user token and no device credential', async () => {
    const result = await readAccountEntitlements(account, async (url, init) => {
      expect(String(url)).toBe('https://api-kun-server.com/api/account/v1/entitlements')
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-token')
      expect(new Headers(init?.headers).get('X-Kun-Device-Credential')).toBeNull()
      return Response.json(snapshot())
    })
    expect(result.features).toEqual({ mobileRemote: true, personalAssistant: false })
  })
  it('never publishes another accounts result after a token or account change', async () => {
    await expect(readAccountEntitlements(account, async () => Response.json(snapshot('22222222-2222-2222-2222-222222222222')))).rejects.toThrow('ACCOUNT_CHANGED')
  })
})

describe('paid feature admission', () => {
  for (const status of [404, 503]) it(`denies when the entitlement endpoint returns ${status}`, async () => {
    await expect(requireAccountFeature(account, async () => Response.json({ error: 'not_found' }, { status }), 'mobileRemote', owner))
      .rejects.toMatchObject({ code: 'ENTITLEMENTS_UNAVAILABLE' })
  })
  it('denies invalid responses and network errors without treating unknown as paid', async () => {
    for (const fetcher of [async () => Response.json({ ok: true }), async () => { throw new TypeError('offline') }]) {
      await expect(requireAccountFeature(account, fetcher, 'personalAssistant', owner)).rejects.toMatchObject({ code: 'ENTITLEMENTS_UNAVAILABLE' })
    }
  })
  for (const tier of ['free', 'plus', 'pro', 'max']) it(`admits only the ${tier} feature matrix`, async () => {
    const value = { ...snapshot(), tier, effectiveTier: tier, status: tier === 'free' ? 'free' : 'active',
      features: { mobileRemote: tier !== 'free', personalAssistant: ['pro', 'max'].includes(tier) } }
    for (const feature of ['mobileRemote', 'personalAssistant'] as const) {
      const check = requireAccountFeature(account, async () => Response.json(value), feature, owner)
      if (value.features[feature]) await expect(check).resolves.toBeUndefined()
      else await expect(check).rejects.toMatchObject({ code: feature === 'mobileRemote' ? 'vip_mobile_remote_required' : 'vip_personal_assistant_required' })
    }
  })
})

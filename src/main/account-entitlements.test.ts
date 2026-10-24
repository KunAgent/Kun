import { describe, expect, it } from 'vitest'
import { readAccountEntitlements } from './account-entitlements'
import type { ArtAccountAccess } from './art-assets/account-access'
const owner = '11111111-1111-1111-1111-111111111111'
const snapshot = (userId = owner) => ({ version: 1, userId, tier: 'plus', effectiveTier: 'plus', status: 'active', expiresAt: null, revision: 1, checkedAt: new Date().toISOString(), features: { mobileRemote: true, personalAssistant: false } })
const account: ArtAccountAccess = {
  getState: async () => ({ status: 'authenticated', error: null, user: { id: owner, name: 'Owner', email: 'owner@example.test', avatarUrl: null } }),
  accessToken: async () => 'test-token', expire: () => {}, onState: () => () => {}
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

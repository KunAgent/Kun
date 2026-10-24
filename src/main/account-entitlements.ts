import { RemoteApi, type AccountEntitlements } from '@kun/remote-protocol'
import type { ArtAccountAccess } from './art-assets/account-access'
import { hasKunAccountSession } from '../shared/kun-account'
export async function readAccountEntitlements(account: ArtAccountAccess, fetch: typeof globalThis.fetch): Promise<AccountEntitlements> {
  const state = await account.getState()
  if (!hasKunAccountSession(state) || !state.user) throw new Error('LOGIN_REQUIRED')
  const owner = state.user.id
  const api = new RemoteApi({ origin: 'https://api-kun-server.com', token: () => account.accessToken(), fetch,
    identity: async () => { throw new Error('IDENTITY_NOT_NEEDED') } })
  const value = await api.entitlements()
  const latest = await account.getState()
  if (latest.user?.id !== owner || value.userId !== owner) throw new Error('ACCOUNT_CHANGED')
  return value
}

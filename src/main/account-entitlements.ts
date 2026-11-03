import { RemoteApi, RemoteError, type AccountEntitlements } from '@kun/remote-protocol'
import type { ArtAccountAccess } from './art-assets/account-access'
import { hasKunAccountSession } from '../shared/kun-account'
type Account = Pick<ArtAccountAccess, 'getState' | 'accessToken'>
export async function readAccountEntitlements(account: Account, fetch: typeof globalThis.fetch, origin = 'https://api-kun-server.com'): Promise<AccountEntitlements> {
  const state = await account.getState()
  if (!hasKunAccountSession(state) || !state.user) throw new Error('LOGIN_REQUIRED')
  const owner = state.user.id
  const api = new RemoteApi({ origin, token: () => account.accessToken(), fetch,
    identity: async () => { throw new Error('IDENTITY_NOT_NEEDED') } })
  const value = await api.entitlements()
  const latest = await account.getState()
  if (!hasKunAccountSession(latest) || latest.user?.id !== owner || value.userId !== owner) throw new Error('ACCOUNT_CHANGED')
  return value
}

/** No positive fallback: missing routes, invalid snapshots and network failures cannot grant access. */
export async function requireAccountFeature(account: Account, fetch: typeof globalThis.fetch,
  feature: keyof AccountEntitlements['features'], owner: string, origin = 'https://api-kun-server.com'): Promise<void> {
  let value: AccountEntitlements
  try { value = await readAccountEntitlements(account, fetch, origin) }
  catch (error) {
    if (['ACCOUNT_CHANGED', 'LOGIN_REQUIRED'].includes((error as Error)?.message)) throw error
    throw new RemoteError('ENTITLEMENTS_UNAVAILABLE')
  }
  if (value.userId !== owner) throw new Error('ACCOUNT_CHANGED')
  if (!value.features[feature]) throw new RemoteError(feature === 'mobileRemote' ? 'vip_mobile_remote_required' : 'vip_personal_assistant_required')
}

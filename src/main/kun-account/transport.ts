import type { KunAccountUser } from '../../shared/kun-account'
import { AccountError } from './errors'
import { KUN_ACCOUNT_ISSUER, KUN_ACCOUNT_SUPABASE } from './config'

export type AccountTokens = { accessToken: string; refreshToken: string; expiresAt: number }
export interface AccountTransport {
  exchange(fields: Record<string, string>, previousRefresh?: string): Promise<AccountTokens>
  user(accessToken: string): Promise<KunAccountUser>
  logout(accessToken: string): Promise<void>
}

export function createAccountTransport(fetcher: typeof fetch, clientId: string, now = Date.now): AccountTransport {
  let discovery: Promise<string> | undefined
  async function request(url: string, options: RequestInit = {}): Promise<Response> {
    try { return await fetcher(url, { ...options, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000) }) }
    catch { throw new AccountError('network') }
  }
  async function json(response: Response): Promise<Record<string, unknown>> {
    let data: Record<string, unknown>
    try { data = await response.json() } catch { throw new AccountError('service') }
    if (!response.ok) {
      if ([401, 403].includes(response.status) || data?.error === 'invalid_grant') throw new AccountError('expired')
      throw new AccountError('service')
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AccountError('service')
    return data
  }
  function key(): Promise<string> {
    discovery ??= request(`${KUN_ACCOUNT_ISSUER}/auth/config`).then(json).then((data) => {
      const providers = data.providers as Record<string, unknown> | undefined
      if (data.supabase_url !== KUN_ACCOUNT_SUPABASE || !data.oauth_enabled || !(providers?.email || providers?.google) ||
          typeof data.publishable_key !== 'string' || !data.publishable_key.startsWith('sb_publishable_')) throw new AccountError('configuration')
      return data.publishable_key
    }).catch((error) => { discovery = undefined; throw error })
    return discovery
  }
  return {
    async exchange(fields, previousRefresh) {
      if (!clientId) throw new AccountError('configuration')
      const data = await json(await request(`${KUN_ACCOUNT_SUPABASE}/auth/v1/oauth/token`, {
        method: 'POST', headers: { apikey: await key(), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ ...fields, client_id: clientId }).toString()
      }))
      const refreshToken = data.refresh_token || previousRefresh
      const expiresIn = Number(data.expires_in)
      if (typeof data.access_token !== 'string' || !data.access_token || typeof refreshToken !== 'string' || !refreshToken ||
          !Number.isFinite(expiresIn) || expiresIn <= 0 || expiresIn > 604800 ||
          (data.token_type && String(data.token_type).toLowerCase() !== 'bearer')) throw new AccountError('service')
      return { accessToken: data.access_token, refreshToken, expiresAt: now() + expiresIn * 1000 }
    },
    async user(accessToken) {
      const headers = { Authorization: `Bearer ${accessToken}` }
      const [identity, profile] = await Promise.all([
        request(`${KUN_ACCOUNT_SUPABASE}/auth/v1/oauth/userinfo`, { headers: { ...headers, apikey: await key() } }).then(json),
        request(`${KUN_ACCOUNT_ISSUER}/api/me`, { headers }).then(json)
      ])
      if (typeof identity.sub !== 'string' || !identity.sub || profile.id !== identity.sub || typeof identity.email !== 'string') throw new AccountError('expired')
      let avatarUrl: string | null = null
      try {
        const url = new URL(String(profile.avatar_url || identity.picture || ''))
        if (url.protocol === 'https:' && !url.username && !url.password) avatarUrl = url.href
      } catch { /* Initial avatar remains available. */ }
      const name = [profile.display_name, identity.name, identity.email.split('@')[0]].find((value) => typeof value === 'string' && value.trim())
      return { id: identity.sub, email: identity.email, name: String(name || 'Kun').slice(0, 80), avatarUrl }
    },
    async logout(accessToken) {
      const response = await request(`${KUN_ACCOUNT_SUPABASE}/auth/v1/logout?scope=local`, {
        method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, apikey: await key() }
      })
      if (!response.ok && ![401, 403].includes(response.status)) throw new AccountError('service')
    }
  }
}

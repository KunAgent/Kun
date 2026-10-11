import type { KunAccountState } from '../../shared/kun-account'
export type ArtAccountAccess = {
  getState(): Promise<KunAccountState>
  accessToken(force?: boolean): Promise<string | null>
  expire(): Promise<void>
  onState(listener: (state: KunAccountState) => void): () => void
}
/** Tokens stay in main and are only attached to the fixed Kunserve origin. */
export function authenticatedArtFetch(account: ArtAccountAccess, fetcher: typeof fetch, current: () => boolean): typeof fetch {
  return async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (url.origin !== 'https://api-kun-server.com' || !(url.pathname.startsWith('/art/') || url.pathname === '/api/assets/releases/latest')) throw new Error('untrusted_art_origin')
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await account.accessToken(attempt > 0)
      if (!token || !current()) throw new Error('login_required')
      const headers = new Headers(options.headers); headers.set('Authorization', `Bearer ${token}`)
      const response = await fetcher(url.href, { ...options, headers, credentials: 'omit', redirect: 'error', cache: 'no-store' })
      if (!current()) { await response.body?.cancel(); throw new Error('account_changed') }
      if (response.status !== 401 && response.status !== 403) return response
      await response.body?.cancel()
    }
    await account.expire()
    throw new Error('login_required')
  }
}

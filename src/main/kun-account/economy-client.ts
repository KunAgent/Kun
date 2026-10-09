import { randomUUID } from 'node:crypto'
import type { KunAvatarParts, KunWardrobeItemKey, KunWardrobeSettings } from '../../shared/rooms-api'
import type { KunEconomyFailure } from '../../shared/kun-account-economy'
import { KUN_ACCOUNT_ISSUER } from './config'

export class EconomyError extends Error {
  constructor(readonly code: KunEconomyFailure) { super(code); this.name = 'EconomyError' }
}
export const economyErrorCode = (error: unknown): KunEconomyFailure => error instanceof EconomyError ? error.code : 'service'

export type EconomyJson = Record<string, unknown>
export type EconomyClientDependencies = {
  fetch: typeof fetch
  /** The current access token (rotated first when `force`), or null when signed out. */
  token(force: boolean): Promise<string | null>
  /** The session ended elsewhere: sign this app out. */
  expire(): Promise<void>
  requestId?: () => string
}

/**
 * Kunserve's account economy API. A refused token is rotated and the call retried once; a write that
 * carries a request id is retried once after a network failure with the same id, so it settles once.
 */
export function createEconomyClient(deps: EconomyClientDependencies) {
  const newId = deps.requestId ?? randomUUID
  async function call(path: string, method = 'GET', body?: unknown, idempotent = false): Promise<EconomyJson> {
    let networkRetry = idempotent
    for (let attempt = 0; ; attempt++) {
      const token = await deps.token(attempt > 0)
      if (!token) throw new EconomyError('anonymous')
      let response: Response
      try {
        response = await deps.fetch(`${KUN_ACCOUNT_ISSUER}${path}`, {
          method, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000),
          headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) })
        })
      } catch {
        if (networkRetry) { networkRetry = false; continue }
        throw new EconomyError('network')
      }
      if (response.status === 401 || response.status === 403) {
        if (attempt === 0) continue
        await deps.expire()
        throw new EconomyError('expired')
      }
      let data: unknown
      try { data = await response.json() } catch { data = null }
      if (!response.ok) {
        const code = (data as EconomyJson | null)?.error
        // Rule codes are snake_case identifiers; shape errors carry English sentences.
        if (typeof code === 'string' && /^[a-z_]{1,64}$/.test(code)) throw new EconomyError(code)
        throw new EconomyError([400, 413, 415].includes(response.status) ? 'invalid_request' : 'service')
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new EconomyError('service')
      return data as EconomyJson
    }
  }
  return {
    wardrobe: () => call('/api/wardrobe'),
    activity: (input: { runId: string; source: 'room' | 'code'; context: Record<string, string> }) =>
      call('/api/wardrobe/activity', 'POST', input, true),
    open: (bottleIds: string[]) => call('/api/wardrobe/open', 'POST', { requestId: newId(), bottleIds }, true),
    stash: (bottleIds: string[]) => call('/api/wardrobe/stash', 'POST', { bottleIds }, true),
    seen: (keys: string[]) => call('/api/wardrobe/seen', 'POST', { keys }, true),
    settings: (settings: Partial<KunWardrobeSettings>) => call('/api/wardrobe/settings', 'PATCH', settings, true),
    exchange: (itemKey: KunWardrobeItemKey) => call('/api/wardrobe/exchange', 'POST', { requestId: newId(), itemKey }, true),
    setLook: (look: KunAvatarParts) => call('/api/wardrobe/look', 'PUT', { look }, true),
    shop: () => call('/api/shop'),
    purchase: (offerId: string) => call('/api/shop/purchases', 'POST', { requestId: newId(), offerId }, true),
    invites: () => call('/api/invites'),
    claimInvite: (code: string) => call('/api/invites/claim', 'POST', { code })
  }
}
export type EconomyClient = ReturnType<typeof createEconomyClient>

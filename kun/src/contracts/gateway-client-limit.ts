/**
 * What a gateway client may still do in its current window (`GET /v1/kun/limit`
 * and the admin per-client view). The numbers are the ones the budget check
 * uses before refusing a request with 429.
 */
export type GatewayClientLimit = {
  client: { id: string; name?: string }
  limited: boolean
  protocols?: string[]
  /** Public model ids the key may use; `all` for an unrestricted legacy key. */
  models?: string[] | 'all'
  rate?: { requestsPerMinute: number; burst: number; maxConcurrent: number; active: number }
  tokenBudget?: { mode: 'hard' | 'soft'; period: string; timeZone: string; tokens: number; used: number; left: number; resetsAt: string }
  cost?: { period: string; timeZone: string; usd: number; used: number; left: number; enforce: boolean; resetsAt: string }
  expiresAt?: string
}

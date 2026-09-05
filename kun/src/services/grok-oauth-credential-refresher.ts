import { GROK_CLI_VERSION } from '../adapters/model/provider-cli-identity.js'

export const GROK_OAUTH_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828'
export const GROK_OAUTH_ISSUER = 'https://auth.x.ai'
export const GROK_CLIENT_VERSION = GROK_CLI_VERSION
const GROK_EARLY_INVALIDATION_MS = 5 * 60 * 1000
const GROK_TOKEN_TTL_FALLBACK_MS = 30 * 24 * 60 * 60 * 1000
const GROK_REFRESH_TIMEOUT_MS = 10_000

export type StoredGrokOAuthCredentials = {
  kind: 'grok-oauth'
  accessToken: string
  refreshToken: string
  expiresAt: number
  email?: string
  userId?: string
  issuer?: string
  clientId?: string
}

export type RefreshableLegacyCredentialStore = {
  resolveApiKey(sourceId: string): Promise<{ apiKey: string } | null>
  updateResolvedApiKey(sourceId: string, expectedApiKey: string, apiKey: string): Promise<boolean>
}

export type ResolvedLegacyRequestCredential = {
  rawApiKey: string
  refreshable: boolean
}

type GrokTokenResponse = Record<string, unknown>

/**
 * Resolves protected provider credentials for each request and refreshes Grok
 * subscription OAuth tokens before their access token expires. Refresh work is
 * single-flight per source so rotated refresh tokens are never used twice by
 * concurrent turns.
 */
export class GrokOAuthCredentialRefresher {
  private readonly inflight = new Map<string, Promise<void>>()
  private readonly fetchImpl: typeof fetch
  private readonly fetchForSource?: (sourceId: string) => typeof fetch | Promise<typeof fetch>
  private readonly nowMs: () => number

  constructor(
    private readonly store: RefreshableLegacyCredentialStore,
    options: {
      fetchImpl?: typeof fetch
      fetchForSource?: (sourceId: string) => typeof fetch | Promise<typeof fetch>
      nowMs?: () => number
    } = {}
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.fetchForSource = options.fetchForSource
    this.nowMs = options.nowMs ?? Date.now
  }

  /**
   * `rejectedAccessToken` is supplied after a 401. It forces a refresh only
   * when the protected store still contains that rejected token; if another
   * request already rotated it, the newly persisted credential is reused.
   */
  async resolve(
    sourceId: string,
    rejectedAccessToken?: string
  ): Promise<ResolvedLegacyRequestCredential> {
    let resolved = await this.store.resolveApiKey(sourceId)
    if (!resolved) {
      throw new Error(`protected credential source is unavailable: ${sourceId}`)
    }
    let credentials = parseStoredGrokOAuthCredentials(resolved.apiKey)
    if (!credentials) {
      return { rawApiKey: resolved.apiKey, refreshable: false }
    }

    const shouldRefresh = rejectedAccessToken
      ? credentials.accessToken === rejectedAccessToken
      : isStoredGrokCredentialExpired(credentials, this.nowMs())
    if (shouldRefresh) {
      await this.refreshSingleFlight(sourceId, rejectedAccessToken)
      resolved = await this.store.resolveApiKey(sourceId)
      if (!resolved) {
        throw new Error(`protected credential source is unavailable after refresh: ${sourceId}`)
      }
      credentials = parseStoredGrokOAuthCredentials(resolved.apiKey)
      if (!credentials) {
        return { rawApiKey: resolved.apiKey, refreshable: false }
      }
    }

    return { rawApiKey: resolved.apiKey, refreshable: true }
  }

  private async refreshSingleFlight(
    sourceId: string,
    rejectedAccessToken?: string
  ): Promise<void> {
    let pending = this.inflight.get(sourceId)
    if (!pending) {
      pending = this.refreshSource(sourceId, rejectedAccessToken)
      this.inflight.set(sourceId, pending)
      void pending.finally(() => {
        if (this.inflight.get(sourceId) === pending) this.inflight.delete(sourceId)
      }).catch(() => undefined)
    }
    await pending
  }

  private async refreshSource(
    sourceId: string,
    rejectedAccessToken?: string
  ): Promise<void> {
    const latest = await this.store.resolveApiKey(sourceId)
    if (!latest) throw new Error(`protected credential source is unavailable: ${sourceId}`)
    const credentials = parseStoredGrokOAuthCredentials(latest.apiKey)
    if (!credentials) return

    // Another request may have completed the refresh before this single-flight
    // operation acquired the latest protected value.
    if (rejectedAccessToken && credentials.accessToken !== rejectedAccessToken) return
    if (!rejectedAccessToken && !isStoredGrokCredentialExpired(credentials, this.nowMs())) return

    const refreshed = await refreshStoredGrokOAuthCredentials(
      credentials,
      this.fetchForSource ? await this.fetchForSource(sourceId) : this.fetchImpl,
      this.nowMs
    )
    const updated = await this.store.updateResolvedApiKey(
      sourceId,
      latest.apiKey,
      JSON.stringify(refreshed)
    )
    // A user replacement or another writer won the race. resolve() reads the
    // authoritative value again after this attempt.
    if (!updated) return
  }
}

export function parseStoredGrokOAuthCredentials(
  rawApiKey: string
): StoredGrokOAuthCredentials | null {
  const value = rawApiKey.trim()
  if (!value.startsWith('{')) return null
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    if (
      parsed.kind !== 'grok-oauth' ||
      typeof parsed.accessToken !== 'string' ||
      !parsed.accessToken ||
      typeof parsed.refreshToken !== 'string' ||
      !parsed.refreshToken
    ) return null
    return {
      kind: 'grok-oauth',
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: typeof parsed.expiresAt === 'number' ? parsed.expiresAt : 0,
      ...(typeof parsed.email === 'string' ? { email: parsed.email } : {}),
      ...(typeof parsed.userId === 'string' ? { userId: parsed.userId } : {}),
      ...(typeof parsed.issuer === 'string' ? { issuer: parsed.issuer } : {}),
      ...(typeof parsed.clientId === 'string' ? { clientId: parsed.clientId } : {})
    }
  } catch {
    return null
  }
}

export function isStoredGrokCredentialExpired(
  credentials: StoredGrokOAuthCredentials,
  nowMs: number = Date.now()
): boolean {
  return !Number.isFinite(credentials.expiresAt) ||
    credentials.expiresAt <= 0 ||
    nowMs >= credentials.expiresAt - GROK_EARLY_INVALIDATION_MS
}

export async function refreshStoredGrokOAuthCredentials(
  credentials: StoredGrokOAuthCredentials,
  fetchImpl: typeof fetch = fetch,
  nowMs: () => number = Date.now
): Promise<StoredGrokOAuthCredentials> {
  const issuer = (credentials.issuer || GROK_OAUTH_ISSUER).replace(/\/$/, '')
  let tokenEndpoint = `${issuer}/oauth2/token`
  try {
    tokenEndpoint = await discoverTokenEndpoint(issuer, fetchImpl)
  } catch {
    // Grok Build falls back to the conventional endpoint when OIDC discovery
    // is temporarily unavailable.
  }

  const response = await fetchImpl(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-grok-client-version': GROK_CLIENT_VERSION
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: credentials.refreshToken,
      client_id: credentials.clientId || GROK_OAUTH_CLIENT_ID
    }).toString(),
    signal: AbortSignal.timeout(GROK_REFRESH_TIMEOUT_MS)
  })
  const text = await response.text()
  if (!response.ok) {
    const detail = summarizeAuthErrorBody(text)
    throw new Error(
      `Grok subscription token refresh failed (${response.status})${detail ? `: ${detail}` : ''}`
    )
  }

  let tokens: GrokTokenResponse
  try {
    tokens = JSON.parse(text) as GrokTokenResponse
  } catch {
    throw new Error('Grok subscription token refresh returned invalid JSON')
  }
  const accessToken = typeof tokens.access_token === 'string' ? tokens.access_token : ''
  if (!accessToken) throw new Error('Grok subscription token refresh returned no access token')
  const refreshToken = typeof tokens.refresh_token === 'string' && tokens.refresh_token
    ? tokens.refresh_token
    : credentials.refreshToken
  return {
    kind: 'grok-oauth',
    accessToken,
    refreshToken,
    expiresAt: expiresAtFromTokens(tokens, accessToken, nowMs()),
    email: extractJwtString(tokens.id_token, accessToken, 'email') ?? credentials.email,
    userId:
      extractJwtString(tokens.id_token, accessToken, 'sub') ??
      extractJwtString(tokens.id_token, accessToken, 'user_id') ??
      credentials.userId,
    issuer,
    clientId: credentials.clientId || GROK_OAUTH_CLIENT_ID
  }
}

async function discoverTokenEndpoint(issuer: string, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(`${issuer}/.well-known/openid-configuration`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(GROK_REFRESH_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`OIDC discovery failed (${response.status})`)
  const value = await response.json() as Record<string, unknown>
  if (typeof value.token_endpoint !== 'string' || !value.token_endpoint) {
    throw new Error('OIDC discovery did not return a token endpoint')
  }
  return value.token_endpoint
}

function expiresAtFromTokens(
  tokens: GrokTokenResponse,
  accessToken: string,
  nowMs: number
): number {
  const expiresIn = Number(tokens.expires_in)
  if (Number.isFinite(expiresIn) && expiresIn > 0) return nowMs + expiresIn * 1000
  const jwtExpiry = extractJwtNumber(accessToken, 'exp')
  if (jwtExpiry && jwtExpiry * 1000 > nowMs) return jwtExpiry * 1000
  return nowMs + GROK_TOKEN_TTL_FALLBACK_MS
}

function extractJwtString(
  idToken: unknown,
  accessToken: string,
  claim: string
): string | undefined {
  for (const token of [typeof idToken === 'string' ? idToken : '', accessToken]) {
    const value = parseJwtClaims(token)?.[claim]
    if (typeof value === 'string' && value) return value
  }
  return undefined
}

function extractJwtNumber(token: string, claim: string): number | undefined {
  const value = parseJwtClaims(token)?.[claim]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parseJwtClaims(token: string): Record<string, unknown> | undefined {
  const body = token.split('.')[1]
  if (!body) return undefined
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function summarizeAuthErrorBody(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    return [
      typeof parsed.error === 'string' ? parsed.error : '',
      typeof parsed.error_description === 'string' ? parsed.error_description : '',
      typeof parsed.message === 'string' ? parsed.message : ''
    ].filter(Boolean).join(': ').slice(0, 300)
  } catch {
    return compact.slice(0, 300)
  }
}

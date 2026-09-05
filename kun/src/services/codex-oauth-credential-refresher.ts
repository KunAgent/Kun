export const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
export const CODEX_OAUTH_TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token'
const CODEX_EARLY_INVALIDATION_MS = 5 * 60 * 1000
const CODEX_TOKEN_TTL_FALLBACK_MS = 60 * 60 * 1000
const CODEX_REFRESH_TIMEOUT_MS = 10_000

export type StoredCodexOAuthCredentials = {
  kind: 'codex-oauth'
  accessToken: string
  refreshToken: string
  expiresAt: number
  accountId: string
  email?: string
}

export type CodexRefreshableCredentialStore = {
  resolveApiKey(sourceId: string): Promise<{ apiKey: string } | null>
  updateResolvedApiKey(sourceId: string, expectedApiKey: string, apiKey: string): Promise<boolean>
}

export type ResolvedCodexRequestCredential = {
  rawApiKey: string
  refreshable: boolean
}

/**
 * Resolves protected Codex subscription credentials immediately before model
 * requests and serializes refreshes per credential source.
 */
export class CodexOAuthCredentialRefresher {
  private readonly inflight = new Map<string, Promise<void>>()
  private readonly fetchImpl: typeof fetch
  private readonly fetchForSource?: (sourceId: string) => typeof fetch | Promise<typeof fetch>
  private readonly nowMs: () => number

  constructor(
    private readonly store: CodexRefreshableCredentialStore,
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

  async resolve(
    sourceId: string,
    rejectedAccessToken?: string
  ): Promise<ResolvedCodexRequestCredential> {
    let resolved = await this.store.resolveApiKey(sourceId)
    if (!resolved) {
      throw new Error(`protected credential source is unavailable: ${sourceId}`)
    }
    let credentials = parseStoredCodexOAuthCredentials(resolved.apiKey)
    if (!credentials) {
      return { rawApiKey: resolved.apiKey, refreshable: false }
    }

    const shouldRefresh = rejectedAccessToken
      ? credentials.accessToken === rejectedAccessToken
      : isStoredCodexCredentialExpired(credentials, this.nowMs())
    if (shouldRefresh) {
      await this.refreshSingleFlight(sourceId, rejectedAccessToken)
      resolved = await this.store.resolveApiKey(sourceId)
      if (!resolved) {
        throw new Error(`protected credential source is unavailable after refresh: ${sourceId}`)
      }
      credentials = parseStoredCodexOAuthCredentials(resolved.apiKey)
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
    const credentials = parseStoredCodexOAuthCredentials(latest.apiKey)
    if (!credentials) return

    if (rejectedAccessToken && credentials.accessToken !== rejectedAccessToken) return
    if (!rejectedAccessToken && !isStoredCodexCredentialExpired(credentials, this.nowMs())) return

    const refreshed = await refreshStoredCodexOAuthCredentials(
      credentials,
      this.fetchForSource ? await this.fetchForSource(sourceId) : this.fetchImpl,
      this.nowMs
    )
    const updated = await this.store.updateResolvedApiKey(
      sourceId,
      latest.apiKey,
      JSON.stringify(refreshed)
    )
    if (!updated) {
      // A user replacement or another writer won the race. The caller will
      // resolve the authoritative value again after this refresh attempt.
      return
    }
  }
}

export function parseStoredCodexOAuthCredentials(
  rawApiKey: string
): StoredCodexOAuthCredentials | null {
  const value = rawApiKey.trim()
  if (!value.startsWith('{')) return null
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    if (
      parsed.kind !== 'codex-oauth' ||
      typeof parsed.accessToken !== 'string' ||
      !parsed.accessToken ||
      typeof parsed.refreshToken !== 'string' ||
      !parsed.refreshToken ||
      typeof parsed.accountId !== 'string' ||
      !parsed.accountId
    ) return null
    return {
      kind: 'codex-oauth',
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: typeof parsed.expiresAt === 'number' ? parsed.expiresAt : 0,
      accountId: parsed.accountId,
      ...(typeof parsed.email === 'string' ? { email: parsed.email } : {})
    }
  } catch {
    return null
  }
}

export function isStoredCodexCredentialExpired(
  credentials: StoredCodexOAuthCredentials,
  nowMs: number = Date.now()
): boolean {
  return !Number.isFinite(credentials.expiresAt) ||
    credentials.expiresAt <= 0 ||
    nowMs >= credentials.expiresAt - CODEX_EARLY_INVALIDATION_MS
}

export async function refreshStoredCodexOAuthCredentials(
  credentials: StoredCodexOAuthCredentials,
  fetchImpl: typeof fetch = fetch,
  nowMs: () => number = Date.now
): Promise<StoredCodexOAuthCredentials> {
  let response: Response
  try {
    response = await fetchImpl(CODEX_OAUTH_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: credentials.refreshToken,
        client_id: CODEX_OAUTH_CLIENT_ID
      }).toString(),
      signal: AbortSignal.timeout(CODEX_REFRESH_TIMEOUT_MS)
    })
  } catch (error) {
    const message = redactKnownSecrets(
      error instanceof Error ? error.message : String(error),
      credentials
    )
    throw new Error(`Codex subscription token refresh failed${message ? `: ${message}` : ''}`)
  }

  const text = await response.text()
  if (!response.ok) {
    const detail = summarizeAuthErrorBody(text, credentials)
    throw new Error(
      `Codex subscription token refresh failed (${response.status})${detail ? `: ${detail}` : ''}`
    )
  }

  let tokens: Record<string, unknown>
  try {
    tokens = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error('Codex subscription token refresh returned invalid JSON')
  }
  const accessToken = typeof tokens.access_token === 'string' ? tokens.access_token : ''
  if (!accessToken) {
    throw new Error('Codex subscription token refresh returned no access token')
  }
  const refreshToken = typeof tokens.refresh_token === 'string' && tokens.refresh_token
    ? tokens.refresh_token
    : credentials.refreshToken
  return {
    kind: 'codex-oauth',
    accessToken,
    refreshToken,
    expiresAt: expiresAtFromTokens(tokens, accessToken, nowMs()),
    accountId: extractAccountIdFromTokens(tokens.id_token, accessToken) ?? credentials.accountId,
    email: extractJwtString(tokens.id_token, accessToken, 'email') ?? credentials.email
  }
}

function expiresAtFromTokens(
  tokens: Record<string, unknown>,
  accessToken: string,
  nowMs: number
): number {
  const expiresIn = Number(tokens.expires_in)
  if (Number.isFinite(expiresIn) && expiresIn > 0) return nowMs + expiresIn * 1000
  const jwtExpiry = extractJwtNumber(accessToken, 'exp')
  if (jwtExpiry && jwtExpiry * 1000 > nowMs) return jwtExpiry * 1000
  return nowMs + CODEX_TOKEN_TTL_FALLBACK_MS
}

function extractAccountIdFromTokens(
  idToken: unknown,
  accessToken: string
): string | undefined {
  for (const token of [typeof idToken === 'string' ? idToken : '', accessToken]) {
    const claims = parseJwtClaims(token)
    if (!claims) continue
    if (typeof claims.chatgpt_account_id === 'string' && claims.chatgpt_account_id) {
      return claims.chatgpt_account_id
    }
    const auth = claims['https://api.openai.com/auth']
    if (auth && typeof auth === 'object' && !Array.isArray(auth)) {
      const accountId = (auth as Record<string, unknown>).chatgpt_account_id
      if (typeof accountId === 'string' && accountId) return accountId
    }
    const organizations = claims.organizations
    if (Array.isArray(organizations)) {
      const first = organizations[0]
      if (first && typeof first === 'object' && !Array.isArray(first)) {
        const accountId = (first as Record<string, unknown>).id
        if (typeof accountId === 'string' && accountId) return accountId
      }
    }
  }
  return undefined
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

function summarizeAuthErrorBody(
  text: string,
  credentials: StoredCodexOAuthCredentials
): string {
  let summary = ''
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    summary = [
      typeof parsed.error === 'string' ? parsed.error : '',
      typeof parsed.error_description === 'string' ? parsed.error_description : '',
      typeof parsed.message === 'string' ? parsed.message : ''
    ].filter(Boolean).join(': ')
  } catch {
    summary = text.replace(/\s+/g, ' ').trim()
  }
  return redactKnownSecrets(summary, credentials).slice(0, 300)
}

function redactKnownSecrets(
  value: string,
  credentials: StoredCodexOAuthCredentials
): string {
  let redacted = value
  for (const secret of [credentials.accessToken, credentials.refreshToken]) {
    if (secret) redacted = redacted.split(secret).join('[redacted]')
  }
  return redacted
}

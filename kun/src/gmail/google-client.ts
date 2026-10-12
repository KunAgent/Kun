import { GmailError, GMAIL_SCOPES } from './ports.js'
import type { GmailTokens } from './store.js'
import type { GmailWireMessage } from './mail.js'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API_URL = 'https://gmail.googleapis.com/gmail/v1/users/me'
type RecordValue = Record<string, unknown>

/** Fixed Google endpoints; all token-bearing requests use headers or POST bodies. */
export class GoogleGmailClient {
  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly clientId: string,
    private readonly clientSecret: string | undefined,
    private readonly now: () => number
  ) {}

  async exchange(code: string, verifier: string, redirectUri: string): Promise<GmailTokens> {
    const payload = await this.tokenRequest({
      grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri
    })
    const tokens = this.parseTokens(payload)
    const profile = await this.get('/profile', tokens.accessToken, new URLSearchParams({ fields: 'emailAddress' }))
    if (typeof profile.emailAddress !== 'string' || !/^[^\s@]+@[^\s@]+$/u.test(profile.emailAddress)) {
      throw new GmailError('authorization_failed', 'Google did not return the connected Gmail address')
    }
    return { ...tokens, email: profile.emailAddress }
  }

  async refresh(tokens: GmailTokens): Promise<GmailTokens> {
    if (!tokens.refreshToken) throw new GmailError('reconnect_required', 'Reconnect Gmail to continue')
    const payload = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken })
    return { ...tokens, ...this.parseTokens(payload, tokens.scopes), email: tokens.email,
      refreshToken: string(payload.refresh_token) ?? tokens.refreshToken }
  }

  async revoke(token: string): Promise<void> {
    let response: Response
    try {
      response = await this.fetchImpl('https://oauth2.googleapis.com/revoke', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token })
      })
    } catch { throw new GmailError('revocation_failed', 'Local Gmail connection was removed; Google revocation could not be confirmed') }
    if (!response.ok) throw new GmailError('revocation_failed', 'Local Gmail connection was removed; Google revocation could not be confirmed')
  }

  async list(query: string, maxResults: number, token: string): Promise<{ messages: { id: string }[]; hasMore: boolean }> {
    const result = await this.get('/messages', token, new URLSearchParams({
      q: query, maxResults: String(maxResults), fields: 'messages(id),nextPageToken'
    }))
    const entries = Array.isArray(result.messages) ? result.messages : []
    const messages = entries.slice(0, maxResults).flatMap((entry) => {
      const id = record(entry).id
      return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(id) ? [{ id }] : []
    })
    return { messages, hasMore: typeof result.nextPageToken === 'string' }
  }

  async message(id: string, token: string, metadataOnly: boolean): Promise<GmailWireMessage> {
    const params = new URLSearchParams({
      format: metadataOnly ? 'metadata' : 'full',
      fields: metadataOnly ? 'id,threadId,snippet,payload(headers)' : 'id,threadId,snippet,payload'
    })
    if (metadataOnly) for (const header of ['From', 'To', 'Subject', 'Date']) params.append('metadataHeaders', header)
    return await this.get(`/messages/${encodeURIComponent(id)}`, token, params) as GmailWireMessage
  }

  /** Exactly one POST; ambiguous transport failure is deliberately not retried. */
  async send(raw: string, token: string): Promise<{ id: string; threadId?: string; status: 'sent' }> {
    let response: Response
    try {
      response = await this.fetchImpl(`${API_URL}/messages/send`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ raw })
      })
    } catch { throw new GmailError('send_unknown', 'Send result is uncertain. Check Gmail Sent before creating a new send request') }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new GmailError(response.status < 500 ? 'send_rejected' : 'send_unknown',
        response.status < 500 ? 'Google rejected this send request' : 'Send result is uncertain. Check Gmail Sent before creating a new send request')
    }
    let value: RecordValue
    try { value = await boundedJson(response) }
    catch { throw new GmailError('send_unknown', 'Send result is uncertain. Check Gmail Sent before creating a new send request') }
    if (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(value.id)) {
      throw new GmailError('send_unknown', 'Send result is uncertain. Check Gmail Sent before creating a new send request')
    }
    return { id: value.id, ...(typeof value.threadId === 'string' ? { threadId: value.threadId.slice(0, 128) } : {}), status: 'sent' }
  }

  private async get(path: string, token: string, params: URLSearchParams): Promise<RecordValue> {
    let response: Response
    try {
      response = await this.fetchImpl(`${API_URL}${path}?${params}`, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: { authorization: `Bearer ${token}` }
      })
    } catch { throw new GmailError('google_unavailable', 'Gmail could not be reached. Try again later') }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      if (response.status === 401) throw new GmailError('access_expired', 'Reconnect Gmail to continue')
      if (response.status === 403) throw new GmailError('scope_missing', 'Google denied the requested Gmail permission')
      throw new GmailError('google_unavailable', 'Gmail could not complete this request. Try again later')
    }
    return boundedJson(response)
  }

  private async tokenRequest(fields: Record<string, string>): Promise<RecordValue> {
    let response: Response
    try {
      response = await this.fetchImpl(TOKEN_URL, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: this.clientId, ...(this.clientSecret ? { client_secret: this.clientSecret } : {}), ...fields })
      })
    } catch { throw new GmailError('google_unavailable', 'Google authorization could not be completed. Try connecting again') }
    const payload = await boundedJson(response, 64 * 1024)
    if (!response.ok) {
      throw new GmailError(payload.error === 'invalid_grant' ? 'reconnect_required' : 'authorization_failed',
        payload.error === 'invalid_grant' ? 'Reconnect Gmail to continue' : 'Google authorization could not be completed. Try connecting again')
    }
    return payload
  }

  private parseTokens(payload: RecordValue, fallbackScopes?: string[]): Omit<GmailTokens, 'email'> {
    const accessToken = string(payload.access_token)
    const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 0
    const scopes = typeof payload.scope === 'string' ? payload.scope.split(/\s+/u).filter(Boolean) : fallbackScopes ?? []
    if (!accessToken || expiresIn <= 0 || expiresIn > 86_400 || !GMAIL_SCOPES.every((scope) => scopes.includes(scope)) ||
      scopes.some((scope) => !(GMAIL_SCOPES as readonly string[]).includes(scope))) {
      throw new GmailError('scope_missing', 'Allow both Gmail reading and sending permissions to connect')
    }
    return { accessToken, expiresAt: this.now() + expiresIn * 1_000, scopes,
      ...(string(payload.refresh_token) ? { refreshToken: string(payload.refresh_token) } : {}) }
  }
}

export async function boundedJson(response: Response, limit = 2 * 1024 * 1024): Promise<RecordValue> {
  const reader = response.body?.getReader()
  if (!reader) throw new GmailError('invalid_response', 'Google returned an incomplete response')
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.length
      if (bytes > limit) throw new GmailError('message_too_large', 'This email is too large to read safely in Kun')
      chunks.push(next.value)
    }
    return record(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    if (error instanceof GmailError) throw error
    throw new GmailError('invalid_response', 'Google returned an incomplete response')
  } finally { reader.releaseLock() }
}
function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as RecordValue
}
function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 16_384 ? value : undefined
}

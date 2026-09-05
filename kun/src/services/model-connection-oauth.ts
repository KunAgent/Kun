import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { getProviderCatalogPreset, type ProviderCatalogPreset } from '@kun/provider-catalog'
import {
  ModelConnectionOAuthStartRequestSchema,
  ModelConnectionOAuthStatusSchema,
  type ModelConnectionOAuthStartRequest,
  type ModelConnectionOAuthStatus
} from '../contracts/model-connections.js'
import type { ModelConnectionRegistry } from './model-connection-registry.js'
import type { ClaudeConnectionService } from './claude-connection-service.js'
import { createProxyFetch } from '../adapters/model/proxy-fetch.js'
import { resolveRegistryProfileProxyUrl } from './model-connection-registry-proxy.js'

const CHATGPT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CHATGPT_ISSUER = 'https://auth.openai.com'
const CHATGPT_DEVICE_CALLBACK = `${CHATGPT_ISSUER}/deviceauth/callback`
const GROK_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828'
const GROK_ISSUER = 'https://auth.x.ai'
const GROK_CLIENT_VERSION = '0.2.106'
const SESSION_TTL_MS = 10 * 60 * 1000
const GROK_SCOPES = [
  'openid', 'profile', 'email', 'offline_access', 'grok-cli:access', 'api:access',
  'conversations:read', 'conversations:write', 'workspaces:read', 'workspaces:write'
].join(' ')

type OAuthCredentials = {
  kind: 'codex-oauth' | 'grok-oauth'
  accessToken: string
  refreshToken: string
  expiresAt: number
  accountId?: string
  email?: string
  userId?: string
  issuer?: string
  clientId?: string
}

type OAuthSession = {
  id: string
  input: ModelConnectionOAuthStartRequest
  status: ModelConnectionOAuthStatus['status']
  url?: string
  userCode?: string
  interval?: number
  expiresAt: number
  message?: string
  deviceCode?: string
  credentials?: OAuthCredentials
  claudeToken?: string
  abort?: AbortController
  snapshot?: ModelConnectionOAuthStatus['snapshot']
  server?: Server
  grok?: { tokenEndpoint: string; redirectUri: string; verifier: string; state: string }
  fetch?: typeof fetch
}

/** Runtime-owned OAuth coordinator. Tokens never cross the HTTP boundary. */
export class ModelConnectionOAuthService {
  private readonly sessions = new Map<string, OAuthSession>()

  constructor(private readonly options: {
    registry: ModelConnectionRegistry
    claude?: ClaudeConnectionService
    fetch?: typeof fetch
    now?: () => number
  }) {}

  async start(raw: unknown): Promise<ModelConnectionOAuthStatus> {
    const input = ModelConnectionOAuthStartRequestSchema.parse(raw)
    await this.options.registry.assertRevision(input.expectedRevision)
    this.expireSessions()
    if (input.provider === 'chatgpt') return this.startChatGpt(input)
    if (input.provider === 'grok') return this.startGrok(input)
    return this.startClaude(input)
  }

  async status(sessionId: string): Promise<ModelConnectionOAuthStatus> {
    const session = this.requireSession(sessionId)
    if (session.status !== 'pending') return project(session)
    if (this.now() >= session.expiresAt) {
      this.finish(session, 'failed', 'OAuth session expired.')
      return project(session)
    }
    if (session.input.provider === 'chatgpt' && !session.credentials) {
      await this.pollChatGpt(session)
    }
    if (session.credentials || session.claudeToken) await this.commit(session)
    return project(session)
  }

  async submit(sessionId: string, code: string): Promise<ModelConnectionOAuthStatus> {
    const session = this.requireSession(sessionId)
    if (session.input.provider !== 'grok' || !session.grok || session.status !== 'pending') {
      throw new Error('Grok OAuth session is not accepting an authorization code')
    }
    const parsed = parsePastedCode(code)
    if (parsed.state && parsed.state !== session.grok.state) throw new Error('OAuth state mismatch')
    session.credentials = await this.exchangeGrok(session.grok, parsed.code, session.fetch)
    await this.commit(session)
    return project(session)
  }

  cancel(sessionId: string): ModelConnectionOAuthStatus {
    const session = this.requireSession(sessionId)
    if (session.status === 'pending') this.finish(session, 'cancelled', 'OAuth login cancelled.')
    return project(session)
  }

  close(): void {
    for (const session of this.sessions.values()) session.server?.close()
    this.sessions.clear()
  }

  async claudeSdkStatus() {
    if (!this.options.claude) throw new Error('Claude SDK installer is unavailable')
    return this.options.claude.status()
  }

  async installClaudeSdk() {
    if (!this.options.claude) throw new Error('Claude SDK installer is unavailable')
    return this.options.claude.install()
  }

  private async startClaude(input: ModelConnectionOAuthStartRequest): Promise<ModelConnectionOAuthStatus> {
    if (!this.options.claude) throw new Error('Claude SDK installer is unavailable')
    const sdk = await this.options.claude.status()
    if (!sdk.installed) throw new Error('Claude Code is not installed')
    const session = this.createSession(input, {
      message: 'Claude Code opened the browser login flow.',
      abort: new AbortController()
    })
    void this.options.claude.setupToken(10 * 60 * 1000, session.abort?.signal).then(
      (token) => { session.claudeToken = token; session.message = undefined },
      (error) => this.finish(session, 'failed', safeError(error))
    )
    return project(session)
  }

  private async startChatGpt(input: ModelConnectionOAuthStartRequest): Promise<ModelConnectionOAuthStatus> {
    const fetcher = await this.fetchFor(input, 'codex')
    const data = await postJson(fetcher, `${CHATGPT_ISSUER}/api/accounts/deviceauth/usercode`, {
      client_id: CHATGPT_CLIENT_ID
    })
    const deviceCode = stringValue(data.device_auth_id)
    const userCode = stringValue(data.user_code)
    if (!deviceCode || !userCode) throw new Error('ChatGPT device authorization returned incomplete data')
    const session = this.createSession(input, {
      url: `${CHATGPT_ISSUER}/codex/device`,
      userCode,
      interval: Math.max(1, Number(data.interval) || 5),
      deviceCode,
      fetch: fetcher
    })
    return project(session)
  }

  private async pollChatGpt(session: OAuthSession): Promise<void> {
    const fetcher = session.fetch ?? this.fetch
    const response = await fetcher(`${CHATGPT_ISSUER}/api/accounts/deviceauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_auth_id: session.deviceCode, user_code: session.userCode })
    })
    if (response.status === 403 || response.status === 404) return
    if (!response.ok) throw new Error(`ChatGPT device authorization failed with HTTP ${response.status}`)
    const authorization = await jsonObject(response)
    const authorizationCode = stringValue(authorization.authorization_code)
    const verifier = stringValue(authorization.code_verifier)
    if (!authorizationCode || !verifier) throw new Error('ChatGPT authorization response is incomplete')
    const tokens = await postForm(fetcher, `${CHATGPT_ISSUER}/oauth/token`, {
      grant_type: 'authorization_code', code: authorizationCode,
      redirect_uri: CHATGPT_DEVICE_CALLBACK, client_id: CHATGPT_CLIENT_ID, code_verifier: verifier
    })
    const accessToken = stringValue(tokens.access_token)
    const refreshToken = stringValue(tokens.refresh_token)
    const accountId = tokenClaim(tokens.id_token, accessToken, 'account')
    if (!accessToken || !refreshToken || !accountId) throw new Error('ChatGPT token exchange is incomplete')
    session.credentials = {
      kind: 'codex-oauth', accessToken, refreshToken,
      expiresAt: this.now() + (Number(tokens.expires_in) || 3600) * 1000,
      accountId,
      email: tokenClaim(tokens.id_token, accessToken, 'email')
    }
  }

  private async startGrok(input: ModelConnectionOAuthStartRequest): Promise<ModelConnectionOAuthStatus> {
    const fetcher = await this.fetchFor(input, 'grok-subscription')
    const discovery = await getJson(fetcher, `${GROK_ISSUER}/.well-known/openid-configuration`)
    const authorizationEndpoint = stringValue(discovery.authorization_endpoint)
    const tokenEndpoint = stringValue(discovery.token_endpoint)
    if (!authorizationEndpoint || !tokenEndpoint) throw new Error('Grok OIDC discovery is incomplete')
    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const state = randomBytes(32).toString('base64url')
    const nonce = randomBytes(16).toString('base64url')
    const session = this.createSession(input, { fetch: fetcher })
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') { response.writeHead(404).end('Not found'); return }
      const code = url.searchParams.get('code')
      if (!code || url.searchParams.get('state') !== state) {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Invalid OAuth callback.')
        return
      }
      void this.exchangeGrok(session.grok!, code, session.fetch).then((credentials) => {
        session.credentials = credentials
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
          .end('Kun connected to Grok. You can close this page and return to the terminal.')
      }, (error) => {
        session.message = safeError(error)
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Grok login failed.')
      })
    })
    const port = await listenLoopback(server)
    const redirectUri = `http://127.0.0.1:${port}/callback`
    session.server = server
    session.grok = { tokenEndpoint, redirectUri, verifier, state }
    const params = new URLSearchParams({
      response_type: 'code', client_id: GROK_CLIENT_ID, redirect_uri: redirectUri,
      scope: GROK_SCOPES, code_challenge: challenge, code_challenge_method: 'S256',
      state, nonce, referrer: 'kun'
    })
    session.url = `${authorizationEndpoint}${authorizationEndpoint.includes('?') ? '&' : '?'}${params}`
    return project(session)
  }

  private async exchangeGrok(
    session: { tokenEndpoint: string; redirectUri: string; verifier: string },
    code: string,
    fetcher?: typeof fetch
  ): Promise<OAuthCredentials> {
    const tokens = await postForm(fetcher ?? this.fetch, session.tokenEndpoint, {
      grant_type: 'authorization_code', code, redirect_uri: session.redirectUri,
      client_id: GROK_CLIENT_ID, code_verifier: session.verifier
    }, { 'x-grok-client-version': GROK_CLIENT_VERSION })
    const accessToken = stringValue(tokens.access_token)
    const refreshToken = stringValue(tokens.refresh_token)
    if (!accessToken || !refreshToken) throw new Error('Grok token exchange is incomplete')
    return {
      kind: 'grok-oauth', accessToken, refreshToken,
      expiresAt: this.now() + (Number(tokens.expires_in) || 30 * 24 * 60 * 60) * 1000,
      email: tokenClaim(tokens.id_token, accessToken, 'email'),
      userId: tokenClaim(tokens.id_token, accessToken, 'subject'),
      issuer: GROK_ISSUER,
      clientId: GROK_CLIENT_ID
    }
  }

  private async commit(session: OAuthSession): Promise<void> {
    if ((!session.credentials && !session.claudeToken) || session.status !== 'pending') return
    try {
      if (session.input.provider === 'claude') {
        const preset = requireCatalogPreset('claude-subscription')
        session.snapshot = await this.options.registry.connectAuthenticated({
          expectedRevision: session.input.expectedRevision,
          id: preset.id,
          name: preset.name,
          presetSource: preset.id,
          kind: preset.kind,
          authType: preset.authType,
          ...(preset.baseUrl ? { baseUrl: preset.baseUrl } : {}),
          endpointFormat: preset.endpointFormat,
          useProxy: session.input.useProxy,
          credential: session.claudeToken,
          models: [...preset.models],
          selectedModel: catalogModel(preset, session.input.model),
          select: session.input.select
        })
        this.finish(session, 'connected')
        return
      }
      const chatGpt = session.input.provider === 'chatgpt'
      const preset = requireCatalogPreset(chatGpt ? 'codex' : 'grok-subscription')
      session.snapshot = await this.options.registry.connectAuthenticated({
        expectedRevision: session.input.expectedRevision,
        id: preset.id,
        name: preset.name,
        presetSource: preset.id,
        kind: preset.kind,
        authType: preset.authType,
        ...(preset.baseUrl ? { baseUrl: preset.baseUrl } : {}),
        endpointFormat: preset.endpointFormat,
        useProxy: session.input.useProxy,
        credential: JSON.stringify(session.credentials),
        models: [...preset.models],
        selectedModel: catalogModel(preset, session.input.model),
        select: session.input.select
      })
      this.finish(session, 'connected')
    } catch (error) {
      this.finish(session, 'failed', safeError(error))
    }
  }

  private createSession(
    input: ModelConnectionOAuthStartRequest,
    extra: Partial<OAuthSession> = {}
  ): OAuthSession {
    const session: OAuthSession = {
      id: randomUUID(), input, status: 'pending', expiresAt: this.now() + SESSION_TTL_MS, ...extra
    }
    this.sessions.set(session.id, session)
    return session
  }

  private finish(session: OAuthSession, status: OAuthSession['status'], message?: string): void {
    session.status = status
    session.message = message
    session.credentials = undefined
    session.claudeToken = undefined
    session.abort?.abort()
    session.abort = undefined
    session.server?.close()
    session.server = undefined
  }

  private requireSession(id: string): OAuthSession {
    const session = this.sessions.get(id)
    if (!session) throw new Error('OAuth session not found')
    return session
  }

  private async fetchFor(input: ModelConnectionOAuthStartRequest, providerId: string): Promise<typeof fetch> {
    const snapshot = await this.options.registry.snapshot()
    const proxyUrl = resolveRegistryProfileProxyUrl(
      { proxy: snapshot.proxy },
      { id: providerId, kind: 'http', useProxy: input.useProxy }
    )
    return createProxyFetch(proxyUrl) ?? this.fetch
  }

  private expireSessions(): void {
    for (const session of this.sessions.values()) {
      if (session.status === 'pending' && this.now() >= session.expiresAt) {
        this.finish(session, 'failed', 'OAuth session expired.')
      }
    }
  }

  private get fetch(): typeof fetch { return this.options.fetch ?? fetch }
  private now(): number { return this.options.now?.() ?? Date.now() }
}

function requireCatalogPreset(id: string): ProviderCatalogPreset {
  const preset = getProviderCatalogPreset(id)
  if (!preset) throw new Error(`OAuth provider preset is unavailable: ${id}`)
  return preset
}

function catalogModel(preset: ProviderCatalogPreset, requested: string | undefined): string {
  if (requested && preset.models.includes(requested)) return requested
  const fallback = preset.models[0]
  if (!fallback) throw new Error(`OAuth provider has no models: ${preset.id}`)
  return fallback
}

function project(session: OAuthSession): ModelConnectionOAuthStatus {
  return ModelConnectionOAuthStatusSchema.parse({
    sessionId: session.id,
    provider: session.input.provider,
    status: session.status,
    url: session.url,
    userCode: session.userCode,
    interval: session.interval,
    expiresAt: new Date(session.expiresAt).toISOString(),
    message: session.message,
    snapshot: session.snapshot
  })
}

async function listenLoopback(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      if (!address || typeof address === 'string') reject(new Error('Unable to bind OAuth callback'))
      else resolve(address.port)
    })
  })
}

async function getJson(fetchImpl: typeof fetch, url: string): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`OAuth request failed with HTTP ${response.status}`)
  return jsonObject(response)
}

async function postJson(fetchImpl: typeof fetch, url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000)
  })
  if (!response.ok) throw new Error(`OAuth request failed with HTTP ${response.status}`)
  return jsonObject(response)
}

async function postForm(
  fetchImpl: typeof fetch,
  url: string,
  body: Record<string, string>,
  headers: Record<string, string> = {}
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(15_000)
  })
  if (!response.ok) throw new Error(`OAuth token exchange failed with HTTP ${response.status}`)
  return jsonObject(response)
}

async function jsonObject(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json() as unknown
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('OAuth response was not an object')
  return value as Record<string, unknown>
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function tokenClaim(idToken: unknown, accessToken: string | undefined, kind: 'account' | 'email' | 'subject'): string | undefined {
  for (const token of [stringValue(idToken), accessToken]) {
    const claims = decodeJwt(token)
    if (!claims) continue
    if (kind === 'email') return stringValue(claims.email)
    if (kind === 'subject') return stringValue(claims.sub)
    const direct = stringValue(claims.chatgpt_account_id)
    if (direct) return direct
    const auth = claims['https://api.openai.com/auth']
    if (auth && typeof auth === 'object') {
      const nested = stringValue((auth as Record<string, unknown>).chatgpt_account_id)
      if (nested) return nested
    }
  }
  return undefined
}

function decodeJwt(token: string | undefined): Record<string, unknown> | undefined {
  const part = token?.split('.')[1]
  if (!part) return undefined
  try { return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown> }
  catch { return undefined }
}

function parsePastedCode(value: string): { code: string; state?: string } {
  const trimmed = value.trim()
  if (/^https?:\/\//iu.test(trimmed)) {
    const url = new URL(trimmed)
    const code = url.searchParams.get('code')
    if (!code) throw new Error('Callback URL does not contain an authorization code')
    return { code, state: url.searchParams.get('state') ?? undefined }
  }
  if (!trimmed) throw new Error('Authorization code is required')
  return { code: trimmed }
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

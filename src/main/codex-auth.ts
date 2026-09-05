import { createServer, type Server } from 'node:http'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  CODEX_CLI_ORIGINATOR,
  CODEX_CLI_VERSION,
  codexCliRequestHeaders,
  codexCliUserAgent
} from '../../kun/src/adapters/model/provider-cli-identity.js'
import { grokRequestHeaders } from './grok-auth'
import { fetchWithOptionalProxy } from './proxy-fetch'

const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CODEX_ISSUER = 'https://auth.openai.com'
const CODEX_DEVICE_CALLBACK = `${CODEX_ISSUER}/deviceauth/callback`
// Keep in sync with the Codex CLI Hydra redirect URI allow-list.
const CODEX_OAUTH_PORTS = [1455, 1457] as const
const CODEX_OAUTH_HOST = '127.0.0.1'
const CODEX_OAUTH_TIMEOUT_MS = 5 * 60 * 1000
const CODEX_SESSION_ID = randomUUID()
const CODEX_OAUTH_SCOPE = 'openid profile email offline_access api.connectors.read api.connectors.invoke'
const CODEX_ORIGINATOR = CODEX_CLI_ORIGINATOR
export { CODEX_CLI_VERSION, codexCliUserAgent as codexUserAgent }

export type CodexOAuthCredentials = {
  kind: 'codex-oauth'
  accessToken: string
  refreshToken: string
  expiresAt: number
  accountId: string
  email?: string
}

export type CodexAuthStartResult =
  | { ok: true; url: string; deviceCode: string; userCode: string; interval: number }
  | { ok: false; message: string }

export type CodexAuthPollResult =
  | { done: true; credentials: CodexOAuthCredentials }
  | { done: false; error?: string }

export type CodexBrowserAuthErrorCode = 'port_in_use'

export type CodexBrowserAuthResult =
  | { ok: true; credentials: CodexOAuthCredentials }
  | { ok: false; message: string; code?: CodexBrowserAuthErrorCode }

export type CodexAuthTransport = {
  fetcher?: typeof fetchWithOptionalProxy
  proxyUrl?: string
}

class CodexBrowserAuthError extends Error {
  constructor(
    message: string,
    readonly code: CodexBrowserAuthErrorCode
  ) {
    super(message)
    this.name = 'CodexBrowserAuthError'
  }
}

function parseJwtClaims(token: string): Record<string, unknown> | undefined {
  const part = token.split('.')[1]
  if (!part) return undefined
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString()) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function extractAccountId(claims: Record<string, unknown>): string | undefined {
  if (typeof claims.chatgpt_account_id === 'string') return claims.chatgpt_account_id
  const auth = claims['https://api.openai.com/auth']
  if (auth && typeof auth === 'object' && 'chatgpt_account_id' in auth) {
    const id = (auth as Record<string, unknown>).chatgpt_account_id
    if (typeof id === 'string') return id
  }
  const orgs = claims.organizations
  if (Array.isArray(orgs) && orgs[0] && typeof orgs[0].id === 'string') return orgs[0].id
  return undefined
}

function extractAccountIdFromTokens(
  idToken?: string,
  accessToken?: string
): string | undefined {
  for (const token of [idToken, accessToken]) {
    if (!token) continue
    const claims = parseJwtClaims(token)
    if (!claims) continue
    const id = extractAccountId(claims)
    if (id) return id
  }
  return undefined
}

function extractEmail(idToken?: string, accessToken?: string): string | undefined {
  for (const token of [idToken, accessToken]) {
    if (!token) continue
    const claims = parseJwtClaims(token)
    if (claims && typeof claims.email === 'string') return claims.email
  }
  return undefined
}

async function authFetch(
  url: string,
  init: RequestInit,
  transport: CodexAuthTransport
): Promise<Response> {
  return transport.fetcher
    ? transport.fetcher(url, init, transport.proxyUrl ?? '')
    : fetch(url, init)
}

async function postJson(
  url: string,
  body: Record<string, string>,
  transport: CodexAuthTransport
): Promise<Record<string, unknown>> {
  const res = await authFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, transport)
  const text = await res.text()
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(`ChatGPT subscription auth: unexpected response from ${url}: ${text.slice(0, 200)}`)
  }
}

async function postForm(
  url: string,
  body: Record<string, string>,
  transport: CodexAuthTransport
): Promise<Record<string, unknown>> {
  const res = await authFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString()
  }, transport)
  const text = await res.text()
  if (!res.ok) {
    const detail = summarizeAuthErrorBody(text)
    throw new Error(`ChatGPT subscription auth: ${url} returned ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(`ChatGPT subscription auth: unexpected response from ${url}: ${text.slice(0, 200)}`)
  }
}

function summarizeAuthErrorBody(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const parts = [
      typeof parsed.error === 'string' ? parsed.error : '',
      typeof parsed.error_description === 'string' ? parsed.error_description : '',
      typeof parsed.message === 'string' ? parsed.message : ''
    ].filter(Boolean)
    if (parts.length) return parts.join(': ').slice(0, 300)
  } catch { /* fall through */ }
  return compact.slice(0, 300)
}

export async function startCodexDeviceAuth(
  transport: CodexAuthTransport = {}
): Promise<CodexAuthStartResult> {
  try {
    const data = await postJson(`${CODEX_ISSUER}/api/accounts/deviceauth/usercode`, {
      client_id: CODEX_CLIENT_ID
    }, transport)
    const deviceCode = data.device_auth_id as string | undefined
    const userCode = data.user_code as string | undefined
    const interval = Math.max(Number(data.interval) || 5, 1)
    if (!deviceCode || !userCode) {
      throw new Error('Incomplete device auth response')
    }
    return {
      ok: true,
      url: `${CODEX_ISSUER}/codex/device`,
      deviceCode,
      userCode,
      interval
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function pollCodexDeviceAuth(
  deviceCode: string,
  userCode: string,
  transport: CodexAuthTransport = {}
): Promise<CodexAuthPollResult> {
  try {
    const res = await authFetch(`${CODEX_ISSUER}/api/accounts/deviceauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_auth_id: deviceCode, user_code: userCode })
    }, transport)
    if (!res.ok) {
      if (res.status === 403 || res.status === 404) return { done: false }
      return { done: false, error: `Device authorization failed: ${res.status}` }
    }
    const data = (await res.json()) as Record<string, unknown>
    const authCode = data.authorization_code as string | undefined
    const codeVerifier = data.code_verifier as string | undefined
    if (!authCode || !codeVerifier) {
      return { done: false, error: 'Missing authorization_code or code_verifier in poll response' }
    }

    const tokens = await postForm(`${CODEX_ISSUER}/oauth/token`, {
      grant_type: 'authorization_code',
      code: authCode,
      redirect_uri: CODEX_DEVICE_CALLBACK,
      client_id: CODEX_CLIENT_ID,
      code_verifier: codeVerifier
    }, transport)

    const accessToken = tokens.access_token as string | undefined
    const refreshToken = tokens.refresh_token as string | undefined
    const expiresIn = Number(tokens.expires_in) || 3600
    if (!accessToken || !refreshToken) {
      return { done: false, error: 'Token exchange returned incomplete tokens' }
    }
    const accountId = extractAccountIdFromTokens(tokens.id_token as string, accessToken)
    if (!accountId) {
      return { done: false, error: 'Could not extract account ID from tokens' }
    }
    return {
      done: true,
      credentials: {
        kind: 'codex-oauth',
        accessToken,
        refreshToken,
        expiresAt: Date.now() + expiresIn * 1000,
        accountId,
        email: extractEmail(tokens.id_token as string, accessToken)
      }
    }
  } catch (error) {
    return { done: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function refreshCodexToken(
  credentials: CodexOAuthCredentials,
  transport: CodexAuthTransport = {}
): Promise<CodexOAuthCredentials | null> {
  try {
    const tokens = await postForm(`${CODEX_ISSUER}/oauth/token`, {
      grant_type: 'refresh_token',
      refresh_token: credentials.refreshToken,
      client_id: CODEX_CLIENT_ID
    }, transport)
    const accessToken = tokens.access_token as string | undefined
    const refreshToken = tokens.refresh_token as string | undefined
    const expiresIn = Number(tokens.expires_in) || 3600
    if (!accessToken || !refreshToken) return null
    const accountId =
      extractAccountIdFromTokens(tokens.id_token as string, accessToken) ??
      credentials.accountId
    return {
      kind: 'codex-oauth',
      accessToken,
      refreshToken,
      expiresAt: Date.now() + expiresIn * 1000,
      accountId,
      email: extractEmail(tokens.id_token as string, accessToken) ?? credentials.email
    }
  } catch {
    return null
  }
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function generatePkce(): { verifier: string; challenge: string } {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const verifier = Array.from(randomBytes(43), (byte) => chars[byte % chars.length]).join('')
  const challenge = base64UrlEncode(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

function codexOAuthRedirect(port: number): string {
  return `http://localhost:${port}/auth/callback`
}

function buildAuthorizeUrl(pkceChallenge: string, state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CODEX_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: CODEX_OAUTH_SCOPE,
    code_challenge: pkceChallenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    state,
    originator: CODEX_ORIGINATOR
  })
  return `${CODEX_ISSUER}/oauth/authorize?${params.toString()}`
}

function credentialsFromTokens(tokens: Record<string, unknown>): CodexOAuthCredentials | null {
  const accessToken = tokens.access_token as string | undefined
  const refreshToken = tokens.refresh_token as string | undefined
  const expiresIn = Number(tokens.expires_in) || 3600
  if (!accessToken || !refreshToken) return null
  const accountId = extractAccountIdFromTokens(tokens.id_token as string, accessToken)
  if (!accountId) return null
  return {
    kind: 'codex-oauth',
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    accountId,
    email: extractEmail(tokens.id_token as string, accessToken)
  }
}

const CODEX_BROWSER_SUCCESS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>ChatGPT 订阅</title><style>body{font-family:system-ui,-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#faf6ef;color:#3a2f23}.box{text-align:center;padding:2rem}h1{margin-bottom:.5rem}p{color:#8a7a66}</style></head><body><div class="box"><h1>登录成功</h1><p>可以关闭此窗口并返回应用。</p></div><script>setTimeout(()=>window.close(),1500)</script></body></html>`

function renderCodexErrorHtml(message: string): string {
  const safe = message.replace(/[&<>"]/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;'
  )
  return `<!doctype html><html><head><meta charset="utf-8"><title>ChatGPT 订阅</title></head><body style="font-family:system-ui;padding:2rem;color:#b91c1c"><h1>登录失败</h1><p>${safe}</p></body></html>`
}

/**
 * Full browser OAuth (authorization code + PKCE). Opens the user's default
 * browser via `openBrowser`, runs a one-shot local callback server,
 * exchanges the returned code for tokens, and resolves with credentials. The
 * callback URL ports are fixed by OpenAI's app registration.
 */
export async function startCodexBrowserAuth(
  openBrowser: (url: string) => void | Promise<void>,
  transport: CodexAuthTransport = {}
): Promise<CodexBrowserAuthResult> {
  const pkce = generatePkce()
  const state = base64UrlEncode(randomBytes(32))
  let server: Server | null = null

  const cleanup = (): void => {
    if (server) {
      try {
        server.close(() => {})
      } catch { /* server may not have finished binding */ }
      server = null
    }
  }

  try {
    const credentials = await new Promise<CodexOAuthCredentials>((resolve, reject) => {
      let settled = false
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error('授权超时，请重试'))
      }, CODEX_OAUTH_TIMEOUT_MS)

      const settleReject = (error: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        cleanup()
        reject(error)
      }
      const settleResolve = (creds: CodexOAuthCredentials): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        cleanup()
        resolve(creds)
      }

      let portIndex = 0
      let activePort = CODEX_OAUTH_PORTS[portIndex]

      server = createServer((req, res) => {
        const url = new URL(req.url || '/', `http://localhost:${activePort}`)
        if (url.pathname !== '/auth/callback') {
          res.writeHead(404).end('Not found')
          return
        }
        const code = url.searchParams.get('code')
        const returnedState = url.searchParams.get('state')
        const oauthError = url.searchParams.get('error')
        if (oauthError) {
          const message = url.searchParams.get('error_description') || oauthError
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderCodexErrorHtml(message))
          settleReject(new Error(message))
          return
        }
        if (!code || returnedState !== state) {
          const message = !code ? '缺少授权码' : '状态校验失败（可能的 CSRF）'
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderCodexErrorHtml(message))
          settleReject(new Error(message))
          return
        }
        postForm(`${CODEX_ISSUER}/oauth/token`, {
          grant_type: 'authorization_code',
          code,
          redirect_uri: codexOAuthRedirect(activePort),
          client_id: CODEX_CLIENT_ID,
          code_verifier: pkce.verifier
        }, transport)
          .then((tokens) => {
            const creds = credentialsFromTokens(tokens)
            if (!creds) throw new Error('令牌交换返回的数据不完整')
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(CODEX_BROWSER_SUCCESS_HTML)
            settleResolve(creds)
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err)
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderCodexErrorHtml(message))
            settleReject(new Error(message))
          })
      })

      let listen: () => void
      const onListenError = (err: NodeJS.ErrnoException): void => {
        server?.off('error', onListenError)
        if (err.code === 'EADDRINUSE' && portIndex < CODEX_OAUTH_PORTS.length - 1) {
          portIndex += 1
          listen()
          return
        }
        const message =
          err.code === 'EADDRINUSE'
            ? `端口 ${CODEX_OAUTH_PORTS.join('/')} 被占用，无法完成登录回调`
            : err.message
        settleReject(
          err.code === 'EADDRINUSE'
            ? new CodexBrowserAuthError(message, 'port_in_use')
            : new Error(message)
        )
      }

      listen = (): void => {
        activePort = CODEX_OAUTH_PORTS[portIndex]
        server?.once('error', onListenError)
        server?.listen(activePort, CODEX_OAUTH_HOST, () => {
          server?.off('error', onListenError)
          const redirectUri = codexOAuthRedirect(activePort)
          void Promise.resolve(openBrowser(buildAuthorizeUrl(pkce.challenge, state, redirectUri))).catch((err: unknown) => {
            settleReject(err instanceof Error ? err : new Error(String(err)))
          })
        })
      }

      listen()
    })
    return { ok: true, credentials }
  } catch (error) {
    cleanup()
    const message = error instanceof Error ? error.message : String(error)
    return error instanceof CodexBrowserAuthError
      ? { ok: false, message, code: error.code }
      : { ok: false, message }
  }
}

export function isCodexOAuthCredentials(apiKey: string): boolean {
  if (!apiKey.startsWith('{')) return false
  try {
    return (JSON.parse(apiKey) as Record<string, unknown>).kind === 'codex-oauth'
  } catch {
    return false
  }
}

export function parseCodexCredentials(apiKey: string): CodexOAuthCredentials | null {
  if (!isCodexOAuthCredentials(apiKey)) return null
  const parsed = JSON.parse(apiKey) as CodexOAuthCredentials
  if (!parsed.accessToken || !parsed.refreshToken || !parsed.accountId) return null
  return parsed
}

export function encodeCodexCredentials(creds: CodexOAuthCredentials): string {
  return JSON.stringify(creds)
}

export function codexRequestHeaders(creds: CodexOAuthCredentials): Record<string, string> {
  return codexCliRequestHeaders({
    accountId: creds.accountId,
    sessionId: CODEX_SESSION_ID
  })
}

export function resolveCodexOAuthApiKey(rawApiKey: string): { apiKey: string; headers?: Record<string, string> } {
  const key = rawApiKey.trim()
  const codex = isCodexOAuthCredentials(key) ? parseCodexCredentials(key) : null
  if (codex) return { apiKey: codex.accessToken, headers: codexRequestHeaders(codex) }
  // Grok subscription credentials also serialize into provider.apiKey as JSON.
  // Reuse this resolve helper so existing callers unwrap either subscription kind.
  if (key.startsWith('{')) {
    try {
      const parsed = JSON.parse(key) as Record<string, unknown>
      if (parsed.kind === 'grok-oauth' && typeof parsed.accessToken === 'string' && parsed.accessToken.trim()) {
        return {
          apiKey: parsed.accessToken.trim(),
          headers: grokRequestHeaders()
        }
      }
    } catch {
      /* plain key */
    }
  }
  return { apiKey: key }
}

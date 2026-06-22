import { createServer, type Server } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'

// Anthropic OAuth (Claude Pro/Max subscription). Mirrors codex-auth.ts but
// targets Anthropic's Authorization-Code + PKCE flow, reusing the Claude Code
// CLI's registered OAuth app so requests consume the user's subscription quota
// instead of a pay-as-you-go API key. Constants verified against the reference
// implementation in `openclaw/src/llm/utils/oauth/anthropic.ts`.
const ANTHROPIC_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const ANTHROPIC_AUTHORIZE_URL = 'https://claude.ai/oauth/authorize'
const ANTHROPIC_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token'
// Anthropic registers this exact redirect for the Claude Code app; the port is
// not configurable. If it is occupied the browser flow fails fast.
const ANTHROPIC_OAUTH_PORT = 53692
const ANTHROPIC_OAUTH_REDIRECT = `http://localhost:${ANTHROPIC_OAUTH_PORT}/callback`
const ANTHROPIC_OAUTH_SCOPES =
  'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload'
const ANTHROPIC_OAUTH_TIMEOUT_MS = 5 * 60 * 1000

export type AnthropicOAuthCredentials = {
  kind: 'anthropic-oauth'
  accessToken: string
  refreshToken: string
  expiresAt: number
  email?: string
}

export type AnthropicBrowserAuthResult =
  | { ok: true; credentials: AnthropicOAuthCredentials }
  | { ok: false; message: string }

async function postJson(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body)
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Anthropic auth: ${url} returned ${res.status}: ${text.slice(0, 200)}`)
  }
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(`Anthropic auth: unexpected response from ${url}: ${text.slice(0, 200)}`)
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

/**
 * Build the Claude OAuth authorize URL. Exported for tests; the `code=true`
 * param and the exact scope string are required by Anthropic's flow.
 */
export function buildAnthropicAuthorizeUrl(pkceChallenge: string, state: string): string {
  const params = new URLSearchParams({
    code: 'true',
    client_id: ANTHROPIC_CLIENT_ID,
    response_type: 'code',
    redirect_uri: ANTHROPIC_OAUTH_REDIRECT,
    scope: ANTHROPIC_OAUTH_SCOPES,
    code_challenge: pkceChallenge,
    code_challenge_method: 'S256',
    state
  })
  return `${ANTHROPIC_AUTHORIZE_URL}?${params.toString()}`
}

function credentialsFromTokens(tokens: Record<string, unknown>): AnthropicOAuthCredentials | null {
  const accessToken = tokens.access_token as string | undefined
  const refreshToken = tokens.refresh_token as string | undefined
  const expiresIn = Number(tokens.expires_in) || 3600
  if (!accessToken || !refreshToken) return null
  return {
    kind: 'anthropic-oauth',
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000
  }
}

const ANTHROPIC_BROWSER_SUCCESS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Claude</title><style>body{font-family:system-ui,-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#faf6ef;color:#3a2f23}.box{text-align:center;padding:2rem}h1{margin-bottom:.5rem}p{color:#8a7a66}</style></head><body><div class="box"><h1>登录成功</h1><p>可以关闭此窗口并返回应用。</p></div><script>setTimeout(()=>window.close(),1500)</script></body></html>`

function renderAnthropicErrorHtml(message: string): string {
  const safe = message.replace(/[&<>"]/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;'
  )
  return `<!doctype html><html><head><meta charset="utf-8"><title>Claude</title></head><body style="font-family:system-ui;padding:2rem;color:#b91c1c"><h1>登录失败</h1><p>${safe}</p></body></html>`
}

/**
 * Full browser OAuth (authorization code + PKCE). Opens the user's default
 * browser via `openBrowser`, runs a one-shot localhost:53692 callback server,
 * exchanges the returned code for tokens, and resolves with credentials. The
 * callback URL/port is fixed by Anthropic's app registration.
 */
export async function startAnthropicBrowserAuth(
  openBrowser: (url: string) => void | Promise<void>
): Promise<AnthropicBrowserAuthResult> {
  const pkce = generatePkce()
  const state = base64UrlEncode(randomBytes(32))
  let server: Server | null = null

  const cleanup = (): void => {
    if (server) {
      server.close(() => {})
      server = null
    }
  }

  try {
    const credentials = await new Promise<AnthropicOAuthCredentials>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error('授权超时，请重试'))
      }, ANTHROPIC_OAUTH_TIMEOUT_MS)

      const settleReject = (error: Error): void => {
        clearTimeout(timeout)
        cleanup()
        reject(error)
      }
      const settleResolve = (creds: AnthropicOAuthCredentials): void => {
        clearTimeout(timeout)
        cleanup()
        resolve(creds)
      }

      server = createServer((req, res) => {
        const url = new URL(req.url || '/', `http://localhost:${ANTHROPIC_OAUTH_PORT}`)
        if (url.pathname !== '/callback') {
          res.writeHead(404).end('Not found')
          return
        }
        const code = url.searchParams.get('code')
        const returnedState = url.searchParams.get('state')
        const oauthError = url.searchParams.get('error')
        if (oauthError) {
          const message = url.searchParams.get('error_description') || oauthError
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderAnthropicErrorHtml(message))
          settleReject(new Error(message))
          return
        }
        if (!code || returnedState !== state) {
          const message = !code ? '缺少授权码' : '状态校验失败（可能的 CSRF）'
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderAnthropicErrorHtml(message))
          settleReject(new Error(message))
          return
        }
        postJson(ANTHROPIC_TOKEN_URL, {
          grant_type: 'authorization_code',
          client_id: ANTHROPIC_CLIENT_ID,
          code,
          state,
          redirect_uri: ANTHROPIC_OAUTH_REDIRECT,
          code_verifier: pkce.verifier
        })
          .then((tokens) => {
            const creds = credentialsFromTokens(tokens)
            if (!creds) throw new Error('令牌交换返回的数据不完整')
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(ANTHROPIC_BROWSER_SUCCESS_HTML)
            settleResolve(creds)
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err)
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderAnthropicErrorHtml(message))
            settleReject(new Error(message))
          })
      })

      server.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timeout)
        const message =
          err.code === 'EADDRINUSE'
            ? `端口 ${ANTHROPIC_OAUTH_PORT} 被占用，无法完成登录回调`
            : err.message
        cleanup()
        reject(new Error(message))
      })

      server.listen(ANTHROPIC_OAUTH_PORT, () => {
        void Promise.resolve(openBrowser(buildAnthropicAuthorizeUrl(pkce.challenge, state))).catch(
          (err: unknown) => {
            settleReject(err instanceof Error ? err : new Error(String(err)))
          }
        )
      })
    })
    return { ok: true, credentials }
  } catch (error) {
    cleanup()
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Refresh the Anthropic OAuth access token. Anthropic ROTATES the refresh
 * token on every refresh, so the caller must persist the returned credentials
 * (the old refresh token stops working). Returns null on failure so the caller
 * can fall back to a re-login prompt.
 */
export async function refreshAnthropicToken(
  credentials: AnthropicOAuthCredentials
): Promise<AnthropicOAuthCredentials | null> {
  try {
    const tokens = await postJson(ANTHROPIC_TOKEN_URL, {
      grant_type: 'refresh_token',
      client_id: ANTHROPIC_CLIENT_ID,
      refresh_token: credentials.refreshToken
    })
    const accessToken = tokens.access_token as string | undefined
    if (!accessToken) return null
    // Keep the rotated refresh token; fall back to the prior one only if the
    // response omitted it.
    const refreshToken = (tokens.refresh_token as string | undefined) ?? credentials.refreshToken
    const expiresIn = Number(tokens.expires_in) || 3600
    return {
      kind: 'anthropic-oauth',
      accessToken,
      refreshToken,
      expiresAt: Date.now() + expiresIn * 1000,
      email: credentials.email
    }
  } catch {
    return null
  }
}

export function isAnthropicOAuthCredentials(apiKey: string): boolean {
  if (!apiKey.startsWith('{')) return false
  try {
    return (JSON.parse(apiKey) as Record<string, unknown>).kind === 'anthropic-oauth'
  } catch {
    return false
  }
}

export function parseAnthropicCredentials(apiKey: string): AnthropicOAuthCredentials | null {
  if (!isAnthropicOAuthCredentials(apiKey)) return null
  const parsed = JSON.parse(apiKey) as AnthropicOAuthCredentials
  if (!parsed.accessToken || !parsed.refreshToken) return null
  return parsed
}

export function encodeAnthropicCredentials(creds: AnthropicOAuthCredentials): string {
  return JSON.stringify(creds)
}

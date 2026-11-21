import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { ColabOAuthPendingState } from '../../shared/colab/colab-types'
import type { StoredColabOAuthToken } from './colab-credential-store'

/**
 * Public installed-app OAuth client shipped in official `google-colab-cli`
 * (`src/colab_cli/oauth_config.json`), supporting both RFC 8252 `http://localhost:<port>`
 * loopback redirects and `https://sdk.cloud.google.com/applicationdefaultauthcode.html`
 * manual-code fallback.
 */
export const COLAB_OAUTH_CLIENT_ID =
  '764086051850-6qr4p6gpi6hn506pt8ejuq83di341hur.apps.googleusercontent.com'
export const COLAB_OAUTH_CLIENT_SECRET = 'd-FL95Q19q7MQmFpd7hHD0Ty'
export const COLAB_OAUTH_AUTH_URI = 'https://accounts.google.com/o/oauth2/auth'
export const COLAB_OAUTH_TOKEN_URI = 'https://oauth2.googleapis.com/token'
export const COLAB_OAUTH_TOKENINFO_URI = 'https://oauth2.googleapis.com/tokeninfo'
export const COLAB_REMOTE_REDIRECT_URI =
  'https://sdk.cloud.google.com/applicationdefaultauthcode.html'

export const COLAB_PUBLIC_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/colaboratory',
  'https://www.googleapis.com/auth/drive.file'
] as const

export const COLAB_OAUTH_TIMEOUT_MS = 5 * 60 * 1000

export type VerifiedColabIdentity = {
  email: string
  token: StoredColabOAuthToken
}

type ActiveOAuthFlow = {
  state: ColabOAuthPendingState
  oauthState: string
  loopbackVerifier: string
  loopbackRedirectUri: string
  manualVerifier: string
  server: Server
  timer: ReturnType<typeof setTimeout>
  settled: boolean
}

function base64Url(bytes: Buffer): string {
  return bytes.toString('base64url')
}

function s256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url')
}

function buildGoogleAuthUrl(params: {
  redirectUri: string
  state: string
  codeChallenge: string
  remoteUsage?: boolean
  loginHint?: string
}): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: COLAB_OAUTH_CLIENT_ID,
    redirect_uri: params.redirectUri,
    scope: COLAB_PUBLIC_SCOPES.join(' '),
    state: params.state,
    prompt: 'consent select_account',
    access_type: 'offline',
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256'
  })
  if (params.remoteUsage) query.set('token_usage', 'remote')
  if (params.loginHint) query.set('login_hint', params.loginHint)
  return `${COLAB_OAUTH_AUTH_URI}?${query.toString()}`
}

function callbackHtml(success: boolean, detail: string): string {
  const color = success ? '#128a4a' : '#d6493f'
  const title = success ? 'Google 账号已授权' : 'Google 授权未完成'
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Kun · Colab</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fcfcfd;font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#20242d}
.box{max-width:420px;background:#fff;border:1px solid #e7e9ee;border-radius:18px;padding:28px 32px;text-align:center;box-shadow:0 18px 48px rgba(32,55,90,.08)}
.dot{width:36px;height:36px;border-radius:50%;margin:0 auto 12px;display:grid;place-items:center;color:#fff;font-weight:700;background:${color}}
p{margin:6px 0 0;color:#687083;font-size:13px}</style></head>
<body><div class="box"><div class="dot">${success ? '✓' : '!'}</div><b>${title}</b><p>${detail}</p></div></body></html>`
}

export class ColabOAuthCoordinator {
  private current: ActiveOAuthFlow | null = null

  constructor(
    private readonly handlers: {
      openExternal: (url: string) => Promise<void>
      onAuthorized: (flow: ColabOAuthPendingState, identity: VerifiedColabIdentity) => Promise<void>
      onFailed: (
        flow: ColabOAuthPendingState,
        kind: 'cancelled' | 'timeout' | 'error',
        message: string
      ) => void
      fetchImpl?: typeof fetch
    }
  ) {}

  get pendingState(): ColabOAuthPendingState | null {
    return this.current?.state ?? null
  }

  async startFlow(input: {
    flowId: string
    connectionName: string
    setAsCurrent: boolean
    workspaceRoot: string
    reauthConnectionId?: string
    reauthExpectedEmail?: string
  }): Promise<ColabOAuthPendingState> {
    await this.cancelCurrent('replaced')
    const oauthState = base64Url(randomBytes(24))
    const loopbackVerifier = base64Url(randomBytes(32))
    const manualVerifier = base64Url(randomBytes(32))

    const server = createServer((req, res) => {
      void this.handleLoopbackRequest(req.url ?? '/', res)
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
        server.off('error', reject)
        resolve()
      })
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      server.close()
      throw new Error('Failed to bind local OAuth callback port.')
    }
    const loopbackRedirectUri = `http://localhost:${address.port}`
    const authUrl = buildGoogleAuthUrl({
      redirectUri: loopbackRedirectUri,
      state: oauthState,
      codeChallenge: s256Challenge(loopbackVerifier),
      loginHint: input.reauthExpectedEmail
    })
    const manualAuthUrl = buildGoogleAuthUrl({
      redirectUri: COLAB_REMOTE_REDIRECT_URI,
      state: oauthState,
      codeChallenge: s256Challenge(manualVerifier),
      remoteUsage: true,
      loginHint: input.reauthExpectedEmail
    })
    const pending: ColabOAuthPendingState = {
      flowId: input.flowId,
      connectionName: input.connectionName,
      setAsCurrent: input.setAsCurrent,
      workspaceRoot: input.workspaceRoot,
      ...(input.reauthConnectionId ? { reauthConnectionId: input.reauthConnectionId } : {}),
      ...(input.reauthExpectedEmail ? { reauthExpectedEmail: input.reauthExpectedEmail } : {}),
      authUrl,
      manualAuthUrl,
      expiresAt: Date.now() + COLAB_OAUTH_TIMEOUT_MS
    }

    const timer = setTimeout(() => {
      if (!this.current || this.current.state.flowId !== pending.flowId || this.current.settled) {
        return
      }
      const expiredFlow = this.current.state
      void this.cleanupFlow(pending.flowId).then(() => {
        this.handlers.onFailed(expiredFlow, 'timeout', 'Google 登录等待超时，请重试。')
      })
    }, COLAB_OAUTH_TIMEOUT_MS)

    this.current = {
      state: pending,
      oauthState,
      loopbackVerifier,
      loopbackRedirectUri,
      manualVerifier,
      server,
      timer,
      settled: false
    }
    await this.handlers.openExternal(authUrl).catch(() => undefined)
    return pending
  }

  async reopenUrl(flowId: string): Promise<boolean> {
    if (!this.current || this.current.state.flowId !== flowId) return false
    await this.handlers.openExternal(this.current.state.authUrl)
    return true
  }

  async submitManualCode(flowId: string, rawCode: string): Promise<VerifiedColabIdentity> {
    const active = this.current
    if (!active || active.state.flowId !== flowId || active.settled) {
      throw new Error('当前登录流程已结束，请重新发起登录。')
    }
    const code = rawCode.trim()
    if (!code) throw new Error('请输入有效的 Google 授权码。')
    active.settled = true
    try {
      const identity = await this.exchangeAndVerify({
        code,
        codeVerifier: active.manualVerifier,
        redirectUri: COLAB_REMOTE_REDIRECT_URI
      })
      await this.cleanupFlow(flowId)
      return identity
    } catch (error) {
      active.settled = false
      throw error
    }
  }

  async cancelCurrent(reason: 'user' | 'replaced' | 'shutdown' = 'user'): Promise<boolean> {
    const active = this.current
    if (!active) return false
    const flowState = active.state
    await this.cleanupFlow(flowState.flowId)
    if (reason === 'user') {
      this.handlers.onFailed(flowState, 'cancelled', '登录已取消。')
    }
    return true
  }

  private async cleanupFlow(flowId: string): Promise<void> {
    const active = this.current
    if (!active || active.state.flowId !== flowId) return
    this.current = null
    clearTimeout(active.timer)
    await new Promise<void>((resolve) => active.server.close(() => resolve()))
  }

  private async handleLoopbackRequest(
    rawUrl: string,
    res: import('node:http').ServerResponse
  ): Promise<void> {
    const active = this.current
    if (!active || active.settled) {
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
      res.end(callbackHtml(false, '该授权链接已失效，请回到 Kun 重新发起连接。'))
      return
    }
    const parsed = new URL(rawUrl, 'http://localhost')
    if (parsed.pathname === '/favicon.ico') {
      res.writeHead(204)
      res.end()
      return
    }
    const errorParam = parsed.searchParams.get('error')
    if (errorParam) {
      const flowState = active.state
      active.settled = true
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(callbackHtml(false, '你已取消授权，可关闭此标签页并回到 Kun。'))
      await this.cleanupFlow(flowState.flowId)
      this.handlers.onFailed(
        flowState,
        errorParam === 'access_denied' ? 'cancelled' : 'error',
        errorParam === 'access_denied' ? 'Google 授权已取消。' : `Google 授权返回错误：${errorParam}`
      )
      return
    }
    const returnedState = parsed.searchParams.get('state')
    const code = parsed.searchParams.get('code')
    if (!code || returnedState !== active.oauthState) {
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
      res.end(callbackHtml(false, '授权校验参数不匹配，请回到 Kun 重试。'))
      return
    }
    active.settled = true
    const flowState = active.state
    try {
      const identity = await this.exchangeAndVerify({
        code,
        codeVerifier: active.loopbackVerifier,
        redirectUri: active.loopbackRedirectUri
      })
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(callbackHtml(true, `已连接 ${identity.email}，现在可以关闭此页面回到 Kun。`))
      await this.cleanupFlow(flowState.flowId)
      await this.handlers.onAuthorized(flowState, identity)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' })
      res.end(callbackHtml(false, `换取访问凭据失败：${message}`))
      await this.cleanupFlow(flowState.flowId)
      this.handlers.onFailed(flowState, 'error', message)
    }
  }

  private async exchangeAndVerify(params: {
    code: string
    codeVerifier: string
    redirectUri: string
  }): Promise<VerifiedColabIdentity> {
    const fetchFn = this.handlers.fetchImpl ?? fetch
    const tokenResp = await fetchFn(COLAB_OAUTH_TOKEN_URI, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        client_id: COLAB_OAUTH_CLIENT_ID,
        client_secret: COLAB_OAUTH_CLIENT_SECRET,
        code: params.code,
        code_verifier: params.codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: params.redirectUri
      }),
      signal: AbortSignal.timeout(20_000)
    })
    const tokenData = (await tokenResp.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      scope?: string
      error?: string
      error_description?: string
    }
    if (!tokenResp.ok || !tokenData.access_token || !tokenData.refresh_token) {
      throw new Error(
        tokenData.error_description ||
          tokenData.error ||
          `Google OAuth token exchange failed (HTTP ${tokenResp.status}).`
      )
    }

    const infoResp = await fetchFn(
      `${COLAB_OAUTH_TOKENINFO_URI}?${new URLSearchParams({ access_token: tokenData.access_token }).toString()}`,
      { signal: AbortSignal.timeout(15_000) }
    )
    const infoData = (await infoResp.json()) as { email?: string; scope?: string }
    const email = infoData.email?.trim().toLowerCase()
    if (!infoResp.ok || !email) {
      throw new Error('未能读取 Google 账号邮箱，请确认已勾选基本账号信息权限。')
    }
    const grantedScopes = (tokenData.scope || infoData.scope || '')
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (!grantedScopes.some((s) => s.endsWith('/colaboratory'))) {
      throw new Error('未授予 Google Colaboratory 访问权限，请重新登录并勾选所需权限。')
    }
    const expiryIso =
      typeof tokenData.expires_in === 'number' && Number.isFinite(tokenData.expires_in)
        ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
        : undefined

    return {
      email,
      token: {
        token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_uri: COLAB_OAUTH_TOKEN_URI,
        client_id: COLAB_OAUTH_CLIENT_ID,
        client_secret: COLAB_OAUTH_CLIENT_SECRET,
        scopes: grantedScopes,
        ...(expiryIso ? { expiry: expiryIso } : {})
      }
    }
  }
}

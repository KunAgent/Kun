import { createServer, get as httpGet, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CODEX_CLI_VERSION } from '../../kun/src/adapters/model/provider-cli-identity.js'
import {
  codexRequestHeaders,
  codexUserAgent,
  startCodexBrowserAuth,
  startCodexDeviceAuth
} from './codex-auth'

const CODEX_OAUTH_PORTS = [1455, 1457] as const
const CODEX_OAUTH_SCOPE = 'openid profile email offline_access api.connectors.read api.connectors.invoke'

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function listenOnPort(port: number): Promise<Server | null> {
  return new Promise((resolve, reject) => {
    const server = createServer((_, res) => {
      res.writeHead(204).end()
    })
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        resolve(null)
        return
      }
      reject(error)
    })
    server.listen(port, '127.0.0.1', () => {
      resolve(server)
    })
  })
}

function encodeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.`
}

function successfulTokenBody() {
  const claims = {
    email: 'codex@example.com',
    'https://api.openai.com/auth': { chatgpt_account_id: 'acct_123' }
  }
  return {
    access_token: encodeJwt(claims),
    refresh_token: 'refresh-token',
    id_token: encodeJwt(claims),
    expires_in: 3600
  }
}

function hitCallback(redirectUri: string, state: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = new URL(redirectUri)
    url.hostname = '127.0.0.1'
    url.searchParams.set('code', 'auth-code')
    url.searchParams.set('state', state)
    const req = httpGet(url, (res) => {
      res.resume()
      res.on('end', resolve)
    })
    req.on('error', reject)
  })
}

describe('startCodexBrowserAuth', () => {
  let blockers: Server[] = []

  afterEach(async () => {
    vi.restoreAllMocks()
    const closing = blockers
    blockers = []
    await Promise.all(closing.map((server) => closeServer(server)))
  })

  it('falls back to the registered 1457 callback port when 1455 is busy', async () => {
    const fallbackProbe = await listenOnPort(1457)
    if (!fallbackProbe) return
    await closeServer(fallbackProbe)

    const blocker = await listenOnPort(1455)
    if (blocker) blockers.push(blocker)

    const tokenRequests: Array<{ url: string; body: string }> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      tokenRequests.push({ url: String(url), body: String(init?.body ?? '') })
      return new Response(JSON.stringify(successfulTokenBody()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    })

    let authUrlString = ''
    const result = await startCodexBrowserAuth(async (url) => {
      authUrlString = url
      const authUrl = new URL(url)
      const redirectUri = authUrl.searchParams.get('redirect_uri')
      const state = authUrl.searchParams.get('state')
      if (!redirectUri || !state) throw new Error('missing OAuth redirect data')
      await hitCallback(redirectUri, state)
    })

    expect(result).toMatchObject({
      ok: true,
      credentials: {
        accountId: 'acct_123',
        email: 'codex@example.com',
        refreshToken: 'refresh-token'
      }
    })
    const authUrl = new URL(authUrlString)
    expect(authUrl.searchParams.get('redirect_uri')).toBe('http://localhost:1457/auth/callback')
    expect(authUrl.searchParams.get('scope')).toBe(CODEX_OAUTH_SCOPE)
    expect(authUrl.searchParams.get('originator')).toBe('codex_cli_rs')
    const tokenBody = new URLSearchParams(tokenRequests[0]?.body ?? '')
    expect(tokenBody.get('redirect_uri')).toBe('http://localhost:1457/auth/callback')
  })

  it('returns a structured fallback code only when all callback ports are busy', async () => {
    for (const port of CODEX_OAUTH_PORTS) {
      const blocker = await listenOnPort(port)
      if (blocker) blockers.push(blocker)
    }
    const openBrowser = vi.fn()

    const result = await startCodexBrowserAuth(openBrowser)

    expect(openBrowser).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      ok: false,
      code: 'port_in_use'
    })
    if (!result.ok) {
      expect(result.message).toContain('1455/1457')
    }
  })

  it('builds Codex CLI-shaped request headers without Kun or DeepSeek-GUI branding', () => {
    const headers = codexRequestHeaders({
      kind: 'codex-oauth',
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 60_000,
      accountId: 'acct_1'
    })
    expect(headers.originator).toBe('codex_cli_rs')
    expect(headers['User-Agent']).toBe(codexUserAgent())
    expect(headers['User-Agent']).toMatch(
      new RegExp(`^codex_cli_rs\\/${CODEX_CLI_VERSION.replace(/\./g, '\\.')} \\(.+; .+\\)$`)
    )
    expect(headers['User-Agent']).not.toMatch(/deepseekgui|kun/i)
  })

  it('includes token endpoint error details when the exchange is rejected', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({
        error: 'access_denied',
        error_description: 'workspace disallowed'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      })
    })

    const result = await startCodexBrowserAuth(async (url) => {
      const authUrl = new URL(url)
      const redirectUri = authUrl.searchParams.get('redirect_uri')
      const state = authUrl.searchParams.get('state')
      if (!redirectUri || !state) throw new Error('missing OAuth redirect data')
      await hitCallback(redirectUri, state)
    })

    expect(result).toMatchObject({ ok: false })
    if (!result.ok) {
      expect(result.message).toContain('returned 403: access_denied: workspace disallowed')
    }
  })
})

describe('Codex auth transport', () => {
  it('uses the Provider-scoped proxy transport for device discovery', async () => {
    const proxyUrl = 'socks5://127.0.0.1:1080'
    const fetcher = vi.fn(async () => Response.json({
      device_auth_id: 'device-1',
      user_code: 'ABCD',
      interval: 2
    }))

    await expect(startCodexDeviceAuth({ fetcher, proxyUrl })).resolves.toMatchObject({
      ok: true,
      deviceCode: 'device-1'
    })
    expect(fetcher).toHaveBeenCalledWith(
      'https://auth.openai.com/api/accounts/deviceauth/usercode',
      expect.objectContaining({ method: 'POST' }),
      proxyUrl
    )
  })
})

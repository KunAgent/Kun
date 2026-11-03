import { describe, expect, it, vi } from 'vitest'
import { createGmailGoogleFetch, MacSystemHttpsProxy, parseMacHttpsProxyReport } from './google-network-transport.js'
import { withGmailWireFence } from './google-wire-fence.js'
import { GoogleGmailClient } from './google-client.js'
import { GMAIL_SCOPES } from './ports.js'

const report = (host = '127.0.0.1', port = '10808', enabled = '1') => `<dictionary> {
  HTTPEnable : 1
  HTTPProxy : wrong-http-only.example
  HTTPPort : 3128
  HTTPSEnable : ${enabled}
  HTTPSProxy : ${host}
  HTTPSPort : ${port}
}`
const tokenUrl = 'https://oauth2.googleapis.com/token'
const response = () => new Response('{}', { headers: { 'content-type': 'application/json' } })

describe('macOS system HTTPS proxy parsing and short-lived cache', () => {
  it('accepts bounded host/port values without credentials and uses HTTP CONNECT for HTTPS destinations', () => {
    expect(parseMacHttpsProxyReport(report())).toBe('http://127.0.0.1:10808')
    expect(parseMacHttpsProxyReport(report('proxy.example.com', '443'))).toBe('http://proxy.example.com:443')
    expect(parseMacHttpsProxyReport(report('::1', '10808'))).toBe('http://[::1]:10808')
  })

  it('ignores absent and disabled HTTPS settings, including a configured HTTP-only proxy', () => {
    expect(parseMacHttpsProxyReport(report('127.0.0.1', '10808', '0'))).toBeUndefined()
    expect(parseMacHttpsProxyReport('<dictionary> {\n HTTPEnable : 1\n HTTPProxy : localhost\n HTTPPort : 80\n}')).toBeUndefined()
    expect(parseMacHttpsProxyReport('')).toBeUndefined()
  })

  it('rejects malformed hosts, auth, URL paths, invalid ports, duplicate keys and oversized reports', () => {
    for (const host of ['', 'https://proxy.example.com', 'user:password@127.0.0.1', 'proxy.example.com/path',
      'proxy.example.com?secret=value', 'space host', '-bad.example', 'bad_.example', '999.999.999.999']) {
      expect(parseMacHttpsProxyReport(report(host))).toBeUndefined()
    }
    for (const port of ['0', '65536', '-1', '80/password', '80.0', '080', '']) {
      expect(parseMacHttpsProxyReport(report('127.0.0.1', port))).toBeUndefined()
    }
    expect(parseMacHttpsProxyReport(report('127.0.0.1', '10808', '2'))).toBeUndefined()
    expect(parseMacHttpsProxyReport(report().replace('HTTPSEnable : 1', 'HTTPSEnable : 1\n HTTPSEnable : 0'))).toBeUndefined()
    expect(parseMacHttpsProxyReport(report().slice(0, -1))).toBeUndefined()
    expect(parseMacHttpsProxyReport(' '.repeat(65_537))).toBeUndefined()
  })

  it('never substitutes scoped or PAC routes for the global HTTPS proxy', () => {
    const scoped = `<dictionary> {
      ProxyAutoConfigEnable : 1
      ProxyAutoConfigURLString : https://proxy.example/script.pac
      __SCOPED__ : <dictionary> {
        en0 : <dictionary> {
          HTTPSEnable : 1
          HTTPSProxy : scoped.example
          HTTPSPort : 3128
        }
      }
    }`
    expect(parseMacHttpsProxyReport(scoped)).toBeUndefined()
    expect(parseMacHttpsProxyReport(scoped.replace('ProxyAutoConfigEnable : 1',
      'HTTPSEnable : 1\n HTTPSProxy : 127.0.0.1\n HTTPSPort : 10808\n ProxyAutoConfigEnable : 0')))
      .toBe('http://127.0.0.1:10808')
  })

  it('shares the pending probe for ten seconds, then re-reads changed system settings', async () => {
    let now = 1
    const probe = vi.fn(async () => report())
    const system = new MacSystemHttpsProxy({ platform: 'darwin', now: () => now, report: probe })
    expect(await Promise.all([system.resolve(), system.resolve()])).toEqual(['http://127.0.0.1:10808', 'http://127.0.0.1:10808'])
    expect(probe).toHaveBeenCalledOnce()
    now += 10_000
    probe.mockResolvedValue(report('127.0.0.1', '10809'))
    expect(await system.resolve()).toBe('http://127.0.0.1:10809')
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('does not execute macOS utilities on other platforms or expose failed-probe diagnostics', async () => {
    const probe = vi.fn(async () => { throw new Error('raw report with secret') })
    for (const platform of ['linux', 'win32'] as const) {
      expect(await new MacSystemHttpsProxy({ platform, now: Date.now, report: probe }).resolve()).toBeUndefined()
    }
    expect(probe).not.toHaveBeenCalled()
    expect(await new MacSystemHttpsProxy({ platform: 'darwin', now: Date.now, report: probe }).resolve()).toBeUndefined()
  })
})

describe('Google-only Gmail network transport', () => {
  it('prefers the explicit app-global proxy without reading system settings', async () => {
    const resolve = vi.fn(async () => 'http://127.0.0.1:10808')
    const proxied = vi.fn<typeof fetch>(async () => response())
    const proxyFetch = vi.fn(() => proxied)
    const direct = vi.fn<typeof fetch>()
    const transport = createGmailGoogleFetch({ appProxy: async () => ' http://app-global.example:3128 ' },
      { systemProxy: { resolve }, proxyFetch, directFetch: direct })
    await transport(tokenUrl, { method: 'POST', body: 'synthetic', redirect: 'follow' })
    expect(resolve).not.toHaveBeenCalled()
    expect(proxyFetch).toHaveBeenCalledWith('http://app-global.example:3128')
    expect(proxied).toHaveBeenCalledWith(tokenUrl, expect.objectContaining({ redirect: 'error' }))
    expect(direct).not.toHaveBeenCalled()
  })

  it('uses system HTTPS settings only when the application has no explicit proxy', async () => {
    const resolve = vi.fn(async () => 'http://127.0.0.1:10808')
    const proxied = vi.fn<typeof fetch>(async () => response())
    const proxyFetch = vi.fn(() => proxied)
    const transport = createGmailGoogleFetch({ appProxy: async () => '' }, { systemProxy: { resolve }, proxyFetch })
    await transport(tokenUrl, { method: 'POST' })
    await transport('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1')
    expect(proxyFetch).toHaveBeenCalledWith('http://127.0.0.1:10808')
    expect(proxied).toHaveBeenCalledTimes(2)
  })

  it('uses direct transport when HTTPS proxy is absent, disabled or unsupported', async () => {
    const direct = vi.fn<typeof fetch>(async () => response())
    const proxyFetch = vi.fn(() => null)
    const transport = createGmailGoogleFetch({ appProxy: async () => undefined },
      { systemProxy: { resolve: async () => undefined }, proxyFetch, directFetch: direct })
    await transport('https://oauth2.googleapis.com/revoke', { method: 'POST' })
    expect(proxyFetch).toHaveBeenCalledWith('')
    expect(direct).toHaveBeenCalledOnce()
  })

  it('refuses model, local inference, non-HTTPS and unexpected Google endpoints before reading any proxy', async () => {
    const appProxy = vi.fn(async () => '')
    const resolve = vi.fn(async () => undefined)
    const proxyFetch = vi.fn()
    const direct = vi.fn()
    const transport = createGmailGoogleFetch({ appProxy }, { systemProxy: { resolve }, proxyFetch, directFetch: direct })
    for (const url of ['https://api.deepseek.com/chat/completions', 'http://127.0.0.1:11434/v1/chat/completions',
      'http://oauth2.googleapis.com/token', 'https://oauth2.googleapis.com/token?code=do-not-log',
      'https://oauth2.googleapis.com/token#code', 'https://user:password@gmail.googleapis.com/gmail/v1/users/me/profile',
      'https://gmail.googleapis.com/gmail/v1/users/another/profile', 'https://accounts.google.com/o/oauth2/v2/auth']) {
      await expect(transport(url)).rejects.toThrow('Unexpected Gmail transport destination')
    }
    expect(appProxy).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
    expect(proxyFetch).not.toHaveBeenCalled()
    expect(direct).not.toHaveBeenCalled()
  })

  it('rechecks the host consent fence after asynchronous system-proxy discovery', async () => {
    let release!: (value: string | undefined) => void
    const waiting = new Promise<string | undefined>((resolve) => { release = resolve })
    let allowed = true
    const resolve = vi.fn(async () => waiting)
    const direct = vi.fn<typeof fetch>(async () => response())
    const transport = createGmailGoogleFetch({ appProxy: async () => '' },
      { systemProxy: { resolve }, proxyFetch: () => null, directFetch: direct })
    const running = transport('https://gmail.googleapis.com/gmail/v1/users/me/profile',
      withGmailWireFence({}, () => { if (!allowed) throw new Error('consent revoked') }))
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledOnce())
    allowed = false
    release(undefined)
    await expect(running).rejects.toThrow('consent revoked')
    expect(direct).not.toHaveBeenCalled()
  })

  it('carries read and send service fences into the concrete Google client transport', async () => {
    for (const action of ['read', 'send'] as const) {
      let release!: () => void
      const waiting = new Promise<void>((resolve) => { release = resolve })
      let allowed = true
      const appProxy = vi.fn(async () => { await waiting; return '' })
      const direct = vi.fn<typeof fetch>(async () => response())
      const transport = createGmailGoogleFetch({ appProxy },
        { systemProxy: { resolve: async () => undefined }, proxyFetch: () => null, directFetch: direct })
      const client = new GoogleGmailClient(transport, 'synthetic-client', undefined, Date.now)
      const fence = () => { if (!allowed) throw new Error('host permission changed') }
      const running = action === 'read' ? client.message('synthetic-message', 'synthetic-token', false, fence)
        : client.send('synthetic-encoded-mail', 'synthetic-token', fence)
      await vi.waitFor(() => expect(appProxy).toHaveBeenCalledOnce())
      allowed = false
      release()
      await expect(running).rejects.toMatchObject({ code: action === 'read' ? 'google_unavailable' : 'send_unknown' })
      expect(direct).not.toHaveBeenCalled()
    }
  })

  it('carries authorization exchange, profile and refresh fences through deferred proxy lookup', async () => {
    for (const action of ['exchange', 'profile', 'refresh'] as const) {
      let release!: () => void
      const waiting = new Promise<void>((resolve) => { release = resolve })
      let allowed = true
      let attempts = 0
      const appProxy = vi.fn(async () => {
        attempts += 1
        if (action !== 'profile' || attempts === 2) await waiting
        return ''
      })
      const direct = vi.fn<typeof fetch>(async () => Response.json({ access_token: 'synthetic-access',
        expires_in: 3_600, scope: GMAIL_SCOPES.join(' ') }))
      const transport = createGmailGoogleFetch({ appProxy },
        { systemProxy: { resolve: async () => undefined }, proxyFetch: () => null, directFetch: direct })
      const client = new GoogleGmailClient(transport, 'synthetic-client', undefined, Date.now)
      const fence = () => { if (!allowed) throw new Error('connection changed') }
      const running = action === 'refresh' ? client.refresh({ accessToken: 'synthetic-old', refreshToken: 'synthetic-refresh',
        email: 'synthetic@example.com', expiresAt: 0, scopes: [...GMAIL_SCOPES] }, fence)
        : client.exchange('synthetic-code', 'synthetic-verifier', 'http://127.0.0.1:1/callback', fence)
      await vi.waitFor(() => expect(appProxy).toHaveBeenCalledTimes(action === 'profile' ? 2 : 1))
      allowed = false
      release()
      await expect(running).rejects.toBeInstanceOf(Error)
      expect(direct).toHaveBeenCalledTimes(action === 'profile' ? 1 : 0)
    }
  })

  it('snapshots mutable URL inputs before asynchronous proxy discovery', async () => {
    const url = new URL(tokenUrl)
    const direct = vi.fn<typeof fetch>(async () => response())
    const transport = createGmailGoogleFetch({ appProxy: async () => { url.hostname = 'attacker.example'; return '' } },
      { systemProxy: { resolve: async () => undefined }, proxyFetch: () => null, directFetch: direct })
    await transport(url, { method: 'POST' })
    expect(direct).toHaveBeenCalledWith(tokenUrl, expect.objectContaining({ method: 'POST', redirect: 'error' }))
  })
})

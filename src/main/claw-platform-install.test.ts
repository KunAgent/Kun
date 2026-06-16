import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_WEIXIN_BRIDGE_RPC_URL } from '../shared/app-settings'
import {
  configureManagedWeixinBridgeUrlResolver,
  pollFeishuInstall,
  pollWeixinInstall,
  startFeishuInstallQrcode,
  startWeixinInstallQrcode
} from './claw-platform-install'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain' }
  })
}

function requestHostname(input: RequestInfo | URL): string {
  try {
    return new URL(String(input)).hostname.toLowerCase()
  } catch {
    return ''
  }
}

describe('claw platform install', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    configureManagedWeixinBridgeUrlResolver(null)
  })

  it('always begins on Feishu and switches to Lark only when tenant_brand says so', async () => {
    const seenActions: Array<string | null> = []
    const beginHosts: string[] = []
    let beginCount = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const hostname = requestHostname(input)
      const body = new URLSearchParams(String(init?.body ?? ''))
      const action = body.get('action')
      seenActions.push(action)

      if (action === 'begin') {
        beginHosts.push(hostname)
        beginCount += 1
        // First start() stands in for a Feishu tenant, the second for Lark.
        const deviceCode = beginCount === 1 ? 'feishu-device' : 'lark-device'
        return jsonResponse({
          device_code: deviceCode,
          user_code: `CODE-${beginCount}`,
          verification_uri_complete: `https://open.feishu.cn/page/launcher?user_code=CODE-${beginCount}`,
          expires_in: 3600,
          interval: 5
        })
      }

      if (action === 'poll') {
        const deviceCode = body.get('device_code')
        if (deviceCode === 'feishu-device') {
          // Feishu tenant: credentials are issued directly by accounts.feishu.cn.
          return jsonResponse({
            client_id: 'cli_feishu',
            client_secret: 'secret',
            user_info: { tenant_brand: 'feishu' }
          })
        }
        if (deviceCode === 'lark-device') {
          if (hostname === 'accounts.feishu.cn') {
            // Lark tenant detected, but the secret lives on larksuite.com.
            return jsonResponse({ user_info: { tenant_brand: 'lark' } })
          }
          if (hostname === 'accounts.larksuite.com') {
            return jsonResponse({
              client_id: 'cli_lark',
              client_secret: 'secret',
              user_info: { tenant_brand: 'lark' }
            })
          }
        }
      }

      return jsonResponse({ message: 'unexpected request' }, 400)
    })
    vi.stubGlobal('fetch', fetchMock)

    const feishuStart = await startFeishuInstallQrcode(false)
    const larkStart = await startFeishuInstallQrcode(true)
    expect(feishuStart).toMatchObject({ ok: true })
    expect(larkStart).toMatchObject({ ok: true })

    // #316: the QR is always minted on Feishu — even for the Lark selection the
    // scannable link points at open.feishu.cn, never open.larksuite.com (the
    // latter is what the Lark app rejected as "Link expired").
    if (!larkStart.ok) throw new Error(larkStart.message)
    expect(larkStart.url).toContain('https://open.feishu.cn/')
    expect(larkStart.url).not.toContain('larksuite.com')
    expect(beginHosts).toEqual(['accounts.feishu.cn', 'accounts.feishu.cn'])
    // ...and the flow goes straight to `begin`, with no `action: 'init'` step.
    expect(seenActions).not.toContain('init')

    // Feishu tenant: secret comes straight from accounts.feishu.cn.
    await expect(pollFeishuInstall('feishu-device')).resolves.toEqual({
      done: true,
      kind: 'feishu',
      appId: 'cli_feishu',
      appSecret: 'secret',
      domain: 'feishu'
    })
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('accounts.feishu.cn')

    // Lark tenant: the Feishu poll reveals tenant_brand=lark, so a single
    // pollFeishuInstall call switches to accounts.larksuite.com for the secret.
    await expect(pollFeishuInstall('lark-device')).resolves.toEqual({
      done: true,
      kind: 'feishu',
      appId: 'cli_lark',
      appSecret: 'secret',
      domain: 'lark'
    })
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('accounts.larksuite.com')
  })

  it('uses the default WeChat bridge URL for WeChat QR login', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      expect(payload.method).toBe('web.login.start')
      return jsonResponse({
        ok: true,
        payload: {
          qrDataUrl: 'data:image/png;base64,qr',
          sessionKey: 'weixin-session'
        }
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await startWeixinInstallQrcode()

    expect(result).toMatchObject({
      ok: true,
      url: 'data:image/png;base64,qr'
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(DEFAULT_WEIXIN_BRIDGE_RPC_URL)
  })

  it('maps a missing WeChat bridge route to a product-level error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse('Not Found', 404)))

    const result = await startWeixinInstallQrcode()

    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining('WeChat login bridge is unavailable')
    })
  })

  it('uses the GUI-managed WeChat bridge resolver when configured', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => jsonResponse({
      ok: true,
      payload: {
        qrDataUrl: 'data:image/png;base64,managed-qr',
        sessionKey: 'managed-session'
      }
    }))
    vi.stubGlobal('fetch', fetchMock)
    configureManagedWeixinBridgeUrlResolver(async () => 'http://127.0.0.1:18790/api/v1/admin/rpc')

    const result = await startWeixinInstallQrcode()

    expect(result).toMatchObject({
      ok: true,
      url: 'data:image/png;base64,managed-qr'
    })
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://127.0.0.1:18790/api/v1/admin/rpc')
  })

  it('starts the WeChat channel after QR login completes', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? '{}')) as { method?: string; params?: Record<string, unknown> }
      if (payload.method === 'web.login.start') {
        return jsonResponse({
          ok: true,
          payload: {
            qrDataUrl: 'data:image/png;base64,qr',
            sessionKey: 'weixin-session'
          }
        })
      }
      if (payload.method === 'web.login.wait') {
        expect(payload.params).toMatchObject({ accountId: 'weixin-session' })
        return jsonResponse({
          ok: true,
          payload: {
            connected: true,
            accountId: 'weixin-account'
          }
        })
      }
      if (payload.method === 'channels.start') {
        expect(payload.params).toMatchObject({
          channel: 'openclaw-weixin',
          accountId: 'weixin-account'
        })
        return jsonResponse({
          ok: true,
          payload: {
            channel: 'openclaw-weixin',
            accountId: 'weixin-account',
            started: true
          }
        })
      }
      return jsonResponse({ ok: false, error: { message: `unexpected method ${payload.method}` } }, 400)
    })
    vi.stubGlobal('fetch', fetchMock)

    const start = await startWeixinInstallQrcode()
    expect(start).toMatchObject({ ok: true })
    if (!start.ok) throw new Error(start.message)

    await expect(pollWeixinInstall(start.deviceCode)).resolves.toMatchObject({
      done: true,
      kind: 'weixin',
      accountId: 'weixin-account'
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

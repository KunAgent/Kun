import { describe, expect, it } from 'vitest'
import { listenForAccountCode } from './callback'
import { request } from 'node:http'

describe('desktop OAuth loopback callback', () => {
  it('binds IPv4 loopback and rejects incorrect state and duplicates without consuming the pending request', async () => {
    const abort = new AbortController()
    const callback = await listenForAccountCode('expected-state', abort.signal, 0)
    const url = `http://127.0.0.1:${callback.port}/auth/callback`
    try {
      for (const query of ['state=wrong&code=x', 'state=expected-state&state=expected-state&code=x', 'state=expected-state&code=x&code=y']) {
        expect((await fetch(`${url}?${query}`)).status).toBe(400)
      }
      const response = await fetch(`${url}?state=expected-state&code=one-use`)
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('referrer-policy')).toBe('no-referrer')
      const body = await response.text()
      expect(body).toContain('history.replaceState')
      expect(body).not.toContain('one-use')
      expect(await callback.code).toBe('one-use')
      await expect(fetch(`${url}?state=expected-state&code=one-use`)).rejects.toThrow()
    } finally { callback.close() }
  })

  it('requires the correct host, method and path', async () => {
    const callback = await listenForAccountCode('s', new AbortController().signal, 0)
    const base = `http://127.0.0.1:${callback.port}`
    try {
      expect((await fetch(`${base}/auth/callback?state=s&code=x`, { method: 'POST' })).status).toBe(400)
      expect((await fetch(`${base}/wrong?state=s&code=x`)).status).toBe(400)
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const req = request(`${base}/auth/callback?state=s&code=x`, { headers: { Host: 'evil.example' } }, (response) => { response.resume(); resolve(response.statusCode) })
        req.on('error', reject); req.end()
      })
      expect(status).toBe(400)
    } finally { callback.close() }
    await expect(callback.code).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('handles denied authorization, expiry and cancellation', async () => {
    const denied = await listenForAccountCode('s', new AbortController().signal, 0)
    await fetch(`http://127.0.0.1:${denied.port}/auth/callback?state=s&error=access_denied&error_description=private`)
    await expect(denied.code).rejects.toMatchObject({ code: 'cancelled' })
    const expired = await listenForAccountCode('s', new AbortController().signal, 0, 10)
    await expect(expired.code).rejects.toMatchObject({ code: 'timeout' })
    const controller = new AbortController()
    const cancelled = await listenForAccountCode('s', controller.signal, 0)
    controller.abort()
    await expect(cancelled.code).rejects.toMatchObject({ code: 'cancelled' })
  })
})

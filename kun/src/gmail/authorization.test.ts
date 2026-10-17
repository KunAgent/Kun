import { createHash } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { gmailFixture, json, EMAIL, SCOPE } from '../test-support/gmail-fixture.js'
import { GMAIL_SCOPES } from './ports.js'
import { GmailLoopbackAuthorization } from './authorization.js'

describe('native Gmail authorization boundary', () => {
  it('does not start OAuth after an older card revokes sharing during a deferred storage probe', async () => {
    let releaseGate!: () => void
    const blocked = new Promise<void>((resolve) => { releaseGate = resolve })
    const gate = vi.fn(async () => blocked)
    const fixture = await gmailFixture(undefined, undefined, gate)
    try {
      await fixture.seed()
      const starting = fixture.service.startAuthorize({ scopeId: SCOPE, allowModelSharing: true })
      await vi.waitFor(() => expect(gate).toHaveBeenCalledTimes(1))
      await fixture.service.setModelSharing(SCOPE, false)
      releaseGate()
      await expect(starting).rejects.toMatchObject({ code: 'consent_changed' })
      expect(fixture.opened).toEqual([])
      expect(fixture.calls).toHaveLength(0)
      expect((await fixture.service.status(SCOPE)).allowModelSharing).toBe(false)
    } finally { releaseGate?.(); await fixture.cleanup() }
  })

  it('cancels a pending protection check during shutdown without opening the browser', async () => {
    const fixture = await gmailFixture()
    try {
      const starting = fixture.service.startAuthorize({ scopeId: SCOPE, allowModelSharing: true })
      const disposing = fixture.service.dispose()
      await expect(starting).rejects.toMatchObject({ code: 'cancelled' })
      await disposing
      expect(fixture.opened).toEqual([])
      expect(fixture.calls).toHaveLength(0)
      expect((await fixture.service.status(SCOPE)).connected).toBe(false)
    } finally { await fixture.cleanup() }
  })

  it('cancels an actual loopback bind before returning an authorization URL', async () => {
    const authorization = new GmailLoopbackAuthorization(SCOPE, 'fake-client', Date.now, vi.fn())
    const starting = authorization.start()
    await authorization.cancel()
    const result = await starting
    await authorization.dispose()
    expect(result.status).toBe('cancelled')
    expect(result.url).toBe('')
  })

  it('uses only Gmail scopes, S256 PKCE, one callback consumption and a clean completion page', async () => {
    const fixture = await gmailFixture()
    try {
      const authorization = await fixture.service.startAuthorize({ scopeId: SCOPE, allowModelSharing: true })
      const url = new URL(authorization.url)
      const callback = new URL(url.searchParams.get('redirect_uri')!)
      expect(callback.hostname).toBe('127.0.0.1')
      expect(Number(callback.port)).toBeGreaterThan(0)
      expect(url.searchParams.get('scope')?.split(' ')).toEqual([...GMAIL_SCOPES])
      expect(url.searchParams.get('code_challenge_method')).toBe('S256')
      expect(fixture.opened).toEqual([authorization.url])
      const invalid = new URL(callback)
      invalid.searchParams.set('state', 'wrong-state')
      invalid.searchParams.set('code', 'sensitive-code')
      expect((await fetch(invalid)).status).toBe(400)
      expect(fixture.calls).toHaveLength(0)
      const valid = new URL(callback)
      valid.searchParams.set('state', url.searchParams.get('state')!)
      valid.searchParams.set('code', 'sensitive-code')
      const received = await fetch(valid, { redirect: 'manual' })
      expect(received.status).toBe(303)
      expect(received.headers.get('location')).not.toContain('sensitive-code')
      expect(received.headers.get('referrer-policy')).toBe('no-referrer')
      const complete = await fetch(new URL(received.headers.get('location')!, callback))
      const page = await complete.text()
      expect(page).not.toContain('sensitive-code')
      expect(page).toContain('Gmail connected')
      expect(complete.headers.get('content-security-policy')).toContain("img-src data:")
      expect(complete.headers.get('content-security-policy')).not.toContain('script-src')
      await vi.waitFor(async () => expect((await fixture.service.pollAuthorization(authorization.id, SCOPE)).status).toBe('connected'))
      const tokenCall = fixture.calls.find(([request]) => String(request).includes('/token'))!
      const body = tokenCall[1]?.body as URLSearchParams
      expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(url.searchParams.get('code_challenge'))
      expect(body.get('redirect_uri')).toBe(callback.href)
      expect(body.get('code')).toBe('sensitive-code')
      expect((await fetch(valid, { redirect: 'manual' })).status).toBe(410)
      expect(fixture.calls.filter(([request]) => String(request).includes('/token'))).toHaveLength(1)
      const status = await fixture.service.status(SCOPE)
      expect(status).toMatchObject({ connected: true, email: EMAIL, allowModelSharing: true })
      expect(JSON.stringify(status)).not.toContain('fake-access')
      expect((await fixture.service.status('thread:other')).allowModelSharing).toBe(false)
    } finally { await fixture.cleanup() }
  })

  it('rejects callback path and Host confusion, duplicate state and cross-scope polling', async () => {
    const fixture = await gmailFixture()
    try {
      const authorization = await fixture.service.startAuthorize({ scopeId: SCOPE, allowModelSharing: false })
      const url = new URL(authorization.url)
      const callback = new URL(url.searchParams.get('redirect_uri')!)
      callback.searchParams.set('state', url.searchParams.get('state')!)
      callback.searchParams.set('code', 'code')
      const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
        const request = httpRequest(callback, { headers: { host: 'attacker.example' } }, (response) => {
          response.resume()
          resolve(response.statusCode)
        })
        request.on('error', reject)
        request.end()
      })
      expect(hostStatus).toBe(404)
      const wrongPath = new URL(callback)
      wrongPath.pathname += '/'
      expect((await fetch(wrongPath)).status).toBe(404)
      callback.searchParams.append('state', url.searchParams.get('state')!)
      expect((await fetch(callback)).status).toBe(400)
      await expect(fixture.service.pollAuthorization(authorization.id, 'thread:other')).rejects.toMatchObject({ code: 'authorization_not_found' })
      expect(fixture.calls).toHaveLength(0)
    } finally { await fixture.cleanup() }
  })

  it('handles denial and expiry without creating a connection', async () => {
    let now = Date.now()
    const fixture = await gmailFixture(undefined, () => now)
    try {
      const first = await fixture.service.startAuthorize({ scopeId: SCOPE, allowModelSharing: false })
      const url = new URL(first.url)
      const denied = new URL(url.searchParams.get('redirect_uri')!)
      denied.searchParams.set('state', url.searchParams.get('state')!)
      denied.searchParams.set('error', 'access_denied')
      expect((await fetch(denied, { redirect: 'manual' })).status).toBe(303)
      expect(await fixture.service.pollAuthorization(first.id)).toMatchObject({ status: 'cancelled', error: 'access_denied' })
      const second = await fixture.service.startAuthorize({ scopeId: SCOPE, allowModelSharing: false })
      now += 5 * 60_000
      expect((await fixture.service.pollAuthorization(second.id)).status).toBe('expired')
      expect((await fixture.service.status(SCOPE)).connected).toBe(false)
      expect(fixture.calls).toHaveLength(0)
    } finally { await fixture.cleanup() }
  })

  it('does not fetch a profile or save credentials after disconnect cancels an in-flight callback', async () => {
    let resolveToken!: (value: Response) => void
    const pending = new Promise<Response>((resolve) => { resolveToken = resolve })
    const request = vi.fn<typeof fetch>(async (url) => String(url).includes('/token') ? pending : json({ emailAddress: EMAIL }))
    const fixture = await gmailFixture(request)
    try {
      const authorization = await fixture.service.startAuthorize({ scopeId: SCOPE, allowModelSharing: true })
      const url = new URL(authorization.url)
      const callback = new URL(url.searchParams.get('redirect_uri')!)
      callback.searchParams.set('state', url.searchParams.get('state')!)
      callback.searchParams.set('code', 'code')
      await fetch(callback, { redirect: 'manual' })
      await fixture.service.disconnect({ revoke: false })
      resolveToken(json({ access_token: 'fake-access', expires_in: 3_600, scope: GMAIL_SCOPES.join(' ') }))
      await fixture.service.dispose()
      expect(request).toHaveBeenCalledOnce()
      expect((await fixture.service.status(SCOPE)).connected).toBe(false)
      expect((await fixture.service.pollAuthorization(authorization.id)).status).toBe('cancelled')
    } finally { resolveToken?.(json({})); await fixture.cleanup() }
  })

  it('does not re-enable sharing when an older card revokes it during OAuth', async () => {
    const fixture = await gmailFixture()
    try {
      await fixture.seed()
      const authorization = await fixture.service.startAuthorize({ scopeId: SCOPE, allowModelSharing: true })
      const url = new URL(authorization.url)
      const callback = new URL(url.searchParams.get('redirect_uri')!)
      callback.searchParams.set('state', url.searchParams.get('state')!)
      callback.searchParams.set('code', 'code')
      await fixture.service.setModelSharing(SCOPE, false)
      expect((await fixture.service.pollAuthorization(authorization.id)).status).toBe('cancelled')
      await expect(fetch(callback, { redirect: 'manual' })).rejects.toThrow()
      expect(fixture.calls).toHaveLength(0)
      expect((await fixture.service.status(SCOPE)).allowModelSharing).toBe(false)
    } finally { await fixture.cleanup() }
  })

  it('rechecks host data protection before exchanging a callback and before committing credentials', async () => {
    let protectedStorage = true
    const gate = vi.fn(async () => { if (!protectedStorage) throw new Error('unsafe local storage') })
    const fixture = await gmailFixture(undefined, undefined, gate)
    try {
      const authorization = await fixture.service.startAuthorize({ scopeId: SCOPE, allowModelSharing: true })
      const url = new URL(authorization.url)
      const callback = new URL(url.searchParams.get('redirect_uri')!)
      callback.searchParams.set('state', url.searchParams.get('state')!)
      callback.searchParams.set('code', 'code')
      protectedStorage = false
      await fetch(callback, { redirect: 'manual' })
      await vi.waitFor(async () => expect((await fixture.service.pollAuthorization(authorization.id)).status).toBe('failed'))
      expect(fixture.calls).toHaveLength(0)
      expect((await fixture.service.status(SCOPE)).connected).toBe(false)
    } finally { await fixture.cleanup() }
  })

  it('refuses to persist a completed exchange when local data protection changes during Google requests', async () => {
    let checks = 0
    const gate = vi.fn(async () => { if (++checks === 3) throw new Error('unsafe local storage') })
    const fixture = await gmailFixture(undefined, undefined, gate)
    try {
      const authorization = await fixture.service.startAuthorize({ scopeId: SCOPE, allowModelSharing: true })
      const url = new URL(authorization.url)
      const callback = new URL(url.searchParams.get('redirect_uri')!)
      callback.searchParams.set('state', url.searchParams.get('state')!)
      callback.searchParams.set('code', 'code')
      await fetch(callback, { redirect: 'manual' })
      await vi.waitFor(async () => expect((await fixture.service.pollAuthorization(authorization.id)).status).toBe('failed'))
      expect(fixture.calls).toHaveLength(2)
      expect((await fixture.store.read()).tokens).toBeUndefined()
      expect((await fixture.service.status(SCOPE)).allowModelSharing).toBe(false)
    } finally { await fixture.cleanup() }
  })
})

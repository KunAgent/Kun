import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { callback, fixture, SCOPE } from './github-app.test-support.js'

describe('GitHub App desktop authorization', () => {
  it('uses S256 and state, consumes the real loopback callback once and persists encrypted user tokens', async () => {
    const f = await fixture()
    try {
      expect(await f.service.status(SCOPE)).toMatchObject({ connected: false, allowModelSharing: false })
      expect(f.opened).toHaveLength(0)
      const flow = await f.service.authorize(SCOPE)
      const url = f.opened[0]
      expect(url.origin).toBe('https://github.com')
      expect(url.searchParams.get('scope')).toBe('offline_access')
      expect(url.searchParams.get('code_challenge_method')).toBe('S256')
      expect((await fetch(callback(url, 'forged'), { redirect: 'manual' })).status).toBe(400)
      expect(f.calls).toHaveLength(0)
      const duplicate = callback(url); duplicate.searchParams.append('state', 'duplicate')
      expect((await fetch(duplicate, { redirect: 'manual' })).status).toBe(400)
      const response = await fetch(callback(url), { redirect: 'manual' })
      expect(response.status).toBe(303)
      expect(response.headers.get('location')).not.toContain('synthetic-code')
      expect(response.headers.get('referrer-policy')).toBe('no-referrer')
      await vi.waitFor(async () => expect((await f.service.poll(flow.id, SCOPE)).status).toBe('connected'))
      expect((await fetch(callback(url), { redirect: 'manual' })).status).toBe(410)
      const exchange = new URLSearchParams(String(f.calls[0][1]?.body))
      expect(createHash('sha256').update(exchange.get('code_verifier')!).digest('base64url')).toBe(url.searchParams.get('code_challenge'))
      expect(await f.service.status(SCOPE, true)).toMatchObject({ connected: true, allowModelSharing: true, repositoryCount: 1 })
      expect((await f.service.status('thread:another')).allowModelSharing).toBe(false)
      const publicStatus = JSON.stringify(await f.service.status(SCOPE))
      expect(publicStatus).not.toContain('synthetic-user')
      const stored = await readFile(join(f.dataDir, 'mcp-oauth/native-github-app.json'), 'utf8')
      expect(stored).not.toContain('synthetic-user')
      expect(stored).not.toContain('fixture-user')
      expect(stored).not.toContain('synthetic-code')
    } finally { await f.cleanup() }
  })
  it('rejects another conversation polling or cancelling the authorization and handles denial', async () => {
    const f = await fixture()
    try {
      const flow = await f.service.authorize(SCOPE)
      await expect(f.service.cancel(flow.id, 'thread:other')).rejects.toMatchObject({ code: 'invalid_context' })
      const denied = callback(f.opened[0]); denied.searchParams.delete('code'); denied.searchParams.set('error', 'access_denied')
      await fetch(denied, { redirect: 'manual' })
      expect((await f.service.poll(flow.id, SCOPE)).status).toBe('cancelled')
      expect(f.calls).toHaveLength(0)
      expect((await f.service.status(SCOPE)).connected).toBe(false)
    } finally { await f.cleanup() }
  })
  it('does not persist tokens after cancellation races a token exchange', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const f = await fixture(async () => { await gate; return Response.json({ access_token: 'late-token' }) })
    try {
      const flow = await f.service.authorize(SCOPE)
      await fetch(callback(f.opened[0]), { redirect: 'manual' })
      await vi.waitFor(() => expect(f.calls).toHaveLength(1))
      await f.service.cancel(flow.id, SCOPE)
      release()
      await vi.waitFor(async () => expect((await f.service.poll(flow.id, SCOPE)).status).toBe('cancelled'))
      expect((await f.store.read()).tokens).toBeUndefined()
    } finally { release(); await f.cleanup() }
  })
})

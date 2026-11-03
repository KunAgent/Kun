import { describe, expect, it, vi } from 'vitest'
import { fixture, json, SCOPE, tokenResponse } from './github-app.test-support.js'

describe('GitHub App credentials and conversation grants', () => {
  it('requires a distinct conversation grant and fences in-flight reads when that grant is revoked', async () => {
    const f = await fixture()
    try {
      await f.seed()
      const forbidden = vi.fn()
      await expect(f.service.withAccess('thread:other', forbidden)).rejects.toMatchObject({ code: 'sharing_required' })
      expect(forbidden).not.toHaveBeenCalled()
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      const request = f.service.withAccess(SCOPE, async () => { await gate; return 'private content' })
      const observed = expect(request).rejects.toMatchObject({ code: 'consent_changed' })
      await f.service.sharing(SCOPE, false)
      release(); await observed
    } finally { await f.cleanup() }
  })
  it('refreshes once for parallel requests, preserves stable identity and rotates refresh tokens', async () => {
    const f = await fixture(async (url) => String(url).endsWith('/user')
      ? json({ id: 42, login: 'renamed-user' })
      : json({ ...tokenResponse, access_token: 'rotated-access', refresh_token: 'rotated-refresh' }))
    try {
      await f.seed(true)
      expect(await Promise.all([1, 2, 3].map(() => f.service.withAccess(SCOPE, async (token) => token))))
        .toEqual(['rotated-access', 'rotated-access', 'rotated-access'])
      expect(f.calls.filter(([url]) => String(url).includes('access_token'))).toHaveLength(1)
      expect((await f.store.read()).tokens).toMatchObject({ userId: 42, login: 'renamed-user', refreshToken: 'rotated-refresh' })
    } finally { await f.cleanup() }
  })
  it('does not resurrect credentials if disconnect races refresh', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const f = await fixture(async () => { await gate; return json(tokenResponse) })
    try {
      await f.seed(true)
      const access = f.service.withAccess(SCOPE, async () => 'should not run')
      const observed = expect(access).rejects.toMatchObject({ code: 'connection_changed' })
      await vi.waitFor(() => expect(f.calls).toHaveLength(1))
      await f.service.disconnect(); release(); await observed
      expect((await f.store.read()).tokens).toBeUndefined()
      expect((await f.store.read()).grants).toEqual([])
    } finally { release(); await f.cleanup() }
  })
  it('requires reconnection after refresh revocation and never falls back to environment or gh credentials', async () => {
    const f = await fixture(async () => json({ error: 'bad_refresh_token' }))
    try {
      await f.seed(true)
      await expect(f.service.withAccess(SCOPE, vi.fn())).rejects.toMatchObject({ code: 'reconnect_required' })
      expect(await f.service.status(SCOPE)).toMatchObject({ connected: false, reconnectRequired: true, allowModelSharing: false })
      expect(f.calls).toHaveLength(1)
    } finally { await f.cleanup() }
  })
})

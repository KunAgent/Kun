import { describe, expect, it, vi } from 'vitest'
import { callback, fixture, json, SCOPE, tokenResponse } from './github-app.test-support.js'

/** An account login is not a conversation consent: it must never invent a scope or a grant. */
describe('GitHub App account-only authorization', () => {
  it('stores account credentials without creating any conversation grant', async () => {
    const f = await fixture()
    try {
      const flow = await f.service.authorizeAccount()
      expect(flow).toMatchObject({ status: 'pending' })
      expect((await f.service.status()).pendingAccountAuthorization).toMatchObject({ id: flow.id, status: 'pending' })
      expect((await f.service.status()).pendingAuthorization).toBeUndefined()
      await fetch(callback(f.opened[0]), { redirect: 'manual' })
      await vi.waitFor(async () => expect((await f.service.pollAccount(flow.id)).status).toBe('connected'))
      expect((await f.store.read()).tokens).toMatchObject({ userId: 42, login: 'fixture-user' })
      expect((await f.store.read()).grants).toEqual([])
      expect(await f.service.status()).toMatchObject({ connected: true, allowModelSharing: false, login: 'fixture-user' })
      expect(await f.service.status(SCOPE)).toMatchObject({ connected: true, allowModelSharing: false })
      const forbidden = vi.fn()
      await expect(f.service.withAccess(SCOPE, forbidden)).rejects.toMatchObject({ code: 'sharing_required' })
      expect(forbidden).not.toHaveBeenCalled()
    } finally { await f.cleanup() }
  })
  it('rejects polling or cancelling a flow from another authorization context', async () => {
    const f = await fixture()
    try {
      const accountFlow = await f.service.authorizeAccount()
      await expect(f.service.poll(accountFlow.id, SCOPE)).rejects.toMatchObject({ code: 'invalid_context' })
      await expect(f.service.cancel(accountFlow.id, SCOPE)).rejects.toMatchObject({ code: 'invalid_context' })
      expect((await f.service.pollAccount(accountFlow.id)).status).toBe('pending')
      const scopeFlow = await f.service.authorize(SCOPE)
      await expect(f.service.pollAccount(scopeFlow.id)).rejects.toMatchObject({ code: 'invalid_context' })
      await expect(f.service.cancelAccount(scopeFlow.id)).rejects.toMatchObject({ code: 'invalid_context' })
      expect((await f.service.poll(scopeFlow.id, SCOPE)).status).toBe('pending')
      expect((await f.service.pollAccount(accountFlow.id)).status).toBe('cancelled')
      await fetch(callback(f.opened[1]), { redirect: 'manual' })
      await vi.waitFor(async () => expect((await f.service.poll(scopeFlow.id, SCOPE)).status).toBe('connected'))
      expect((await f.store.read()).grants).toEqual([{ scopeId: SCOPE, policy: 'configured-models-v1' }])
    } finally { await f.cleanup() }
  })
  it('clears conversation grants when a different GitHub account signs in', async () => {
    const f = await fixture(async (url) => String(url).endsWith('/user')
      ? json({ id: 99, login: 'other-user' })
      : json(tokenResponse))
    try {
      await f.seed()
      expect(await f.service.status(SCOPE)).toMatchObject({ connected: true, allowModelSharing: true })
      const flow = await f.service.authorizeAccount()
      await fetch(callback(f.opened[0]), { redirect: 'manual' })
      await vi.waitFor(async () => expect((await f.service.pollAccount(flow.id)).status).toBe('connected'))
      expect((await f.store.read()).tokens).toMatchObject({ userId: 99, login: 'other-user' })
      expect((await f.store.read()).grants).toEqual([])
      expect(await f.service.status(SCOPE)).toMatchObject({ connected: true, allowModelSharing: false })
      await expect(f.service.withAccess(SCOPE, vi.fn())).rejects.toMatchObject({ code: 'sharing_required' })
    } finally { await f.cleanup() }
  })
  it('keeps conversation grants when the same account signs in again', async () => {
    const f = await fixture()
    try {
      await f.seed()
      const flow = await f.service.authorizeAccount()
      await fetch(callback(f.opened[0]), { redirect: 'manual' })
      await vi.waitFor(async () => expect((await f.service.pollAccount(flow.id)).status).toBe('connected'))
      expect((await f.store.read()).grants).toEqual([{ scopeId: SCOPE, policy: 'configured-models-v1' }])
      expect(await f.service.status(SCOPE)).toMatchObject({ connected: true, allowModelSharing: true })
    } finally { await f.cleanup() }
  })
  it('does not persist credentials when cancellation races the account token exchange', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const f = await fixture(async () => { await gate; return json(tokenResponse) })
    try {
      const flow = await f.service.authorizeAccount()
      await fetch(callback(f.opened[0]), { redirect: 'manual' })
      await vi.waitFor(() => expect(f.calls).toHaveLength(1))
      await f.service.cancelAccount(flow.id)
      release()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect((await f.service.pollAccount(flow.id)).status).toBe('cancelled')
      expect((await f.store.read()).tokens).toBeUndefined()
      expect((await f.store.read()).grants).toEqual([])
    } finally { release(); await f.cleanup() }
  })
  it('fences an account flow superseded by a newer authorization', async () => {
    const f = await fixture()
    try {
      const first = await f.service.authorizeAccount()
      const second = await f.service.authorizeAccount()
      expect((await f.service.pollAccount(first.id)).status).toBe('cancelled')
      const late = await fetch(callback(f.opened[0]), { redirect: 'manual' }).catch(() => undefined)
      expect(late?.status).not.toBe(303)
      expect(f.calls).toHaveLength(0)
      await fetch(callback(f.opened[1]), { redirect: 'manual' })
      await vi.waitFor(async () => expect((await f.service.pollAccount(second.id)).status).toBe('connected'))
      expect((await f.store.read()).grants).toEqual([])
      expect(f.calls).toHaveLength(2)
    } finally { await f.cleanup() }
  })
})

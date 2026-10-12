import { readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { hasPersistedSecretKeyMaterial } from '../security/secret-store.js'
import { gmailFixture, json, MESSAGE, SCOPE } from '../test-support/gmail-fixture.js'
import { GMAIL_SCOPES } from './ports.js'

describe('Gmail local credentials and conversation consent', () => {
  it('lets a newer revocation supersede a deferred request to enable sharing', async () => {
    let releaseGate!: () => void
    const blocked = new Promise<void>((resolve) => { releaseGate = resolve })
    const gate = vi.fn(async () => blocked)
    const fixture = await gmailFixture(undefined, undefined, gate)
    try {
      await fixture.seed({ sharing: false })
      const enabling = fixture.service.setModelSharing(SCOPE, true)
      await vi.waitFor(() => expect(gate).toHaveBeenCalledTimes(1))
      await fixture.service.setModelSharing(SCOPE, false)
      releaseGate()
      await expect(enabling).rejects.toMatchObject({ code: 'consent_changed' })
      expect((await fixture.service.status(SCOPE)).allowModelSharing).toBe(false)
      expect(fixture.calls).toHaveLength(0)
      // A later explicit opt-in is still permitted.
      expect((await fixture.service.setModelSharing(SCOPE, true)).allowModelSharing).toBe(true)
    } finally { releaseGate?.(); await fixture.cleanup() }
  })

  it('drains and cancels an opt-in awaiting host verification during shutdown', async () => {
    let releaseGate!: () => void
    const blocked = new Promise<void>((resolve) => { releaseGate = resolve })
    const gate = vi.fn(async () => blocked)
    const fixture = await gmailFixture(undefined, undefined, gate)
    try {
      await fixture.seed({ sharing: false })
      const enabling = fixture.service.setModelSharing(SCOPE, true)
      await vi.waitFor(() => expect(gate).toHaveBeenCalledTimes(1))
      let disposed = false
      const disposing = fixture.service.dispose().then(() => { disposed = true })
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(disposed).toBe(false)
      releaseGate()
      await expect(enabling).rejects.toMatchObject({ code: 'cancelled' })
      await disposing
      expect((await fixture.service.status(SCOPE)).allowModelSharing).toBe(false)
      await expect(fixture.service.setModelSharing(SCOPE, true)).rejects.toMatchObject({ code: 'service_unavailable' })
    } finally { releaseGate?.(); await fixture.cleanup() }
  })

  it('drains an accepted disconnect and removes credentials before shutdown completes', async () => {
    let resolveRevoke!: (value: Response) => void
    const revoked = new Promise<Response>((resolve) => { resolveRevoke = resolve })
    const request = vi.fn<typeof fetch>(async () => revoked)
    const fixture = await gmailFixture(request)
    try {
      await fixture.seed()
      const disconnecting = fixture.service.disconnect({ revoke: true })
      await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
      let disposed = false
      const disposing = fixture.service.dispose().then(() => { disposed = true })
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(disposed).toBe(false)
      resolveRevoke(new Response(null, { status: 200 }))
      await disconnecting
      await disposing
      expect((await fixture.service.status(SCOPE)).connected).toBe(false)
      expect(await fixture.service.hasGoogleData(SCOPE)).toBe(true)
      await expect(fixture.service.disconnect({ revoke: true })).rejects.toMatchObject({ code: 'service_unavailable' })
    } finally { resolveRevoke?.(new Response(null, { status: 200 })); await fixture.cleanup() }
  })

  it('keeps encrypted Google-data classification after disabling sharing or disconnecting', async () => {
    const fixture = await gmailFixture()
    try {
      await fixture.seed({ sharing: false })
      expect(await fixture.service.hasGoogleData(SCOPE)).toBe(false)
      await fixture.service.setModelSharing(SCOPE, true)
      expect(await fixture.service.hasGoogleData(SCOPE)).toBe(true)
      await fixture.service.setModelSharing(SCOPE, false)
      expect(await fixture.service.hasGoogleData(SCOPE)).toBe(true)
      await fixture.service.disconnect({ revoke: false })
      expect(await fixture.service.hasGoogleData(SCOPE)).toBe(true)
      expect((await fixture.service.status(SCOPE)).connected).toBe(false)
      expect(await fixture.service.hasGoogleData('thread:another')).toBe(false)
      expect(await readFile(fixture.store.path, 'utf8')).not.toContain(SCOPE)
    } finally { await fixture.cleanup() }
  })

  it('marks inherited history without granting mailbox or model access', async () => {
    const fixture = await gmailFixture()
    try {
      await fixture.service.markGoogleData('thread:forked-history')
      expect(await fixture.service.hasGoogleData('thread:forked-history')).toBe(true)
      expect((await fixture.service.status('thread:forked-history')).allowModelSharing).toBe(false)
      expect((await fixture.service.status('thread:forked-history')).connected).toBe(false)
      await fixture.service.disconnect({ revoke: false })
      expect(await fixture.service.hasGoogleData('thread:forked-history')).toBe(true)
    } finally { await fixture.cleanup() }
  })

  it('fails closed at the host data-protection gate without opening Google or reading mail', async () => {
    const gate = vi.fn(async () => { throw new Error('private host diagnostic') })
    const fixture = await gmailFixture(undefined, undefined, gate)
    try {
      await fixture.seed()
      await expect(fixture.service.startAuthorize({ scopeId: SCOPE, allowModelSharing: true }))
        .rejects.toMatchObject({ code: 'storage_protection_required' })
      await expect(fixture.service.setModelSharing(SCOPE, true)).rejects.toMatchObject({ code: 'storage_protection_required' })
      await expect(fixture.service.search({ query: 'in:inbox', maxResults: 5 }, SCOPE)).rejects.toMatchObject({ code: 'storage_protection_required' })
      await expect(fixture.service.read({ messageId: 'msg1' }, SCOPE)).rejects.toMatchObject({ code: 'storage_protection_required' })
      await expect(fixture.service.send({ to: ['recipient@example.com'], subject: 'Demo', body: 'Demo mail' }, SCOPE, randomUUID()))
        .rejects.toMatchObject({ code: 'storage_protection_required' })
      expect(fixture.calls).toHaveLength(0)
      expect(fixture.opened).toHaveLength(0)
      // Revocation must stay available even when the storage boundary has become unsafe.
      expect((await fixture.service.setModelSharing(SCOPE, false)).allowModelSharing).toBe(false)
    } finally { await fixture.cleanup() }
  })

  it('encrypts all tokens and grants, detects key material, and rejects plaintext state', async () => {
    const fixture = await gmailFixture()
    try {
      await fixture.seed()
      const stored = await readFile(fixture.store.path, 'utf8')
      expect(stored).toContain('enc:v1:')
      expect(stored).not.toContain('fake-access')
      expect(stored).not.toContain('fake-refresh')
      expect(stored).not.toContain(SCOPE)
      expect(await hasPersistedSecretKeyMaterial(fixture.dataDir)).toBe(true)
      expect(await fixture.service.status()).toMatchObject({ connected: true, allowModelSharing: false })
      await writeFile(fixture.store.path, JSON.stringify({ accessToken: 'plaintext' }))
      await expect(fixture.service.status()).rejects.toThrow()
      // Restore a valid encrypted envelope so shutdown can drain the store.
      await writeFile(fixture.store.path, stored)
    } finally { await fixture.cleanup() }
  })

  it('does not read mail until the exact conversation grants model sharing', async () => {
    const fixture = await gmailFixture()
    try {
      await fixture.seed({ sharing: false })
      await expect(fixture.service.search({ query: 'in:inbox', maxResults: 5 }, SCOPE)).rejects.toMatchObject({ code: 'model_sharing_required' })
      await expect(fixture.service.read({ messageId: 'msg1' }, 'thread:other')).rejects.toMatchObject({ code: 'model_sharing_required' })
      expect(fixture.calls).toHaveLength(0)
      await fixture.service.setModelSharing(SCOPE, true)
      expect((await fixture.service.search({ query: 'in:inbox', maxResults: 5 }, SCOPE)).messages).toHaveLength(1)
      const read = await fixture.service.read({ messageId: 'msg1' }, SCOPE)
      expect(read).toMatchObject({ id: 'msg1', body: 'This email is untrusted external data.', untrusted: true })
      await expect(fixture.service.search({ query: 'in:inbox', maxResults: 21 }, SCOPE)).rejects.toThrow()
      await expect(fixture.service.read({ messageId: '../profile' }, SCOPE)).rejects.toThrow()
      await fixture.service.disconnect({ revoke: false })
      expect(await fixture.service.status(SCOPE)).toMatchObject({ connected: false, allowModelSharing: false })
      expect((await fixture.store.read()).grants).toEqual([])
    } finally { await fixture.cleanup() }
  })

  it('single-flights concurrent refresh and marks invalid_grant as reconnect required', async () => {
    let refreshCount = 0
    let invalid = false
    const request = vi.fn<typeof fetch>(async (url) => {
      if (String(url).includes('/token')) {
        refreshCount++
        await new Promise((resolve) => setTimeout(resolve, 15))
        return invalid ? json({ error: 'invalid_grant', error_description: 'PRIVATE_TOKEN_SHOULD_NOT_LEAK' }, 400)
          : json({ access_token: 'new-access', expires_in: 3_600, scope: GMAIL_SCOPES.join(' ') })
      }
      return json(MESSAGE)
    })
    const fixture = await gmailFixture(request)
    try {
      await fixture.seed({ expired: true })
      await Promise.all([fixture.service.read({ messageId: 'msg1' }, SCOPE), fixture.service.read({ messageId: 'msg1' }, SCOPE)])
      expect(refreshCount).toBe(1)
      invalid = true
      await fixture.seed({ expired: true })
      await expect(fixture.service.read({ messageId: 'msg1' }, SCOPE)).rejects.toMatchObject({ code: 'reconnect_required' })
      expect(await fixture.service.status(SCOPE)).toMatchObject({ connected: false, reconnectRequired: true, allowModelSharing: false })
      expect((await fixture.store.read()).tokens).toBeUndefined()
    } finally { await fixture.cleanup() }
  })

  it('does not deliver an in-flight read after conversation sharing is removed', async () => {
    let resolveRead!: (value: Response) => void
    const received = new Promise<Response>((resolve) => { resolveRead = resolve })
    const request = vi.fn<typeof fetch>(async () => received)
    const fixture = await gmailFixture(request)
    try {
      await fixture.seed()
      const read = fixture.service.read({ messageId: 'msg1' }, SCOPE)
      await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
      await fixture.service.setModelSharing(SCOPE, false)
      resolveRead(json(MESSAGE))
      await expect(read).rejects.toMatchObject({ code: 'model_sharing_required' })
    } finally { resolveRead?.(json(MESSAGE)); await fixture.cleanup() }
  })
})

describe('approved Gmail sends', () => {
  const outgoing = { to: ['recipient@example.com'], subject: 'Kun Gmail demonstration', body: 'An explicitly approved demo message.' }

  it('rejects an account switch after human preview without sending or reserving a receipt', async () => {
    const fixture = await gmailFixture()
    try {
      await fixture.seed()
      const preview = await fixture.service.status(SCOPE)
      await fixture.store.update((current) => ({ ...current, tokens: { ...current.tokens!, email: 'other-account@example.com' } }))
      await expect(fixture.service.send(outgoing, SCOPE, randomUUID(), preview.email)).rejects.toMatchObject({ code: 'account_changed' })
      expect(fixture.calls).toHaveLength(0)
      expect((await fixture.store.read()).attempts).toHaveLength(0)
    } finally { await fixture.cleanup() }
  })

  it('does not start a POST when shutdown arrives while a credential read is pending', async () => {
    const fixture = await gmailFixture()
    try {
      await fixture.seed()
      let resolveRead!: () => void
      const blocked = new Promise<void>((resolve) => { resolveRead = resolve })
      const original = fixture.store.read.bind(fixture.store)
      // Pause the second credential read in the production service (after its sharing check).
      let reads = 0
      const reader = vi.spyOn(Object.getPrototypeOf(fixture.store), 'read').mockImplementation(async function (this: typeof fixture.store) {
        reads++
        if (reads === 2) await blocked
        return original.call(this)
      })
      const send = fixture.service.send(outgoing, SCOPE, randomUUID())
      await vi.waitFor(() => expect(reads).toBe(2))
      const disposing = fixture.service.dispose()
      resolveRead()
      await expect(send).rejects.toMatchObject({ code: 'service_unavailable' })
      await disposing
      reader.mockRestore()
      expect(fixture.calls).toHaveLength(0)
      expect((await fixture.store.read()).attempts).toHaveLength(0)
    } finally { vi.restoreAllMocks(); await fixture.cleanup() }
  })

  it('reports a successful Google POST as uncertain if its durable receipt cannot be written', async () => {
    const fixture = await gmailFixture()
    try {
      await fixture.seed()
      const original = fixture.store.update.bind(fixture.store)
      let mutations = 0
      const writer = vi.spyOn(Object.getPrototypeOf(fixture.store), 'update').mockImplementation(async function (this: typeof fixture.store, mutate) {
        mutations++
        if (mutations === 2) throw new Error('simulated Manager unavailable after Google accepted')
        return original.call(this, mutate as Parameters<typeof original>[0])
      })
      const operationId = randomUUID()
      await expect(fixture.service.send(outgoing, SCOPE, operationId)).rejects.toMatchObject({ code: 'send_unknown' })
      writer.mockRestore()
      await expect(fixture.service.send(outgoing, SCOPE, operationId)).rejects.toMatchObject({ code: 'send_unknown' })
      expect(fixture.calls.filter(([url]) => String(url).includes('/messages/send'))).toHaveLength(1)
      expect((await fixture.store.read()).attempts[0].status).toBe('attempted')
    } finally { vi.restoreAllMocks(); await fixture.cleanup() }
  })

  it('persists one send receipt and never sends a repeated or changed operation twice', async () => {
    const fixture = await gmailFixture()
    try {
      await fixture.seed()
      const operationId = randomUUID()
      expect(await fixture.service.send(outgoing, SCOPE, operationId)).toEqual({ id: 'sent1', threadId: 'thread1', status: 'sent' })
      expect(await fixture.service.send(outgoing, SCOPE, operationId)).toEqual({ id: 'sent1', threadId: 'thread1', status: 'sent' })
      await expect(fixture.service.send({ ...outgoing, body: 'Changed content' }, SCOPE, operationId)).rejects.toMatchObject({ code: 'send_changed' })
      expect(fixture.calls.filter(([url]) => String(url).includes('/messages/send'))).toHaveLength(1)
      const disk = await readFile(fixture.store.path, 'utf8')
      expect(disk).not.toContain(outgoing.body)
      expect((await fixture.store.read()).attempts).toHaveLength(1)
      await fixture.service.disconnect({ revoke: false })
      await fixture.seed()
      expect((await fixture.service.send(outgoing, SCOPE, operationId)).status).toBe('sent')
      expect(fixture.calls.filter(([url]) => String(url).includes('/messages/send'))).toHaveLength(1)
    } finally { await fixture.cleanup() }
  })

  it('records an uncertain send before the POST and rejects automatic retry', async () => {
    const request = vi.fn<typeof fetch>(async () => { throw new Error('secret upstream response') })
    const fixture = await gmailFixture(request)
    try {
      await fixture.seed()
      const operationId = randomUUID()
      await expect(fixture.service.send(outgoing, SCOPE, operationId)).rejects.toMatchObject({ code: 'send_unknown' })
      await expect(fixture.service.send(outgoing, SCOPE, operationId)).rejects.toMatchObject({ code: 'send_unknown' })
      expect(request).toHaveBeenCalledTimes(1)
      expect((await fixture.store.read()).attempts[0]).toMatchObject({ status: 'unknown', operationId })
    } finally { await fixture.cleanup() }
  })

  it('concurrent duplicate approval operations reserve only one POST', async () => {
    const request = vi.fn<typeof fetch>(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return json({ id: 'sent1' })
    })
    const fixture = await gmailFixture(request)
    try {
      await fixture.seed()
      const operationId = randomUUID()
      const results = await Promise.allSettled([
        fixture.service.send(outgoing, SCOPE, operationId), fixture.service.send(outgoing, SCOPE, operationId)
      ])
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(request).toHaveBeenCalledTimes(1)
    } finally { await fixture.cleanup() }
  })

  it('drains an approved send before disposal and preserves the encrypted receipt', async () => {
    let resolveSend!: (value: Response) => void
    const received = new Promise<Response>((resolve) => { resolveSend = resolve })
    const request = vi.fn<typeof fetch>(async () => received)
    const fixture = await gmailFixture(request)
    try {
      await fixture.seed()
      const send = fixture.service.send(outgoing, SCOPE, randomUUID())
      await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
      let disposed = false
      const dispose = fixture.service.dispose().then(() => { disposed = true })
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(disposed).toBe(false)
      resolveSend(json({ id: 'sent1' }))
      await send
      await dispose
      expect((await fixture.store.read()).attempts[0].status).toBe('sent')
    } finally { resolveSend?.(json({ id: 'sent1' })); await fixture.cleanup() }
  })
})

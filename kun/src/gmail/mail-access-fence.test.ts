import { describe, expect, it, vi } from 'vitest'
import { gmailFixture, json, MESSAGE, SCOPE } from '../test-support/gmail-fixture.js'
import { GMAIL_SCOPES } from './ports.js'

describe('mail reads stop dispatching after consent changes', () => {
  it('does not fetch message metadata after revocation during search-list response', async () => {
    let release!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { release = resolve })
    const fetchImpl = vi.fn<typeof fetch>(async () => pending)
    const f = await gmailFixture(fetchImpl)
    try {
      await f.seed()
      const searching = f.service.search({ query: 'subject:synthetic-demo', maxResults: 10 }, SCOPE)
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce())
      await f.service.setModelSharing(SCOPE, false)
      release(json({ messages: [{ id: 'msg1' }] }))
      await expect(searching).rejects.toMatchObject({ code: 'consent_changed' })
      expect(fetchImpl).toHaveBeenCalledOnce()
    } finally { release?.(json({ messages: [] })); await f.cleanup() }
  })

  it('does not retry a rejected GET after revocation while token refresh is pending', async () => {
    let release!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { release = resolve })
    const fetchImpl = vi.fn<typeof fetch>(async (url) => String(url).includes('/token') ? pending : json({}, 401))
    const f = await gmailFixture(fetchImpl)
    try {
      await f.seed()
      const reading = f.service.read({ messageId: 'msg1' }, SCOPE)
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2))
      await f.service.setModelSharing(SCOPE, false)
      release(json({ access_token: 'synthetic-refreshed-token', expires_in: 3_600, scope: GMAIL_SCOPES.join(' ') }))
      await expect(reading).rejects.toMatchObject({ code: 'consent_changed' })
      expect(fetchImpl).toHaveBeenCalledTimes(2)
      expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/messages/'))).toHaveLength(1)
    } finally { release?.(json({ error: 'invalid_grant' }, 400)); await f.cleanup() }
  })

  it('checks each physical metadata GET within a parallel search batch', async () => {
    let f!: Awaited<ReturnType<typeof gmailFixture>>
    let revoked = false
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      if (String(url).includes('/messages?')) return json({ messages: [{ id: 'msg1' }, { id: 'msg2' }, { id: 'msg3' }] })
      if (!revoked) { revoked = true; void f.service.setModelSharing(SCOPE, false) }
      return json(MESSAGE)
    })
    f = await gmailFixture(fetchImpl)
    try {
      await f.seed()
      await expect(f.service.search({ query: 'subject:synthetic-demo', maxResults: 10 }, SCOPE)).rejects.toMatchObject({ code: 'consent_changed' })
      expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/messages/'))).toHaveLength(1)
    } finally { await f.cleanup() }
  })
})

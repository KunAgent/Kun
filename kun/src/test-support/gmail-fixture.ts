import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createAesEncryptor } from '../security/secret-store.js'
import { NativeGmailService } from '../gmail/service.js'
import { GMAIL_SCOPES } from '../gmail/ports.js'
import { EncryptedGmailStore } from '../gmail/store.js'

export const SCOPE = 'thread:test-conversation'
export const EMAIL = 'kun-demo@example.com'
export const MESSAGE = {
  id: 'msg1', threadId: 'thread1', snippet: 'Demo mail',
  payload: { mimeType: 'text/plain', headers: [
    { name: 'From', value: 'sender@example.com' }, { name: 'To', value: EMAIL },
    { name: 'Subject', value: 'Demo mail' }, { name: 'Date', value: 'Mon, 12 Oct 2026 12:00:00 +0800' }
  ], body: { data: Buffer.from('This email is untrusted external data.').toString('base64url') } }
}
export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}
export async function gmailFixture(fetchImpl?: typeof fetch, clock?: () => number, assertDataProtection?: () => Promise<void>) {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-gmail-test-'))
  const encryptor = createAesEncryptor(randomBytes(32))
  const calls: Parameters<typeof fetch>[] = []
  const opened: string[] = []
  const defaultFetch: typeof fetch = async (url) => {
    const path = String(url)
    if (path.includes('oauth2.googleapis.com/token')) return json({ access_token: 'fake-access', refresh_token: 'fake-refresh', expires_in: 3_600, scope: GMAIL_SCOPES.join(' ') })
    if (path.includes('/profile')) return json({ emailAddress: EMAIL })
    if (path.includes('/messages/send')) return json({ id: 'sent1', threadId: 'thread1' })
    if (path.includes('/messages/msg1')) return json(MESSAGE)
    if (path.includes('/messages?')) return json({ messages: [{ id: 'msg1' }] })
    if (path.includes('/revoke')) return new Response(null, { status: 200 })
    throw new Error('unexpected Google request')
  }
  const request: typeof fetch = async (...args) => {
    calls.push(args)
    return (fetchImpl ?? defaultFetch)(...args)
  }
  const openExternal = async (url: string) => { opened.push(url) }
  const store = new EncryptedGmailStore(dataDir, encryptor)
  const service = new NativeGmailService({ dataDir, encryptor, fetchImpl: request, openExternal, now: clock, assertDataProtection })
  const seed = async (options: { expired?: boolean; sharing?: boolean } = {}) => {
    await store.update((state) => ({ ...state, tokens: {
      accessToken: 'fake-access', refreshToken: 'fake-refresh', email: EMAIL,
      expiresAt: options.expired ? 0 : (clock?.() ?? Date.now()) + 3_600_000,
      scopes: [...GMAIL_SCOPES]
    }, grants: [{ scopeId: SCOPE, allowModelSharing: options.sharing ?? true, grantedAt: 1 }] }))
  }
  return { dataDir, encryptor, store, service, request, calls, opened, openExternal, seed,
    cleanup: async () => { await service.dispose(); await rm(dataDir, { recursive: true, force: true }) } }
}

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { GmailAuthorization } from '../contracts/gmail.js'
import { GMAIL_SCOPES, GmailError } from './ports.js'

const AUTHORIZATION_TIMEOUT = 5 * 60_000
const CALLBACK_PATH = '/oauth/gmail/callback'
const COMPLETE_TEXT = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Kun Gmail authorization</title><body><h1>Return to Kun</h1><p>Kun received the authorization response. You can close this tab and check the Gmail connection card.</p></body></html>'

/** Ephemeral, IP-bound callback receiver. The renderer polls a separate safe status. */
export class GmailLoopbackAuthorization {
  readonly id = randomUUID()
  readonly verifier = randomBytes(32).toString('base64url')
  private readonly state = randomBytes(32).toString('base64url')
  private readonly completePath = `/complete/${randomBytes(24).toString('base64url')}`
  readonly expiresAt: number
  private readonly server: Server
  private timeout?: NodeJS.Timeout
  private closeTimer?: NodeJS.Timeout
  private consumed = false
  private authorizationStatus: GmailAuthorization['status'] = 'pending'
  private authorizationError?: GmailAuthorization['error']
  private redirect = ''
  private authUrl = ''
  private exchange?: Promise<void>

  constructor(
    readonly scopeId: string,
    private readonly clientId: string,
    private readonly now: () => number,
    private readonly onCode: (code: string, verifier: string, redirectUri: string) => Promise<void>
  ) {
    this.expiresAt = now() + AUTHORIZATION_TIMEOUT
    this.server = createServer((request, response) => this.receive(request, response))
    this.server.maxConnections = 8
    this.server.requestTimeout = 5_000
    this.server.headersTimeout = 5_000
    this.server.on('clientError', (_error, socket) => socket.destroy())
  }

  async start(): Promise<GmailAuthorization> {
    await new Promise<void>((resolve, reject) => {
      const failed = () => reject(new GmailError('callback_unavailable', 'Kun could not open a local Google callback'))
      this.server.once('error', failed)
      this.server.listen(0, '127.0.0.1', () => {
        this.server.removeListener('error', failed)
        this.server.on('error', () => this.finish('failed', 'authorization_failed'))
        resolve()
      })
    })
    const address = this.server.address() as AddressInfo | null
    if (!address) {
      if (this.authorizationStatus === 'pending') this.finish('failed', 'authorization_failed')
      return this.status()
    }
    this.redirect = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`
    if (this.authorizationStatus !== 'pending' || this.now() >= this.expiresAt) {
      if (this.authorizationStatus === 'pending') this.finish('expired')
      await this.close()
      return this.status()
    }
    const params = new URLSearchParams({
      client_id: this.clientId, redirect_uri: this.redirect, response_type: 'code',
      scope: GMAIL_SCOPES.join(' '), access_type: 'offline', prompt: 'consent select_account',
      state: this.state, code_challenge: createHash('sha256').update(this.verifier).digest('base64url'),
      code_challenge_method: 'S256'
    })
    this.authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`
    this.timeout = setTimeout(() => { this.finish('expired'); void this.close() }, AUTHORIZATION_TIMEOUT)
    this.timeout.unref()
    return this.status()
  }

  status(): GmailAuthorization {
    if (this.authorizationStatus === 'pending' && this.now() >= this.expiresAt) {
      this.finish('expired')
      void this.close()
    }
    return {
      id: this.id, url: this.authUrl, status: this.authorizationStatus,
      expiresAt: new Date(this.expiresAt).toISOString(),
      ...(this.authorizationError ? { error: this.authorizationError } : {})
    }
  }

  failBrowser(): void { this.finish('failed', 'browser_unavailable'); void this.close() }
  async cancel(): Promise<void> { this.finish('cancelled'); await this.close() }
  async dispose(): Promise<void> { await this.cancel(); await this.exchange?.catch(() => undefined) }

  private receive(request: IncomingMessage, response: ServerResponse): void {
    secureHeaders(response)
    const expectedHost = new URL(this.redirect).host
    if (request.headers.host !== expectedHost || request.method !== 'GET' ||
      !request.url?.startsWith('/') || request.url.startsWith('//') || request.url.length > 8_192) {
      return end(response, 404)
    }
    let incoming: URL
    try { incoming = new URL(request.url, `http://${expectedHost}`) }
    catch { return end(response, 400) }
    if (incoming.pathname === this.completePath && !incoming.search && this.consumed) {
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(COMPLETE_TEXT)
      return
    }
    if (incoming.pathname !== CALLBACK_PATH) return end(response, 404)
    if (this.consumed || this.authorizationStatus !== 'pending') return end(response, 410)
    if (this.now() >= this.expiresAt) { this.finish('expired'); return end(response, 410) }
    const states = incoming.searchParams.getAll('state')
    const codes = incoming.searchParams.getAll('code')
    const errors = incoming.searchParams.getAll('error')
    if (states.length !== 1 || !constantTimeEqual(states[0], this.state) ||
      codes.length > 1 || errors.length > 1 || (codes.length && errors.length) ||
      (!codes.length && !errors.length) || (codes[0]?.length ?? 0) > 4_096) return end(response, 400)
    this.consumed = true
    if (this.timeout) clearTimeout(this.timeout)
    // Do not leave an authorization code in the final page URL or in a referer.
    response.writeHead(303, { location: this.completePath })
    response.end()
    this.closeTimer = setTimeout(() => { void this.close() }, 30_000)
    this.closeTimer.unref()
    if (errors.length) {
      this.finish(errors[0] === 'access_denied' ? 'cancelled' : 'failed',
        errors[0] === 'access_denied' ? 'access_denied' : 'authorization_failed')
      return
    }
    this.exchange = this.onCode(codes[0], this.verifier, this.redirect).then(() => {
      this.finish('connected')
    }, (error: unknown) => {
      this.finish('failed', error instanceof GmailError && error.code === 'scope_missing' ? 'scope_missing' : 'authorization_failed')
    })
  }

  private finish(status: GmailAuthorization['status'], error?: GmailAuthorization['error']): void {
    if (this.authorizationStatus !== 'pending') return
    this.authorizationStatus = status
    this.authorizationError = error
  }

  private async close(): Promise<void> {
    if (this.timeout) clearTimeout(this.timeout)
    if (this.closeTimer) clearTimeout(this.closeTimer)
    if (!this.server.listening) return
    await new Promise<void>((resolve) => { this.server.close(() => resolve()); this.server.closeAllConnections() })
  }
}

function secureHeaders(response: ServerResponse): void {
  response.setHeader('cache-control', 'no-store')
  response.setHeader('referrer-policy', 'no-referrer')
  response.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
  response.setHeader('x-content-type-options', 'nosniff')
  response.setHeader('x-frame-options', 'DENY')
}
function end(response: ServerResponse, status: number): void {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
  response.end(status === 404 ? 'Not found' : 'Authorization response was not accepted')
}
function constantTimeEqual(left: string, right: string): boolean {
  const a = createHash('sha256').update(left).digest()
  const b = createHash('sha256').update(right).digest()
  return timingSafeEqual(a, b)
}

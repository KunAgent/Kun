import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { GITHUB_CALLBACK, type GitHubAuthorization, type GitHubAuthorizationContext } from '../contracts/github-app.js'

/** One-use local callback; credentials never cross the renderer/HTTP status boundary. */
export class GitHubAuthorizationFlow {
  readonly id = randomUUID()
  readonly expiresAt: number
  private readonly verifier = randomBytes(32).toString('base64url')
  private readonly state = randomBytes(32).toString('base64url')
  private readonly completePath = `/complete/${randomBytes(24).toString('base64url')}`
  private statusValue: GitHubAuthorization['status'] = 'pending'
  private error?: string
  private consumed = false
  private redirect = GITHUB_CALLBACK
  private timer?: NodeJS.Timeout
  private completion?: Promise<void>
  private readonly server = createServer((req, res) => {
    res.setHeader('cache-control', 'no-store')
    res.setHeader('referrer-policy', 'no-referrer')
    res.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
    res.setHeader('x-content-type-options', 'nosniff')
    if (req.method !== 'GET' || req.headers.host !== new URL(this.redirect).host ||
        !req.url?.startsWith('/') || req.url.startsWith('//') || req.url.length > 8192) return end(res, 404)
    const url = new URL(req.url, this.redirect)
    if (url.pathname === this.completePath && !url.search && this.consumed) {
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.end('<!doctype html><html><meta charset="utf-8"><title>Kun · GitHub</title><h1>Return to Kun / 返回 Kun</h1><p>Kun is finishing your GitHub connection. Follow the connection card to select repositories or continue your task.</p></html>')
      return
    }
    if (url.pathname !== new URL(GITHUB_CALLBACK).pathname) return end(res, 404)
    if (this.consumed || this.status().status !== 'pending') return end(res, 410)
    const states = url.searchParams.getAll('state'), codes = url.searchParams.getAll('code'), errors = url.searchParams.getAll('error')
    if (states.length !== 1 || !same(states[0], this.state) || codes.length > 1 || errors.length > 1 ||
        Boolean(codes.length) === Boolean(errors.length) || (codes.length && (!codes[0] || codes[0].length > 4096))) return end(res, 400)
    this.consumed = true
    res.writeHead(303, { location: this.completePath }); res.end()
    if (errors.length) { this.finish(errors[0] === 'access_denied' ? 'cancelled' : 'failed'); return }
    this.completion = this.onCode(codes[0], this.verifier, this.redirect,
      () => { if (this.status().status !== 'pending') throw new Error('GitHub authorization is no longer current') })
      .then(() => this.finish('connected'), () => this.finish('failed', 'authorization_failed'))
  })

  constructor(readonly context: GitHubAuthorizationContext, private readonly clientId: string,
    private readonly onCode: (code: string, verifier: string, redirect: string, assertCurrent: () => void) => Promise<void>,
    private readonly now = Date.now, private readonly port = Number(new URL(GITHUB_CALLBACK).port)) {
    this.expiresAt = now() + 10 * 60_000
    this.server.maxConnections = 8
    this.server.requestTimeout = 5000
    this.server.headersTimeout = 5000
    this.server.on('clientError', (_error, socket) => socket.destroy())
  }
  async start(): Promise<string> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(this.port, '127.0.0.1', () => { this.server.removeListener('error', reject); resolve() })
    })
    this.server.on('error', () => this.finish('failed', 'callback_unavailable'))
    this.redirect = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/oauth/github/callback`
    if (this.statusValue !== 'pending') { await this.close(); throw new Error('GitHub authorization was cancelled') }
    this.timer = setTimeout(() => { this.finish('expired'); void this.close() }, 10 * 60_000)
    this.timer.unref()
    return 'https://github.com/login/oauth/authorize?' + new URLSearchParams({
      client_id: this.clientId, redirect_uri: this.redirect, state: this.state, scope: 'offline_access',
      code_challenge: createHash('sha256').update(this.verifier).digest('base64url'),
      code_challenge_method: 'S256', prompt: 'select_account'
    })
  }
  status(): GitHubAuthorization {
    if (this.statusValue === 'pending' && this.now() >= this.expiresAt) { this.finish('expired'); void this.close() }
    return { id: this.id, status: this.statusValue, expiresAt: new Date(this.expiresAt).toISOString(), ...(this.error ? { error: this.error } : {}) }
  }
  async cancel(): Promise<void> { this.finish('cancelled'); await this.close() }
  async failBrowser(): Promise<void> { this.finish('failed', 'browser_unavailable'); await this.close() }
  async dispose(): Promise<void> { await this.cancel(); await this.completion }
  private finish(status: GitHubAuthorization['status'], error?: string): void {
    if (this.statusValue !== 'pending') return
    this.statusValue = status; this.error = error
  }
  private async close(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    if (!this.server.listening) return
    await new Promise<void>((resolve) => { this.server.close(() => resolve()); this.server.closeAllConnections() })
  }
}
function same(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())
}
function end(response: ServerResponse, status: number): void { response.writeHead(status); response.end('Authorization response was not accepted') }

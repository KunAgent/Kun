import { createHash, randomBytes } from 'node:crypto'
import type { KunAccountState, KunAccountUser } from '../../shared/kun-account'
import type { AccountTokens, AccountTransport } from './transport'
import type { AccountStorage } from './storage'
import type { AccountCallback } from './callback'
import { AccountError, accountErrorCode } from './errors'
import { KUN_ACCOUNT_ISSUER, KUN_ACCOUNT_REDIRECT } from './config'

export type AccountDependencies = {
  clientId: string
  transport: AccountTransport
  storage: AccountStorage
  listen(state: string, signal: AbortSignal): Promise<AccountCallback>
  openBrowser(url: string): Promise<void>
  changed(state: KunAccountState): void
  focus(): void
  now?: () => number
}

export class KunAccountService {
  private state: KunAccountState = { status: 'loading', user: null, error: null }
  private tokens: AccountTokens | null = null
  private generation = 0
  private initialized?: Promise<KunAccountState>
  private syncing?: Promise<KunAccountState>
  private rotating?: Promise<AccountTokens>
  private signingOut?: Promise<KunAccountState>
  private persistence = Promise.resolve()
  private pending?: AbortController
  // The page for the pending request, so a closed browser tab can be reopened.
  private authorizationUrl?: string
  private timer?: ReturnType<typeof setTimeout>
  private disposed = false
  private readonly now: () => number

  constructor(private readonly deps: AccountDependencies) { this.now = deps.now || Date.now }
  snapshot(): KunAccountState { return this.state }
  private publish(status: KunAccountState['status'], user: KunAccountUser | null = this.state.user, error: KunAccountState['error'] = null): KunAccountState {
    this.state = Object.freeze({ status, user, error })
    if (!this.disposed) this.deps.changed(this.state)
    return this.state
  }
  private active(epoch: number): void { if (this.disposed || epoch !== this.generation) throw new AccountError('cancelled') }
  private serialize(operation: () => Promise<void>): Promise<void> {
    const result = this.persistence.catch(() => {}).then(operation)
    this.persistence = result.catch(() => {})
    return result
  }
  private async save(tokens: AccountTokens, epoch: number): Promise<void> {
    await this.serialize(async () => {
      this.active(epoch)
      await this.deps.storage.write(tokens)
      if (this.disposed || epoch !== this.generation) {
        if (this.tokens) await this.deps.storage.write(this.tokens)
        else await this.deps.storage.clear()
        throw new AccountError('cancelled')
      }
      this.tokens = tokens
    })
  }
  private schedule(delay?: number): void {
    clearTimeout(this.timer)
    if (!this.tokens || this.disposed || this.pending) return
    this.timer = setTimeout(() => { void this.sync(true) }, Math.min(2147483647, delay ?? Math.max(1000, this.tokens.expiresAt - this.now() - 60_000)))
    this.timer.unref()
  }
  private async failure(error: unknown, epoch: number): Promise<KunAccountState> {
    if (epoch !== this.generation || this.disposed) return this.state
    const code = accountErrorCode(error)
    if (code === 'expired') {
      this.generation++
      this.tokens = null
      clearTimeout(this.timer)
      await this.serialize(() => this.deps.storage.clear()).catch(() => {})
      return this.publish('anonymous', null, code)
    }
    if (code === 'network' || code === 'service') this.schedule(30_000)
    else clearTimeout(this.timer)
    return this.publish('error', this.state.user, code)
  }
  getState(): Promise<KunAccountState> {
    this.initialized ??= (async () => {
      const epoch = this.generation
      try {
        const tokens = await this.deps.storage.read()
        this.active(epoch)
        this.tokens = tokens
        return tokens ? this.sync(false) : this.publish('anonymous', null)
      } catch (error) { return this.failure(error, epoch) }
    })()
    return this.initialized.then(() => this.state)
  }
  private async validTokens(force: boolean, epoch: number): Promise<AccountTokens | null> {
    if (!this.tokens) return null
    if (!force && this.tokens.expiresAt > this.now() + 30_000) return this.tokens
    if (!this.rotating) {
      const current = this.tokens
      this.rotating = this.deps.transport.exchange({ grant_type: 'refresh_token', refresh_token: current.refreshToken }, current.refreshToken)
        .then(async (tokens) => {
          this.active(epoch)
          try { await this.save(tokens, epoch) }
          catch (error) {
            this.active(epoch)
            // Rotation has already consumed the old refresh token. Preserve the
            // replacement in main memory so an unlocked store can be retried.
            this.tokens = tokens
            throw error
          }
          return tokens
        })
        .finally(() => { this.rotating = undefined })
    }
    return this.rotating
  }
  private sync(force: boolean): Promise<KunAccountState> {
    if (this.syncing) return this.syncing
    if (this.pending || this.disposed) return Promise.resolve(this.state)
    const epoch = this.generation
    this.syncing = (async () => {
      const tokens = await this.validTokens(force, epoch)
      this.active(epoch)
      if (!tokens) return this.publish('anonymous', null)
      const user = await this.deps.transport.user(tokens.accessToken)
      this.active(epoch)
      this.schedule()
      return this.publish('authenticated', user)
    })().catch((error) => this.failure(error, epoch)).finally(() => { this.syncing = undefined })
    return this.syncing
  }
  async refresh(): Promise<KunAccountState> { await this.getState(); return this.sync(true) }
  /** A valid access token for Kunserve APIs, or null when signed out; `force` rotates it first. */
  async accessToken(force = false): Promise<string | null> {
    await this.getState()
    if (this.pending || !this.tokens || this.disposed) return null
    const epoch = this.generation
    try { return (await this.validTokens(force, epoch))?.accessToken ?? null }
    catch (error) { await this.failure(error, epoch); throw error }
  }
  /** An API refused even a freshly rotated token: the session ended elsewhere. */
  async expire(): Promise<void> {
    if (this.tokens) await this.failure(new AccountError('expired'), this.generation)
  }
  async login(): Promise<KunAccountState> {
    await this.getState()
    if (this.signingOut) await this.signingOut
    if (this.pending || this.disposed) return this.state
    const epoch = ++this.generation
    clearTimeout(this.timer)
    const controller = new AbortController()
    this.pending = controller
    this.authorizationUrl = undefined
    this.publish('authorizing', null)
    let callback: AccountCallback | undefined
    try {
      if (!this.deps.clientId) throw new AccountError('configuration')
      await this.deps.storage.assertAvailable()
      this.active(epoch)
      const verifier = randomBytes(32).toString('base64url')
      const state = randomBytes(32).toString('base64url')
      const challenge = createHash('sha256').update(verifier).digest('base64url')
      callback = await this.deps.listen(state, controller.signal)
      this.active(epoch)
      const url = new URL('/auth/start', KUN_ACCOUNT_ISSUER)
      url.search = new URLSearchParams({ client_id: this.deps.clientId, redirect_uri: KUN_ACCOUNT_REDIRECT,
        response_type: 'code', scope: 'openid email profile', state, code_challenge: challenge, code_challenge_method: 'S256' }).toString()
      this.authorizationUrl = url.href
      await this.deps.openBrowser(url.href)
      this.active(epoch)
      void this.completeLogin(callback, verifier, epoch, controller)
    } catch (error) {
      callback?.close()
      if (this.pending === controller) this.pending = undefined
      return this.failure(error, epoch)
    }
    return this.state
  }
  private async completeLogin(callback: AccountCallback, verifier: string, epoch: number, controller: AbortController): Promise<void> {
    let issued: AccountTokens | undefined
    let committed = false
    try {
      const code = await callback.code
      this.active(epoch)
      const tokens = await this.deps.transport.exchange({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: KUN_ACCOUNT_REDIRECT })
      issued = tokens
      this.active(epoch)
      const user = await this.deps.transport.user(tokens.accessToken)
      this.active(epoch)
      await this.save(tokens, epoch)
      committed = true
      this.pending = undefined
      this.publish('authenticated', user)
      this.schedule()
      try { this.deps.focus() } catch { /* Closing a window does not undo a completed sign-in. */ }
    } catch (error) {
      if (issued && !committed) await this.deps.transport.logout(issued.accessToken).catch(() => {})
      if (this.pending === controller) this.pending = undefined
      await this.failure(error, epoch)
    } finally { callback.close() }
  }
  /** Shows the pending sign-in page again. Same PKCE request, same listener. */
  async reopenLogin(): Promise<KunAccountState> {
    const url = this.authorizationUrl
    if (!this.pending || !url || this.disposed) return this.state
    // A browser that fails to open leaves the original page usable.
    await this.deps.openBrowser(url).catch(() => {})
    return this.state
  }
  async cancelLogin(): Promise<KunAccountState> {
    if (!this.pending) return this.state
    this.generation++
    this.pending.abort()
    this.pending = undefined
    if (this.tokens) return this.sync(false)
    return this.publish('anonymous', null)
  }
  logout(): Promise<KunAccountState> {
    this.signingOut ??= (async () => {
      await this.getState()
      await this.cancelLogin()
      if (this.syncing) await this.syncing
      const epoch = ++this.generation
      clearTimeout(this.timer)
      try {
        const tokens = await this.validTokens(false, epoch)
        if (tokens) await this.deps.transport.logout(tokens.accessToken)
        this.active(epoch)
        await this.serialize(() => this.deps.storage.clear())
        this.tokens = null
        return this.publish('anonymous', null)
      } catch (error) { return this.failure(error, epoch) }
    })().finally(() => { this.signingOut = undefined })
    return this.signingOut
  }
  dispose(): void {
    this.disposed = true
    this.generation++
    this.pending?.abort()
    this.pending = undefined
    clearTimeout(this.timer)
  }
}

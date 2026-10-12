import { createHash } from 'node:crypto'
import {
  GmailAuthorizeInputSchema, GmailReadInputSchema, GmailScopeIdSchema,
  GmailSearchInputSchema, GmailSendInputSchema,
  type GmailAuthorization, type GmailAuthorizeInput, type GmailConnectionStatus,
  type GmailMessage, type GmailReadInput, type GmailSearchInput,
  type GmailSearchResult, type GmailSendInput, type GmailSendResult
} from '../contracts/gmail.js'
import { GmailLoopbackAuthorization } from './authorization.js'
import { GoogleGmailClient } from './google-client.js'
import { encodeOutgoingMail, parseMessage, summarizeMessage } from './mail.js'
import {
  GmailError, KUN_GMAIL_CLIENT_ID,
  type GmailServicePort, type NativeGmailOptions
} from './ports.js'
import { EncryptedGmailStore, emptyCredentials, type GmailTokens } from './store.js'

/** One local Google account, explicit model-sharing grants for individual conversations. */
export class NativeGmailService implements GmailServicePort {
  private readonly store: EncryptedGmailStore
  private readonly client: GoogleGmailClient
  private readonly now: () => number
  private readonly clientId: string
  private readonly authorizations = new Map<string, GmailLoopbackAuthorization>()
  private refresh?: Promise<GmailTokens>
  private generation = 0
  private disposed = false
  private readonly inFlight = new Set<Promise<unknown>>()
  private readonly consentRevisions = new Map<string, number>()
  private readonly revokedScopes = new Set<string>()
  private nextConsentRevision = 0

  constructor(private readonly options: NativeGmailOptions) {
    this.now = options.now ?? Date.now
    this.clientId = options.clientId ?? KUN_GMAIL_CLIENT_ID
    this.store = new EncryptedGmailStore(options.dataDir, options.encryptor)
    this.client = new GoogleGmailClient(options.fetchImpl ?? fetch, this.clientId, options.clientSecret, this.now)
  }

  async initialize(): Promise<void> { await this.store.read() }

  async status(scopeId?: string): Promise<GmailConnectionStatus> {
    if (scopeId !== undefined) GmailScopeIdSchema.parse(scopeId)
    const state = await this.store.read()
    const connected = Boolean(state.tokens && !state.reconnectRequired)
    return {
      configured: Boolean(this.clientId), connected, reconnectRequired: state.reconnectRequired,
      ...(state.tokens?.email ? { email: state.tokens.email } : {}), scopes: state.tokens?.scopes ?? [],
      allowModelSharing: connected && Boolean(scopeId && !this.revokedScopes.has(scopeId) &&
        state.grants.find((grant) => grant.scopeId === scopeId)?.allowModelSharing)
    }
  }

  /** Classification outlives credentials because prior conversation history may contain mail. */
  async hasGoogleData(scopeId: string): Promise<boolean> {
    GmailScopeIdSchema.parse(scopeId)
    const state = await this.store.read()
    return state.sensitiveScopes.includes(scopeId) ||
      state.grants.some((grant) => grant.scopeId === scopeId && grant.allowModelSharing)
  }

  async markGoogleData(scopeId: string): Promise<void> {
    return this.track(async () => {
      GmailScopeIdSchema.parse(scopeId)
      if (this.disposed) throw new GmailError('service_unavailable', 'Gmail connection is unavailable')
      await this.store.update((current) => ({ ...current,
        sensitiveScopes: markSensitiveScope(current.sensitiveScopes, scopeId) }))
    })
  }

  async startAuthorize(value: GmailAuthorizeInput): Promise<GmailAuthorization> {
    return this.track(() => this.authorizeScope(value))
  }

  private async authorizeScope(value: GmailAuthorizeInput): Promise<GmailAuthorization> {
    if (this.disposed) throw new GmailError('service_unavailable', 'Gmail connection is unavailable')
    const generation = this.generation
    const input = GmailAuthorizeInputSchema.parse(value)
    const consentRevision = this.consentRevisions.get(input.scopeId) ?? 0
    await this.assertDataProtection()
    if (this.disposed || generation !== this.generation) throw new GmailError('cancelled', 'Gmail authorization was cancelled')
    this.assertConsentRevision(input.scopeId, consentRevision)
    for (const authorization of this.authorizations.values()) {
      if (authorization.status().status === 'pending') await authorization.cancel()
    }
    while (this.authorizations.size >= 16) {
      const oldest = this.authorizations.keys().next().value as string
      await this.authorizations.get(oldest)?.dispose()
      this.authorizations.delete(oldest)
    }
    if (this.disposed || generation !== this.generation) throw new GmailError('cancelled', 'Gmail authorization was cancelled')
    this.assertConsentRevision(input.scopeId, consentRevision)
    let authorization: GmailLoopbackAuthorization
    authorization = new GmailLoopbackAuthorization(input.scopeId, this.clientId, this.now,
      async (code, verifier, redirectUri) => {
        await this.assertDataProtection()
        const tokens = await this.client.exchange(code, verifier, redirectUri)
        await this.assertDataProtection()
        await this.store.update((current) => {
          if (generation !== this.generation || this.disposed || authorization.status().status !== 'pending') {
            throw new GmailError('authorization_cancelled', 'This Gmail authorization was cancelled')
          }
          this.assertConsentRevision(input.scopeId, consentRevision)
          const grants = current.tokens?.email === tokens.email ? current.grants : []
          const grant = { scopeId: input.scopeId, allowModelSharing: input.allowModelSharing, grantedAt: this.now() }
          return { ...current, tokens, reconnectRequired: false,
            sensitiveScopes: input.allowModelSharing ? markSensitiveScope(current.sensitiveScopes, input.scopeId) : current.sensitiveScopes,
            grants: [...grants.filter((entry) => entry.scopeId !== input.scopeId).slice(-255), grant] }
        })
        if (input.allowModelSharing && (this.consentRevisions.get(input.scopeId) ?? 0) === consentRevision) {
          this.revokedScopes.delete(input.scopeId)
        }
      })
    this.authorizations.set(authorization.id, authorization)
    const result = await authorization.start()
    // Browser launching is independent of the short HTTP request that starts authorization.
    void Promise.resolve().then(() => {
      if (!this.disposed && authorization.status().status === 'pending') return this.options.openExternal(result.url)
    })
      .catch(() => authorization.failBrowser())
    return authorization.status()
  }

  async pollAuthorization(id: string, scopeId?: string): Promise<GmailAuthorization> {
    return this.authorization(id, scopeId).status()
  }

  async cancelAuthorization(id: string, scopeId?: string): Promise<GmailAuthorization> {
    const authorization = this.authorization(id, scopeId)
    await authorization.cancel()
    return authorization.status()
  }

  async disconnect(input: { revoke: boolean }): Promise<void> {
    return this.track(() => this.disconnectAccount(input))
  }

  private async disconnectAccount(input: { revoke: boolean }): Promise<void> {
    if (this.disposed) throw new GmailError('service_unavailable', 'Gmail connection is unavailable')
    this.generation += 1
    for (const authorization of this.authorizations.values()) await authorization.cancel()
    const previous = await this.store.read()
    // Keep bounded send receipts when disconnecting so a retried approved operation cannot send twice.
    await this.store.update((current) => ({ ...emptyCredentials(), attempts: current.attempts,
      sensitiveScopes: [...new Set([...current.sensitiveScopes, ...current.grants.filter((grant) => grant.allowModelSharing).map((grant) => grant.scopeId)])] }))
    if (input.revoke && previous.tokens) await this.client.revoke(previous.tokens.refreshToken ?? previous.tokens.accessToken)
  }

  async setModelSharing(scopeId: string, allow: boolean): Promise<GmailConnectionStatus> {
    return this.track(() => this.changeModelSharing(scopeId, allow))
  }

  private async changeModelSharing(scopeId: string, allow: boolean): Promise<GmailConnectionStatus> {
    GmailScopeIdSchema.parse(scopeId)
    if (this.disposed) throw new GmailError('service_unavailable', 'Gmail connection is unavailable')
    const generation = this.generation
    const revision = ++this.nextConsentRevision
    this.consentRevisions.set(scopeId, revision)
    if (!allow) this.revokedScopes.add(scopeId)
    if (allow) await this.assertDataProtection()
    else for (const authorization of this.authorizations.values()) {
      if (authorization.scopeId === scopeId && authorization.status().status === 'pending') await authorization.cancel()
    }
    this.assertConsentRevision(scopeId, revision)
    if (allow && (this.disposed || generation !== this.generation)) throw new GmailError('cancelled', 'Gmail sharing was cancelled')
    await this.store.update((current) => {
      this.assertConsentRevision(scopeId, revision)
      if (allow && (this.disposed || generation !== this.generation)) throw new GmailError('cancelled', 'Gmail sharing was cancelled')
      if (!current.tokens || current.reconnectRequired) throw new GmailError('connection_required', 'Connect Gmail first')
      const grant = { scopeId, allowModelSharing: allow, grantedAt: this.now() }
      return { ...current, sensitiveScopes: allow ? markSensitiveScope(current.sensitiveScopes, scopeId) :
        current.grants.some((entry) => entry.scopeId === scopeId && entry.allowModelSharing)
          ? markSensitiveScope(current.sensitiveScopes, scopeId) : current.sensitiveScopes,
        grants: [...current.grants.filter((entry) => entry.scopeId !== scopeId).slice(-255), grant] }
    })
    if (allow && this.consentRevisions.get(scopeId) === revision) this.revokedScopes.delete(scopeId)
    return this.status(scopeId)
  }

  async search(value: GmailSearchInput, scopeId: string): Promise<GmailSearchResult> {
    return this.track(() => this.searchGranted(value, scopeId))
  }

  private async searchGranted(value: GmailSearchInput, scopeId: string): Promise<GmailSearchResult> {
    const input = GmailSearchInputSchema.parse(value)
    await this.requireSharing(scopeId)
    return this.readRequest(scopeId, async (token) => {
      const found = await this.client.list(input.query, input.maxResults, token)
      const messages = []
      for (let offset = 0; offset < found.messages.length; offset += 5) {
        messages.push(...await Promise.all(found.messages.slice(offset, offset + 5)
          .map(async (entry) => summarizeMessage(await this.client.message(entry.id, token, true)))))
      }
      return { messages, hasMore: found.hasMore, untrusted: true }
    })
  }

  async read(value: GmailReadInput, scopeId: string): Promise<GmailMessage> {
    return this.track(() => this.readGranted(value, scopeId))
  }

  private async readGranted(value: GmailReadInput, scopeId: string): Promise<GmailMessage> {
    const input = GmailReadInputSchema.parse(value)
    await this.requireSharing(scopeId)
    return this.readRequest(scopeId, async (token) => parseMessage(await this.client.message(input.messageId, token, false)))
  }

  /** Only a human-approved tool adapter may call this; never expose an HTTP send endpoint. */
  async send(value: GmailSendInput, scopeId: string, operationId: string, expectedSenderEmail?: string): Promise<GmailSendResult> {
    return this.track(() => this.sendApproved(value, scopeId, operationId, expectedSenderEmail))
  }

  private async sendApproved(value: GmailSendInput, scopeId: string, operationId: string, expectedSenderEmail?: string): Promise<GmailSendResult> {
    const generation = this.generation
    const consentRevision = this.consentRevisions.get(scopeId) ?? 0
    const input = GmailSendInputSchema.parse(value)
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu.test(operationId)) throw new GmailError('invalid_operation', 'A trusted send operation identifier is required')
    await this.requireSharing(scopeId)
    const tokens = await this.accessTokens()
    if (expectedSenderEmail !== undefined && tokens.email !== expectedSenderEmail) {
      throw new GmailError('account_changed', 'The connected Gmail account changed after this message was approved')
    }
    const outgoing = encodeOutgoingMail(input, { email: tokens.email, date: this.now(), operationId })
    const fingerprint = createHash('sha256').update(`${tokens.email}\n${scopeId}\n${outgoing.fingerprint}`).digest('hex')
    let replay: GmailSendResult | undefined
    await this.store.update((current) => {
      const previous = current.attempts.find((entry) => entry.operationId === operationId)
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new GmailError('send_changed', 'This approved send request cannot be changed')
        if (previous.status === 'sent' && previous.result) { replay = previous.result; return current }
        throw new GmailError(previous.status === 'failed' ? 'send_rejected' : 'send_unknown',
          previous.status === 'failed' ? 'This send request was rejected; create and approve a new request' : 'This request may already have been sent. Check Gmail Sent before creating a new request')
      }
      if (this.disposed || generation !== this.generation) {
        throw new GmailError('cancelled', 'Gmail sending was cancelled before contacting Google')
      }
      this.assertConsentRevision(scopeId, consentRevision)
      this.assertScopeNotRevoked(scopeId)
      if (expectedSenderEmail !== undefined && current.tokens?.email !== expectedSenderEmail) {
        throw new GmailError('account_changed', 'The connected Gmail account changed after this message was approved')
      }
      if (current.tokens?.email !== tokens.email || current.tokens.accessToken !== tokens.accessToken || !current.grants.find((grant) => grant.scopeId === scopeId)?.allowModelSharing) {
        throw new GmailError('connection_changed', 'Gmail connection changed before this send request')
      }
      return { ...current, attempts: [...current.attempts.slice(-63), {
        operationId, fingerprint, scopeId, status: 'attempted', attemptedAt: this.now()
      }] }
    })
    if (replay) return replay
    if (this.disposed || generation !== this.generation) {
      throw new GmailError('cancelled', 'Gmail sending was cancelled before contacting Google')
    }
    this.assertConsentRevision(scopeId, consentRevision)
    this.assertScopeNotRevoked(scopeId)
    let result: GmailSendResult
    try { result = await this.client.send(outgoing.raw, tokens.accessToken) }
    catch (error) {
      const status = error instanceof GmailError && error.code === 'send_rejected' ? 'failed' : 'unknown'
      try {
        await this.store.update((current) => ({ ...current, attempts: current.attempts.map((entry) => entry.operationId === operationId ? { ...entry, status } : entry) }))
      } catch {
        throw new GmailError('send_unknown', 'The send result could not be saved. Google may have sent this message; check Gmail Sent before creating a new request')
      }
      throw error
    }
    try {
      await this.store.update((current) => ({ ...current, attempts: current.attempts.map((entry) => entry.operationId === operationId ? { ...entry, status: 'sent', result } : entry) }))
    } catch {
      throw new GmailError('send_unknown', 'Google may have sent this message, but its receipt could not be saved. Check Gmail Sent before creating a new request')
    }
    return result
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.generation += 1
    await Promise.all([...this.authorizations.values()].map((authorization) => authorization.dispose()))
    await Promise.allSettled([...this.inFlight])
    await this.refresh?.catch(() => undefined)
    // An atomic no-op drains the credential-store mutation queue before Manager shutdown.
    await this.store.update((current) => current)
  }

  private authorization(id: string, scopeId?: string): GmailLoopbackAuthorization {
    if (scopeId !== undefined) GmailScopeIdSchema.parse(scopeId)
    const authorization = this.authorizations.get(id)
    if (!authorization || (scopeId !== undefined && authorization.scopeId !== scopeId)) {
      throw new GmailError('authorization_not_found', 'This Gmail authorization is unavailable')
    }
    return authorization
  }

  private async requireSharing(scopeId: string): Promise<void> {
    GmailScopeIdSchema.parse(scopeId)
    if (this.disposed) throw new GmailError('service_unavailable', 'Gmail connection is unavailable')
    this.assertScopeNotRevoked(scopeId)
    await this.assertDataProtection()
    if (this.disposed) throw new GmailError('service_unavailable', 'Gmail connection is unavailable')
    this.assertScopeNotRevoked(scopeId)
    const state = await this.store.read()
    this.assertScopeNotRevoked(scopeId)
    if (!state.tokens || state.reconnectRequired) throw new GmailError('connection_required', 'Connect Gmail before using email tools')
    if (!state.grants.find((grant) => grant.scopeId === scopeId)?.allowModelSharing) {
      throw new GmailError('model_sharing_required', 'Enable Gmail sharing for this conversation before using email tools')
    }
  }

  private async readRequest<T>(scopeId: string, read: (token: string) => Promise<T>): Promise<T> {
    const generation = this.generation
    const consentRevision = this.consentRevisions.get(scopeId) ?? 0
    const tokens = await this.accessTokens()
    if (this.disposed || generation !== this.generation) throw new GmailError('cancelled', 'Gmail reading was cancelled')
    this.assertConsentRevision(scopeId, consentRevision)
    this.assertScopeNotRevoked(scopeId)
    let result: T
    try { result = await read(tokens.accessToken) }
    catch (error) {
      if (!(error instanceof GmailError) || error.code !== 'access_expired') throw error
      result = await read((await this.accessTokens(tokens.accessToken)).accessToken)
    }
    await this.requireSharing(scopeId)
    const current = await this.store.read()
    this.assertConsentRevision(scopeId, consentRevision)
    if (generation !== this.generation || current.tokens?.email !== tokens.email) {
      throw new GmailError('connection_changed', 'Gmail connection changed while reading email')
    }
    return result
  }

  private track<T>(action: () => Promise<T>): Promise<T> {
    const promise = action()
    this.inFlight.add(promise)
    void promise.finally(() => this.inFlight.delete(promise)).catch(() => undefined)
    return promise
  }

  private async assertDataProtection(): Promise<void> {
    try { await this.options.assertDataProtection?.() }
    catch {
      throw new GmailError('storage_protection_required', 'Secure local credential storage is required before using Gmail')
    }
  }

  private async accessTokens(rejected?: string): Promise<GmailTokens> {
    if (this.disposed) throw new GmailError('service_unavailable', 'Gmail connection is unavailable')
    const current = await this.store.read()
    if (this.disposed) throw new GmailError('service_unavailable', 'Gmail connection is unavailable')
    if (!current.tokens || current.reconnectRequired) throw new GmailError('reconnect_required', 'Reconnect Gmail to continue')
    if (current.tokens.accessToken !== rejected && current.tokens.expiresAt > this.now() + 60_000) return current.tokens
    if (this.refresh) return this.refresh
    const generation = this.generation
    const previous = current.tokens
    this.refresh = (async () => {
      try {
        const tokens = await this.client.refresh(previous)
        await this.store.update((state) => {
          if (generation !== this.generation || state.tokens?.refreshToken !== previous.refreshToken || state.tokens?.email !== previous.email) {
            throw new GmailError('connection_changed', 'Gmail connection changed during refresh')
          }
          return { ...state, tokens, reconnectRequired: false }
        })
        return tokens
      } catch (error) {
        if (error instanceof GmailError && error.code === 'reconnect_required') {
          await this.store.update((state) => generation === this.generation && state.tokens?.refreshToken === previous.refreshToken
            ? { ...state, tokens: undefined, reconnectRequired: true, grants: [] } : state)
        }
        throw error
      } finally { this.refresh = undefined }
    })()
    return this.refresh
  }

  private assertConsentRevision(scopeId: string, revision: number): void {
    if ((this.consentRevisions.get(scopeId) ?? 0) !== revision) {
      throw new GmailError('consent_changed', 'Gmail sharing changed while this request was pending')
    }
  }

  private assertScopeNotRevoked(scopeId: string): void {
    if (this.revokedScopes.has(scopeId)) {
      throw new GmailError('model_sharing_required', 'Enable Gmail sharing for this conversation before using email tools')
    }
  }
}

export { GmailError } from './ports.js'
export type { GmailServicePort, NativeGmailOptions } from './ports.js'

function markSensitiveScope(scopes: string[], scopeId: string): string[] {
  if (scopes.includes(scopeId)) return scopes
  if (scopes.length >= 4_096) throw new GmailError('data_scope_limit', 'The local Gmail conversation limit was reached')
  return [...scopes, scopeId]
}

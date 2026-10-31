import { AsyncLocalStorage } from 'node:async_hooks'
import type {
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens
} from '@modelcontextprotocol/client'
import { AtomicJsonFile } from '../../extensions/atomic-json.js'
import { withManagerDataMutex, type ManagerDataMutexOperationContext } from '../../manager/data-mutex.js'
import { currentManagerDataMutexContext } from '../../manager/data-mutex-context.js'
import type { SecretEncryptor } from '../../security/secret-store.js'
import { isEncryptedEnvelope } from '../../security/secret-store.js'
import type { McpOAuthLifetime } from './mcp-oauth-lifetime.js'
import { withFileMutationQueue, fileMutationLockRoot, physicalFilePath } from './file-mutation-queue.js'

/**
 * Persisted OAuth credential material for a single remote MCP server.
 *
 * Tokens, client registration, the in-flight code verifier, and discovery
 * metadata are stored on disk (mode 0600) so an authorized server keeps
 * working across runtime restarts without re-prompting the user. The store
 * also records lifecycle metadata used by diagnostics:
 *
 * - `tokensObtainedAt` lets diagnostics compute access-token expiry.
 * - `lastError` / `lastErrorAt` surface the most recent failed authorization
 *   attempt (e.g. a loopback callback error) so the GUI can explain why a
 *   server is not authorized instead of showing a bare "error".
 */
export type McpOAuthState = {
  clientInformation?: StoredOAuthClientInformation
  tokens?: StoredOAuthTokens
  codeVerifier?: string
  discoveryState?: OAuthDiscoveryState
  /** Epoch milliseconds when the current tokens were saved. */
  tokensObtainedAt?: number
  /** Monotonic counter bumped on every persisted token set. */
  refreshEpoch?: number
  /**
   * Monotonic counter bumped on every credential-affecting write (tokens,
   * verifier, revocation). A refresh compares it against the value it read
   * when the SDK obtained its token to tell that a peer already moved the
   * grant, which works across processes and for servers that never rotate the
   * refresh token.
   */
  mutationEpoch?: number
  /**
   * Monotonic counter bumped whenever credential material is removed. An
   * in-flight refresh that started under an older epoch must never write its
   * result back, otherwise a late response would resurrect cleared tokens.
   */
  clearEpoch?: number
  /**
   * Grant that produced the stored tokens. `grantKey` pins issuer, client,
   * token endpoint, scope and RFC 8707 resource, so a refresh for a different
   * grant is never answered with these tokens.
   */
  lastRefresh?: {
    grantKey: string
    spentRefreshToken: string
    accessToken: string
    at: string
  }
  /** Sanitized message from the most recent failed authorization attempt. */
  lastError?: string
  /** ISO timestamp of the most recent failed authorization attempt. */
  lastErrorAt?: string
}

/** Result of a refresh-aware token write. */
export type McpOAuthRefreshWriteResult = 'saved' | 'superseded' | 'cleared'

/**
 * Shared-data resource for one credential file.
 *
 * Every mutation of this file runs inside {@link withManagerDataMutex} on this
 * resource: with a Manager that is a cross-process lease whose fencing token is
 * attached to the write itself, otherwise a process-local queue. The refresh
 * transaction holds it across the token endpoint round trip, which is what
 * makes "read, refresh, persist" one critical section for every connection and
 * every runtime process.
 */
export function mcpOAuthCredentialResource(storePath: string): string {
  return `mcp-oauth:${physicalFilePath(storePath)}`
}

/** Internal signal: the write was rejected by a guard, nothing was persisted. */
class McpOAuthWriteRejected extends Error {
  constructor(readonly result: Exclude<McpOAuthRefreshWriteResult, 'saved'>) {
    super(`MCP OAuth token write rejected: ${result}`)
  }
}

/** Marks the credential section a nested call is already inside. */
const CREDENTIAL_SECTION = new AsyncLocalStorage<string>()

/**
 * In-flight refresh cancellation, keyed by resolved credential path.
 *
 * Revocation must not queue behind a refresh that is waiting on the
 * authorization server: the credentials are being removed, so the request is
 * pointless. A revocation aborts the current controller and drops it, so the
 * next refresh starts with a fresh signal.
 */
const REFRESH_CANCELLATIONS = new Map<string, AbortController>()

function localSectionContext(storePath: string): ManagerDataMutexOperationContext {
  return {
    resource: mcpOAuthCredentialResource(storePath),
    signal: new AbortController().signal,
    assertCurrent: async () => undefined,
    withCommit: async (commit) => commit()
  }
}

type EncryptedMcpOAuthState = { __enc: string }

/**
 * Atomic, single-file JSON persistence for one server's OAuth state.
 *
 * Writes go through a temp file + rename so a crash mid-write cannot leave a
 * partially serialized credential file behind. The directory and file are
 * created with restrictive permissions because they hold bearer tokens.
 */
export class FileMcpOAuthStore {
  private readonly file: AtomicJsonFile<McpOAuthState | EncryptedMcpOAuthState>
  /**
   * Physical identity of the credential file: symlink-resolved when it exists,
   * otherwise its real directory plus the file name. The on-disk lock, the
   * Manager resource, the grant key and the revocation signal all use this, so
   * two connections that reach the same credentials through different paths
   * still coordinate as one.
   */
  readonly physicalPath: string

  constructor(
    private readonly storagePath: string,
    /** Optional encryptor; when present, bearer tokens are encrypted at rest. */
    private readonly encryptor?: SecretEncryptor,
    private readonly lifetime?: McpOAuthLifetime
  ) {
    this.file = new AtomicJsonFile(storagePath, validateStoredState)
    this.physicalPath = physicalFilePath(storagePath)
  }

  get path(): string {
    return this.storagePath
  }

  async read(): Promise<McpOAuthState> {
    return this.decodeStoredState(await this.file.read(() => ({})))
  }

  async update(update: (state: McpOAuthState) => McpOAuthState): Promise<void> {
    await this.locked(() => this.mutate(update))
  }

  async clear(): Promise<void> {
    // Revocation is not allowed to wait behind a network round trip that its
    // result will be discarded anyway; abort it first so both sides finish.
    this.cancelInFlightRefresh()
    // Keep the epochs (and nothing else) so a refresh that is still in flight
    // cannot write its result back after the user revoked access.
    await this.locked(() => this.mutate((state) => ({
      clearEpoch: (state.clearEpoch ?? 0) + 1,
      mutationEpoch: (state.mutationEpoch ?? 0) + 1
    })))
  }

  /**
   * Abort the refresh currently running for this credential file, if any.
   *
   * Called before a revocation takes the credential section, so a refresh that
   * is blocked on the authorization server cannot hold the section until its
   * request timeout: the socket is aborted, the transaction unwinds, and the
   * revocation proceeds. Across processes this is a no-op (the remote refresh
   * cannot be signalled); there the revocation waits for the section, bounded
   * by the refresh request timeout, and the epoch guards still prevent the
   * remote result from being persisted.
   */
  cancelInFlightRefresh(): void {
    const key = this.physicalPath
    const controller = REFRESH_CANCELLATIONS.get(key)
    if (!controller) return
    REFRESH_CANCELLATIONS.delete(key)
    controller.abort(new Error(`MCP OAuth credentials were revoked for ${key}`))
  }

  /** Signal that aborts when a revocation starts; a new one after each revocation. */
  revocationSignal(): AbortSignal {
    const key = this.physicalPath
    const existing = REFRESH_CANCELLATIONS.get(key)
    if (existing && !existing.signal.aborted) return existing.signal
    const controller = new AbortController()
    REFRESH_CANCELLATIONS.set(key, controller)
    return controller.signal
  }

  /**
   * Persist the result of an OAuth refresh transaction.
   *
   * The caller holds the credential mutex, so this runs while no other writer
   * for this file can commit. The guards still matter: they reject a result
   * that arrives after the credentials were cleared, and one that was overtaken
   * by a different token set.
   *
   * This write deliberately ignores the connection lifetime: a refresh request
   * that already reached the authorization server may have rotated the grant,
   * so discarding its result would leave a dead refresh token on disk. The
   * transaction itself is tracked by the caller so shutdown can wait for it.
   */
  async applyRefreshedTokens(input: {
    tokens: StoredOAuthTokens
    spentRefreshToken: string
    observedClearEpoch: number
    observedMutationEpoch: number
    obtainedAt: number
    issuer: string | undefined
    grantKey: string
  }): Promise<McpOAuthRefreshWriteResult> {
    try {
      await this.locked(() => this.mutate((state) => {
        if ((state.clearEpoch ?? 0) !== input.observedClearEpoch) {
          throw new McpOAuthWriteRejected('cleared')
        }
        if ((state.mutationEpoch ?? 0) !== input.observedMutationEpoch) {
          throw new McpOAuthWriteRejected('superseded')
        }
        if (state.tokens?.access_token && state.tokens.refresh_token !== input.spentRefreshToken) {
          throw new McpOAuthWriteRejected('superseded')
        }
        const tokens = input.issuer && !input.tokens.issuer
          ? { ...input.tokens, issuer: input.issuer }
          : input.tokens
        return {
          ...state,
          tokens,
          tokensObtainedAt: input.obtainedAt,
          refreshEpoch: (state.refreshEpoch ?? 0) + 1,
          mutationEpoch: (state.mutationEpoch ?? 0) + 1,
          lastRefresh: {
            grantKey: input.grantKey,
            spentRefreshToken: input.spentRefreshToken,
            accessToken: tokens.access_token,
            at: new Date(input.obtainedAt).toISOString()
          },
          ...withoutAuthorizationError(state)
        }
      }, { connectionLifetime: false }))
      return 'saved'
    } catch (error) {
      if (error instanceof McpOAuthWriteRejected) return error.result
      throw error
    }
  }

  /**
   * Persist tokens handed back by the SDK provider contract (authorization
   * code exchange, issuer stamping, legacy back-fill).
   *
   * Refresh results are persisted by {@link applyRefreshedTokens} and merely
   * acknowledged by the provider, so this always records a fresh
   * `tokensObtainedAt`: a genuinely new token set may contain the same access
   * token string, and its lifetime must still start now.
   */
  async saveTokens(input: {
    tokens: StoredOAuthTokens
    obtainedAt: number
    observedClearEpoch?: number
  }): Promise<McpOAuthRefreshWriteResult> {
    try {
      await this.locked(() => this.mutate((state) => {
        if (input.observedClearEpoch !== undefined && (state.clearEpoch ?? 0) !== input.observedClearEpoch) {
          throw new McpOAuthWriteRejected('cleared')
        }
        return {
          ...state,
          tokens: input.tokens,
          tokensObtainedAt: input.obtainedAt,
          refreshEpoch: (state.refreshEpoch ?? 0) + 1,
          mutationEpoch: (state.mutationEpoch ?? 0) + 1,
          ...withoutAuthorizationError(state)
        }
      }))
      return 'saved'
    } catch (error) {
      if (error instanceof McpOAuthWriteRejected) return error.result
      throw error
    }
  }

  /**
   * Run one credential critical section.
   *
   * Two existing coordination facilities are composed, in a fixed order so no
   * caller can deadlock against another:
   *
   * - {@link withFileMutationQueue} serializes every process on this host that
   *   mutates this credential file, with an owner record and dead-pid reclaim;
   * - {@link withManagerDataMutex} adds the Manager resource lease and fencing
   *   token for runtimes that share the data directory through a Manager (the
   *   fenced token travels with the `AtomicJsonFile` write itself).
   *
   * Nested callers (a store write issued inside a refresh transaction) reuse
   * the section they are already in instead of re-entering it.
   */
  async runExclusive<T>(
    operation: (context: ManagerDataMutexOperationContext) => Promise<T>
  ): Promise<T> {
    const sectionPath = this.physicalPath
    if (CREDENTIAL_SECTION.getStore() === sectionPath) {
      return await operation(currentManagerDataMutexContext() ?? localSectionContext(sectionPath))
    }
    return await withFileMutationQueue(sectionPath, () => withManagerDataMutex(
      mcpOAuthCredentialResource(sectionPath),
      (context) => CREDENTIAL_SECTION.run(sectionPath, () => operation(context))
    ), { lockRoot: fileMutationLockRoot(sectionPath) })
  }

  /** Run a mutation under the credential section (re-entrant for nested callers). */
  private locked<T>(operation: () => Promise<T>): Promise<T> {
    return this.runExclusive(() => operation())
  }

  private async mutate(
    change: (state: McpOAuthState) => McpOAuthState,
    options: { connectionLifetime?: boolean } = {}
  ): Promise<void> {
    const useLifetime = options.connectionLifetime !== false && this.lifetime !== undefined
    const write = () => this.file.update(
      () => ({}),
      (stored) => this.encryptState(change(this.decodeStoredState(stored))),
      useLifetime ? { signal: this.lifetime?.signal } : {}
    ).then(() => undefined)
    await (useLifetime ? this.lifetime!.track(write) : write())
  }

  /** Encrypt all persisted OAuth state, including client secrets and PKCE data. */
  private encryptState(state: McpOAuthState): McpOAuthState | EncryptedMcpOAuthState {
    if (!this.encryptor) return state
    return { __enc: this.encryptor.encrypt(JSON.stringify(state)) }
  }

  private decryptEnvelope(envelope: EncryptedMcpOAuthState): McpOAuthState {
    if (!this.encryptor) throw new Error('MCP OAuth credential store is encrypted but no decryptor is available')
    try {
      const parsed = JSON.parse(this.encryptor.decrypt(envelope.__enc)) as unknown
      if (!isMcpOAuthState(parsed)) throw new Error('decrypted OAuth state is invalid')
      return parsed
    } catch (error) {
      throw new Error('MCP OAuth credential store could not be decrypted; restore the original key or re-authorize the connector', { cause: error })
    }
  }

  /** Transparently migrate the old format that encrypted only the token field. */
  private decryptLegacyState(state: McpOAuthState): McpOAuthState {
    const tokens = state.tokens as unknown as { __enc?: string } | undefined
    if (!this.encryptor || !tokens || typeof tokens.__enc !== 'string') return state
    if (!isEncryptedEnvelope(tokens.__enc)) return state
    try {
      return { ...state, tokens: JSON.parse(this.encryptor.decrypt(tokens.__enc)) as McpOAuthState['tokens'] }
    } catch (error) {
      throw new Error('MCP OAuth token store could not be decrypted; restore the original key or re-authorize the connector', { cause: error })
    }
  }

  private decodeStoredState(
    stored: McpOAuthState | EncryptedMcpOAuthState
  ): McpOAuthState {
    return isEncryptedMcpOAuthState(stored)
      ? this.decryptEnvelope(stored)
      : this.decryptLegacyState(stored)
  }
}

function validateStoredState(value: unknown): McpOAuthState | EncryptedMcpOAuthState {
  if (isEncryptedMcpOAuthState(value)) return value
  return isMcpOAuthState(value) ? value : {}
}

function isEncryptedMcpOAuthState(value: unknown): value is EncryptedMcpOAuthState {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.keys(value).length === 1 && '__enc' in value &&
    typeof (value as { __enc?: unknown }).__enc === 'string'
}

export function isMcpOAuthState(value: unknown): value is McpOAuthState {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function withoutAuthorizationError(state: McpOAuthState): { lastError?: undefined; lastErrorAt?: undefined } {
  return state.lastError === undefined && state.lastErrorAt === undefined
    ? {}
    : { lastError: undefined, lastErrorAt: undefined }
}

export function isNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code
}

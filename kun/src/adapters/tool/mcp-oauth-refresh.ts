import { createHash } from 'node:crypto'
import type { StoredOAuthTokens } from '@modelcontextprotocol/client'
import type { ManagerDataMutexOperationContext } from '../../manager/data-mutex.js'
import type { McpOAuthLifetime } from './mcp-oauth-lifetime.js'
import type { McpOAuthRefreshWriteResult, McpOAuthState } from './mcp-oauth-store.js'

/**
 * Single-flight coordination for OAuth `refresh_token` grants.
 *
 * Integration point with the MCP SDK: `StreamableHTTPClientTransport` and
 * `SSEClientTransport` accept a `fetch` option. The SDK routes every OAuth
 * network call of `auth()` through that fetch (`ctx.fetchFn`), including the
 * token endpoint POST issued by `refreshAuthorization()`. Wrapping that fetch
 * is what puts the whole refresh transaction - request, response, credential
 * write - inside one critical section, which `OAuthClientProvider` cannot
 * express: `auth()` refreshes unconditionally whenever stored tokens carry a
 * refresh token, so two connections that each reach their own `auth()` would
 * otherwise POST twice with the same rotating refresh token.
 *
 * The transaction runs inside one credential critical section ({@link McpOAuthCredentialSection}),
 * which composes the shared-data coordination already used by the rest of the
 * runtime: a host-wide file mutation queue plus, with a Manager, a cross-process
 * resource lease whose fencing token every `AtomicJsonFile` write inside the
 * operation inherits. A writer whose lease was lost cannot commit.
 */

/** Credential state the SDK based this refresh on, captured when it read tokens. */
export type McpOAuthTokenSnapshot = {
  accessToken: string
  mutationEpoch: number
  clearEpoch: number
}

export type McpOAuthRefreshStore = {
  read(): Promise<McpOAuthState>
  /**
   * Physical identity of the credential file. Every grant key and Manager
   * resource is derived from it, so connections that reach the same file
   * through different paths still share one coordination domain.
   */
  readonly physicalPath: string
  /**
   * Run one credential critical section: the host-wide file queue plus the
   * Manager lease/fence, re-entrant for nested calls.
   */
  runExclusive<T>(operation: (context: ManagerDataMutexOperationContext) => Promise<T>): Promise<T>
  /** Aborts when credentials are revoked, so a doomed request can stop early. */
  revocationSignal(): AbortSignal
  applyRefreshedTokens(input: {
    tokens: StoredOAuthTokens
    spentRefreshToken: string
    observedClearEpoch: number
    observedMutationEpoch: number
    obtainedAt: number
    issuer: string | undefined
    grantKey: string
  }): Promise<McpOAuthRefreshWriteResult>
}

/**
 * Canonical grant identity: everything that has to match before two refreshes
 * can be considered the same transaction. `serverId` plus the credential store
 * path pin the connector; the issuer, client, token endpoint and the requested
 * scope/resource (RFC 8707) pin the authorization-server grant, so two
 * refreshes that ask for different grants are never conflated.
 */
export function canonicalMcpOAuthGrant(input: {
  serverId: string
  storePath: string
  issuer: string | undefined
  clientId: string | undefined
  tokenEndpoint: string
  scope: string | undefined
  resource: string | undefined
}): string {
  return createHash('sha256')
    .update(JSON.stringify([
      input.serverId,
      input.storePath,
      input.issuer ?? '',
      input.clientId ?? '',
      input.tokenEndpoint,
      input.scope ?? '',
      input.resource ?? ''
    ]))
    .digest('hex')
}

type RefreshOutcome =
  | {
    kind: 'response'
    status: number
    headers: Array<[string, string]>
    body: string
    /** Present for token payloads the SDK will acknowledge through saveTokens. */
    guard?: { accessToken: string; refreshToken: string }
  }
  | { kind: 'error'; error: unknown }

function responseFromOutcome(outcome: RefreshOutcome): Response {
  if (outcome.kind === 'error') throw outcome.error
  return new Response(outcome.body, { status: outcome.status, headers: outcome.headers })
}

function jsonOutcome(
  payload: unknown,
  status = 200,
  guard?: { accessToken: string; refreshToken: string }
): RefreshOutcome {
  return {
    kind: 'response',
    status,
    headers: [['content-type', 'application/json']],
    body: JSON.stringify(payload),
    ...(guard ? { guard } : {})
  }
}

function tokenPayload(tokens: StoredOAuthTokens): Record<string, unknown> {
  return {
    access_token: tokens.access_token,
    token_type: tokens.token_type ?? 'Bearer',
    ...(tokens.expires_in !== undefined ? { expires_in: tokens.expires_in } : {}),
    ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
    ...(tokens.scope ? { scope: tokens.scope } : {})
  }
}

function parseTokenResponse(body: string): StoredOAuthTokens | null {
  try {
    const parsed = JSON.parse(body) as Partial<StoredOAuthTokens> & { issuer?: unknown }
    if (typeof parsed.access_token !== 'string' || !parsed.access_token) return null
    // The issuer binding is stamped from the discovery state we validated, not
    // from whatever the token endpoint echoes back.
    const { issuer: _issuer, ...tokens } = parsed
    return tokens as StoredOAuthTokens
  } catch {
    return null
  }
}

async function readRefreshGrant(request: Request): Promise<URLSearchParams | null> {
  if (request.method !== 'POST') return null
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.includes('application/x-www-form-urlencoded')) return null
  let params: URLSearchParams
  try {
    params = new URLSearchParams(await request.clone().text())
  } catch {
    return null
  }
  return params.get('grant_type') === 'refresh_token' ? params : null
}

export type McpOAuthRefreshCoordinatorOptions = {
  serverId: string
  storePath: string
  store: McpOAuthRefreshStore
  /** Expected authorization server from configuration, if the user pinned one. */
  expectedIssuer?: string
  baseFetch?: typeof fetch
  now?: () => number
  /** Token snapshot taken when this connection last read credentials. */
  snapshot?: () => McpOAuthTokenSnapshot | undefined
  /** Registers the token payload the provider's next `saveTokens` acknowledges. */
  beginRefreshWrite?: (write: { accessToken: string; refreshToken: string }) => void
  /**
   * Ties the transaction to the connection lifetime so `close()` waits for it.
   * It deliberately does not abort the transaction: a refresh that already left
   * the process may have rotated the grant server-side, and discarding the
   * rotated result would leave the stored refresh token permanently dead.
   */
  lifetime?: Pick<McpOAuthLifetime, 'track'>
  requestTimeoutMs?: number
}

/** Upper bound for one token endpoint round trip, so `close()` cannot hang. */
const DEFAULT_REFRESH_REQUEST_TIMEOUT_MS = 30_000

/**
 * Fetch wrapper installed on the SDK transports for one MCP server.
 *
 * Non-refresh traffic passes through untouched. A `grant_type=refresh_token`
 * POST runs under the credential mutex: the first caller performs the network
 * refresh and persists the result before releasing it; every later caller
 * re-reads the persisted state and, when the grant already moved, receives that
 * token set without a second request.
 */
export class McpOAuthRefreshCoordinator {
  private readonly baseFetch: typeof fetch
  private readonly now: () => number
  readonly fetch: typeof fetch

  constructor(private readonly options: McpOAuthRefreshCoordinatorOptions) {
    this.baseFetch = options.baseFetch ?? globalThis.fetch
    this.now = options.now ?? (() => Date.now())
    this.fetch = (input, init) => this.handleFetch(input, init)
  }

  private async handleFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init)
    const grant = await readRefreshGrant(request)
    if (!grant) return this.baseFetch(request)
    const outcome = await this.coordinate(request, grant)
    if (outcome.kind === 'response' && outcome.status === 200 && outcome.guard) {
      this.options.beginRefreshWrite?.(outcome.guard)
    }
    return responseFromOutcome(outcome)
  }

  private async coordinate(request: Request, grant: URLSearchParams): Promise<RefreshOutcome> {
    const run = () => this.transaction(request, grant)
    // The lifetime only observes the transaction (so shutdown can wait for a
    // rotation to be persisted); it never cancels it.
    const tracked = this.options.lifetime ? this.options.lifetime.track(run) : run()
    return await tracked.catch((error: unknown): RefreshOutcome => ({ kind: 'error', error }))
  }

  private async transaction(request: Request, grant: URLSearchParams): Promise<RefreshOutcome> {
    const spentRefreshToken = grant.get('refresh_token') ?? ''
    if (!spentRefreshToken) throw new Error('MCP OAuth refresh request carried no refresh token')
    const scope = grant.get('scope') ?? undefined
    const resource = grant.get('resource') ?? undefined
    const snapshot = this.options.snapshot?.()
    const cancellation = this.options.store.revocationSignal()
    return await this.options.store.runExclusive(
      async (context) => {
        const state = await this.options.store.read()
        const clearEpoch = state.clearEpoch ?? 0
        if (cancellation.aborted) {
          // A revocation is already under way; this grant is no longer wanted.
          return jsonOutcome({ error: 'invalid_grant' }, 400)
        }
        const issuer = this.resolveIssuer(state)
        const grantKey = canonicalMcpOAuthGrant({
          serverId: this.options.serverId,
          storePath: this.options.store.physicalPath,
          issuer,
          clientId: state.clientInformation?.client_id,
          tokenEndpoint: request.url,
          scope,
          resource
        })
        if (snapshot && snapshot.clearEpoch !== clearEpoch) {
          // The user revoked this grant after the SDK obtained the refresh
          // token. Spending it now would mint tokens nobody is allowed to hold.
          return jsonOutcome({ error: 'invalid_grant' }, 400)
        }
        const settled = this.settledElsewhere(state, { spentRefreshToken, grantKey, snapshot })
        if (settled) {
          return jsonOutcome(tokenPayload(settled), 200, {
            accessToken: settled.access_token, refreshToken: settled.refresh_token || spentRefreshToken
          })
        }
        // Sending is the irreversible step: re-validate the fence right before.
        await context.assertCurrent()
        const signal = this.requestSignal(context.signal, cancellation)
        try {
          const response = await this.baseFetch(request, { signal: signal.controller.signal })
          const body = await response.text()
          const headers = [...response.headers.entries()]
          if (cancellation.aborted) {
            // A revocation started while this request was on the wire. Its
            // result must not be persisted; the revoker holds the section next
            // and clears the credentials anyway.
            return jsonOutcome({ error: 'invalid_grant' }, 400)
          }
          if (!response.ok) return { kind: 'response', status: response.status, headers, body }
          const parsed = parseTokenResponse(body)
          if (!parsed) return { kind: 'response', status: response.status, headers, body }
          // RFC 6749 makes `refresh_token` optional in a refresh response; the
          // SDK keeps the previous one in that case, and so must the persisted
          // copy, or the next refresh has nothing to spend.
          const tokens: StoredOAuthTokens = parsed.refresh_token
            ? parsed
            : { ...parsed, refresh_token: spentRefreshToken }
          const applied = await this.options.store.applyRefreshedTokens({
            tokens,
            spentRefreshToken,
            observedClearEpoch: clearEpoch,
            observedMutationEpoch: state.mutationEpoch ?? 0,
            obtainedAt: this.now(),
            issuer,
            grantKey
          })
          if (applied === 'cleared') {
            // Credentials were cleared while this refresh was in flight. Never
            // resurrect them: report the grant as gone so the SDK asks for
            // authorization instead of retrying with a dead token.
            return jsonOutcome({ error: 'invalid_grant' }, 400)
          }
          if (applied === 'superseded') {
            // A peer wrote a different token set between our read and our
            // write. Hand the SDK the stored grant so its follow-up saveTokens
            // cannot reinstate the set we just refused to persist.
            const winner = (await this.options.store.read()).tokens
            if (!winner) return jsonOutcome({ error: 'invalid_grant' }, 400)
            return jsonOutcome(tokenPayload(winner), 200, {
              accessToken: winner.access_token, refreshToken: winner.refresh_token || spentRefreshToken
            })
          }
          return {
            kind: 'response',
            status: response.status,
            headers,
            body,
            guard: { accessToken: tokens.access_token, refreshToken: parsed.refresh_token ?? spentRefreshToken }
          }
        } finally {
          signal.dispose()
        }
      }
    )
  }

  /**
   * Tokens that already satisfy this refresh because a peer refreshed first.
   *
   * `mutationEpoch` is the decidable signal: it is persisted in the credential
   * file and captured when this connection read its tokens, so it works for a
   * peer in another process and for authorization servers that never rotate the
   * refresh token. A rotated token is kept as a fallback for credentials written
   * before `lastRefresh` existed. Grant parameters must match, so a refresh
   * asking for a different scope/resource is never answered with a token set
   * minted for another one.
   */
  private settledElsewhere(
    state: McpOAuthState,
    input: { spentRefreshToken: string; grantKey: string; snapshot: McpOAuthTokenSnapshot | undefined }
  ): StoredOAuthTokens | undefined {
    const tokens = state.tokens
    if (!tokens?.access_token) return undefined
    const recorded = state.lastRefresh
    if (recorded && recorded.grantKey !== input.grantKey) return undefined
    const rotated = Boolean(tokens.refresh_token) && tokens.refresh_token !== input.spentRefreshToken
    const movedByPeer = Boolean(input.snapshot) && (
      (state.mutationEpoch ?? 0) !== input.snapshot!.mutationEpoch
      || tokens.access_token !== input.snapshot!.accessToken
    )
    return rotated || movedByPeer ? tokens : undefined
  }

  private resolveIssuer(state: McpOAuthState): string | undefined {
    const discovered = state.discoveryState?.authorizationServerMetadata?.issuer
      ?? state.discoveryState?.authorizationServerUrl
    return this.options.expectedIssuer ?? discovered ?? state.tokens?.issuer
  }

  private requestSignal(
    leaseSignal: AbortSignal,
    cancellation: AbortSignal
  ): { controller: AbortController; dispose: () => void } {
    const controller = new AbortController()
    const timeoutMs = this.options.requestTimeoutMs ?? DEFAULT_REFRESH_REQUEST_TIMEOUT_MS
    const timer = setTimeout(() => {
      controller.abort(new DOMException('MCP OAuth refresh request timed out', 'TimeoutError'))
    }, timeoutMs)
    timer.unref?.()
    const sources = [leaseSignal, cancellation]
    const forward = (event: Event) => controller.abort((event.target as AbortSignal).reason)
    for (const source of sources) {
      if (source.aborted) controller.abort(source.reason)
      else source.addEventListener('abort', forward, { once: true })
    }
    return {
      controller,
      dispose: () => {
        clearTimeout(timer)
        for (const source of sources) source.removeEventListener('abort', forward)
      }
    }
  }
}

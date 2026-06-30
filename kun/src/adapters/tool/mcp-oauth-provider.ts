import {
  type OAuthClientProvider,
  type OAuthDiscoveryState
} from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens
} from '@modelcontextprotocol/sdk/shared/auth.js'
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { join } from 'node:path'
import type { McpCapabilityConfig, McpServerConfig } from '../../contracts/capabilities.js'
import { hashText, slug } from './mcp-naming.js'
import { FileMcpOAuthStore, type McpOAuthState } from './mcp-oauth-store.js'
import type { SecretEncryptor } from '../../security/secret-store.js'
import {
  McpAuthorizationRequiredError,
  type McpOAuthClearResult,
  type McpOAuthDiagnostic,
  type McpOAuthStatus
} from './mcp-types.js'

const MCP_OAUTH_REDIRECT_HOST = '127.0.0.1'
const MCP_OAUTH_REDIRECT_PATH = '/oauth/callback'
const MCP_OAUTH_PORT_BASE = 49_152
const MCP_OAUTH_PORT_RANGE = 12_000

export type McpOAuthProviderOptions = {
  storageDir: string
  openExternal?: (url: URL) => void | Promise<void>
  /**
   * When false (the default) the provider refuses to start the loopback
   * callback server or open a browser: `redirectToAuthorization` throws
   * {@link McpAuthorizationRequiredError} synchronously. This is the load-
   * bearing guard that keeps a non-interactive startup connect from opening a
   * browser the moment the SDK hits a 401 — the interactive flag must reach the
   * provider, not just the connect wrapper.
   */
  interactive?: boolean
  /** Optional encryptor; when present, persisted OAuth tokens are encrypted at rest. */
  encryptor?: SecretEncryptor
}

type McpOAuthDiagnosticDetail = Omit<
  McpOAuthDiagnostic,
  'serverId' | 'enabled' | 'configured' | 'transport' | 'url'
>

/**
 * File-backed {@link OAuthClientProvider} for a single remote MCP server.
 *
 * Responsibilities are deliberately narrow: implement the SDK's OAuth client
 * contract, run a one-shot loopback callback server for the authorization
 * code, and persist credential material through {@link FileMcpOAuthStore}.
 * Transport wiring and connection orchestration live elsewhere so this class
 * stays focused on the authorization state machine.
 */
export class FileMcpOAuthProvider implements OAuthClientProvider {
  readonly clientMetadataUrl?: string
  private readonly store: FileMcpOAuthStore
  private pendingAuthorizationCode: Promise<string> | null = null
  private pendingState: string | null = null

  constructor(
    private readonly serverId: string,
    private readonly server: McpServerConfig,
    storagePath: string,
    private readonly openExternal: (url: URL) => void | Promise<void> = defaultOpenExternal,
    private readonly now: () => number = () => Date.now(),
    /**
     * When false the provider never starts a callback server or opens a
     * browser; `redirectToAuthorization` throws immediately. Defaults to false
     * so an accidental interactive trigger during startup is impossible.
     */
    private readonly interactive: boolean = false,
    /** Optional encryptor; when present, persisted tokens are encrypted at rest. */
    encryptor?: SecretEncryptor
  ) {
    this.store = new FileMcpOAuthStore(storagePath, encryptor)
  }

  get redirectUrl(): URL {
    return new URL(`http://${MCP_OAUTH_REDIRECT_HOST}:${this.redirectPort()}${MCP_OAUTH_REDIRECT_PATH}`)
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.server.oauth?.clientName ?? `Kun MCP Client (${this.serverId})`,
      redirect_uris: [this.redirectUrl.toString()],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: this.server.oauth?.clientSecret ? 'client_secret_post' : 'none',
      ...(this.server.oauth?.scopes.length ? { scope: this.server.oauth.scopes.join(' ') } : {})
    }
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const configured = this.configuredClientInformation()
    if (configured) return configured
    return (await this.store.read()).clientInformation
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    if (this.configuredClientInformation()) return
    await this.store.update((state) => ({ ...state, clientInformation }))
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.store.read()).tokens
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.store.update((state) => {
      const next: McpOAuthState = { ...state, tokens, tokensObtainedAt: this.now() }
      // A fresh token set means the prior authorization failure (if any) is
      // resolved; clear it so diagnostics flip from "error" to "authorized".
      delete next.lastError
      delete next.lastErrorAt
      return next
    })
  }

  state(): string {
    this.pendingState = randomBytes(24).toString('hex')
    return this.pendingState
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    // Non-interactive providers must never reach the browser/callback. Throw
    // BEFORE starting the loopback server or opening a URL, because the SDK
    // calls this synchronously inside auth() the moment a 401 is seen — even
    // a started-then-aborted callback would briefly bind the redirect port and
    // could pop a browser tab on startup. The connection layer maps this to a
    // "waiting for user" state instead of a transport error.
    if (!this.interactive) {
      throw new McpAuthorizationRequiredError(this.serverId)
    }
    if (authorizationUrl.protocol !== 'http:' && authorizationUrl.protocol !== 'https:') {
      throw new Error(`MCP OAuth authorization URL must use http or https for server "${this.serverId}"`)
    }
    const callback = this.startCallbackServer()
    this.pendingAuthorizationCode = callback.code
    try {
      await callback.ready
      await this.openExternal(authorizationUrl)
    } catch (error) {
      callback.cancel()
      this.pendingAuthorizationCode = null
      this.pendingState = null
      throw error
    }
  }

  async waitForAuthorizationCode(): Promise<string> {
    const authorizationCode = this.pendingAuthorizationCode
    if (!authorizationCode) {
      throw new Error(`MCP OAuth authorization was not started for server "${this.serverId}"`)
    }
    try {
      return await authorizationCode
    } finally {
      if (this.pendingAuthorizationCode === authorizationCode) {
        this.pendingAuthorizationCode = null
        this.pendingState = null
      }
    }
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.store.update((state) => ({ ...state, codeVerifier }))
  }

  async codeVerifier(): Promise<string> {
    const codeVerifier = (await this.store.read()).codeVerifier
    if (!codeVerifier) throw new Error(`MCP OAuth code verifier is missing for server "${this.serverId}"`)
    return codeVerifier
  }

  async saveDiscoveryState(discoveryState: OAuthDiscoveryState): Promise<void> {
    await this.store.update((state) => ({ ...state, discoveryState }))
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return (await this.store.read()).discoveryState
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    if (scope === 'all') {
      await this.store.clear()
      return
    }
    await this.store.update((state) => {
      const next = { ...state }
      if (scope === 'client') delete next.clientInformation
      if (scope === 'tokens') {
        delete next.tokens
        delete next.tokensObtainedAt
      }
      if (scope === 'verifier') delete next.codeVerifier
      if (scope === 'discovery') delete next.discoveryState
      return next
    })
  }

  /**
   * Persist the reason an authorization attempt failed. Surfaced by
   * diagnostics as status `error` so the GUI can explain a stuck connector
   * (callback error, timeout, cancellation) instead of showing a bare state.
   */
  async recordAuthorizationError(message: string): Promise<void> {
    await this.store.update((state) => ({
      ...state,
      lastError: message,
      lastErrorAt: new Date(this.now()).toISOString()
    }))
  }

  async diagnostics(): Promise<McpOAuthDiagnosticDetail> {
    const state = await this.store.read()
    const hasClientInformation = Boolean(state.clientInformation)
    const hasTokens = Boolean(state.tokens?.access_token)
    const hasRefreshToken = Boolean(state.tokens?.refresh_token)
    const hasCodeVerifier = Boolean(state.codeVerifier)
    const hasDiscoveryState = Boolean(state.discoveryState)
    const expiresAt = computeTokenExpiry(state)
    const expired = hasTokens && expiresAt !== undefined && Date.parse(expiresAt) <= this.now()
    const grantedScopes = parseTokenScopes(state.tokens?.scope)
    const status = deriveOAuthStatus({
      hasTokens,
      expired,
      hasPartialState: hasClientInformation || hasCodeVerifier || hasDiscoveryState,
      hasError: Boolean(state.lastError)
    })
    return {
      status,
      hasClientInformation,
      hasTokens,
      hasRefreshToken,
      hasCodeVerifier,
      hasDiscoveryState,
      ...(grantedScopes.length ? { grantedScopes } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      ...(state.lastError ? { lastError: state.lastError } : {}),
      ...(state.lastErrorAt ? { lastErrorAt: state.lastErrorAt } : {})
    }
  }

  async clearCredentials(): Promise<void> {
    await this.store.clear()
  }

  private configuredClientInformation(): OAuthClientInformationMixed | undefined {
    if (!this.server.oauth?.clientId) return undefined
    return {
      client_id: this.server.oauth.clientId,
      ...(this.server.oauth.clientSecret ? { client_secret: this.server.oauth.clientSecret } : {})
    }
  }

  private redirectPort(): number {
    return this.server.oauth?.redirectPort ?? defaultMcpOAuthRedirectPort(this.serverId, this.server.url ?? '')
  }

  private startCallbackServer(): { code: Promise<string>; ready: Promise<void>; cancel: () => void } {
    const timeoutMs = this.server.oauth?.callbackTimeoutMs ?? 120_000
    let resolveCode!: (code: string) => void
    let rejectCode!: (error: Error) => void
    let completed = false
    let listening = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const codePromise = new Promise<string>((resolve, reject) => {
      resolveCode = resolve
      rejectCode = reject
    })
    const closeServer = () => {
      if (timer) clearTimeout(timer)
      if (listening) {
        server.close()
        listening = false
      }
    }
    const resolveOnce = (code: string) => {
      if (completed) return
      completed = true
      closeServer()
      resolveCode(code)
    }
    const rejectOnce = (error: Error) => {
      if (completed) return
      completed = true
      closeServer()
      rejectCode(error)
    }
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', this.redirectUrl)
      if (url.pathname !== MCP_OAUTH_REDIRECT_PATH) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        response.end('Not found')
        return
      }
      const state = url.searchParams.get('state')
      if (!this.pendingState || state !== this.pendingState) {
        response.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
        response.end('<!doctype html><title>Kun OAuth</title><p>Authorization state mismatch.</p>')
        return
      }
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')
      if (code) {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end('<!doctype html><title>Kun OAuth</title><p>Authorization complete. You can close this window.</p>')
        resolveOnce(code)
      } else {
        response.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
        response.end('<!doctype html><title>Kun OAuth</title><p>Authorization failed.</p>')
        rejectOnce(new Error(error ? `MCP OAuth authorization failed: ${error}` : 'MCP OAuth callback did not include a code'))
      }
    })
    timer = setTimeout(() => {
      rejectOnce(new Error(`MCP OAuth authorization timed out for server "${this.serverId}"`))
    }, timeoutMs)
    const ready = new Promise<void>((resolve, reject) => {
      server.once('error', (error) => {
        rejectOnce(error instanceof Error ? error : new Error(String(error)))
        reject(error)
      })
      server.listen(this.redirectPort(), MCP_OAUTH_REDIRECT_HOST, () => {
        listening = true
        resolve()
      })
    })
    timer.unref()
    codePromise.finally(() => {
      if (timer) clearTimeout(timer)
    }).catch(() => undefined)
    return {
      code: codePromise,
      ready,
      cancel: () => rejectOnce(new Error(`MCP OAuth authorization was cancelled for server "${this.serverId}"`))
    }
  }
}

export function createMcpOAuthProvider(
  serverId: string,
  server: McpServerConfig,
  options: McpOAuthProviderOptions | undefined
): FileMcpOAuthProvider | undefined {
  if (!options?.storageDir) return undefined
  if (server.transport !== 'streamable-http' && server.transport !== 'sse') return undefined
  if (!server.url || !server.oauth || server.oauth.enabled === false) return undefined
  return new FileMcpOAuthProvider(
    serverId,
    server,
    join(options.storageDir, `${safeMcpOAuthFileName(serverId)}-${hashText(server.url).slice(0, 16)}.json`),
    options.openExternal,
    undefined,
    options.interactive ?? false,
    options.encryptor
  )
}

export async function listMcpOAuthDiagnostics(
  config: McpCapabilityConfig,
  options: { storageDir?: string; encryptor?: SecretEncryptor } = {}
): Promise<McpOAuthDiagnostic[]> {
  const providers = createConfiguredMcpOAuthProviders(config, options)
  return Promise.all(providers.map(async ({ serverId, server, provider }) => ({
    serverId,
    enabled: server.oauth?.enabled !== false,
    configured: Boolean(server.oauth),
    transport: server.transport,
    ...(server.url ? { url: server.url } : {}),
    ...await provider.diagnostics()
  })))
}

export async function clearMcpOAuthCredentials(
  config: McpCapabilityConfig,
  options: { storageDir?: string; serverId?: string } = {}
): Promise<McpOAuthClearResult> {
  const providers = createConfiguredMcpOAuthProviders(config, options)
    .filter((entry) => !options.serverId || entry.serverId === options.serverId)
  await Promise.all(providers.map((entry) => entry.provider.clearCredentials()))
  return { cleared: providers.map((entry) => entry.serverId) }
}

export function createConfiguredMcpOAuthProviders(
  config: McpCapabilityConfig,
  options: {
    storageDir?: string
    openExternal?: (url: URL) => void | Promise<void>
    encryptor?: SecretEncryptor
  } = {}
): Array<{ serverId: string; server: McpServerConfig; provider: FileMcpOAuthProvider }> {
  return Object.entries(config.servers).flatMap(([serverId, server]) => {
    const provider = createMcpOAuthProvider(serverId, server, {
      storageDir: options.storageDir ?? '',
      openExternal: options.openExternal,
      encryptor: options.encryptor
    })
    return provider ? [{ serverId, server, provider }] : []
  })
}

function deriveOAuthStatus(input: {
  hasTokens: boolean
  expired: boolean
  hasPartialState: boolean
  hasError: boolean
}): McpOAuthStatus {
  if (input.hasTokens) return input.expired ? 'expired' : 'authorized'
  if (input.hasError) return 'error'
  if (input.hasPartialState) return 'partial'
  return 'empty'
}

function computeTokenExpiry(state: McpOAuthState): string | undefined {
  const expiresIn = state.tokens?.expires_in
  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn)) return undefined
  if (typeof state.tokensObtainedAt !== 'number' || !Number.isFinite(state.tokensObtainedAt)) return undefined
  return new Date(state.tokensObtainedAt + expiresIn * 1000).toISOString()
}

/**
 * Parse the OAuth `scope` field (a space-delimited string per RFC 6749) into a
 * de-duplicated list of granted scopes for the permission view. Returns an
 * empty array when the provider did not echo any scope.
 */
function parseTokenScopes(scope: string | undefined): string[] {
  if (typeof scope !== 'string') return []
  return [...new Set(scope.split(/\s+/).map((entry) => entry.trim()).filter(Boolean))]
}

export function defaultMcpOAuthRedirectPort(serverId: string, url: string): number {
  const digest = createHash('sha256').update(`${serverId}\n${url}`).digest()
  return MCP_OAUTH_PORT_BASE + digest.readUInt16BE(0) % MCP_OAUTH_PORT_RANGE
}

function safeMcpOAuthFileName(serverId: string): string {
  return slug(serverId).slice(0, 64) || 'server'
}

export function defaultOpenExternal(url: URL): void {
  const target = url.toString()
  const command = process.platform === 'win32' ? 'rundll32.exe'
    : process.platform === 'darwin' ? 'open'
      : 'xdg-open'
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', target] : [target]
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  })
  child.unref()
}

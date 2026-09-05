import type { McpCapabilityConfig, McpServerConfig } from '../../contracts/capabilities.js'
import { redactSecretText } from '../../config/secret-redaction.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import {
  catalogFingerprint,
  canUseMcpServer,
  isMcpServerTrusted,
  isMcpServerVisible,
  normalizeMcpToolName
} from './mcp-naming.js'
import {
  clearMcpOAuthCredentials,
  listMcpOAuthDiagnostics
} from './mcp-oauth-provider.js'
import {
  authorizeMcpServerOAuth,
  createSdkMcpClient,
  isMcpAuthorizationRequiredError
} from './mcp-transport.js'
import { errorMessage, formatMcpConnectionError } from './mcp-stdio-environment.js'
import { createMcpFacadeProvider } from './mcp-facade-provider.js'
import type {
  McpClientLike,
  McpOAuthAuthorizeResult,
  McpOAuthClearResult,
  McpOAuthDiagnostic,
  McpServerDiagnostic,
  McpToolDescriptor
} from './mcp-types.js'
import {
  createMcpSearchProvider,
  mcpSearchDiagnostic,
  McpSearchCatalogController,
  type McpSearchCatalogRecord,
  type McpSearchCatalogState,
  type McpSearchRuntimeDiagnostic
} from './mcp-tool-search.js'
import {
  connectAndLoadCatalog,
  createMcpLocalTool,
  createMcpSearchCatalogRecord,
  defaultMcpReconnectDelay,
  listAllMcpTools,
  raceStartupTimeout,
  refreshMcpConnectionCatalog,
  runMcpBackgroundReconnect,
  serverDiagnostic,
  shouldUseMcpSearch,
  startupConnectionError,
  syncMcpDiagnostic
} from './mcp-tool-runtime.js'

// Re-export the MCP module surface so existing consumers (and the
// `adapters/tool/index.ts` barrel) keep importing from one place even though
// the implementation now lives in focused modules: persistence, OAuth, the
// transport adapter, naming/trust, and stdio environment.
export type {
  McpClientLike,
  McpClientLifecycleHandlers,
  McpOAuthAuthorizeResult,
  McpOAuthClearResult,
  McpOAuthDiagnostic,
  McpOAuthStatus,
  McpServerDiagnostic,
  McpToolDescriptor
} from './mcp-types.js'
export {
  canUseMcpServer,
  isMcpServerTrusted,
  isMcpServerVisible,
  normalizeMcpToolName,
  resolveMcpServerCwd
} from './mcp-naming.js'
export {
  FileMcpOAuthProvider,
  clearMcpOAuthCredentials,
  createMcpOAuthProvider,
  listMcpOAuthDiagnostics
} from './mcp-oauth-provider.js'
export {
  authorizeMcpServerOAuth,
  createSdkMcpClient,
  isMcpAuthorizationRequiredError,
  McpAuthorizationRequiredError
} from './mcp-transport.js'
export {
  buildMcpStdioEnvironment,
  formatMcpConnectionError,
  type McpStdioEnvironmentOptions
} from './mcp-stdio-environment.js'

export type McpToolProviderBuildResult = {
  providers: CapabilityToolProvider[]
  diagnostics: McpServerDiagnostic[]
  oauth: McpOAuthDiagnostic[]
  search: McpSearchRuntimeDiagnostic
  /**
   * Live counts, not startup snapshots. Both are object getters that read the
   * current diagnostics and listed catalog at read time, so capability
   * manifests rebuilt after a reconnect/OAuth/refresh see fresh values.
   */
  connectedServers: number
  toolCount: number
  /**
   * Begin retrying servers that failed/timed out during the fast startup pass.
   * Call once, after the tool registries exist, passing callbacks that add,
   * remove, or replace a late-connected server's provider in them. Without
   * this, a server that loses the startup race (e.g. an npx-based stdio server
   * whose first cold start exceeds the connect timeout on Windows) stays
   * "error" forever until the whole runtime restarts — exactly issue #342.
   * Safe to call when there is nothing to retry (it no-ops). The returned
   * promise resolves once every failed server has reconnected or exhausted its
   * retries (used by tests).
   */
  startBackgroundReconnect: (hooks: {
    register: (provider: CapabilityToolProvider) => void
    unregister: (providerId: string) => void
    /** Replaces an already-exposed direct provider in place (schema/tool-set change). */
    replace?: (provider: CapabilityToolProvider) => void
  }) => Promise<void>
  clearOAuthCredentials: (serverId?: string) => Promise<McpOAuthClearResult>
  /**
   * Run the interactive OAuth authorization flow for one configured remote
   * server (the explicit, user-triggered entry point). Refreshes the cached
   * OAuth diagnostics on completion. Startup never calls this.
   */
  authorizeOAuth: (serverId: string) => Promise<McpOAuthAuthorizeResult>
  close: () => Promise<void>
}

export type McpToolProviderOptions = {
  clientFactory?: (serverId: string, server: McpServerConfig) => Promise<McpClientLike>
  nowIso?: () => string
  oauthStorageDir?: string
  /** Optional encryptor so persisted OAuth tokens are encrypted at rest. */
  oauthEncryptor?: import('../../security/secret-store.js').SecretEncryptor
  openExternal?: (url: URL) => void | Promise<void>
  /**
   * Upper bound for connect + initial tool listing per server during startup.
   * A slow or hung server (e.g. an npx-based stdio server resolving packages)
   * must not keep the whole runtime from reporting ready.
   */
  startupConnectTimeoutMs?: number
  /** Tunables for the post-startup background reconnect of failed servers. */
  backgroundReconnect?: McpBackgroundReconnectOptions
  /** Test seam for the inter-attempt backoff; defaults to a real unref'd timer. */
  delay?: (ms: number) => Promise<void>
  /**
   * Test seam for the interactive authorization step. Defaults to the real
   * browser-driven {@link authorizeMcpServerOAuth}. Tests inject a fake to
   * exercise the authorize-then-register + reconnect path without a network.
   */
  authorize?: (serverId: string, server: McpServerConfig) => Promise<McpOAuthAuthorizeResult>
}

export type McpBackgroundReconnectOptions = {
  /** Disable the retry loop entirely. Defaults to enabled. */
  enabled?: boolean
  /** Attempts per failed server before giving up. Default 5. */
  maxAttempts?: number
  /** First backoff delay; doubles each attempt up to maxDelayMs. Default 4000. */
  baseDelayMs?: number
  /** Backoff ceiling. Default 30000. */
  maxDelayMs?: number
}

const DEFAULT_MCP_STARTUP_CONNECT_TIMEOUT_MS = 10_000
const DEFAULT_MCP_RECONNECT_MAX_ATTEMPTS = 5
const DEFAULT_MCP_RECONNECT_BASE_DELAY_MS = 4_000
const DEFAULT_MCP_RECONNECT_MAX_DELAY_MS = 30_000

export type McpConnectionState = {
  serverId: string
  server: McpServerConfig
  client: McpClientLike
  clientFactory: (serverId: string, server: McpServerConfig) => Promise<McpClientLike>
  nowIso: () => string
  catalogFingerprint?: string
  catalogDrift?: boolean
  toolNames: string[]
  lastConnectedAt?: string
  lastError?: string
  // Reconnect state machine (#642/#639), ported from upstream so a dropped
  // transport flips the live diagnostic to `reconnecting`/`error` and a single
  // shared reconnect recovers concurrent callers.
  status: 'connected' | 'reconnecting' | 'error'
  reconnectAttempts: number
  reconnectBackoffMs: number
  reconnectPromise?: Promise<McpClientLike>
  lastDisconnectedAt?: string
  lastReconnectAt?: string
  nextReconnectAt?: string
  /** Live diagnostic object — the SAME reference stored in the diagnostics array. */
  diagnostic?: McpServerDiagnostic
  intentionallyClosing?: boolean
  /**
   * Provider-assigned hook: fires inside `connectAndLoadCatalog` after every
   * successful catalog load, so runtime reconnects commit like every other
   * path. It is only assigned once a state is adopted by the provider, which
   * keeps fresh-state connects (startup / OAuth / background reconnect) on
   * their existing explicit commit instead of double-committing. A throw here
   * propagates into the reconnect state machine's existing catch (close +
   * cooldown); the hook body is a pure in-memory commit, so that is safe.
   */
  onCatalogChanged?: (serverId: string, listed: McpToolDescriptor[]) => void
}

export async function buildMcpToolProviders(
  config: McpCapabilityConfig | undefined,
  options: McpToolProviderOptions = {}
): Promise<McpToolProviderBuildResult> {
  const providers: CapabilityToolProvider[] = []
  const diagnostics: McpServerDiagnostic[] = []
  const connected: McpConnectionState[] = []
  const catalogState: McpSearchCatalogState = { records: [] }
  // Full direct provider wrappers keyed by serverId, so a schema/tool-set
  // change can atomically replace a live provider instead of a startup snapshot.
  const directToolsByServer = new Map<string, CapabilityToolProvider>()
  // Last-known descriptors per connected server. This is the source of truth
  // the unified commit rebuilds records, wrappers, and the index from.
  const listedByServer = new Map<string, McpToolDescriptor[]>()
  const searchCatalog = new McpSearchCatalogController([])
  const mcp = config
  const nowIso = options.nowIso ?? (() => new Date().toISOString())
  const clientFactory = options.clientFactory ?? ((serverId, server) =>
    createSdkMcpClient(serverId, server, {
      storageDir: options.oauthStorageDir,
      openExternal: options.openExternal,
      ...(options.oauthEncryptor ? { encryptor: options.oauthEncryptor } : {})
    }))
  if (!mcp?.enabled) {
    return {
      providers,
      diagnostics,
      oauth: [],
      search: mcpSearchDiagnostic({
        config: config?.search ?? {
          enabled: false,
          mode: 'auto',
          autoThresholdToolCount: 24,
          topKDefault: 5,
          topKMax: 10,
          minScore: 0.15,
          bm25: { k1: 1.2, b: 0.75 }
        },
        active: false,
        indexedToolCount: 0,
        advertisedToolCount: 0,
        state: catalogState
      }),
      connectedServers: 0,
      toolCount: 0,
      startBackgroundReconnect: async () => undefined,
      clearOAuthCredentials: async () => ({ cleared: [] }),
      authorizeOAuth: async (serverId) => ({ serverId, status: 'disabled', authorized: false }),
      close: async () => undefined
    }
  }

  // Connect all servers in parallel — startup previously paid the sum of
  // every server's connect + list latency, and a single hung server (e.g.
  // npx resolving a package) blocked the runtime ready signal forever.
  const startupTimeoutMs = options.startupConnectTimeoutMs ?? DEFAULT_MCP_STARTUP_CONNECT_TIMEOUT_MS
  type ConnectOutcome =
    | { serverId: string; server: McpServerConfig; status: 'disabled' }
    | { serverId: string; server: McpServerConfig; status: 'error'; error: unknown }
    | {
        serverId: string
        server: McpServerConfig
        status: 'connected'
        state: McpConnectionState
        listed: McpToolDescriptor[]
      }
  const outcomes = await Promise.all(
    Object.entries(mcp.servers).map(async ([serverId, server]): Promise<ConnectOutcome> => {
      if (!server.enabled) {
        return { serverId, server, status: 'disabled' }
      }
      const attempt = connectAndLoadCatalog(serverId, server, clientFactory, nowIso)
      try {
        const result = await raceStartupTimeout(attempt, startupTimeoutMs, serverId)
        return { serverId, server, status: 'connected', ...result }
      } catch (error) {
        return { serverId, server, status: 'error', error }
      }
    })
  )

  for (const outcome of outcomes) {
    if (outcome.status === 'disabled') {
      diagnostics.push(serverDiagnostic({ serverId: outcome.serverId, server: outcome.server }, 'disabled', 0))
      continue
    }
    if (outcome.status === 'error') {
      const authRequired = isMcpAuthorizationRequiredError(outcome.error)
      diagnostics.push(
        serverDiagnostic(
          { serverId: outcome.serverId, server: outcome.server },
          authRequired ? 'authorization_required' : 'error',
          0,
          startupConnectionError(outcome.error, outcome.server)
        )
      )
      continue
    }
    const { state, listed } = outcome
    connected.push(state)
    listedByServer.set(outcome.serverId, listed)
    diagnostics.push(syncMcpDiagnostic(state, 'connected', listed.length))
  }

  const oauthDiagnostics = await listMcpOAuthDiagnostics(mcp, {
    storageDir: options.oauthStorageDir,
    encryptor: options.oauthEncryptor
  })
  const gatewayActive = Object.keys(mcp.servers).length > 0
  /**
   * Search mode is derived from the LIVE catalog size, not a startup snapshot.
   * OAuth late-connect and background reconnect both grow `catalogState.records`
   * after startup; a threshold crossing there must atomically replace the exposed
   * provider set (see syncExposure) instead of reusing the stale startup decision.
   */
  const isSearchActive = (): boolean =>
    shouldUseMcpSearch(mcp.search, catalogState.records.length) &&
    connected.some((state) => state.status === 'connected')
  const computeAdvertisedToolCount = (): number => {
    const gatewayCount = providers
      .filter((provider) => provider.id === 'mcp:search' || provider.id === 'mcp:facade')
      .reduce((total, provider) => total + provider.tools.length, 0)
    const directCount = isSearchActive()
      ? 0
      : [...directToolsByServer.values()].reduce((total, provider) => total + provider.tools.length, 0)
    return gatewayCount + directCount
  }
  const searchDiagnostic = mcpSearchDiagnostic({
    config: mcp.search,
    active: false,
    indexedToolCount: 0,
    advertisedToolCount: 0,
    state: catalogState
  })
  const updateSearchDiagnostic = (): void => {
    searchDiagnostic.active = isSearchActive()
    searchDiagnostic.indexedToolCount = catalogState.records.length
    searchDiagnostic.advertisedToolCount = computeAdvertisedToolCount()
    searchDiagnostic.lastRefreshedAt = catalogState.lastRefreshedAt
    searchDiagnostic.lastError = catalogState.lastError
    searchDiagnostic.catalogFingerprint = catalogState.catalogFingerprint
    searchDiagnostic.catalogDrift = catalogState.catalogDrift
  }

  // Servers that need OAuth authorization are NOT retried by the background
  // reconnect loop — retrying just burns attempts and would re-hit a 401. They
  // wait in `authorization_required` until the user authorizes, after which
  // authorizeOAuth() performs a single live connect + register.
  const failedServers = outcomes.flatMap((outcome) =>
    outcome.status === 'error' && !isMcpAuthorizationRequiredError(outcome.error)
      ? [{ serverId: outcome.serverId, server: outcome.server }]
      : []
  )
  let reconnectAborted = false
  let reconnectStarted = false
  /** Captured from startBackgroundReconnect so authorizeOAuth/reconnect can register/unregister/replace live. */
  let liveRegister: ((provider: CapabilityToolProvider) => void) | null = null
  let liveUnregister: ((providerId: string) => void) | null = null
  let liveReplace: ((provider: CapabilityToolProvider) => void) | null = null
  /** Per-serverId authorization single-flight: concurrent clicks share one run. */
  const authorizeInFlight = new Map<string, Promise<McpOAuthAuthorizeResult>>()

  /**
   * Which direct per-server providers are currently exposed in the live
   * registries. Starts empty and is reconciled once the initial catalog is
   * committed (the startup `providers` array is registered by the composition
   * layer, not through these live hooks).
   */
  const exposedDirectServerIds = new Set<string>()

  /**
   * Atomically reconcile which direct per-server providers are exposed against
   * the live search-active decision:
   * - new catalog reaches the auto threshold: unregister every exposed direct
   *   provider, keep only search/facade;
   * - new catalog falls below the threshold: register the current wrappers;
   * - still direct mode but a schema/tool set changed: replace the already
   *   exposed provider in place instead of skipping it.
   */
  const syncExposure = (): void => {
    if (isSearchActive()) {
      for (const serverId of exposedDirectServerIds) {
        if (liveUnregister) {
          try {
            liveUnregister(`mcp:${serverId}`)
          } catch {
            // Registry removal failure must not break the connect flow; the
            // exposure decision below is authoritative for future syncs.
          }
        }
      }
      exposedDirectServerIds.clear()
    } else {
      for (const state of connected) {
        if (state.status !== 'connected') continue
        const provider = directToolsByServer.get(state.serverId)
        if (!provider) continue
        if (exposedDirectServerIds.has(state.serverId)) {
          if (liveReplace) {
            try {
              liveReplace(provider)
            } catch {
              // ignore duplicate/colliding replacement
            }
          }
          continue
        }
        if (liveRegister) {
          try {
            liveRegister(provider)
          } catch {
            // ignore duplicate/colliding registration
          }
        }
        exposedDirectServerIds.add(state.serverId)
      }
    }
    updateSearchDiagnostic()
  }

  /**
   * The single catalog commit path. Given the latest descriptors per connected
   * server, it rebuilds records, direct wrappers, the search index, exposure,
   * fingerprint, and refresh/error diagnostics together — never partially.
   */
  const commitCatalog = (nextListed: Map<string, McpToolDescriptor[]>): void => {
    const records: McpSearchCatalogRecord[] = []
    const nextDirect = new Map<string, CapabilityToolProvider>()
    for (const state of connected) {
      const listed = nextListed.get(state.serverId)
      if (!listed) continue
      records.push(...listed.map((tool) => createMcpSearchCatalogRecord(state, tool)))
      nextDirect.set(state.serverId, {
        id: `mcp:${state.serverId}`,
        kind: 'mcp',
        enabled: true,
        available: true,
        tools: listed.map((tool) => createMcpLocalTool(state, tool))
      })
    }
    const previousFingerprint = catalogState.catalogFingerprint
    catalogState.records = records
    catalogState.lastRefreshedAt = nowIso()
    catalogState.catalogFingerprint = catalogFingerprint(records.map((record) => record.toolId))
    catalogState.catalogDrift = Boolean(previousFingerprint && previousFingerprint !== catalogState.catalogFingerprint)
    catalogState.lastError = undefined
    directToolsByServer.clear()
    for (const [serverId, provider] of nextDirect) directToolsByServer.set(serverId, provider)
    searchCatalog.replaceAll(records)
    syncExposure()
  }

  /**
   * The provider-side body for the per-state `onCatalogChanged` hook. It merges
   * one server's fresh listing into the live source of truth and re-commits the
   * whole catalog through the single commit path, so runtime reconnects behave
   * identically to OAuth late-connect and background reconnect.
   */
  const catalogChanged = (serverId: string, listed: McpToolDescriptor[]): void => {
    listedByServer.set(serverId, listed)
    commitCatalog(listedByServer)
  }

  /**
   * Full manual refresh: re-list every connected server first, then commit the
   * whole catalog once. If any listing fails the previous records, wrappers,
   * index, exposure, and fingerprint stay intact and only the redacted
   * `lastError` is published.
   */
  const refreshCatalog = async (): Promise<McpSearchCatalogRecord[]> => {
    try {
      const nextListed = new Map<string, McpToolDescriptor[]>()
      for (const state of connected) {
        const listed = await refreshMcpConnectionCatalog(state, 'refresh')
        nextListed.set(state.serverId, listed)
      }
      for (const [serverId, listed] of nextListed) listedByServer.set(serverId, listed)
      commitCatalog(listedByServer)
      return catalogState.records
    } catch (error) {
      catalogState.lastError = redactSecretText(errorMessage(error))
      updateSearchDiagnostic()
      throw error
    }
  }

  if (gatewayActive) {
    providers.push(createMcpSearchProvider({
      config: mcp.search,
      state: catalogState,
      catalog: searchCatalog,
      refreshCatalog,
      isServerAvailable: canUseMcpServer
    }))
  }
  providers.push(createMcpFacadeProvider(connected))
  // Commit the startup catalog before deciding direct exposure so `isSearchActive`
  // and `computeAdvertisedToolCount` see the real initial size.
  commitCatalog(listedByServer)
  for (const state of connected) state.onCatalogChanged = catalogChanged
  if (!isSearchActive()) {
    providers.push(...directToolsByServer.values())
  }

  const refreshOAuthDiagnostics = async (): Promise<void> => {
    const nextDiagnostics = await listMcpOAuthDiagnostics(mcp, {
      storageDir: options.oauthStorageDir,
      encryptor: options.oauthEncryptor
    })
    oauthDiagnostics.splice(0, oauthDiagnostics.length, ...nextDiagnostics)
  }

  /**
   * Connect a server live (using the real/injected client factory), list its
   * tools, register the provider, and flip its diagnostic to `connected` — no
   * runtime restart required after a successful authorization.
   */
  const connectAndRegisterServer = async (serverId: string, server: McpServerConfig): Promise<void> => {
    const { state, listed } = await connectAndLoadCatalog(serverId, server, clientFactory, nowIso)
    connected.push(state)
    listedByServer.set(serverId, listed)
    state.onCatalogChanged = catalogChanged
    commitCatalog(listedByServer)
    const diagnostic = syncMcpDiagnostic(state, 'connected', listed.length)
    const index = diagnostics.findIndex((entry) => entry.id === serverId)
    if (index >= 0) diagnostics[index] = diagnostic
    else diagnostics.push(diagnostic)
  }

  const authorizeOAuth = (serverId: string): Promise<McpOAuthAuthorizeResult> => {
    const inflight = authorizeInFlight.get(serverId)
    if (inflight) return inflight
    const run = (async (): Promise<McpOAuthAuthorizeResult> => {
      const server = mcp.servers[serverId]
      if (!server || !options.oauthStorageDir) {
        return { serverId, status: 'disabled', authorized: false }
      }
      const authorize = options.authorize ??
        ((id: string, srv: McpServerConfig) => authorizeMcpServerOAuth(id, srv, {
          storageDir: options.oauthStorageDir as string,
          openExternal: options.openExternal,
          encryptor: options.oauthEncryptor
        }))
      const result = await authorize(serverId, server)
      await refreshOAuthDiagnostics()
      // On success, connect + register immediately so tools are live without a
      // runtime restart. Skip if the server is already connected.
      if (result.authorized && !connected.some((state) => state.serverId === serverId)) {
        try {
          await connectAndRegisterServer(serverId, server)
        } catch {
          // Leave the server in its prior diagnostic state; the user can retry.
        }
      }
      return result
    })()
    authorizeInFlight.set(serverId, run)
    run.finally(() => {
      if (authorizeInFlight.get(serverId) === run) authorizeInFlight.delete(serverId)
    }).catch(() => undefined)
    return run
  }

  return {
    providers,
    diagnostics,
    oauth: oauthDiagnostics,
    search: searchDiagnostic,
    get connectedServers(): number {
      return diagnostics.filter((diagnostic) => diagnostic.status === 'connected').length
    },
    get toolCount(): number {
      return [...listedByServer.values()].reduce((total, listed) => total + listed.length, 0)
    },
    startBackgroundReconnect: (hooks) => {
      liveRegister = hooks.register
      liveUnregister = hooks.unregister
      liveReplace = hooks.replace ?? null
      // Reconcile exposure as soon as the live hooks exist, covering the
      // window where a catalog was committed before the registries were wired.
      syncExposure()
      if (reconnectStarted) return Promise.resolve()
      reconnectStarted = true
      if (failedServers.length === 0) return Promise.resolve()
      if (options.backgroundReconnect?.enabled === false) return Promise.resolve()
      return runMcpBackgroundReconnect({
        failedServers,
        clientFactory,
        nowIso,
        onServerConnected: (state, listed) => {
          connected.push(state)
          listedByServer.set(state.serverId, listed)
          state.onCatalogChanged = catalogChanged
          commitCatalog(listedByServer)
          const diagnostic = syncMcpDiagnostic(state, 'connected', listed.length)
          const index = diagnostics.findIndex((entry) => entry.id === state.serverId)
          if (index >= 0) diagnostics[index] = diagnostic
          else diagnostics.push(diagnostic)
        },
        isAborted: () => reconnectAborted,
        delay: options.delay ?? defaultMcpReconnectDelay,
        options: options.backgroundReconnect
      })
    },
    clearOAuthCredentials: async (serverId) => {
      const result = await clearMcpOAuthCredentials(mcp, {
        storageDir: options.oauthStorageDir,
        serverId
      })
      await refreshOAuthDiagnostics()
      return result
    },
    authorizeOAuth,
    close: async () => {
      reconnectAborted = true
      await Promise.all(connected.map((state) => state.client.close().catch(() => undefined)))
    }
  }
}

/**
 * Turn a startup connect failure into an actionable diagnostic message.
 * Authorization-required failures (a remote OAuth server with no usable token)
 * are expected during startup — the connect is non-interactive — so they get a
 * "use Authorize" hint instead of a raw transport error.
 */

export { McpToolStatusUnknownError } from './mcp-tool-runtime.js'

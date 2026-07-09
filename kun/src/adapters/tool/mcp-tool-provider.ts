import type { McpCapabilityConfig, McpServerConfig } from '../../contracts/capabilities.js'
import { redactSecretText } from '../../config/secret-redaction.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'
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
  type McpSearchCatalogRecord,
  type McpSearchCatalogState,
  type McpSearchRuntimeDiagnostic
} from './mcp-tool-search.js'

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
  connectedServers: number
  toolCount: number
  /**
   * Begin retrying servers that failed/timed out during the fast startup pass.
   * Call once, after the tool registries exist, passing a callback that adds a
   * late-connected server's provider to them. Without this, a server that loses
   * the startup race (e.g. an npx-based stdio server whose first cold start
   * exceeds the connect timeout on Windows) stays "error" forever until the
   * whole runtime restarts — exactly issue #342. Safe to call when there is
   * nothing to retry (it no-ops). The returned promise resolves once every
   * failed server has reconnected or exhausted its retries (used by tests).
   */
  startBackgroundReconnect: (register: (provider: CapabilityToolProvider) => void) => Promise<void>
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

type McpConnectionState = {
  serverId: string
  server: McpServerConfig
  client: McpClientLike
  clientFactory: (serverId: string, server: McpServerConfig) => Promise<McpClientLike>
  nowIso: () => string
  catalogFingerprint?: string
  catalogDrift?: boolean
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
}

export async function buildMcpToolProviders(
  config: McpCapabilityConfig | undefined,
  options: McpToolProviderOptions = {}
): Promise<McpToolProviderBuildResult> {
  const providers: CapabilityToolProvider[] = []
  const directProviders: CapabilityToolProvider[] = []
  const diagnostics: McpServerDiagnostic[] = []
  const connected: McpConnectionState[] = []
  const catalogState: McpSearchCatalogState = { records: [] }
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
      const attempt = (async () => {
        const client = await clientFactory(serverId, server)
        const state: McpConnectionState = {
          serverId,
          server,
          client,
          clientFactory,
          nowIso,
          status: 'connected',
          reconnectAttempts: 0,
          reconnectBackoffMs: DEFAULT_MCP_RECONNECT_BASE_DELAY_MS,
          lastConnectedAt: nowIso()
        }
        attachMcpClientLifecycle(state)
        const listed = await refreshMcpConnectionCatalog(state)
        return { state, listed }
      })()
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
    catalogState.records.push(...listed.map((tool) => createMcpSearchCatalogRecord(state, tool)))
    const tools = listed.map((tool) => createMcpLocalTool(state, tool))
    directProviders.push({
      id: `mcp:${outcome.serverId}`,
      kind: 'mcp',
      enabled: true,
      available: true,
      tools
    })
    diagnostics.push(syncMcpDiagnostic(state, 'connected', tools.length))
  }

  const connectedServers = diagnostics.filter((diagnostic) => diagnostic.status === 'connected').length
  const toolCount = catalogState.records.length
  const oauthDiagnostics = await listMcpOAuthDiagnostics(mcp, {
    storageDir: options.oauthStorageDir,
    encryptor: options.oauthEncryptor
  })
  catalogState.lastRefreshedAt = nowIso()
  catalogState.catalogFingerprint = catalogFingerprint(catalogState.records.map((record) => record.toolId))
  const searchActive = shouldUseMcpSearch(mcp.search, toolCount) && connectedServers > 0
  if (searchActive) {
    providers.push(createMcpSearchProvider({
      config: mcp.search,
      state: catalogState,
      refreshCatalog: async () => {
        try {
          const records: McpSearchCatalogRecord[] = []
          const previousFingerprint = catalogState.catalogFingerprint
          for (const state of connected) {
            const listed = await refreshMcpConnectionCatalog(state)
            records.push(...listed.map((tool) => createMcpSearchCatalogRecord(state, tool)))
          }
          catalogState.records = records
          catalogState.lastError = undefined
          catalogState.lastRefreshedAt = nowIso()
          catalogState.catalogFingerprint = catalogFingerprint(records.map((record) => record.toolId))
          catalogState.catalogDrift = Boolean(previousFingerprint && previousFingerprint !== catalogState.catalogFingerprint)
          return records
        } catch (error) {
          catalogState.lastError = redactSecretText(errorMessage(error))
          throw error
        }
      },
      isServerAvailable: canUseMcpServer
    }))
  } else {
    providers.push(...directProviders)
  }
  providers.push(createMcpFacadeProvider(connected))
  const advertisedToolCount = providers.reduce((total, provider) => total + provider.tools.length, 0)

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
  /** Captured from startBackgroundReconnect so authorizeOAuth can register live. */
  let liveRegister: ((provider: CapabilityToolProvider) => void) | null = null
  /** Per-serverId authorization single-flight: concurrent clicks share one run. */
  const authorizeInFlight = new Map<string, Promise<McpOAuthAuthorizeResult>>()

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
    const client = await clientFactory(serverId, server)
    const state: McpConnectionState = {
      serverId,
      server,
      client,
      clientFactory,
      nowIso,
      status: 'connected',
      reconnectAttempts: 0,
      reconnectBackoffMs: DEFAULT_MCP_RECONNECT_BASE_DELAY_MS,
      lastConnectedAt: nowIso()
    }
    attachMcpClientLifecycle(state)
    let listed: McpToolDescriptor[]
    try {
      listed = await refreshMcpConnectionCatalog(state)
    } catch (error) {
      await client.close().catch(() => undefined)
      throw error
    }
    connected.push(state)
    catalogState.records.push(...listed.map((tool) => createMcpSearchCatalogRecord(state, tool)))
    catalogState.catalogFingerprint = catalogFingerprint(catalogState.records.map((record) => record.toolId))
    catalogState.lastRefreshedAt = nowIso()
    const tools = listed.map((tool) => createMcpLocalTool(state, tool))
    if (!searchActive && liveRegister) {
      try {
        liveRegister({ id: `mcp:${serverId}`, kind: 'mcp', enabled: true, available: true, tools })
      } catch {
        // Registry collision must not break the authorize flow; the diagnostic
        // still flips to connected below.
      }
    }
    const diagnostic = syncMcpDiagnostic(state, 'connected', tools.length)
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
    search: mcpSearchDiagnostic({
      config: mcp.search,
      active: searchActive,
      indexedToolCount: toolCount,
      advertisedToolCount,
      state: catalogState
    }),
    connectedServers,
    toolCount,
    startBackgroundReconnect: (register) => {
      liveRegister = register
      if (reconnectStarted) return Promise.resolve()
      reconnectStarted = true
      if (failedServers.length === 0) return Promise.resolve()
      if (options.backgroundReconnect?.enabled === false) return Promise.resolve()
      return runMcpBackgroundReconnect({
        failedServers,
        clientFactory,
        nowIso,
        diagnostics,
        connected,
        catalogState,
        searchActive,
        register,
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
function startupConnectionError(error: unknown, server: McpServerConfig): string {
  if (isMcpAuthorizationRequiredError(error)) {
    return 'OAuth authorization required. Use the connector\'s Authorize action to sign in; the runtime will not prompt automatically during startup.'
  }
  return formatMcpConnectionError(error, server)
}

type FailedMcpServer = { serverId: string; server: McpServerConfig }

type McpBackgroundReconnectParams = {
  failedServers: FailedMcpServer[]
  clientFactory: (serverId: string, server: McpServerConfig) => Promise<McpClientLike>
  nowIso: () => string
  diagnostics: McpServerDiagnostic[]
  connected: McpConnectionState[]
  catalogState: McpSearchCatalogState
  searchActive: boolean
  register: (provider: CapabilityToolProvider) => void
  isAborted: () => boolean
  delay: (ms: number) => Promise<void>
  options?: McpBackgroundReconnectOptions
}

/**
 * Retry every server that lost the fast startup connect race. Each server is
 * retried independently with exponential backoff; the per-attempt connect is
 * bounded by the server's own `timeoutMs` (not the short startup race), so a
 * cold `npx` download finally gets the time it needs. On success the server's
 * tools are registered live and its diagnostic flips from "error" to
 * "connected" — no full runtime restart required (issue #342).
 */
async function runMcpBackgroundReconnect(params: McpBackgroundReconnectParams): Promise<void> {
  const maxAttempts = params.options?.maxAttempts ?? DEFAULT_MCP_RECONNECT_MAX_ATTEMPTS
  const baseDelayMs = params.options?.baseDelayMs ?? DEFAULT_MCP_RECONNECT_BASE_DELAY_MS
  const maxDelayMs = params.options?.maxDelayMs ?? DEFAULT_MCP_RECONNECT_MAX_DELAY_MS
  await Promise.all(
    params.failedServers.map((failed) =>
      reconnectFailedMcpServer(params, failed, maxAttempts, baseDelayMs, maxDelayMs)
    )
  )
}

async function reconnectFailedMcpServer(
  params: McpBackgroundReconnectParams,
  failed: FailedMcpServer,
  maxAttempts: number,
  baseDelayMs: number,
  maxDelayMs: number
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (params.isAborted()) return
    await params.delay(Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)))
    if (params.isAborted()) return
    try {
      const client = await params.clientFactory(failed.serverId, failed.server)
      const state: McpConnectionState = {
        serverId: failed.serverId,
        server: failed.server,
        client,
        clientFactory: params.clientFactory,
        nowIso: params.nowIso,
        status: 'connected',
        reconnectAttempts: 0,
        reconnectBackoffMs: DEFAULT_MCP_RECONNECT_BASE_DELAY_MS,
        lastConnectedAt: params.nowIso()
      }
      attachMcpClientLifecycle(state)
      const listed = await refreshMcpConnectionCatalog(state)
      if (params.isAborted()) {
        await client.close().catch(() => undefined)
        return
      }
      registerLateMcpConnection(params, state, listed)
      return
    } catch {
      // Leave the diagnostic as "error" and try again until attempts run out.
    }
  }
}

function registerLateMcpConnection(
  params: McpBackgroundReconnectParams,
  state: McpConnectionState,
  listed: McpToolDescriptor[]
): void {
  params.connected.push(state)
  params.catalogState.records.push(...listed.map((tool) => createMcpSearchCatalogRecord(state, tool)))
  const tools = listed.map((tool) => createMcpLocalTool(state, tool))
  // In search mode the model reaches MCP tools through the search provider
  // (which re-lists `connected`), so advertising them directly would double up.
  // In direct mode, register the provider so its tools become callable.
  if (!params.searchActive) {
    try {
      params.register({
        id: `mcp:${state.serverId}`,
        kind: 'mcp',
        enabled: true,
        available: true,
        tools
      })
    } catch {
      // A registry collision must not crash the loop; the diagnostic still
      // flips to connected below so the UI stops showing the server as failed.
    }
  }
  const diagnostic = syncMcpDiagnostic(state, 'connected', tools.length)
  const index = params.diagnostics.findIndex((entry) => entry.id === state.serverId)
  if (index >= 0) params.diagnostics[index] = diagnostic
  else params.diagnostics.push(diagnostic)
}

function defaultMcpReconnectDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    if (timer && typeof timer === 'object' && 'unref' in timer) {
      ;(timer as { unref: () => void }).unref()
    }
  })
}

function createMcpLocalTool(
  state: McpConnectionState,
  descriptor: McpToolDescriptor
): LocalTool {
  return LocalToolHost.defineTool({
    name: normalizeMcpToolName(state.serverId, descriptor.name),
    description: descriptor.description ?? `MCP tool ${descriptor.name} from ${state.serverId}`,
    inputSchema: descriptor.inputSchema ?? { type: 'object' },
    policy: policyFromAnnotations(descriptor.annotations),
    shouldAdvertise: (context: ToolHostContext) => canUseMcpServer(state.server, context.workspace),
    execute: async (args, context) => {
      if (!isMcpServerVisible(state.server, context.workspace)) {
        return {
          output: { error: `MCP server ${state.serverId} is not enabled for this workspace` },
          isError: true
        }
      }
      if (!isMcpServerTrusted(state.server, context.workspace)) {
        return {
          output: { error: `MCP server ${state.serverId} is not trusted for this workspace` },
          isError: true
        }
      }
      const result = await callMcpToolWithReconnect(
        state,
        { name: descriptor.name, arguments: args },
        context.abortSignal,
        state.server.timeoutMs,
        isMcpReplaySafe(descriptor.annotations)
      )
      return {
        output: {
          serverId: state.serverId,
          toolName: descriptor.name,
          result
        },
        isError: typeof result === 'object' && result !== null && (result as { isError?: boolean }).isError === true
      }
    }
  })
}

async function listAllMcpTools(client: McpClientLike, timeout: number): Promise<McpToolDescriptor[]> {
  const tools: McpToolDescriptor[] = []
  let cursor: string | undefined
  do {
    const listed = await client.listTools({ cursor, timeout })
    tools.push(...listed.tools)
    cursor = listed.nextCursor
  } while (cursor)
  return tools
}

function createMcpSearchCatalogRecord(
  state: McpConnectionState,
  descriptor: McpToolDescriptor
): McpSearchCatalogRecord {
  return {
    toolId: `${state.serverId}/${descriptor.name}`,
    serverId: state.serverId,
    server: state.server,
    client: {
      callTool: (input, options) =>
        callMcpToolWithReconnect(state, input, options?.signal, options?.timeout, isMcpReplaySafe(descriptor.annotations))
    },
    descriptor,
    normalizedName: normalizeMcpToolName(state.serverId, descriptor.name),
    policy: policyFromAnnotations(descriptor.annotations)
  }
}

async function refreshMcpConnectionCatalog(state: McpConnectionState): Promise<McpToolDescriptor[]> {
  const listed = await listAllMcpTools(state.client, state.server.timeoutMs)
  const nextFingerprint = catalogFingerprint(listed.map((tool) => tool.name))
  state.catalogDrift = Boolean(state.catalogFingerprint && state.catalogFingerprint !== nextFingerprint)
  state.catalogFingerprint = nextFingerprint
  state.lastError = undefined
  syncMcpDiagnostic(state, state.status, listed.length)
  return listed
}

async function callMcpToolWithReconnect(
  state: McpConnectionState,
  input: { name: string; arguments: Record<string, unknown> },
  signal: AbortSignal | undefined,
  timeout = state.server.timeoutMs,
  /**
   * Whether this specific tool is safe to REPLAY after a mid-call transport
   * drop. Only tools explicitly marked read-only or idempotent are safe; a
   * non-idempotent tool may have already executed on the server before the
   * transport failed, so replaying it could duplicate its side effects.
   */
  replaySafe = false
): Promise<unknown> {
  // Track whether the request actually reached `callTool`. A failure while
  // (re)connecting BEFORE the request was sent means the tool definitely did
  // not run, so retrying it on the fresh connection is always safe.
  let sentToServer = false
  try {
    await ensureMcpConnectionForCall(state, signal)
    sentToServer = true
    return await state.client.callTool(input, { signal, timeout })
  } catch (error) {
    if (signal?.aborted) throw error
    // Deterministic server-side failures (validation errors, bad
    // arguments) come back identically on a fresh connection; tearing
    // down a healthy session for them just loses server state. Only
    // transport-looking failures earn a reconnect + retry.
    if (!looksLikeMcpTransportError(error)) {
      state.lastError = redactSecretText(errorMessage(error))
      syncMcpDiagnostic(state)
      throw error
    }
    markMcpConnectionError(state, error)
    if (!sentToServer || replaySafe) {
      // Either the request never left (safe) or the tool is read-only/idempotent
      // (safe to repeat) — replay it on the reconnected client.
      const client = await reconnectMcpConnection(state, signal)
      return client.callTool(input, { signal, timeout })
    }
    // A non-idempotent tool dropped mid-flight: it may already have run on the
    // server. Preserve that primary fact even when reconnect also fails: future
    // calls can reconnect in the background, but this call must always surface
    // status-unknown rather than a secondary transport error.
    void reconnectMcpConnection(state, undefined).catch(() => undefined)
    throw new McpToolStatusUnknownError(state.serverId, input.name, error)
  }
}

/**
 * MCP annotations that make a tool safe to replay after a mid-call transport
 * drop. Per the MCP spec the hints default to the UNSAFE side (readOnlyHint
 * false, idempotentHint false, destructiveHint effectively true), so we only
 * treat a tool as replay-safe when it is EXPLICITLY read-only or idempotent.
 * Absent annotations → not safe → no auto-replay.
 */
function isMcpReplaySafe(annotations: McpToolDescriptor['annotations']): boolean {
  if (!annotations) return false
  if (annotations.readOnlyHint === true && annotations.destructiveHint !== true) return true
  if (annotations.idempotentHint === true && annotations.destructiveHint !== true) return true
  return false
}

/**
 * Thrown when a non-idempotent MCP tool's transport dropped mid-call, so its
 * server-side outcome is unknown and it was NOT auto-replayed.
 */
export class McpToolStatusUnknownError extends Error {
  readonly statusUnknown = true
  constructor(
    readonly serverId: string,
    readonly toolName: string,
    readonly causeError: unknown
  ) {
    super(
      `MCP tool "${toolName}" on server "${serverId}" lost its connection mid-call; ` +
        'its result is unknown and it was not retried automatically because it is not marked read-only or idempotent. ' +
        'Verify whether it took effect before re-running it.'
    )
    this.name = 'McpToolStatusUnknownError'
  }
}

function looksLikeMcpTransportError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase()
  return (
    message.includes('connect') ||
    message.includes('connection') ||
    message.includes('transport') ||
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('epipe') ||
    message.includes('broken pipe') ||
    message.includes('socket') ||
    message.includes('stream closed') ||
    message.includes('fetch failed') ||
    message.includes('network')
  )
}

async function raceStartupTimeout<T extends { state: McpConnectionState }>(
  attempt: Promise<T>,
  timeoutMs: number,
  serverId: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      attempt,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`MCP server "${serverId}" did not connect within ${timeoutMs}ms during startup`)),
          timeoutMs
        )
      })
    ])
  } catch (error) {
    // A late successful connection would otherwise leak the child process.
    void attempt.then((result) => result.state.client.close()).catch(() => undefined)
    throw error
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function ensureMcpConnectionForCall(
  state: McpConnectionState,
  signal: AbortSignal | undefined
): Promise<void> {
  if (state.status === 'connected') return
  await reconnectMcpConnection(state, signal)
}

async function reconnectMcpConnection(
  state: McpConnectionState,
  signal?: AbortSignal
): Promise<McpClientLike> {
  if (state.reconnectPromise) return state.reconnectPromise
  if (!canAttemptMcpReconnect(state)) {
    throw new Error(mcpReconnectCooldownMessage(state))
  }
  state.status = 'reconnecting'
  state.reconnectAttempts += 1
  state.lastReconnectAt = state.nowIso()
  syncMcpDiagnostic(state, 'reconnecting')
  state.reconnectPromise = reconnectMcpConnectionOnce(state, signal)
    .catch((error) => {
      markMcpReconnectFailed(state, error)
      throw error
    })
    .finally(() => {
      state.reconnectPromise = undefined
    })
  return state.reconnectPromise
}

async function reconnectMcpConnectionOnce(
  state: McpConnectionState,
  signal?: AbortSignal
): Promise<McpClientLike> {
  if (signal?.aborted) throw new Error('MCP reconnect aborted')
  await closeMcpClient(state)
  if (signal?.aborted) throw new Error('MCP reconnect aborted')
  const client = await state.clientFactory(state.serverId, state.server)
  state.client = client
  state.status = 'connected'
  state.lastConnectedAt = state.nowIso()
  state.lastError = undefined
  state.nextReconnectAt = undefined
  state.reconnectBackoffMs = DEFAULT_MCP_RECONNECT_BASE_DELAY_MS
  attachMcpClientLifecycle(state)
  await refreshMcpConnectionCatalog(state)
  syncMcpDiagnostic(state, 'connected')
  return client
}

async function closeMcpClient(state: McpConnectionState): Promise<void> {
  state.intentionallyClosing = true
  try {
    await state.client.close().catch(() => undefined)
  } finally {
    state.intentionallyClosing = false
  }
}

function attachMcpClientLifecycle(state: McpConnectionState): void {
  state.client.setLifecycleHandlers?.({
    onError: (error) => {
      if (looksLikeMcpTransportError(error)) {
        markMcpConnectionError(state, error)
      } else {
        state.lastError = redactSecretText(errorMessage(error))
        syncMcpDiagnostic(state)
      }
    },
    onClose: () => {
      if (state.intentionallyClosing) return
      markMcpConnectionError(state, new Error('MCP transport closed'))
    }
  })
}

function markMcpConnectionError(state: McpConnectionState, error: unknown): void {
  if (state.intentionallyClosing) return
  state.status = 'error'
  state.lastError = redactSecretText(errorMessage(error))
  state.lastDisconnectedAt = state.nowIso()
  syncMcpDiagnostic(state, 'error')
}

function markMcpReconnectFailed(state: McpConnectionState, error: unknown): void {
  state.status = 'error'
  state.lastError = redactSecretText(errorMessage(error))
  state.lastDisconnectedAt = state.nowIso()
  const nextDelay = state.reconnectBackoffMs
  state.reconnectBackoffMs = Math.min(DEFAULT_MCP_RECONNECT_MAX_DELAY_MS, nextDelay * 2)
  state.nextReconnectAt = new Date(Date.now() + nextDelay).toISOString()
  syncMcpDiagnostic(state, 'error')
}

function canAttemptMcpReconnect(state: McpConnectionState): boolean {
  if (!state.nextReconnectAt) return true
  return Date.now() >= Date.parse(state.nextReconnectAt)
}

function mcpReconnectCooldownMessage(state: McpConnectionState): string {
  return state.nextReconnectAt
    ? `MCP server ${state.serverId} is offline; reconnect is cooling down until ${state.nextReconnectAt}. Last error: ${state.lastError ?? 'unknown error'}`
    : `MCP server ${state.serverId} is offline. Last error: ${state.lastError ?? 'unknown error'}`
}

function shouldUseMcpSearch(config: NonNullable<McpCapabilityConfig['search']>, toolCount: number): boolean {
  if (!config.enabled) return false
  if (config.mode === 'direct') return false
  if (config.mode === 'search') return true
  return toolCount >= config.autoThresholdToolCount
}

function policyFromAnnotations(annotation: McpToolDescriptor['annotations']): LocalTool['policy'] {
  if (annotation?.readOnlyHint && !annotation.openWorldHint && !annotation.destructiveHint) return 'auto'
  if (annotation?.destructiveHint) return 'on-request'
  if (annotation?.openWorldHint) return 'untrusted'
  return 'on-request'
}

function serverDiagnostic(
  state: { serverId: string; server: McpServerConfig; catalogFingerprint?: string; catalogDrift?: boolean; lastConnectedAt?: string },
  status: McpServerDiagnostic['status'],
  toolCount: number,
  lastError?: string
): McpServerDiagnostic {
  return {
    id: state.serverId,
    enabled: state.server.enabled,
    transport: state.server.transport,
    trustScope: state.server.trustScope,
    available: status === 'connected',
    status,
    toolCount,
    ...(state.catalogFingerprint ? { catalogFingerprint: state.catalogFingerprint } : {}),
    ...(state.catalogDrift !== undefined ? { catalogDrift: state.catalogDrift } : {}),
    ...(state.lastConnectedAt ? { lastConnectedAt: state.lastConnectedAt } : {}),
    ...(lastError ? { lastError: redactSecretText(lastError) } : {})
  }
}

function syncMcpDiagnostic(
  state: McpConnectionState,
  status: McpServerDiagnostic['status'] = state.status,
  toolCount = state.diagnostic?.toolCount ?? 0
): McpServerDiagnostic {
  const diagnostic: McpServerDiagnostic = {
    id: state.serverId,
    enabled: state.server.enabled,
    transport: state.server.transport,
    trustScope: state.server.trustScope,
    available: status === 'connected',
    status,
    toolCount,
    ...(state.catalogFingerprint ? { catalogFingerprint: state.catalogFingerprint } : {}),
    ...(state.catalogDrift !== undefined ? { catalogDrift: state.catalogDrift } : {}),
    ...(state.lastConnectedAt ? { lastConnectedAt: state.lastConnectedAt } : {}),
    ...(state.lastDisconnectedAt ? { lastDisconnectedAt: state.lastDisconnectedAt } : {}),
    ...(state.lastReconnectAt ? { lastReconnectAt: state.lastReconnectAt } : {}),
    ...(state.nextReconnectAt ? { nextReconnectAt: state.nextReconnectAt } : {}),
    ...(state.reconnectAttempts > 0 ? { reconnectAttempts: state.reconnectAttempts } : {}),
    ...(state.lastError ? { lastError: redactSecretText(state.lastError) } : {})
  }
  // The diagnostics array stores this exact object reference; mutate it in
  // place so live status changes (reconnecting/error/connected) are visible to
  // anyone holding the array without re-indexing.
  if (!state.diagnostic) {
    state.diagnostic = diagnostic
    return diagnostic
  }
  for (const key of Object.keys(state.diagnostic) as Array<keyof McpServerDiagnostic>) {
    delete (state.diagnostic as Record<string, unknown>)[key]
  }
  Object.assign(state.diagnostic, diagnostic)
  return state.diagnostic
}

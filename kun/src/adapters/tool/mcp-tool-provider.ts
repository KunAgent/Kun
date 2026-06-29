import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createHash } from 'node:crypto'
import { posix, win32 } from 'node:path'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type {
  McpCapabilityConfig,
  McpServerConfig
} from '../../contracts/capabilities.js'
import { redactSecretText } from '../../config/secret-redaction.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'
import {
  createMcpSearchProvider,
  mcpSearchDiagnostic,
  type McpSearchCatalogRecord,
  type McpSearchCatalogState,
  type McpSearchRuntimeDiagnostic
} from './mcp-tool-search.js'

export type McpToolDescriptor = {
  name: string
  title?: string
  description?: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: {
    title?: string
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
  execution?: unknown
  icons?: unknown
  _meta?: Record<string, unknown>
}

export type McpClientLike = {
  listTools(options?: {
    cursor?: string
    signal?: AbortSignal
    timeout?: number
  }): Promise<{ tools: McpToolDescriptor[]; nextCursor?: string }>
  callTool(
    input: { name: string; arguments: Record<string, unknown> },
    options?: { signal?: AbortSignal; timeout?: number }
  ): Promise<unknown>
  close(): Promise<void>
}

export type McpServerDiagnostic = {
  id: string
  enabled: boolean
  transport: McpServerConfig['transport']
  trustScope: McpServerConfig['trustScope']
  available: boolean
  status: 'disabled' | 'connected' | 'error'
  toolCount: number
  catalogFingerprint?: string
  catalogDrift?: boolean
  lastConnectedAt?: string
  lastError?: string
}

export type McpToolProviderBuildResult = {
  providers: CapabilityToolProvider[]
  diagnostics: McpServerDiagnostic[]
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
  close: () => Promise<void>
}

export type McpToolProviderOptions = {
  clientFactory?: (serverId: string, server: McpServerConfig) => Promise<McpClientLike>
  nowIso?: () => string
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

export type McpStdioEnvironmentOptions = {
  platform?: NodeJS.Platform
  baseEnv?: NodeJS.ProcessEnv
}

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
  const clientFactory = options.clientFactory ?? createSdkMcpClient
  if (!mcp?.enabled) {
    return {
      providers,
      diagnostics,
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
          lastConnectedAt: nowIso()
        }
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
      diagnostics.push(
        serverDiagnostic(
          { serverId: outcome.serverId, server: outcome.server },
          'error',
          0,
          formatMcpConnectionError(outcome.error, outcome.server)
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
    diagnostics.push(serverDiagnostic(state, 'connected', tools.length))
  }

  const connectedServers = diagnostics.filter((diagnostic) => diagnostic.status === 'connected').length
  const toolCount = catalogState.records.length
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
  const advertisedToolCount = providers.reduce((total, provider) => total + provider.tools.length, 0)

  const failedServers = outcomes.flatMap((outcome) =>
    outcome.status === 'error' ? [{ serverId: outcome.serverId, server: outcome.server }] : []
  )
  let reconnectAborted = false
  let reconnectStarted = false

  return {
    providers,
    diagnostics,
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
    close: async () => {
      reconnectAborted = true
      await Promise.all(connected.map((state) => state.client.close().catch(() => undefined)))
    }
  }
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
        lastConnectedAt: params.nowIso()
      }
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
  const diagnostic = serverDiagnostic(state, 'connected', tools.length)
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

export function normalizeMcpToolName(serverId: string, toolName: string): string {
  return `mcp_${slug(serverId)}_${slug(toolName)}`
}

export function isMcpServerTrusted(server: McpServerConfig, workspace: string): boolean {
  if (server.trustScope === 'user') return true
  return workspaceMatchesRoots(workspace, server.trustedWorkspaceRoots)
}

export function isMcpServerVisible(server: McpServerConfig, workspace: string): boolean {
  if (server.workspaceRoots.length === 0) return true
  return workspaceMatchesRoots(workspace, server.workspaceRoots)
}

export function canUseMcpServer(server: McpServerConfig, workspace: string): boolean {
  return isMcpServerVisible(server, workspace) && isMcpServerTrusted(server, workspace)
}

function workspaceMatchesRoots(workspace: string, roots: readonly string[]): boolean {
  const normalizedWorkspace = normalizePathForTrust(workspace)
  return roots.some((root) => {
    const normalizedRoot = normalizePathForTrust(root)
    return normalizedWorkspace === normalizedRoot || normalizedWorkspace.startsWith(`${normalizedRoot}/`)
  })
}

async function createSdkMcpClient(serverId: string, server: McpServerConfig): Promise<McpClientLike> {
  const client = new Client({ name: `kun-${serverId}`, version: '0.1.0' })
  // Observe transport-level failures explicitly. The SDK routes a dropped SSE
  // stream and exhausted background reconnects to `onerror`; with no handler
  // they are silently swallowed, which hides real outages from the logs and (on
  // some SDK/runtime versions) lets the rejection escape as unhandled. Handling
  // it here keeps a streamable-http disconnect from destabilizing the runtime
  // (#639) — the per-call reconnect in callMcpToolWithReconnect still recovers
  // the connection on the next tool use.
  client.onerror = (error) => {
    process.stderr.write(`kun mcp[${serverId}]: transport error: ${redactSecretText(errorMessage(error))}\n`)
  }
  const transport = createTransport(server)
  await client.connect(transport, { timeout: server.timeoutMs })
  return {
    listTools: (options) => {
      const params = options?.cursor ? { cursor: options.cursor } : undefined
      return client.listTools(params, {
        signal: options?.signal,
        timeout: options?.timeout
      })
    },
    callTool: (input, options) => client.callTool(input, undefined, options),
    close: () => client.close()
  }
}

function createTransport(server: McpServerConfig): Transport {
  switch (server.transport) {
    case 'stdio': {
      const cwd = resolveMcpServerCwd(server)
      return new StdioClientTransport({
        command: server.command ?? '',
        args: server.args,
        env: buildMcpStdioEnvironment(server.env),
        ...(cwd ? { cwd } : {}),
        stderr: 'pipe'
      })
    }
    case 'streamable-http':
      return new StreamableHTTPClientTransport(new URL(server.url ?? ''), {
        requestInit: { headers: server.headers }
      })
    case 'sse':
      return new SSEClientTransport(new URL(server.url ?? ''), {
        requestInit: { headers: server.headers },
        eventSourceInit: { fetch: fetchWithHeaders(server.headers) }
      })
  }
}

export function resolveMcpServerCwd(server: McpServerConfig): string | undefined {
  if (server.transport !== 'stdio') return undefined
  const configured = server.cwd?.trim()
  if (configured) return configured
  if (server.trustScope !== 'workspace') return undefined
  return server.trustedWorkspaceRoots.map((root) => root.trim()).find(Boolean)
}

function fetchWithHeaders(headers: Record<string, string>): typeof fetch {
  return (input, init) => {
    const mergedHeaders = new Headers(init?.headers)
    for (const [key, value] of Object.entries(headers)) {
      mergedHeaders.set(key, value)
    }
    return fetch(input, { ...init, headers: mergedHeaders })
  }
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
        context.abortSignal
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
        callMcpToolWithReconnect(state, input, options?.signal, options?.timeout)
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
  return listed
}

async function callMcpToolWithReconnect(
  state: McpConnectionState,
  input: { name: string; arguments: Record<string, unknown> },
  signal: AbortSignal | undefined,
  timeout = state.server.timeoutMs
): Promise<unknown> {
  try {
    return await state.client.callTool(input, { signal, timeout })
  } catch (error) {
    state.lastError = redactSecretText(errorMessage(error))
    if (signal?.aborted) throw error
    // Deterministic server-side failures (validation errors, bad
    // arguments) come back identically on a fresh connection; tearing
    // down a healthy session for them just loses server state. Only
    // transport-looking failures earn a reconnect + retry.
    if (!looksLikeMcpTransportError(error)) throw error
    const client = await reconnectMcpConnection(state)
    return client.callTool(input, { signal, timeout })
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

async function reconnectMcpConnection(state: McpConnectionState): Promise<McpClientLike> {
  await state.client.close().catch(() => undefined)
  const client = await state.clientFactory(state.serverId, state.server)
  state.client = client
  state.lastConnectedAt = state.nowIso()
  state.lastError = undefined
  return client
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

function catalogFingerprint(values: readonly string[]): string {
  return createHash('sha256')
    .update(JSON.stringify([...values].sort()))
    .digest('hex')
    .slice(0, 16)
}

function slug(value: string): string {
  let out = ''
  for (const char of value.trim().toLowerCase()) {
    if (isSlugChar(char)) {
      out += char
    } else if (out && out[out.length - 1] !== '_') {
      out += '_'
    }
  }
  return trimBoundaryUnderscores(out) || 'tool'
}

function normalizePathForTrust(value: string): string {
  return trimTrailingSlashes(value.replaceAll('\\', '/'))
}

function isSlugChar(char: string): boolean {
  const code = char.charCodeAt(0)
  return char === '_' || (code >= 48 && code <= 57) || (code >= 97 && code <= 122)
}

function trimBoundaryUnderscores(value: string): string {
  let start = 0
  let end = value.length
  while (start < end && value[start] === '_') start += 1
  while (end > start && value[end - 1] === '_') end -= 1
  return value.slice(start, end)
}

function trimTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1
  return end === value.length ? value : value.slice(0, end)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function buildMcpStdioEnvironment(
  serverEnv: Record<string, string> = {},
  options: McpStdioEnvironmentOptions = {}
): Record<string, string> {
  const platform = options.platform ?? process.platform
  const baseEnv = options.baseEnv ?? process.env
  const pathKey = findPathKey(serverEnv) ?? findPathKey(baseEnv) ?? 'PATH'
  const configuredPath = readEnvPath(serverEnv)
  const inheritedPath = readEnvPath(baseEnv)
  const pathValue = mergePathEntries(
    [configuredPath ?? inheritedPath ?? '', ...commonMcpCommandPathEntries(platform, baseEnv)],
    pathDelimiter(platform)
  )
  return {
    ...serverEnv,
    ...(pathValue ? { [pathKey]: pathValue } : {})
  }
}

export function formatMcpConnectionError(error: unknown, server: McpServerConfig): string {
  const message = errorMessage(error)
  if (server.transport !== 'stdio' || !isMissingExecutableError(error, message)) return message
  const command = missingExecutableCommand(error) ?? server.command ?? 'configured command'
  const hint = isBareCommand(command)
    ? missingBareCommandHint(command)
    : `Could not find MCP command "${command}". Check that the configured executable path exists.`
  return `${message}. ${hint}`
}

function commonMcpCommandPathEntries(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv
): string[] {
  if (platform === 'darwin') {
    return [
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/opt/local/bin',
      homePath(env, '.volta/bin'),
      homePath(env, '.local/bin'),
      homePath(env, '.bun/bin')
    ].filter((entry): entry is string => Boolean(entry))
  }
  if (platform === 'linux') {
    return [
      '/home/linuxbrew/.linuxbrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      homePath(env, '.volta/bin'),
      homePath(env, '.local/bin'),
      homePath(env, '.bun/bin')
    ].filter((entry): entry is string => Boolean(entry))
  }
  if (platform === 'win32') {
    return [
      env.APPDATA ? win32.join(env.APPDATA, 'npm') : '',
      env.ProgramFiles ? win32.join(env.ProgramFiles, 'nodejs') : '',
      env['ProgramFiles(x86)'] ? win32.join(env['ProgramFiles(x86)'], 'nodejs') : ''
    ].filter((entry): entry is string => Boolean(entry))
  }
  return []
}

function findPathKey(env: Record<string, string | undefined>): string | undefined {
  return Object.keys(env).find((key) => key.toLowerCase() === 'path')
}

function readEnvPath(env: Record<string, string | undefined>): string | undefined {
  const key = findPathKey(env)
  const value = key ? env[key] : undefined
  return value && value.trim() ? value : undefined
}

function mergePathEntries(values: string[], delimiter: string): string {
  const seen = new Set<string>()
  const entries: string[] = []
  for (const value of values) {
    for (const entry of value.split(delimiter)) {
      const trimmed = entry.trim()
      if (!trimmed) continue
      const key = trimmed.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      entries.push(trimmed)
    }
  }
  return entries.join(delimiter)
}

function pathDelimiter(platform: NodeJS.Platform): string {
  return platform === 'win32' ? ';' : ':'
}

function homePath(env: NodeJS.ProcessEnv, relativePath: string): string {
  return env.HOME ? posix.join(env.HOME, relativePath) : ''
}

function isMissingExecutableError(error: unknown, message: string): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : ''
  return code === 'ENOENT' || /\bspawn\s+\S+\s+ENOENT\b/i.test(message)
}

function missingExecutableCommand(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const path = (error as { path?: unknown }).path
  return typeof path === 'string' && path.trim() ? path.trim() : undefined
}

function isBareCommand(command: string): boolean {
  return Boolean(command.trim()) && !command.includes('/') && !command.includes('\\')
}

function missingBareCommandHint(command: string): string {
  if (process.platform === 'win32') {
    return `Could not find "${command}" on PATH while starting the MCP server. Make sure Node/npm is installed and available to Kun, or set the MCP command to an absolute path.`
  }
  if (process.platform === 'darwin') {
    return `Could not find "${command}" on PATH while starting the MCP server. If Kun was launched from Finder or the desktop, make sure Node/npm is installed and available to GUI apps, or set the MCP command to an absolute path such as /opt/homebrew/bin/${command}.`
  }
  return `Could not find "${command}" on PATH while starting the MCP server. Make sure Node/npm is installed and available to Kun, or set the MCP command to an absolute path such as /usr/local/bin/${command}.`
}

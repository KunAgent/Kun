import type { McpCapabilityConfig, McpServerConfig } from '../../contracts/capabilities.js'
import { assertBuiltinGitHubMcpCallAllowed } from '../../contracts/builtin-mcp.js'
import { redactSecretText } from '../../config/secret-redaction.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'
import { catalogFingerprint, canUseMcpServer, isMcpServerTrusted, isMcpServerVisible, normalizeMcpToolName } from './mcp-naming.js'
import { isMcpAuthorizationRequiredError } from './mcp-transport.js'
import { errorMessage, formatMcpConnectionError } from './mcp-stdio-environment.js'
import { projectMcpSchemaForModel } from './mcp-schema-projection.js'
import type { McpClientLike, McpServerDiagnostic, McpToolDescriptor } from './mcp-types.js'
import type { McpSearchCatalogRecord } from './mcp-tool-search.js'
import type { McpBackgroundReconnectOptions, McpConnectionState } from './mcp-tool-provider.js'

const DEFAULT_MCP_RECONNECT_MAX_ATTEMPTS = 5
const DEFAULT_MCP_RECONNECT_BASE_DELAY_MS = 4_000
const DEFAULT_MCP_RECONNECT_MAX_DELAY_MS = 30_000

export function startupConnectionError(error: unknown, server: McpServerConfig): string {
  if (isMcpAuthorizationRequiredError(error)) {
    if (error.userMessage) return redactSecretText(error.userMessage)
    return 'OAuth authorization required. Use the connector\'s Authorize action to sign in; the runtime will not prompt automatically during startup.'
  }
  return formatMcpConnectionError(error, server)
}

type FailedMcpServer = { serverId: string; server: McpServerConfig }

type McpBackgroundReconnectParams = {
  failedServers: FailedMcpServer[]
  clientFactory: (serverId: string, server: McpServerConfig) => Promise<McpClientLike>
  nowIso: () => string
  onServerConnected: (state: McpConnectionState, listed: McpToolDescriptor[]) => void
  isAborted: () => boolean
  delay: (ms: number) => Promise<void>
  options?: McpBackgroundReconnectOptions
}

/**
 * Retry every server that lost the fast startup connect race. Each server is
 * retried independently with exponential backoff; the per-attempt connect is
 * bounded by the server's own `timeoutMs` (not the short startup race), so a
 * cold `npx` download finally gets the time it needs. On success the server's
 * tools are added to the MCP gateway catalog and its diagnostic flips from "error" to
 * "connected" — no full runtime restart required (issue #342).
 */
export async function runMcpBackgroundReconnect(params: McpBackgroundReconnectParams): Promise<void> {
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
    let candidate: McpConnectOutcome | undefined
    try {
      candidate = await connectAndLoadCatalog(
        failed.serverId,
        failed.server,
        params.clientFactory,
        params.nowIso
      )
      if (params.isAborted()) {
        await candidate.state.client.close().catch(() => undefined)
        return
      }
      params.onServerConnected(candidate.state, candidate.listed)
      return
    } catch {
      // Ownership transfers to the caller only after onServerConnected
      // succeeds. A failed initialize, abort check, or takeover callback must
      // not leave a stdio subprocess behind for the next retry.
      if (candidate) await candidate.state.client.close().catch(() => undefined)
      // Leave the diagnostic as "error" and try again until attempts run out.
    }
  }
}

export function defaultMcpReconnectDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    if (timer && typeof timer === 'object' && 'unref' in timer) {
      ;(timer as { unref: () => void }).unref()
    }
  })
}

export function createMcpLocalTool(
  state: McpConnectionState,
  descriptor: McpToolDescriptor
): LocalTool {
  return LocalToolHost.defineTool({
    name: normalizeMcpToolName(state.serverId, descriptor.name),
    description: descriptor.description ?? `MCP tool ${descriptor.name} from ${state.serverId}`,
    inputSchema: projectMcpSchemaForModel(descriptor.inputSchema),
    // An MCP server is a separate executable or remote authority. Its own
    // annotations are unauthenticated metadata, so it must not bypass the
    // host command sandbox by masquerading as a harmless tool call.
    toolKind: 'command_execution',
    ...(state.server.planModeReadOnlyTools?.includes(descriptor.name)
      ? { sideEffect: 'read-only' as const }
      : {}),
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
      assertBuiltinGitHubMcpCallAllowed(state.server, descriptor.name, args)
      const result = await callMcpToolWithReconnect(
        state,
        { name: descriptor.name, arguments: args },
        context,
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

export async function listAllMcpTools(
  client: McpClientLike,
  timeout: number,
  cacheMode: 'use' | 'refresh' | 'bypass' = 'use'
): Promise<McpToolDescriptor[]> {
  const tools: McpToolDescriptor[] = []
  const seenCursors = new Set<string>()
  let cursor: string | undefined
  do {
    const listed = await client.listTools({ cursor, timeout, cacheMode })
    tools.push(...listed.tools)
    cursor = listed.nextCursor
    if (cursor !== undefined) {
      if (seenCursors.has(cursor)) throw new Error('MCP tools/list returned a repeated pagination cursor')
      seenCursors.add(cursor)
    }
  } while (cursor !== undefined)
  return tools
}

export function createMcpSearchCatalogRecord(
  state: McpConnectionState,
  descriptor: McpToolDescriptor
): McpSearchCatalogRecord {
  return {
    toolId: normalizeMcpToolName(state.serverId, descriptor.name),
    serverId: state.serverId,
    server: state.server,
    client: {
      callTool: (input, options) => {
        assertBuiltinGitHubMcpCallAllowed(state.server, input.name, input.arguments)
        return callMcpToolWithReconnect(state, input, options?.context, options?.timeout, isMcpReplaySafe(descriptor.annotations))
      }
    },
    descriptor,
    normalizedName: normalizeMcpToolName(state.serverId, descriptor.name),
    policy: policyFromAnnotations(descriptor.annotations)
  }
}

export async function refreshMcpConnectionCatalog(
  state: McpConnectionState,
  cacheMode: 'use' | 'refresh' | 'bypass' = 'use'
): Promise<McpToolDescriptor[]> {
  const listed = await listAllMcpTools(state.client, state.server.timeoutMs, cacheMode)
  state.toolNames = listed.map((tool) => tool.name).sort((a, b) => a.localeCompare(b))
  const nextFingerprint = catalogFingerprint(listed.map((tool) => tool.name))
  state.catalogDrift = Boolean(state.catalogFingerprint && state.catalogFingerprint !== nextFingerprint)
  state.catalogFingerprint = nextFingerprint
  state.lastError = undefined
  syncMcpDiagnostic(state, state.status, listed.length)
  return listed
}

export type McpConnectOutcome = {
  state: McpConnectionState
  listed: McpToolDescriptor[]
}

/**
 * Create an MCP client, bind its lifecycle, and load its tool catalog as one
 * ownership unit. The client stays locally owned until this call resolves;
 * any failure after `clientFactory()` succeeds (lifecycle setup, catalog
 * refresh, or paginated `listTools`) closes the client — and therefore its
 * stdio transport / child process — before rethrowing, so a failed startup
 * attempt, background retry, or live reconnect never leaks a subprocess.
 *
 * When `existingState` is provided (runtime reconnect), the committed state is
 * updated in place with the fresh client instead of building a new one; the
 * caller's reconnect state machine (cooldown / error) is left untouched.
 */
export async function connectAndLoadCatalog(
  serverId: string,
  server: McpServerConfig,
  clientFactory: (serverId: string, server: McpServerConfig) => Promise<McpClientLike>,
  nowIso: () => string,
  existingState?: McpConnectionState
): Promise<McpConnectOutcome> {
  const client = await clientFactory(serverId, server)
  const state: McpConnectionState =
    existingState ??
    ({
      serverId,
      server,
      client,
      clientFactory,
      nowIso,
      status: 'connected',
      reconnectAttempts: 0,
      reconnectBackoffMs: DEFAULT_MCP_RECONNECT_BASE_DELAY_MS,
      toolNames: [],
      lastConnectedAt: nowIso()
    } satisfies McpConnectionState)
  try {
    if (existingState) {
      state.client = client
      state.status = 'connected'
      state.lastConnectedAt = nowIso()
      state.lastError = undefined
      state.nextReconnectAt = undefined
      state.reconnectBackoffMs = DEFAULT_MCP_RECONNECT_BASE_DELAY_MS
    }
    attachMcpClientLifecycle(state)
    const listed = await refreshMcpConnectionCatalog(state)
    // A runtime reconnect (existingState) carries a provider-assigned hook; fire
    // it here so its catalog commit happens BEFORE the reconnect's next callTool.
    // Fresh states (startup / OAuth / background) have no hook yet and commit
    // explicitly via their own adoption path, so this never double-commits.
    state.onCatalogChanged?.(state.serverId, listed)
    return { state, listed }
  } catch (error) {
    await client.close().catch(() => undefined)
    throw error
  }
}

async function callMcpToolWithReconnect(
  state: McpConnectionState,
  input: { name: string; arguments: Record<string, unknown> },
  context: ToolHostContext | undefined,
  timeout = state.server.timeoutMs,
  /** Whether this call is locally known to be replay-safe after a drop. */
  replaySafe = false
): Promise<unknown> {
  const signal = context?.abortSignal
  // Track whether the request actually reached `callTool`. A failure while
  // (re)connecting BEFORE the request was sent means the tool definitely did
  // not run, so retrying it on the fresh connection is always safe.
  let sentToServer = false
  try {
    await ensureMcpConnectionForCall(state, signal)
    sentToServer = true
    return await state.client.callTool(input, { signal, timeout, context })
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
      // Either the request never left (safe) or a locally trusted allow-list
      // marked it replay-safe — replay it on the reconnected client.
      const client = await reconnectMcpConnection(state, signal)
      return client.callTool(input, { signal, timeout, context })
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
 * Server-provided annotations are useful display hints, but an untrusted
 * remote server must not authorize a retry of a side-effecting operation by
 * declaring itself read-only or idempotent. There is currently no local
 * replay allow-list, so mid-flight calls are always treated as unknown.
 */
function isMcpReplaySafe(_annotations: McpToolDescriptor['annotations']): boolean {
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
        'its result is unknown and it was not retried automatically because no local replay policy approved it. ' +
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

export async function raceStartupTimeout<T extends { state: McpConnectionState }>(
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
  const result = await connectAndLoadCatalog(
    state.serverId,
    state.server,
    state.clientFactory,
    state.nowIso,
    state
  )
  return result.state.client
}

async function closeMcpClient(state: McpConnectionState): Promise<void> {
  state.intentionallyClosing = true
  try {
    await state.client.close().catch(() => undefined)
  } finally {
    state.intentionallyClosing = false
  }
}

export function attachMcpClientLifecycle(state: McpConnectionState): void {
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

export function shouldUseMcpSearch(config: NonNullable<McpCapabilityConfig['search']>, toolCount: number): boolean {
  if (!config.enabled) return false
  if (config.mode === 'direct') return false
  if (config.mode === 'search') return true
  return toolCount >= config.autoThresholdToolCount
}

function policyFromAnnotations(annotation: McpToolDescriptor['annotations']): LocalTool['policy'] {
  // MCP annotations come from the remote server and are not an authorization
  // signal. Keep a uniform confirmation boundary regardless of what it says.
  void annotation
  return 'on-request'
}

export function serverDiagnostic(
  state: { serverId: string; server: McpServerConfig; catalogFingerprint?: string; catalogDrift?: boolean; lastConnectedAt?: string },
  status: McpServerDiagnostic['status'],
  toolCount: number,
  lastError?: string
): McpServerDiagnostic {
  return {
    id: state.serverId,
    enabled: state.server.enabled,
    ...(state.server.managedBy ? { managedBy: state.server.managedBy } : {}),
    transport: state.server.transport,
    trustScope: state.server.trustScope,
    available: status === 'connected',
    status,
    toolCount,
    toolNames: [],
    ...(state.catalogFingerprint ? { catalogFingerprint: state.catalogFingerprint } : {}),
    ...(state.catalogDrift !== undefined ? { catalogDrift: state.catalogDrift } : {}),
    ...(state.lastConnectedAt ? { lastConnectedAt: state.lastConnectedAt } : {}),
    ...(lastError ? { lastError: redactSecretText(lastError) } : {})
  }
}

export function syncMcpDiagnostic(
  state: McpConnectionState,
  status: McpServerDiagnostic['status'] = state.status,
  toolCount = state.diagnostic?.toolCount ?? 0
): McpServerDiagnostic {
  const diagnostic: McpServerDiagnostic = {
    id: state.serverId,
    enabled: state.server.enabled,
    ...(state.server.managedBy ? { managedBy: state.server.managedBy } : {}),
    transport: state.server.transport,
    trustScope: state.server.trustScope,
    available: status === 'connected',
    status,
    toolCount,
    toolNames: [...state.toolNames],
    ...(state.client.protocolEra ? { protocolEra: state.client.protocolEra } : {}),
    ...(state.client.protocolVersion ? { protocolVersion: state.client.protocolVersion } : {}),
    ...(state.client.serverInfo ? { serverInfo: state.client.serverInfo } : {}),
    ...(state.client.serverCapabilities ? { serverCapabilities: state.client.serverCapabilities } : {}),
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

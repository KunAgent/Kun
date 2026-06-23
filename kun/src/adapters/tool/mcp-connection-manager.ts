import { z } from 'zod'
import { McpServerConfig } from '../../contracts/capabilities.js'
import type { McpConnectionStatus } from '../../contracts/events.js'
import { redactSecretText } from '../../config/secret-redaction.js'
import { createSdkMcpClient, type McpClientLike, type McpToolDescriptor } from './mcp-tool-provider.js'

/**
 * Per-server connection state exposed to GUI / diagnostics.
 */
export type McpConnectionStateInfo = {
  serverId: string
  status: McpConnectionStatus
  toolCount: number
  lastActivityAt?: string
  lastConnectedAt?: string
  lastError?: string
  reconnectAttempt: number
  transport: McpServerConfig['transport']
  enabled: boolean
}

type ConnectionState = {
  serverId: string
  server: McpServerConfig
  client: McpClientLike | null
  status: McpConnectionStatus
  toolCount: number
  lastActivityAt?: string
  lastConnectedAt?: string
  lastError?: string
  reconnectAttempt: number
  reconnectTimer: ReturnType<typeof setTimeout> | null
  abortReconnect: boolean
  nowIso: () => string
}

export type McpConnectionManagerOptions = {
  nowIso?: () => string
  maxReconnectAttempts?: number
  reconnectBaseDelayMs?: number
  reconnectMaxDelayMs?: number
  clientFactory?: (serverId: string, server: McpServerConfig) => Promise<McpClientLike>
  onStatusChange?: (info: McpConnectionStateInfo) => void
  onConnected?: (serverId: string, server: McpServerConfig, client: McpClientLike, tools: McpToolDescriptor[]) => void
  onDisconnected?: (serverId: string) => void
}

const DEFAULT_MAX_RECONNECT = 3
const DEFAULT_BASE_DELAY = 2_000
const DEFAULT_MAX_DELAY = 30_000

/**
 * Manages the lifecycle of multiple MCP server connections with a proper
 * state machine. Each connection has a well-defined lifecycle:
 *
 *   disabled → connecting → connected ↔ disconnected → error
 *                              ↑_______________/
 *                                    (auto-reconnect, up to N attempts)
 *
 * Addresses GitHub Issues #68 (MCP configured but not usable) and
 * #168 (MCP state not observable).
 */
export class McpConnectionManager {
  private readonly connections = new Map<string, ConnectionState>()
  private readonly nowIso: () => string
  private readonly maxReconnectAttempts: number
  private readonly reconnectBaseDelayMs: number
  private readonly reconnectMaxDelayMs: number
  private readonly clientFactory: (serverId: string, server: McpServerConfig) => Promise<McpClientLike>
  private readonly onStatusChange?: (info: McpConnectionStateInfo) => void
  private readonly onConnected?: McpConnectionManagerOptions['onConnected']
  private readonly onDisconnected?: McpConnectionManagerOptions['onDisconnected']
  private closed = false

  constructor(options: McpConnectionManagerOptions = {}) {
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? DEFAULT_BASE_DELAY
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? DEFAULT_MAX_DELAY
    this.clientFactory = options.clientFactory ?? createSdkMcpClient
    this.onStatusChange = options.onStatusChange
    this.onConnected = options.onConnected
    this.onDisconnected = options.onDisconnected
  }

  /** Add and connect a new MCP server. If it already exists, reconnects with new config. */
  async addServer(serverId: string, server: McpServerConfig): Promise<void> {
    if (this.closed) return
    if (!server.enabled) { this.setStatus(serverId, 'disabled'); return }

    const existing = this.connections.get(serverId)
    if (existing) { await this.reconnectServer(serverId, server); return }

    const state: ConnectionState = {
      serverId, server, client: null, status: 'connecting', toolCount: 0,
      reconnectAttempt: 0, reconnectTimer: null, abortReconnect: false,
      nowIso: this.nowIso,
    }
    this.connections.set(serverId, state)
    this.emitStatus(state)
    void this.connectState(state)
  }

  /** Remove a server, closing its connection. */
  async removeServer(serverId: string): Promise<void> {
    const state = this.connections.get(serverId)
    if (!state) return
    state.abortReconnect = true
    if (state.reconnectTimer) { clearTimeout(state.reconnectTimer); state.reconnectTimer = null }
    if (state.client) { await state.client.close().catch(() => undefined); state.client = null }
    this.connections.delete(serverId)
    this.onDisconnected?.(serverId)
  }

  /** Reconnect a server with new config (config hot-reload). */
  async reconnectServer(serverId: string, server: McpServerConfig): Promise<void> {
    const state = this.connections.get(serverId)
    if (!state) { await this.addServer(serverId, server); return }
    if (!server.enabled) { state.server = server; await this.closeConnection(state, false); this.setStatus(serverId, 'disabled'); return }

    state.server = server
    state.abortReconnect = true
    if (state.reconnectTimer) { clearTimeout(state.reconnectTimer); state.reconnectTimer = null }
    await this.closeConnection(state, false)
    state.abortReconnect = false
    state.status = 'connecting'
    state.reconnectAttempt = 0
    state.lastError = undefined
    this.emitStatus(state)
    void this.connectState(state)
  }

  getAllStatuses(): McpConnectionStateInfo[] {
    return [...this.connections.values()].map((s) => this.stateInfo(s))
  }

  getStatus(serverId: string): McpConnectionStateInfo | null {
    const state = this.connections.get(serverId)
    return state ? this.stateInfo(state) : null
  }

  getConnectedClients(): Array<{ serverId: string; server: McpServerConfig; client: McpClientLike; toolCount: number }> {
    return [...this.connections.values()]
      .filter((s) => s.status === 'connected' && s.client)
      .map((s) => ({ serverId: s.serverId, server: s.server, client: s.client!, toolCount: s.toolCount }))
  }

  async close(): Promise<void> {
    this.closed = true
    const closes: Promise<void>[] = []
    for (const state of this.connections.values()) {
      state.abortReconnect = true
      if (state.reconnectTimer) { clearTimeout(state.reconnectTimer); state.reconnectTimer = null }
      if (state.client) closes.push(state.client.close().catch(() => undefined))
    }
    await Promise.all(closes)
    this.connections.clear()
  }

  // ─── internal ────────────────────────────────────────────────────────

  private async connectState(state: ConnectionState): Promise<void> {
    state.status = 'connecting'
    this.emitStatus(state)

    try {
      const client = await this.clientFactory(state.serverId, state.server)
      if (state.abortReconnect || this.closed) { await client.close().catch(() => undefined); return }

      const tools = await listAllMcpTools(client, state.server.timeoutMs)
      if (state.abortReconnect || this.closed) { await client.close().catch(() => undefined); return }

      state.client = client
      state.toolCount = tools.length
      state.lastConnectedAt = this.nowIso()
      state.lastActivityAt = this.nowIso()
      state.lastError = undefined
      state.reconnectAttempt = 0
      state.status = 'connected'
      this.emitStatus(state)
      this.onConnected?.(state.serverId, state.server, client, tools)
    } catch (error) {
      if (state.abortReconnect || this.closed) return
      state.lastError = redactSecretText(error instanceof Error ? error.message : String(error))
      this.handleConnectionFailure(state)
    }
  }

  private handleConnectionFailure(state: ConnectionState): void {
    if (state.abortReconnect || this.closed) return
    state.reconnectAttempt++

    if (state.reconnectAttempt <= this.maxReconnectAttempts) {
      state.status = 'connecting'
      this.emitStatus(state)
      const delay = Math.min(
        this.reconnectMaxDelayMs,
        this.reconnectBaseDelayMs * 2 ** (state.reconnectAttempt - 1)
      )
      state.reconnectTimer = setTimeout(() => {
        state.reconnectTimer = null
        if (state.abortReconnect || this.closed) return
        void this.connectState(state)
      }, delay)
      if (typeof state.reconnectTimer === 'object' && 'unref' in state.reconnectTimer) {
        (state.reconnectTimer as { unref: () => void }).unref()
      }
    } else {
      state.status = 'error'
      this.emitStatus(state)
    }
  }

  private async closeConnection(state: ConnectionState, notify: boolean): Promise<void> {
    if (state.client) { await state.client.close().catch(() => undefined); state.client = null }
    if (notify && state.status === 'connected') {
      state.status = 'disconnected'
      this.emitStatus(state)
      this.onDisconnected?.(state.serverId)
    }
  }

  private setStatus(serverId: string, status: McpConnectionStatus): void {
    const state = this.connections.get(serverId)
    if (!state) {
      const stub: ConnectionState = {
        serverId,
        server: McpServerConfig.parse({ enabled: false, transport: 'stdio', command: 'disabled', trustScope: 'user' }),
        client: null, status, toolCount: 0, reconnectAttempt: 0,
        reconnectTimer: null, abortReconnect: false, nowIso: this.nowIso,
      }
      this.connections.set(serverId, stub)
      this.emitStatus(stub)
      return
    }
    state.status = status
    this.emitStatus(state)
  }

  private stateInfo(state: ConnectionState): McpConnectionStateInfo {
    return {
      serverId: state.serverId, status: state.status, toolCount: state.toolCount,
      lastActivityAt: state.lastActivityAt, lastConnectedAt: state.lastConnectedAt,
      lastError: state.lastError, reconnectAttempt: state.reconnectAttempt,
      transport: state.server.transport, enabled: state.server.enabled,
    }
  }

  private emitStatus(state: ConnectionState): void {
    this.onStatusChange?.(this.stateInfo(state))
  }
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

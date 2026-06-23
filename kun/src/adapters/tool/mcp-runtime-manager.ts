import { join } from 'node:path'
import { homedir } from 'node:os'
import type { McpCapabilityConfig, McpServerConfig } from '../../contracts/capabilities.js'
import { McpConnectionManager, type McpConnectionStateInfo } from './mcp-connection-manager.js'
import { readMcpConfigFile, watchMcpConfigFile, type McpConfigError } from './mcp-config-file.js'
import { buildMcpToolProviders, type McpToolProviderBuildResult, type McpToolProviderOptions } from './mcp-tool-provider.js'

export type McpRuntimeStatus = {
  servers: McpConnectionStateInfo[]
  configErrors: McpConfigError[]
  configFilePath: string
  configLoaded: boolean
  watching: boolean
}

export type McpRuntimeManagerOptions = McpToolProviderOptions & {
  configFilePath?: string
  watchConfig?: boolean
  watchDebounceMs?: number
  onServerStatusChange?: (info: McpConnectionStateInfo) => void
  onConfigErrors?: (errors: McpConfigError[]) => void
}

const DEFAULT_MCP_CONFIG_PATH = join(homedir(), '.kun', 'mcp.json')

/**
 * High-level MCP runtime manager.
 *
 * Combines config file parsing (with line-number-aware errors),
 * connection state management, and optional file watching into a
 * single easy-to-use component.
 *
 * Addresses GitHub Issues #68 (MCP configured but not usable)
 * and #168 (MCP state not observable).
 */
export class McpRuntimeManager {
  private readonly options: McpRuntimeManagerOptions
  private readonly connectionManager: McpConnectionManager
  private configFilePath: string
  private buildResult: McpToolProviderBuildResult | null = null
  private unwatchConfig: (() => void) | null = null
  private configErrors: McpConfigError[] = []
  private configLoaded = false

  constructor(options: McpRuntimeManagerOptions = {}) {
    this.options = options
    this.configFilePath = options.configFilePath ?? DEFAULT_MCP_CONFIG_PATH
    this.connectionManager = new McpConnectionManager({
      nowIso: options.nowIso,
      clientFactory: options.clientFactory,
      maxReconnectAttempts: options.backgroundReconnect?.maxAttempts ?? 3,
      reconnectBaseDelayMs: options.backgroundReconnect?.baseDelayMs ?? 2000,
      reconnectMaxDelayMs: options.backgroundReconnect?.maxDelayMs ?? 30000,
      onStatusChange: (info) => options.onServerStatusChange?.(info),
    })
  }

  /**
   * Initialize the manager: load config, merge with base, connect servers.
   * Returns a backward-compatible McpToolProviderBuildResult.
   */
  async initialize(baseConfig?: McpCapabilityConfig): Promise<McpToolProviderBuildResult> {
    let fileConfig: McpCapabilityConfig | undefined
    try {
      const result = await readMcpConfigFile(this.configFilePath)
      this.configLoaded = true
      if (result.ok) { fileConfig = result.config }
      else { this.configErrors = result.errors; this.options.onConfigErrors?.(result.errors) }
    } catch { /* non-fatal */ }

    const mergedConfig = mergeMcpConfigs(baseConfig, fileConfig)

    this.buildResult = await buildMcpToolProviders(mergedConfig, this.options)

    if (mergedConfig?.enabled && mergedConfig.servers) {
      for (const [serverId, server] of Object.entries(mergedConfig.servers)) {
        void this.connectionManager.addServer(serverId, server as McpServerConfig)
      }
    }

    if (this.options.watchConfig) this.startWatching()

    const originalClose = this.buildResult.close
    this.buildResult.close = async () => { await this.close(); await originalClose() }

    return this.buildResult
  }

  getStatus(): McpRuntimeStatus {
    return {
      servers: this.connectionManager.getAllStatuses(),
      configErrors: [...this.configErrors],
      configFilePath: this.configFilePath,
      configLoaded: this.configLoaded,
      watching: this.unwatchConfig !== null,
    }
  }

  getConnectionManager(): McpConnectionManager { return this.connectionManager }

  startWatching(): void {
    if (this.unwatchConfig) return
    this.unwatchConfig = watchMcpConfigFile(
      this.configFilePath,
      (result) => void this.handleConfigChange(result),
      { debounceMs: this.options.watchDebounceMs ?? 500 },
    )
  }

  stopWatching(): void {
    if (this.unwatchConfig) { this.unwatchConfig(); this.unwatchConfig = null }
  }

  async close(): Promise<void> { this.stopWatching(); await this.connectionManager.close() }

  // ─── internal ────────────────────────────────────────────────────────

  private async handleConfigChange(result: {
    ok: boolean; errors?: McpConfigError[]; config?: McpCapabilityConfig; servers?: Record<string, McpServerConfig>
  }): Promise<void> {
    if (!result.ok) { this.configErrors = result.errors ?? []; this.options.onConfigErrors?.(this.configErrors); return }
    this.configErrors = []
    const newServers = (result.servers ?? {}) as Record<string, McpServerConfig>
    const currentIds = new Set(this.connectionManager.getAllStatuses().map((s) => s.serverId))
    const newIds = new Set(Object.keys(newServers))

    for (const id of currentIds) { if (!newIds.has(id)) await this.connectionManager.removeServer(id) }
    for (const [serverId, server] of Object.entries(newServers)) {
      if (currentIds.has(serverId)) { void this.connectionManager.reconnectServer(serverId, server) }
      else { void this.connectionManager.addServer(serverId, server) }
    }
  }
}

function mergeMcpConfigs(base?: McpCapabilityConfig, file?: McpCapabilityConfig): McpCapabilityConfig | undefined {
  if (!base && !file) return undefined
  if (!file) return base
  if (!base) return file
  return { enabled: base.enabled || file.enabled, servers: { ...base.servers, ...file.servers }, search: file.search.enabled ? file.search : base.search }
}

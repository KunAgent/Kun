/**
 * Independent backend for the Figma Desktop local MCP server.
 *
 * Scope, deliberately narrow:
 * - one fixed loopback endpoint (see `figma-desktop-mcp-preset.ts`);
 * - read the server's own tool catalog at connect time, then disconnect;
 * - no process launch, no OAuth, no MCP Apps, no persisted catalog cache;
 * - no background reconnect loop, so Kun never keeps probing a closed socket.
 *
 * A missing/unreachable server is reported as `unavailable` with zero tools.
 * Nothing here fabricates Figma capability, and no seat or plan entitlement is
 * inferred: Figma enforces both when the user enables the server.
 */
import { McpCapabilityConfig } from '../contracts/capabilities.js'
import type { McpServerConfig } from '../contracts/capabilities.js'
import { buildMcpToolProviders } from '../adapters/tool/mcp-tool-provider.js'
import type {
  McpClientLike,
  McpToolProviderBuildResult,
  McpToolProviderOptions
} from '../adapters/tool/mcp-tool-provider.js'
import { normalizeMcpToolName } from '../adapters/tool/mcp-naming.js'
import type { CapabilityToolProvider } from '../adapters/tool/capability-registry.js'
import {
  assertFigmaDesktopMcpServerConfig,
  createFigmaDesktopMcpServerConfig,
  FIGMA_DESKTOP_MCP_CALL_TIMEOUT_MS,
  FIGMA_DESKTOP_MCP_CONNECT_TIMEOUT_MS,
  FIGMA_DESKTOP_MCP_GUIDANCE,
  FIGMA_DESKTOP_MCP_MAX_TIMEOUT_MS,
  FIGMA_DESKTOP_MCP_SERVER_ID,
  FIGMA_DESKTOP_MCP_URL,
  FigmaDesktopMcpError
} from './figma-desktop-mcp-preset.js'

export type FigmaDesktopMcpState = 'disabled' | 'disconnected' | 'unavailable' | 'connected'

export type FigmaDesktopMcpStatus = {
  state: FigmaDesktopMcpState
  serverId: string
  url: string
  /** Tool definitions the live server actually advertised. */
  toolCount: number
  /** Normalized `mcp_figma_desktop_*` names, sorted. Always empty unless connected. */
  tools: string[]
  lastError?: string
  guidance: string
}

export type FigmaDesktopMcpConnectorOptions = {
  /** Opt-in only. Defaults to false so runtime start-up never connects. */
  enabled?: boolean
  /** Connect plus `tools/list` budget. Bounded to 1s..60s. */
  connectTimeoutMs?: number
  clientFactory?: McpToolProviderOptions['clientFactory']
  /** Test/host seam for the shared MCP provider builder. */
  buildProviders?: typeof buildMcpToolProviders
}

const MAX_ERROR_CHARS = 400

export class FigmaDesktopMcpConnector {
  private readonly enabled: boolean
  private readonly connectTimeoutMs: number
  private readonly clientFactory?: (serverId: string, server: McpServerConfig) => Promise<McpClientLike>
  private readonly buildProviders: typeof buildMcpToolProviders
  private build?: McpToolProviderBuildResult
  private current: FigmaDesktopMcpStatus

  constructor(options: FigmaDesktopMcpConnectorOptions = {}) {
    this.enabled = options.enabled ?? false
    this.connectTimeoutMs = options.connectTimeoutMs ?? FIGMA_DESKTOP_MCP_CONNECT_TIMEOUT_MS
    if (!Number.isInteger(this.connectTimeoutMs) ||
      this.connectTimeoutMs < 1_000 || this.connectTimeoutMs > FIGMA_DESKTOP_MCP_MAX_TIMEOUT_MS) {
      throw new FigmaDesktopMcpError(
        'invalid_config',
        `Figma Desktop MCP connect timeout must be 1000..${FIGMA_DESKTOP_MCP_MAX_TIMEOUT_MS} ms.`
      )
    }
    this.clientFactory = options.clientFactory
    this.buildProviders = options.buildProviders ?? buildMcpToolProviders
    this.current = this.idleStatus()
  }

  status(): FigmaDesktopMcpStatus {
    return { ...this.current, tools: [...this.current.tools] }
  }

  /**
   * Live providers for the host tool registry. Empty unless connected, so a
   * failed or disabled connector contributes no capability.
   */
  providers(): readonly CapabilityToolProvider[] {
    return this.build?.providers ?? []
  }

  /** Connects once, lists the live catalog, and reports what the server offered. */
  async discover(): Promise<FigmaDesktopMcpStatus> {
    if (!this.enabled) return this.publish(this.idleStatus())
    if (this.build) return this.status()

    let build: McpToolProviderBuildResult
    try {
      build = await this.buildProviders(this.capabilityConfig(), {
        ...(this.clientFactory ? { clientFactory: this.clientFactory } : {}),
        startupConnectTimeoutMs: this.connectTimeoutMs
      })
    } catch (error) {
      return this.publish(this.unavailableStatus(message(error)))
    }

    const diagnostic = build.diagnostics.find((entry) => entry.id === FIGMA_DESKTOP_MCP_SERVER_ID)
    if (diagnostic?.status !== 'connected') {
      // Nothing is live, so keep no provider handle and offer no tools.
      await build.close().catch(() => undefined)
      return this.publish(this.unavailableStatus(diagnostic?.lastError))
    }
    this.build = build
    const tools = (diagnostic.toolNames ?? [])
      .map((name) => normalizeMcpToolName(FIGMA_DESKTOP_MCP_SERVER_ID, name))
      .sort((left, right) => left.localeCompare(right))
    return this.publish({
      state: 'connected',
      serverId: FIGMA_DESKTOP_MCP_SERVER_ID,
      url: FIGMA_DESKTOP_MCP_URL,
      toolCount: diagnostic.toolCount,
      tools,
      guidance: tools.length > 0
        ? `Connected to the local Figma Desktop MCP server. ${tools.length} tool(s) are available.`
        : 'Connected to the local Figma Desktop MCP server, which advertised no tools. ' +
          'Open a Figma Design file and check Dev Mode MCP settings.',
      ...(diagnostic.lastError ? { lastError: cap(diagnostic.lastError) } : {})
    })
  }

  /** Closes the live client. Idempotent: a second call is a no-op. */
  async disconnect(): Promise<void> {
    const build = this.build
    this.build = undefined
    if (build) await build.close().catch(() => undefined)
    this.publish(this.idleStatus())
  }

  /** The single-server capability config this connector connects with. */
  capabilityConfig(): McpCapabilityConfig {
    const server = createFigmaDesktopMcpServerConfig({ enabled: true })
    const config = McpCapabilityConfig.parse({
      enabled: true,
      servers: {
        [FIGMA_DESKTOP_MCP_SERVER_ID]: {
          ...server,
          timeoutMs: this.connectTimeoutMs,
          callTimeoutMs: Math.max(this.connectTimeoutMs, FIGMA_DESKTOP_MCP_CALL_TIMEOUT_MS)
        }
      },
      search: { enabled: false }
    })
    assertFigmaDesktopMcpServerConfig(config.servers[FIGMA_DESKTOP_MCP_SERVER_ID])
    return config
  }

  private idleStatus(): FigmaDesktopMcpStatus {
    return {
      state: this.enabled ? 'disconnected' : 'disabled',
      serverId: FIGMA_DESKTOP_MCP_SERVER_ID,
      url: FIGMA_DESKTOP_MCP_URL,
      toolCount: 0,
      tools: [],
      guidance: this.enabled
        ? FIGMA_DESKTOP_MCP_GUIDANCE
        : 'The Figma Desktop MCP connector is off. Enable it to read your local Figma session.'
    }
  }

  private unavailableStatus(error: string | undefined): FigmaDesktopMcpStatus {
    return {
      state: 'unavailable',
      serverId: FIGMA_DESKTOP_MCP_SERVER_ID,
      url: FIGMA_DESKTOP_MCP_URL,
      toolCount: 0,
      tools: [],
      guidance: `No Figma Desktop MCP server answered at ${FIGMA_DESKTOP_MCP_URL}. ${FIGMA_DESKTOP_MCP_GUIDANCE}`,
      ...(error ? { lastError: cap(error) } : {})
    }
  }

  private publish(status: FigmaDesktopMcpStatus): FigmaDesktopMcpStatus {
    this.current = status
    return this.status()
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function cap(value: string): string {
  const trimmed = value.trim()
  return trimmed.length > MAX_ERROR_CHARS ? `${trimmed.slice(0, MAX_ERROR_CHARS)}...` : trimmed
}

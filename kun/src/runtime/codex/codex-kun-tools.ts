/**
 * Kun Tools for `codex app-server`: the same turn-scoped `/mcp/kun` server ACP
 * agents receive, handed to Codex as a streamable-HTTP MCP server through the
 * `thread/start` / `thread/resume` config overrides. The bearer is stable per
 * Kun thread and re-pinned to each turn by KunToolsMcpProvider, so the server
 * Codex keeps across turns only works while a Kun turn is running.
 *
 * The descriptor carries the token in `http_headers`: it travels over the
 * app-server pipe as a per-thread override, never on argv or in config.toml.
 */
import type { McpServer, McpServerHttp } from '../acp/acp-schema.js'

/** Codex MCP server name; Codex reports calls as `mcp:kun/<tool>`. */
export const CODEX_KUN_TOOLS_SERVER_NAME = 'kun'
const STARTUP_TIMEOUT_SEC = 30
/** Kun approvals and user input can hold a call well past Codex's 60 s default. */
const TOOL_TIMEOUT_SEC = 900

function httpServer(servers: readonly McpServer[] | undefined): McpServerHttp | undefined {
  for (const server of servers ?? []) {
    if ('type' in server && server.type === 'http' && 'url' in server) return server as McpServerHttp
  }
  return undefined
}

/** `config` overrides that register Kun Tools with a Codex thread, or none. */
export function codexKunToolsConfig(
  servers: readonly McpServer[] | undefined
): Record<string, unknown> | undefined {
  const server = httpServer(servers)
  if (!server) return undefined
  const headers = Object.fromEntries(server.headers.map((header) => [header.name, header.value]))
  return {
    [`mcp_servers.${CODEX_KUN_TOOLS_SERVER_NAME}`]: {
      url: server.url,
      http_headers: headers,
      startup_timeout_sec: STARTUP_TIMEOUT_SEC,
      tool_timeout_sec: TOOL_TIMEOUT_SEC
    }
  }
}

/**
 * Codex asks before calling an MCP tool through `mcpServer/elicitation/request`.
 * For the Kun server that prompt is redundant: every call already crosses
 * Kun's ToolHost, which applies the turn's approval policy and sandbox. Other
 * servers' elicitations stay declined.
 */
export function isKunToolsElicitation(params: unknown): boolean {
  if (!params || typeof params !== 'object') return false
  const record = params as Record<string, unknown>
  return record.serverName === CODEX_KUN_TOOLS_SERVER_NAME && record.mode !== 'url'
}

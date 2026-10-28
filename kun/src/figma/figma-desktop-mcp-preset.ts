/**
 * Controlled preset for the official Figma Desktop local MCP server.
 *
 * Figma Desktop exposes its MCP server on one documented loopback address.
 * Kun accepts exactly that address and nothing else: no user-supplied URL, no
 * other loopback port, no `localhost`/`::1` alias, no TLS variant, and no
 * query string. This is a product preset, not a general "allow plain HTTP"
 * exception: the shared MCP transport and loopback policy are unchanged.
 *
 * Kun never launches Figma, never injects headers or environment secrets, and
 * never pretends the server exists. Enabling the Desktop MCP server is a user
 * action inside Figma (Dev Mode), and a seat/plan requirement is enforced by
 * Figma, not by this module.
 */
import { McpServerConfig } from '../contracts/capabilities.js'

/** Official Figma Desktop MCP endpoint: fixed host, port, and path. */
export const FIGMA_DESKTOP_MCP_URL = 'http://127.0.0.1:3845/mcp' as const
export const FIGMA_DESKTOP_MCP_SERVER_ID = 'figma-desktop' as const
const FIGMA_DESKTOP_MCP_HOST = '127.0.0.1'
const FIGMA_DESKTOP_MCP_PORT = '3845'
const FIGMA_DESKTOP_MCP_PATH = '/mcp'

export const FIGMA_DESKTOP_MCP_CONNECT_TIMEOUT_MS = 8_000
export const FIGMA_DESKTOP_MCP_CALL_TIMEOUT_MS = 30_000
/** A host cannot raise the budget past this; a hung endpoint must stay bounded. */
export const FIGMA_DESKTOP_MCP_MAX_TIMEOUT_MS = 60_000

/** Stable user-facing guidance; it never claims the server is running. */
export const FIGMA_DESKTOP_MCP_GUIDANCE =
  'Open Figma Desktop, enable the Dev Mode MCP server in Preferences, and keep the file you want to read open. ' +
  'Kun connects to the fixed local address ' + FIGMA_DESKTOP_MCP_URL + ' only and never starts Figma for you.'

export type FigmaDesktopMcpErrorCode = 'unsupported_endpoint' | 'invalid_config'

export class FigmaDesktopMcpError extends Error {
  constructor(readonly code: FigmaDesktopMcpErrorCode, message: string) {
    super(message)
    this.name = 'FigmaDesktopMcpError'
  }
}

/**
 * Validates the single accepted endpoint structurally, then against the
 * canonical string, so a near-miss (another port, `localhost`, a trailing
 * slash, a query, TLS) is refused before any socket is opened.
 */
export function assertFigmaDesktopMcpUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw unsupportedEndpoint()
  }
  if (
    url.protocol !== 'http:' ||
    url.hostname !== FIGMA_DESKTOP_MCP_HOST ||
    url.port !== FIGMA_DESKTOP_MCP_PORT ||
    url.pathname !== FIGMA_DESKTOP_MCP_PATH ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw unsupportedEndpoint()
  }
  if (url.href !== FIGMA_DESKTOP_MCP_URL) throw unsupportedEndpoint()
  return url
}

/**
 * Builds the only Figma Desktop server entry Kun will connect to. Disabled by
 * default: the host must opt in, so nothing connects at runtime start-up.
 */
export function createFigmaDesktopMcpServerConfig(options: { enabled?: boolean } = {}): McpServerConfig {
  const config = McpServerConfig.parse({
    enabled: options.enabled ?? false,
    transport: 'streamable-http',
    url: FIGMA_DESKTOP_MCP_URL,
    // Explicit empty containers keep every built entry independent of the
    // schema defaults, so a host cannot mutate a shared array or object.
    args: [],
    headers: {},
    env: {},
    workspaceRoots: [],
    trustedWorkspaceRoots: [],
    // Loopback with no credential: it is not tied to one workspace root.
    trustScope: 'user',
    timeoutMs: FIGMA_DESKTOP_MCP_CONNECT_TIMEOUT_MS,
    callTimeoutMs: FIGMA_DESKTOP_MCP_CALL_TIMEOUT_MS
  })
  assertFigmaDesktopMcpServerConfig(config)
  return config
}

export function isFigmaDesktopMcpServerConfig(value: unknown): boolean {
  try {
    assertFigmaDesktopMcpServerConfig(value)
    return true
  } catch {
    return false
  }
}

/**
 * Fail-closed check for a persisted or host-mutated entry. Everything that
 * could turn this preset into something else (a spawned process, extra
 * secrets, another endpoint, OAuth, an unbounded timeout) is rejected.
 */
export function assertFigmaDesktopMcpServerConfig(value: unknown): void {
  const server = recordValue(value)
  if (!server) throw invalidConfig('Figma Desktop MCP configuration must be an object.')
  if (server.transport !== 'streamable-http') {
    throw unsupportedEndpoint()
  }
  if (typeof server.url !== 'string') throw unsupportedEndpoint()
  assertFigmaDesktopMcpUrl(server.url)
  if (typeof server.enabled !== 'boolean') throw invalidConfig('Figma Desktop MCP configuration must set enabled.')
  if (server.command !== undefined || server.cwd !== undefined) {
    throw invalidConfig('Kun never launches Figma or a local process for this connector.')
  }
  if (nonEmpty(server.args)) throw invalidConfig('Kun never launches Figma or a local process for this connector.')
  if (nonEmpty(server.env)) throw invalidConfig('The Figma Desktop MCP connector accepts no environment variables.')
  if (nonEmpty(server.headers)) throw invalidConfig('The Figma Desktop MCP endpoint needs no headers or secrets.')
  if (server.oauth !== undefined) throw invalidConfig('The local Figma Desktop MCP endpoint does not use OAuth.')
  if (server.githubPolicy !== undefined) throw invalidConfig('The Figma Desktop MCP connector has no GitHub policy.')
  if (server.trustScope !== 'user') throw invalidConfig('The Figma Desktop MCP connector must be user-scoped.')
  if (nonEmpty(server.workspaceRoots) || nonEmpty(server.trustedWorkspaceRoots)) {
    throw invalidConfig('The Figma Desktop MCP connector is not workspace-scoped.')
  }
  if (!boundedTimeout(server.timeoutMs)) throw invalidConfig('Figma Desktop MCP connect timeout is out of range.')
  if (server.callTimeoutMs !== undefined && !boundedTimeout(server.callTimeoutMs)) {
    throw invalidConfig('Figma Desktop MCP call timeout is out of range.')
  }
}

function boundedTimeout(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) &&
    value >= 1_000 && value <= FIGMA_DESKTOP_MCP_MAX_TIMEOUT_MS
}

function nonEmpty(value: unknown): boolean {
  if (value === undefined) return false
  if (Array.isArray(value)) return value.length > 0
  const record = recordValue(value)
  return record ? Object.keys(record).length > 0 : true
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function unsupportedEndpoint(): FigmaDesktopMcpError {
  return new FigmaDesktopMcpError(
    'unsupported_endpoint',
    `Only the official Figma Desktop MCP endpoint ${FIGMA_DESKTOP_MCP_URL} is supported.`
  )
}

function invalidConfig(message: string): FigmaDesktopMcpError {
  return new FigmaDesktopMcpError('invalid_config', message)
}

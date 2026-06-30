import { createHash } from 'node:crypto'
import type { McpServerConfig } from '../../contracts/capabilities.js'

/**
 * MCP identifier, slug, and workspace-trust helpers.
 *
 * Pure string/path logic shared by the tool, OAuth, and transport layers.
 * Kept dependency-free so every other MCP module can import it without
 * creating an import cycle.
 */

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

export function resolveMcpServerCwd(server: McpServerConfig): string | undefined {
  if (server.transport !== 'stdio') return undefined
  const configured = server.cwd?.trim()
  if (configured) return configured
  if (server.trustScope !== 'workspace') return undefined
  return server.trustedWorkspaceRoots.map((root) => root.trim()).find(Boolean)
}

export function slug(value: string): string {
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

export function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function catalogFingerprint(values: readonly string[]): string {
  return createHash('sha256')
    .update(JSON.stringify([...values].sort()))
    .digest('hex')
    .slice(0, 16)
}

function workspaceMatchesRoots(workspace: string, roots: readonly string[]): boolean {
  const normalizedWorkspace = normalizePathForTrust(workspace)
  return roots.some((root) => {
    const normalizedRoot = normalizePathForTrust(root)
    return normalizedWorkspace === normalizedRoot || normalizedWorkspace.startsWith(`${normalizedRoot}/`)
  })
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

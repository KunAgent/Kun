export const GRAPH_NETWORK_PROVIDER_IDS = [
  'web',
  'imageGen',
  'speechGen',
  'musicGen',
  'videoGen',
  'computerUse'
] as const

export function graphBlockedProviderIds(input: {
  blockedMcpServers: readonly string[]
  networkAllowed: boolean
}): string[] {
  return [
    ...input.blockedMcpServers.map((serverId) => `mcp:${serverId}`),
    ...(input.networkAllowed ? [] : GRAPH_NETWORK_PROVIDER_IDS)
  ]
}

const SCOPED_WORKSPACE_TOOL_NAMES = new Set([
  'read',
  'ls',
  'find',
  'grep',
  'write',
  'edit',
  'read_artifact',
  'fast_context',
  'load_skill'
])

/**
 * Tools backed by an unconstrained process or whole-workspace index cannot
 * honor a narrow Graph assignment. Keep only adapters that cross the shared
 * path resolver/write guard; Graph executors receive no workflow tools.
 */
export function graphPathScopedToolNames(
  tools: readonly string[],
  readScopes: readonly string[],
  writeScopes: readonly string[]
): string[] {
  const graphTools = new Set<string>([
    ...GRAPH_LEAD_TOOL_NAMES,
    ...GRAPH_WORKER_TOOL_NAMES
  ])
  const collaborationTools = tools.filter((tool) =>
    tool === GRAPH_WORKER_REPORT_TOOL_NAME
  )
  const executorTools = tools.filter((tool) => !graphTools.has(tool))
  if (readScopes.includes('.') && (writeScopes.length === 0 || writeScopes.includes('.'))) {
    return executorTools
  }
  return [
    ...executorTools.filter((tool) => SCOPED_WORKSPACE_TOOL_NAMES.has(tool)),
    ...collaborationTools
  ].filter((tool, index, all) => all.indexOf(tool) === index)
}
import {
  GRAPH_LEAD_TOOL_NAMES,
  GRAPH_WORKER_REPORT_TOOL_NAME,
  GRAPH_WORKER_TOOL_NAMES
} from './graph-tool-boundary.js'

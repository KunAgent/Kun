import { KUN_NODE_GRAPH_FOLDER_PATH, KUN_NODE_GRAPH_PATH } from '@shared/kun-endpoints'
import { rendererRuntimeClient } from '../agent/runtime-client'
import {
  NODE_GRAPH_EDGE_KINDS,
  NODE_GRAPH_NODE_KINDS,
  type NodeGraphEdge,
  type NodeGraphNode,
  type NodeGraphProjection
} from './node-graph-types'

export type NodeGraphFetchOptions = {
  workspace?: string
  includeChangedFiles?: boolean
  refresh?: boolean
}

const NODE_KINDS = new Set<string>(NODE_GRAPH_NODE_KINDS)
const EDGE_KINDS = new Set<string>(NODE_GRAPH_EDGE_KINDS)

export function nodeGraphRequestPath(options: NodeGraphFetchOptions = {}): string {
  const query = new URLSearchParams()
  if (options.workspace) query.set('workspace', options.workspace)
  if (options.includeChangedFiles === false) query.set('changed_files', 'false')
  if (options.refresh) query.set('refresh', 'true')
  const search = query.toString()
  return search ? `${KUN_NODE_GRAPH_PATH}?${search}` : KUN_NODE_GRAPH_PATH
}

/**
 * Drops nodes and edges the renderer does not recognize so a newer runtime
 * contract degrades to a smaller graph instead of an exception.
 */
export function normalizeNodeGraphProjection(value: unknown): NodeGraphProjection {
  const raw = (value ?? {}) as Partial<NodeGraphProjection>
  const nodes = (Array.isArray(raw.nodes) ? raw.nodes : []).filter(
    (node): node is NodeGraphNode =>
      Boolean(node && typeof node.id === 'string' && NODE_KINDS.has(node.kind as string))
  )
  const ids = new Set(nodes.map((node) => node.id))
  const edges = (Array.isArray(raw.edges) ? raw.edges : []).filter(
    (edge): edge is NodeGraphEdge =>
      Boolean(
        edge &&
        typeof edge.id === 'string' &&
        EDGE_KINDS.has(edge.kind as string) &&
        ids.has(edge.from) &&
        ids.has(edge.to)
      )
  )
  return {
    version: typeof raw.version === 'number' ? raw.version : 1,
    builtAt: typeof raw.builtAt === 'string' ? raw.builtAt : '',
    ...(typeof raw.workspace === 'string' ? { workspace: raw.workspace } : {}),
    nodes,
    edges,
    counts: (raw.counts ?? {}) as NodeGraphProjection['counts'],
    truncated: raw.truncated === true,
    diagnostics: Array.isArray(raw.diagnostics)
      ? raw.diagnostics.filter((note): note is string => typeof note === 'string')
      : []
  }
}

export async function fetchNodeGraph(
  options: NodeGraphFetchOptions = {}
): Promise<NodeGraphProjection> {
  const response = await rendererRuntimeClient.runtimeRequest(
    nodeGraphRequestPath(options),
    'GET'
  )
  if (!response.ok) throw new Error(readErrorMessage(response.body, response.status))
  let parsed: unknown
  try {
    parsed = JSON.parse(response.body)
  } catch {
    throw new Error('runtime returned an invalid node graph response')
  }
  return normalizeNodeGraphProjection(parsed)
}

function readErrorMessage(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string }
    return parsed.error?.message ?? parsed.message ?? `node graph request failed (${status})`
  } catch {
    return `node graph request failed (${status})`
  }
}

export function nodeGraphFolderRequestPath(
  roots: readonly string[],
  refresh?: boolean
): string {
  const query = new URLSearchParams()
  // Repeated `root` params: one projection can span several workspaces so a
  // link reaching into a sibling workspace still draws an edge.
  for (const root of roots) if (root.trim()) query.append('root', root.trim())
  if (refresh) query.set('refresh', 'true')
  return `${KUN_NODE_GRAPH_FOLDER_PATH}?${query.toString()}`
}

/** Folder projection for the Work tab: markdown files, wikilinks, folders. */
export async function fetchNodeGraphFolder(
  roots: readonly string[],
  options: { refresh?: boolean } = {}
): Promise<NodeGraphProjection> {
  const response = await rendererRuntimeClient.runtimeRequest(
    nodeGraphFolderRequestPath(roots, options.refresh),
    'GET'
  )
  if (!response.ok) throw new Error(readErrorMessage(response.body, response.status))
  let parsed: unknown
  try {
    parsed = JSON.parse(response.body)
  } catch {
    throw new Error('runtime returned an invalid node graph response')
  }
  return normalizeNodeGraphProjection(parsed)
}

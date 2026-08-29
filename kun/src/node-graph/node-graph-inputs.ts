import type { NodeGraphNodeKind } from '../contracts/node-graph.js'
import type { StoredKnowledgeIndex } from '../knowledge/knowledge-types.js'

/** Thread fields the projection reads. A structural subset of `ThreadSummary`. */
export type NodeGraphThreadInput = {
  id: string
  title: string
  workspace: string
  additionalWorkspaces?: readonly string[]
  agentId?: string
  parentThreadId?: string
  forkedFromThreadId?: string
  relation?: string
  status?: string
  mode?: string
  createdAt?: string
  updatedAt?: string
  knowledgeBases?: readonly { id: string; name: string }[]
}

/** Memory fields the projection reads. A structural subset of `MemoryRecord`. */
export type NodeGraphMemoryInput = {
  id: string
  content: string
  scope: string
  workspace?: string
  project?: string
  tags?: readonly string[]
  sourceThreadId?: string
  updatedAt?: string
  disabledAt?: string
  deletedAt?: string
}

/**
 * One mounted knowledge base. `index` is null when the base has never been
 * indexed or its index is still being rebuilt; the base still becomes a node
 * so the graph shows the mount rather than silently hiding it.
 */
export type NodeGraphKnowledgeInput = {
  mountId: string
  mountName: string
  state?: string
  index: StoredKnowledgeIndex | null
  /** Threads that mount this base, used for `mount` edges. */
  threadIds: readonly string[]
}

/** Files a thread changed, aggregated from Graph Mode run summaries. */
export type NodeGraphChangedFilesInput = {
  threadId: string
  workspace?: string
  files: readonly string[]
}

/** Subagent profile labels, so `agent` nodes are not bare ids. */
export type NodeGraphAgentInput = {
  id: string
  name: string
}

export type NodeGraphLimits = {
  maxNodes: number
  maxEdges: number
  /** Cap on section nodes per document, mirroring the browse-children cap. */
  maxSectionsPerDocument: number
}

export const DEFAULT_NODE_GRAPH_LIMITS: NodeGraphLimits = {
  maxNodes: 4_000,
  maxEdges: 12_000,
  maxSectionsPerDocument: 60
}

export type NodeGraphBuildInput = {
  builtAt: string
  workspace?: string
  threads: readonly NodeGraphThreadInput[]
  memories?: readonly NodeGraphMemoryInput[]
  knowledgeBases?: readonly NodeGraphKnowledgeInput[]
  changedFiles?: readonly NodeGraphChangedFilesInput[]
  agents?: readonly NodeGraphAgentInput[]
  limits?: Partial<NodeGraphLimits>
  diagnostics?: readonly string[]
}

/**
 * Truncation priority. Structural nodes survive a cap so a large vault still
 * renders a navigable skeleton instead of an arbitrary slice.
 */
export const NODE_GRAPH_KIND_PRIORITY: readonly NodeGraphNodeKind[] = [
  'workspace',
  'thread',
  'knowledgeBase',
  'folder',
  'agent',
  'document',
  'memory',
  'tag',
  'file',
  'section'
]

export function workspaceNodeId(workspace: string): string {
  return `workspace:${workspace}`
}

export function threadNodeId(threadId: string): string {
  return `thread:${threadId}`
}

export function agentNodeId(agentId: string): string {
  return `agent:${agentId}`
}

export function knowledgeBaseNodeId(mountId: string): string {
  return `kb:${mountId}`
}

export function knowledgeNodeGraphId(mountId: string, knowledgeNodeId: string): string {
  return `kn:${mountId}:${knowledgeNodeId}`
}

export function memoryNodeId(memoryId: string): string {
  return `memory:${memoryId}`
}

export function tagNodeId(tag: string): string {
  return `tag:${tag.toLocaleLowerCase()}`
}

export function fileNodeId(workspace: string | undefined, path: string): string {
  return `file:${workspace ?? ''}:${path}`
}

export function edgeId(kind: string, from: string, to: string): string {
  return `${kind}|${from}|${to}`
}

/** Trailing path segment, used as a display label for paths and roots. */
export function basenameOf(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '')
  const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return separator === -1 ? trimmed : trimmed.slice(separator + 1)
}

/** Containing folder of a relative path, or `''` at the root. */
export function folderOf(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const separator = normalized.lastIndexOf('/')
  return separator === -1 ? '' : normalized.slice(0, separator)
}

export function clipLabel(value: string, max = 120): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length <= max ? compact : `${compact.slice(0, Math.max(0, max - 3))}...`
}

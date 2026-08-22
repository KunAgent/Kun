/**
 * Renderer mirror of `kun/src/contracts/node-graph.ts`. The renderer has no
 * alias to the runtime package, so the shape is restated here the same way
 * `agent/kun-contract.ts` restates the thread contract.
 *
 * Unrelated to Graph Mode (`components/graph/*`), which visualizes a single
 * orchestration run. Node Graph is the Obsidian-style map of the workspace.
 */
export const NODE_GRAPH_NODE_KINDS = [
  'workspace',
  'thread',
  'agent',
  'knowledgeBase',
  'folder',
  'document',
  'section',
  'memory',
  'tag',
  'file'
] as const
export type NodeGraphNodeKind = (typeof NODE_GRAPH_NODE_KINDS)[number]

export const NODE_GRAPH_EDGE_KINDS = [
  'contains',
  'link',
  'mount',
  'parent',
  'fork',
  'workspace',
  'agent',
  'memoryOf',
  'tagged',
  'touches'
] as const
export type NodeGraphEdgeKind = (typeof NODE_GRAPH_EDGE_KINDS)[number]

export type NodeGraphNode = {
  id: string
  kind: NodeGraphNodeKind
  label: string
  subtitle?: string
  workspace?: string
  path?: string
  folder?: string
  threadId?: string
  agentId?: string
  mountId?: string
  knowledgeNodeId?: string
  memoryId?: string
  tag?: string
  state?: string
  createdAt?: string
  updatedAt?: string
  sizeBytes?: number
  degree: number
}

export type NodeGraphEdge = {
  id: string
  from: string
  to: string
  kind: NodeGraphEdgeKind
  label?: string
}

export type NodeGraphProjection = {
  version: number
  builtAt: string
  workspace?: string
  nodes: NodeGraphNode[]
  edges: NodeGraphEdge[]
  counts: Partial<Record<NodeGraphNodeKind, number>>
  truncated: boolean
  diagnostics: string[]
}

export const EMPTY_NODE_GRAPH_PROJECTION: NodeGraphProjection = {
  version: 1,
  builtAt: '',
  nodes: [],
  edges: [],
  counts: {},
  truncated: false,
  diagnostics: []
}

/** Kinds that only ever appear inside a knowledge base. */
export function isKnowledgeKind(kind: NodeGraphNodeKind): boolean {
  return kind === 'knowledgeBase' || kind === 'document' || kind === 'section'
}

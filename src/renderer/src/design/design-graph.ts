/**
 * Node-canvas graph document for design-mode 'graph' artifacts. A graph is a
 * small design pipeline: `prompt` nodes carry instructions, `design` nodes
 * generate an HTML artifact from their own brief plus the text flowing in from
 * upstream nodes. Persisted as JSON; execution lives in design-graph-run.ts.
 */
export type DesignGraphNodeKind = 'prompt' | 'design'
export type DesignGraphNodeStatus = 'idle' | 'running' | 'done' | 'error'

export type DesignGraphNodeData = {
  kind: DesignGraphNodeKind
  label: string
  /** Prompt text (prompt node) or design instruction (design node). */
  brief: string
  status?: DesignGraphNodeStatus
  /** Workspace-relative path to the design node's generated HTML, once run. */
  outputPath?: string
}

export type DesignGraphNode = {
  id: string
  position: { x: number; y: number }
  data: DesignGraphNodeData
}

export type DesignGraphEdge = {
  id: string
  source: string
  target: string
}

export type DesignGraphDoc = {
  version: 1
  nodes: DesignGraphNode[]
  edges: DesignGraphEdge[]
}

export function emptyDesignGraph(): DesignGraphDoc {
  return { version: 1, nodes: [], edges: [] }
}

function normalizeNode(raw: unknown): DesignGraphNode | null {
  if (!raw || typeof raw !== 'object') return null
  const n = raw as { id?: unknown; position?: { x?: unknown; y?: unknown }; data?: Record<string, unknown> }
  if (typeof n.id !== 'string' || !n.id) return null
  const d = n.data ?? {}
  return {
    id: n.id,
    position: { x: Number(n.position?.x) || 0, y: Number(n.position?.y) || 0 },
    data: {
      kind: d.kind === 'prompt' ? 'prompt' : 'design',
      label: typeof d.label === 'string' ? d.label : '',
      brief: typeof d.brief === 'string' ? d.brief : '',
      status:
        d.status === 'running' || d.status === 'done' || d.status === 'error' || d.status === 'idle'
          ? d.status
          : undefined,
      outputPath: typeof d.outputPath === 'string' ? d.outputPath : undefined
    }
  }
}

function normalizeEdge(raw: unknown): DesignGraphEdge | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as { id?: unknown; source?: unknown; target?: unknown }
  if (typeof e.source !== 'string' || typeof e.target !== 'string') return null
  return { id: typeof e.id === 'string' ? e.id : `${e.source}-${e.target}`, source: e.source, target: e.target }
}

export function parseDesignGraph(raw: string): DesignGraphDoc {
  try {
    const parsed = JSON.parse(raw) as { nodes?: unknown; edges?: unknown }
    const nodes = Array.isArray(parsed.nodes)
      ? parsed.nodes.map(normalizeNode).filter((n): n is DesignGraphNode => n !== null)
      : []
    const edges = Array.isArray(parsed.edges)
      ? parsed.edges.map(normalizeEdge).filter((e): e is DesignGraphEdge => e !== null)
      : []
    return { version: 1, nodes, edges }
  } catch {
    return emptyDesignGraph()
  }
}

export function serializeDesignGraph(doc: DesignGraphDoc): string {
  return `${JSON.stringify(doc, null, 2)}\n`
}

export function createGraphNodeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `n_${crypto.randomUUID().slice(0, 8)}`
  }
  return `n_${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Kahn topological order of node ids, or null when the graph has a cycle.
 */
export function topoSortDesignGraph(
  nodes: { id: string }[],
  edges: { source: string; target: string }[]
): string[] | null {
  const indegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()
  for (const node of nodes) {
    indegree.set(node.id, 0)
    adjacency.set(node.id, [])
  }
  for (const edge of edges) {
    if (!indegree.has(edge.source) || !indegree.has(edge.target)) continue
    adjacency.get(edge.source)!.push(edge.target)
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
  }
  const queue = nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id)
  const order: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    order.push(id)
    for (const next of adjacency.get(id) ?? []) {
      const left = (indegree.get(next) ?? 0) - 1
      indegree.set(next, left)
      if (left === 0) queue.push(next)
    }
  }
  return order.length === nodes.length ? order : null
}

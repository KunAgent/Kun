import {
  NODE_GRAPH_CONTRACT_VERSION,
  type NodeGraphEdge,
  type NodeGraphEdgeKind,
  type NodeGraphNode,
  type NodeGraphNodeKind,
  type NodeGraphProjection
} from '../contracts/node-graph.js'
import {
  DEFAULT_NODE_GRAPH_LIMITS,
  NODE_GRAPH_KIND_PRIORITY,
  edgeId,
  type NodeGraphLimits
} from './node-graph-inputs.js'

type DraftNode = Omit<NodeGraphNode, 'degree'>

/**
 * Collects nodes and edges from every source, then emits a capped, degree-
 * weighted projection. Insertion is idempotent per id so sources may claim
 * the same node without coordinating; the first claim wins and later claims
 * only fill in fields the first one left empty.
 */
export class NodeGraphAccumulator {
  private readonly nodes = new Map<string, DraftNode>()
  private readonly edges = new Map<string, NodeGraphEdge>()
  private readonly notes: string[] = []
  private readonly limits: NodeGraphLimits

  constructor(limits: Partial<NodeGraphLimits> = {}) {
    this.limits = { ...DEFAULT_NODE_GRAPH_LIMITS, ...limits }
  }

  get sectionCap(): number {
    return this.limits.maxSectionsPerDocument
  }

  diagnostic(message: string): void {
    if (this.notes.length >= 64 || this.notes.includes(message)) return
    this.notes.push(message)
  }

  has(id: string): boolean {
    return this.nodes.has(id)
  }

  addNode(node: DraftNode): string {
    const existing = this.nodes.get(node.id)
    if (!existing) {
      this.nodes.set(node.id, node)
      return node.id
    }
    // Fill only absent fields so a richer later claim (e.g. a document node
    // that a `link` edge referenced first) does not lose its own metadata.
    for (const [key, value] of Object.entries(node) as [keyof DraftNode, unknown][]) {
      if (value === undefined || existing[key] !== undefined) continue
      Object.assign(existing, { [key]: value })
    }
    return node.id
  }

  addEdge(kind: NodeGraphEdgeKind, from: string, to: string, label?: string): void {
    if (from === to) return
    const id = edgeId(kind, from, to)
    if (this.edges.has(id)) return
    this.edges.set(id, { id, from, to, kind, ...(label ? { label } : {}) })
  }

  finish(builtAt: string, workspace?: string): NodeGraphProjection {
    const counts = this.countByKind()
    const kept = this.applyNodeCap()
    const keptIds = new Set(kept.map((node) => node.id))
    const degrees = new Map<string, number>()
    const edges: NodeGraphEdge[] = []
    let droppedEdges = 0
    for (const edge of this.edges.values()) {
      if (!keptIds.has(edge.from) || !keptIds.has(edge.to)) {
        droppedEdges += 1
        continue
      }
      if (edges.length >= this.limits.maxEdges) {
        droppedEdges += 1
        continue
      }
      edges.push(edge)
      degrees.set(edge.from, (degrees.get(edge.from) ?? 0) + 1)
      degrees.set(edge.to, (degrees.get(edge.to) ?? 0) + 1)
    }
    const truncated = kept.length < this.nodes.size || droppedEdges > 0
    if (kept.length < this.nodes.size) {
      this.diagnostic(
        `node cap reached: kept ${kept.length} of ${this.nodes.size} nodes`
      )
    }
    if (droppedEdges > 0) {
      this.diagnostic(`dropped ${droppedEdges} edges outside the visible node set`)
    }
    return {
      version: NODE_GRAPH_CONTRACT_VERSION,
      builtAt,
      ...(workspace ? { workspace } : {}),
      nodes: kept.map((node) => ({ ...node, degree: degrees.get(node.id) ?? 0 })),
      edges,
      counts,
      truncated,
      diagnostics: [...this.notes]
    }
  }

  private countByKind(): Record<NodeGraphNodeKind, number> {
    const counts = Object.fromEntries(
      NODE_GRAPH_KIND_PRIORITY.map((kind) => [kind, 0])
    ) as Record<NodeGraphNodeKind, number>
    for (const node of this.nodes.values()) counts[node.kind] += 1
    return counts
  }

  /**
   * Keeps whole priority tiers while they fit, then fills the remaining
   * budget from the first tier that overflows. Structural nodes therefore
   * never lose out to thousands of document sections.
   */
  private applyNodeCap(): DraftNode[] {
    if (this.nodes.size <= this.limits.maxNodes) return [...this.nodes.values()]
    const byKind = new Map<NodeGraphNodeKind, DraftNode[]>()
    for (const node of this.nodes.values()) {
      const bucket = byKind.get(node.kind)
      if (bucket) bucket.push(node)
      else byKind.set(node.kind, [node])
    }
    const kept: DraftNode[] = []
    for (const kind of NODE_GRAPH_KIND_PRIORITY) {
      const bucket = byKind.get(kind)
      if (!bucket) continue
      const room = this.limits.maxNodes - kept.length
      if (room <= 0) break
      kept.push(...bucket.slice(0, room))
    }
    return kept
  }
}

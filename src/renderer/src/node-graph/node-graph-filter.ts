import { matchesNodeGraphQuery, parseNodeGraphQuery } from './node-graph-query'
import type { NodeGraphGroup, NodeGraphSettings } from './node-graph-settings'
import type { NodeGraphEdge, NodeGraphNode, NodeGraphProjection } from './node-graph-types'

export type NodeGraphView = {
  nodes: NodeGraphNode[]
  edges: NodeGraphEdge[]
  /** Recomputed for the visible subgraph, so node radius reflects what shows. */
  degrees: Map<string, number>
  /** Group color per node id; absent means "use the kind color". */
  groupColors: Map<string, string>
  /** Nodes hidden by the current filters. */
  hiddenCount: number
}

/**
 * The subset of settings the filter pipeline reads. Typed narrowly so callers
 * can memoize on exactly these fields — display and physics changes must not
 * rebuild the view (and the analysis derived from it).
 */
export type NodeGraphFilterSettings = Pick<
  NodeGraphSettings,
  'search' | 'kinds' | 'minDegree' | 'showOrphans' | 'localDepth' | 'groups'
>

export type NodeGraphViewInput = {
  projection: NodeGraphProjection
  settings: NodeGraphFilterSettings
  /** When set, only nodes within `localDepth` hops of this node are shown. */
  focusNodeId?: string | null
}

/**
 * Applies the filter pipeline in a fixed order: node kind toggles, the search
 * lens, the local-graph radius, the min-degree cut, then the orphan toggle.
 * Order matters — hiding orphans last means a node stranded *by* the earlier
 * filters disappears too, which is what Obsidian shows.
 */
export function buildNodeGraphView(input: NodeGraphViewInput): NodeGraphView {
  const { projection, settings } = input
  const total = projection.nodes.length
  const searchTerms = parseNodeGraphQuery(settings.search)
  let visible = projection.nodes.filter((node) => settings.kinds[node.kind] !== false)
  if (searchTerms.length > 0) {
    visible = visible.filter((node) => matchesNodeGraphQuery(node, searchTerms))
  }
  let ids = new Set(visible.map((node) => node.id))
  const focusNodeId = input.focusNodeId ?? null
  if (focusNodeId && ids.has(focusNodeId)) {
    ids = localNeighborhood(projection.edges, ids, focusNodeId, settings.localDepth)
    visible = visible.filter((node) => ids.has(node.id))
  } else if (focusNodeId) {
    // A focus target the filters removed would otherwise blank the canvas.
    visible = []
    ids = new Set()
  }
  let edges = projection.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to))
  let degrees = degreeMap(edges)
  const minDegree = Math.max(0, Math.round(settings.minDegree))
  if (minDegree > 0) {
    // Applied once rather than iterated to a fixed point: repeatedly pruning
    // would cascade until only dense cores survived, which is not what a
    // "hide weakly connected nodes" control should mean.
    visible = visible.filter((node) => (degrees.get(node.id) ?? 0) >= minDegree)
    ids = new Set(visible.map((node) => node.id))
    edges = edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to))
    degrees = degreeMap(edges)
  }
  if (!settings.showOrphans) {
    visible = visible.filter((node) => (degrees.get(node.id) ?? 0) > 0)
    ids = new Set(visible.map((node) => node.id))
    edges = edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to))
    degrees = degreeMap(edges)
  }
  return {
    nodes: visible,
    edges,
    degrees,
    groupColors: resolveGroupColors(visible, settings.groups),
    hiddenCount: total - visible.length
  }
}

function degreeMap(edges: readonly NodeGraphEdge[]): Map<string, number> {
  const degrees = new Map<string, number>()
  for (const edge of edges) {
    degrees.set(edge.from, (degrees.get(edge.from) ?? 0) + 1)
    degrees.set(edge.to, (degrees.get(edge.to) ?? 0) + 1)
  }
  return degrees
}

/** Breadth-first expansion over undirected edges, bounded by `depth` hops. */
function localNeighborhood(
  edges: readonly NodeGraphEdge[],
  allowed: ReadonlySet<string>,
  focusNodeId: string,
  depth: number
): Set<string> {
  const adjacency = new Map<string, string[]>()
  const connect = (from: string, to: string): void => {
    const bucket = adjacency.get(from)
    if (bucket) bucket.push(to)
    else adjacency.set(from, [to])
  }
  for (const edge of edges) {
    if (!allowed.has(edge.from) || !allowed.has(edge.to)) continue
    connect(edge.from, edge.to)
    connect(edge.to, edge.from)
  }
  const reached = new Set([focusNodeId])
  let frontier = [focusNodeId]
  for (let hop = 0; hop < Math.max(1, depth); hop += 1) {
    const next: string[] = []
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        if (reached.has(neighbor)) continue
        reached.add(neighbor)
        next.push(neighbor)
      }
    }
    if (next.length === 0) break
    frontier = next
  }
  return reached
}

/**
 * Resolves each node's group colour.
 *
 * A hand-assigned node always keeps its group's colour: an explicit choice
 * must not be overridden by a pattern that happens to match. Only nodes with
 * no assignment fall through to the queries, where the first matching group
 * wins so group order reads as a visible priority list.
 */
export function resolveGroupColors(
  nodes: readonly NodeGraphNode[],
  groups: readonly NodeGraphGroup[]
): Map<string, string> {
  const colors = new Map<string, string>()
  if (groups.length === 0) return colors
  const assigned = new Map<string, string>()
  for (const group of groups) {
    for (const nodeId of group.nodeIds) {
      if (!assigned.has(nodeId)) assigned.set(nodeId, group.color)
    }
  }
  const compiled = groups
    .map((group) => ({ color: group.color, terms: parseNodeGraphQuery(group.query) }))
    .filter((group) => group.terms.length > 0)
  for (const node of nodes) {
    const explicit = assigned.get(node.id)
    if (explicit) {
      colors.set(node.id, explicit)
      continue
    }
    for (const group of compiled) {
      if (matchesNodeGraphQuery(node, group.terms)) {
        colors.set(node.id, group.color)
        break
      }
    }
  }
  return colors
}

/** Ids directly connected to `nodeId`, used for hover highlighting. */
export function neighborIds(edges: readonly NodeGraphEdge[], nodeId: string): Set<string> {
  const neighbors = new Set<string>()
  for (const edge of edges) {
    if (edge.from === nodeId) neighbors.add(edge.to)
    else if (edge.to === nodeId) neighbors.add(edge.from)
  }
  return neighbors
}

import { describe, expect, it } from 'vitest'
import {
  buildAdjacency,
  computeCentrality,
  computeClusters,
  findShortestPath,
  summarizeGraph
} from './node-graph-analysis'
import type { NodeGraphEdge, NodeGraphNode } from './node-graph-types'

function node(id: string): NodeGraphNode {
  return { id, kind: 'thread', label: id, degree: 0 }
}

function edge(from: string, to: string): NodeGraphEdge {
  return { id: `${from}-${to}`, from, to, kind: 'link' }
}

/** Two triangles joined by a single bridge, plus one isolated node. */
function twoCommunities(): { nodes: NodeGraphNode[]; edges: NodeGraphEdge[] } {
  return {
    nodes: ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'lonely'].map(node),
    edges: [
      edge('a1', 'a2'), edge('a2', 'a3'), edge('a3', 'a1'),
      edge('b1', 'b2'), edge('b2', 'b3'), edge('b3', 'b1'),
      edge('a1', 'b1')
    ]
  }
}

describe('buildAdjacency', () => {
  it('is undirected, sorted, and deduplicated', () => {
    const adjacency = buildAdjacency(
      [node('a'), node('b'), node('c')],
      [edge('b', 'a'), edge('a', 'c'), { ...edge('a', 'b'), id: 'dup' }]
    )
    expect(adjacency.get('a')).toEqual(['b', 'c'])
    expect(adjacency.get('b')).toEqual(['a'])
    expect(adjacency.get('c')).toEqual(['a'])
  })

  it('includes isolated nodes with an empty neighbour list', () => {
    const adjacency = buildAdjacency([node('a')], [])
    expect(adjacency.get('a')).toEqual([])
  })

  it('ignores self edges and edges to unknown nodes', () => {
    const adjacency = buildAdjacency([node('a')], [edge('a', 'a'), edge('a', 'ghost')])
    expect(adjacency.get('a')).toEqual([])
    expect(adjacency.has('ghost')).toBe(false)
  })
})

describe('computeCentrality', () => {
  it('handles an empty graph', () => {
    const result = computeCentrality(buildAdjacency([], []))
    expect(result.ranked).toEqual([])
  })

  it('ranks a hub above its leaves', () => {
    const nodes = ['hub', 'l1', 'l2', 'l3', 'l4'].map(node)
    const edges = ['l1', 'l2', 'l3', 'l4'].map((leaf) => edge('hub', leaf))
    const result = computeCentrality(buildAdjacency(nodes, edges))
    expect(result.ranked[0]!.id).toBe('hub')
    expect(result.ranked[0]!.degree).toBe(4)
  })

  it('separates equal-degree nodes by the shape of their neighbourhood', () => {
    // `a1` and `leafy` both have degree 3, but a1 sits in a triangle while
    // leafy's neighbours are dead ends. A pure degree ranking would tie them;
    // this is what PageRank buys over counting links.
    const nodes = ['a1', 'a2', 'a3', 'bridge', 'leafy', 'x1', 'x2', 'x3'].map(node)
    const edges = [
      edge('a1', 'a2'), edge('a2', 'a3'), edge('a3', 'a1'),
      edge('bridge', 'a1'), edge('bridge', 'a2'),
      edge('leafy', 'x1'), edge('leafy', 'x2'), edge('leafy', 'x3')
    ]
    const result = computeCentrality(buildAdjacency(nodes, edges))
    const score = (id: string): number => result.scores.get(id)!
    const degree = (id: string): number =>
      result.ranked.find((entry) => entry.id === id)!.degree
    expect(degree('a1')).toBe(degree('leafy'))
    expect(score('a1')).not.toBeCloseTo(score('leafy'), 6)
  })

  it('ranks every node above the isolated ones', () => {
    const { nodes, edges } = twoCommunities()
    const result = computeCentrality(buildAdjacency(nodes, edges))
    const connected = result.ranked.filter((entry) => entry.degree > 0)
    const lonely = result.ranked.find((entry) => entry.id === 'lonely')!
    for (const entry of connected) expect(entry.score).toBeGreaterThan(lonely.score)
  })

  it('keeps scores a normalized distribution even with isolated nodes', () => {
    const { nodes, edges } = twoCommunities()
    const result = computeCentrality(buildAdjacency(nodes, edges))
    const total = [...result.scores.values()].reduce((sum, score) => sum + score, 0)
    expect(total).toBeCloseTo(1, 5)
  })

  it('is deterministic', () => {
    const { nodes, edges } = twoCommunities()
    const first = computeCentrality(buildAdjacency(nodes, edges))
    const second = computeCentrality(buildAdjacency([...nodes].reverse(), [...edges].reverse()))
    expect(first.ranked.map((entry) => entry.id)).toEqual(second.ranked.map((entry) => entry.id))
  })
})

describe('computeClusters', () => {
  it('separates two communities joined by one bridge', () => {
    const { nodes, edges } = twoCommunities()
    const result = computeClusters(buildAdjacency(nodes, edges))
    const label = (id: string): number => result.labels.get(id)!
    expect(label('a2')).toBe(label('a3'))
    expect(label('b2')).toBe(label('b3'))
    expect(label('lonely')).not.toBe(label('a2'))
  })

  it('orders clusters largest first', () => {
    const nodes = ['a', 'b', 'c', 'd', 'solo'].map(node)
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'a'), edge('c', 'd')]
    const result = computeClusters(buildAdjacency(nodes, edges))
    expect(result.clusters[0]!.length).toBeGreaterThanOrEqual(result.clusters[1]!.length)
    expect(result.clusters.at(-1)).toEqual(['solo'])
  })

  it('gives every isolated node its own cluster', () => {
    const result = computeClusters(buildAdjacency(['a', 'b', 'c'].map(node), []))
    expect(result.clusters).toHaveLength(3)
    expect(result.clusters.every((members) => members.length === 1)).toBe(true)
  })

  it('is deterministic regardless of input order', () => {
    const { nodes, edges } = twoCommunities()
    const first = computeClusters(buildAdjacency(nodes, edges))
    const second = computeClusters(buildAdjacency([...nodes].reverse(), [...edges].reverse()))
    expect(first.clusters).toEqual(second.clusters)
  })

  it('assigns every node to exactly one cluster', () => {
    const { nodes, edges } = twoCommunities()
    const result = computeClusters(buildAdjacency(nodes, edges))
    expect(result.clusters.flat().sort()).toEqual(nodes.map((item) => item.id).sort())
  })
})

describe('findShortestPath', () => {
  const chain = {
    nodes: ['a', 'b', 'c', 'd', 'island'].map(node),
    edges: [edge('a', 'b'), edge('b', 'c'), edge('c', 'd')]
  }

  it('finds the hop sequence and the edges along it', () => {
    const adjacency = buildAdjacency(chain.nodes, chain.edges)
    const path = findShortestPath(adjacency, chain.edges, 'a', 'd')
    expect(path.nodeIds).toEqual(['a', 'b', 'c', 'd'])
    expect(path.edgeIds).toEqual(['a-b', 'b-c', 'c-d'])
    expect(path.hops).toBe(3)
  })

  it('reports zero hops for a node to itself', () => {
    const adjacency = buildAdjacency(chain.nodes, chain.edges)
    const path = findShortestPath(adjacency, chain.edges, 'b', 'b')
    expect(path.nodeIds).toEqual(['b'])
    expect(path.hops).toBe(0)
  })

  it('reports no path when the target is unreachable', () => {
    const adjacency = buildAdjacency(chain.nodes, chain.edges)
    const path = findShortestPath(adjacency, chain.edges, 'a', 'island')
    expect(path.hops).toBeNull()
    expect(path.nodeIds).toEqual([])
  })

  it('reports no path for an unknown endpoint', () => {
    const adjacency = buildAdjacency(chain.nodes, chain.edges)
    expect(findShortestPath(adjacency, chain.edges, 'a', 'ghost').hops).toBeNull()
    expect(findShortestPath(adjacency, chain.edges, 'ghost', 'a').hops).toBeNull()
  })

  it('takes the shorter of two routes', () => {
    const nodes = ['a', 'b', 'c', 'shortcut'].map(node)
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('a', 'shortcut'), edge('shortcut', 'c')]
    const path = findShortestPath(buildAdjacency(nodes, edges), edges, 'a', 'c')
    expect(path.hops).toBe(2)
  })

  it('works in both directions over undirected edges', () => {
    const adjacency = buildAdjacency(chain.nodes, chain.edges)
    expect(findShortestPath(adjacency, chain.edges, 'd', 'a').nodeIds)
      .toEqual(['d', 'c', 'b', 'a'])
  })

  it('is deterministic when two routes tie', () => {
    const nodes = ['a', 'left', 'right', 'z'].map(node)
    const edges = [
      edge('a', 'left'), edge('left', 'z'),
      edge('a', 'right'), edge('right', 'z')
    ]
    const adjacency = buildAdjacency(nodes, edges)
    const first = findShortestPath(adjacency, edges, 'a', 'z')
    const second = findShortestPath(adjacency, edges, 'a', 'z')
    expect(first.nodeIds).toEqual(second.nodeIds)
    expect(first.hops).toBe(2)
  })
})

describe('summarizeGraph', () => {
  it('counts orphans, clusters, and average degree', () => {
    const { nodes, edges } = twoCommunities()
    const adjacency = buildAdjacency(nodes, edges)
    const summary = summarizeGraph(nodes, edges, adjacency, computeClusters(adjacency))
    expect(summary.nodeCount).toBe(7)
    expect(summary.edgeCount).toBe(7)
    expect(summary.orphanIds).toEqual(['lonely'])
    expect(summary.averageDegree).toBeCloseTo(2, 5)
    expect(summary.largestClusterSize).toBeGreaterThan(1)
  })

  it('reports zero average degree for an empty graph', () => {
    const adjacency = buildAdjacency([], [])
    const summary = summarizeGraph([], [], adjacency, computeClusters(adjacency))
    expect(summary.averageDegree).toBe(0)
    expect(summary.clusterCount).toBe(0)
  })
})

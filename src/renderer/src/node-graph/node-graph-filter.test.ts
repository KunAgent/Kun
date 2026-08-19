import { describe, expect, it } from 'vitest'
import { buildNodeGraphView, neighborIds, resolveGroupColors } from './node-graph-filter'
import { DEFAULT_NODE_GRAPH_SETTINGS, type NodeGraphSettings } from './node-graph-settings'
import type { NodeGraphEdge, NodeGraphNode, NodeGraphProjection } from './node-graph-types'

function node(id: string, overrides: Partial<NodeGraphNode> = {}): NodeGraphNode {
  return { id, kind: 'thread', label: id, degree: 0, ...overrides }
}

function edge(from: string, to: string, kind: NodeGraphEdge['kind'] = 'link'): NodeGraphEdge {
  return { id: `${kind}|${from}|${to}`, from, to, kind }
}

/** a — b — c — d chain plus an unlinked orphan and one document. */
function projection(): NodeGraphProjection {
  return {
    version: 1,
    builtAt: '2026-08-18T00:00:00.000Z',
    nodes: [
      node('a'),
      node('b'),
      node('c'),
      node('d'),
      node('orphan'),
      node('doc', { kind: 'document', label: 'notes.md', path: 'notes/notes.md', folder: 'notes' })
    ],
    edges: [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('a', 'doc', 'touches')],
    counts: {},
    truncated: false,
    diagnostics: []
  }
}

function settings(overrides: Partial<NodeGraphSettings> = {}): NodeGraphSettings {
  return { ...DEFAULT_NODE_GRAPH_SETTINGS, ...overrides }
}

function ids(view: { nodes: NodeGraphNode[] }): string[] {
  return view.nodes.map((item) => item.id).sort()
}

describe('buildNodeGraphView', () => {
  it('keeps every node when no filter is active', () => {
    const view = buildNodeGraphView({ projection: projection(), settings: settings() })
    expect(ids(view)).toEqual(['a', 'b', 'c', 'd', 'doc', 'orphan'])
    expect(view.hiddenCount).toBe(0)
  })

  it('hides node kinds that are toggled off, and their edges', () => {
    const view = buildNodeGraphView({
      projection: projection(),
      settings: settings({ kinds: { ...DEFAULT_NODE_GRAPH_SETTINGS.kinds, document: false } })
    })
    expect(ids(view)).not.toContain('doc')
    expect(view.edges.some((item) => item.to === 'doc')).toBe(false)
    expect(view.hiddenCount).toBe(1)
  })

  it('narrows to search matches', () => {
    const view = buildNodeGraphView({
      projection: projection(),
      settings: settings({ search: 'notes' })
    })
    expect(ids(view)).toEqual(['doc'])
  })

  it('drops orphans only when the toggle is off', () => {
    const kept = buildNodeGraphView({ projection: projection(), settings: settings() })
    expect(ids(kept)).toContain('orphan')
    const dropped = buildNodeGraphView({
      projection: projection(),
      settings: settings({ showOrphans: false })
    })
    expect(ids(dropped)).not.toContain('orphan')
  })

  it('hides a node stranded by the kind filter when orphans are off', () => {
    // `doc` is only reachable through `a`; removing threads strands it.
    const view = buildNodeGraphView({
      projection: projection(),
      settings: settings({
        showOrphans: false,
        kinds: { ...DEFAULT_NODE_GRAPH_SETTINGS.kinds, thread: false }
      })
    })
    expect(ids(view)).toEqual([])
  })

  it('limits the local graph to the requested depth', () => {
    const depthOne = buildNodeGraphView({
      projection: projection(),
      settings: settings({ localDepth: 1 }),
      focusNodeId: 'a'
    })
    expect(ids(depthOne)).toEqual(['a', 'b', 'doc'])
    const depthTwo = buildNodeGraphView({
      projection: projection(),
      settings: settings({ localDepth: 2 }),
      focusNodeId: 'a'
    })
    expect(ids(depthTwo)).toEqual(['a', 'b', 'c', 'doc'])
    const depthFive = buildNodeGraphView({
      projection: projection(),
      settings: settings({ localDepth: 5 }),
      focusNodeId: 'a'
    })
    expect(ids(depthFive)).toEqual(['a', 'b', 'c', 'd', 'doc'])
  })

  it('renders nothing when the focused node is itself filtered out', () => {
    const view = buildNodeGraphView({
      projection: projection(),
      settings: settings({ kinds: { ...DEFAULT_NODE_GRAPH_SETTINGS.kinds, document: false } }),
      focusNodeId: 'doc'
    })
    expect(view.nodes).toEqual([])
    expect(view.edges).toEqual([])
  })

  it('recomputes degree against the visible subgraph', () => {
    const view = buildNodeGraphView({
      projection: projection(),
      settings: settings(),
      focusNodeId: 'a'
    })
    expect(view.degrees.get('a')).toBe(2)
    expect(view.degrees.get('b')).toBe(1)
  })

  it('colors nodes by the first matching group', () => {
    const view = buildNodeGraphView({
      projection: projection(),
      settings: settings({
        groups: [
          { id: 'g1', name: '', query: 'kind:document', color: '#111111', nodeIds: [] },
          { id: 'g2', name: '', query: 'folder:notes', color: '#222222', nodeIds: [] }
        ]
      })
    })
    expect(view.groupColors.get('doc')).toBe('#111111')
    expect(view.groupColors.has('a')).toBe(false)
  })
})

describe('minimum-degree filter', () => {
  it('hides nodes below the minimum connection count', () => {
    // Degrees in the fixture: a=2 (b, doc), b=2, c=2, d=1, doc=1, orphan=0.
    const view = buildNodeGraphView({
      projection: projection(),
      settings: settings({ minDegree: 2 })
    })
    expect(ids(view)).toEqual(['a', 'b', 'c'])
  })

  it('does not cascade the minimum-degree cut', () => {
    // `a` keeps its place even though losing `doc` drops it to one connection.
    // Pruning to a fixed point would strip it, and "hide weakly connected
    // nodes" is a single pass, not a repeated erosion.
    const view = buildNodeGraphView({
      projection: projection(),
      settings: settings({ minDegree: 2 })
    })
    expect(view.degrees.get('a')).toBe(1)
    expect(view.edges.map((edge) => edge.id).sort()).toEqual(['link|a|b', 'link|b|c'])
  })

  it('treats a zero minimum as no filter', () => {
    const view = buildNodeGraphView({
      projection: projection(),
      settings: settings({ minDegree: 0 })
    })
    expect(ids(view)).toEqual(['a', 'b', 'c', 'd', 'doc', 'orphan'])
  })
})

describe('hand-assigned group membership', () => {
  it('colors an explicitly assigned node with no query at all', () => {
    const colors = resolveGroupColors(
      [node('a'), node('b')],
      [{ id: 'g', name: 'Picked', query: '', color: '#abcdef', nodeIds: ['a'] }]
    )
    expect(colors.get('a')).toBe('#abcdef')
    expect(colors.has('b')).toBe(false)
  })

  it('lets an assignment override a query in an earlier group', () => {
    const colors = resolveGroupColors(
      [node('a')],
      [
        { id: 'broad', name: '', query: 'kind:thread', color: '#111111', nodeIds: [] },
        { id: 'picked', name: '', query: '', color: '#222222', nodeIds: ['a'] }
      ]
    )
    // An explicit choice must beat a pattern that happens to match.
    expect(colors.get('a')).toBe('#222222')
  })

  it('keeps the first group when the same node is listed twice', () => {
    const colors = resolveGroupColors(
      [node('a')],
      [
        { id: 'first', name: '', query: '', color: '#111111', nodeIds: ['a'] },
        { id: 'second', name: '', query: '', color: '#222222', nodeIds: ['a'] }
      ]
    )
    expect(colors.get('a')).toBe('#111111')
  })

  it('still applies queries to nodes with no assignment', () => {
    const colors = resolveGroupColors(
      [node('a'), node('doc', { kind: 'document' })],
      [{ id: 'g', name: '', query: 'kind:document', color: '#333333', nodeIds: ['a'] }]
    )
    expect(colors.get('a')).toBe('#333333')
    expect(colors.get('doc')).toBe('#333333')
  })
})

describe('group and neighbor helpers', () => {
  it('ignores groups with an empty query', () => {
    const colors = resolveGroupColors(
      [node('a')],
      [{ id: 'g', name: '', query: '  ', color: '#000000', nodeIds: [] }]
    )
    expect(colors.size).toBe(0)
  })

  it('collects neighbors in both edge directions', () => {
    const neighbors = neighborIds(projection().edges, 'b')
    expect([...neighbors].sort()).toEqual(['a', 'c'])
  })
})

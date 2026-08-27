import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNodeGraphStore } from './node-graph-store'
import {
  DEFAULT_NODE_GRAPH_SETTINGS,
  MAX_NODE_GRAPH_GROUPS
} from './node-graph-settings'
import { EMPTY_NODE_GRAPH_PROJECTION, type NodeGraphProjection } from './node-graph-types'

const client = vi.hoisted(() => ({ fetchNodeGraph: vi.fn(), fetchNodeGraphFolder: vi.fn() }))
vi.mock('./node-graph-client', () => client)

function projection(ids: string[]): NodeGraphProjection {
  return {
    version: 1,
    builtAt: '2026-08-18T00:00:00.000Z',
    nodes: ids.map((id) => ({ id, kind: 'thread' as const, label: id, degree: 0 })),
    edges: [],
    counts: {},
    truncated: false,
    diagnostics: []
  }
}

beforeEach(() => {
  client.fetchNodeGraph.mockReset()
  client.fetchNodeGraphFolder.mockReset()
  useNodeGraphStore.setState({
    projection: EMPTY_NODE_GRAPH_PROJECTION,
    status: 'idle',
    error: null,
    workspace: '',
    settings: { ...DEFAULT_NODE_GRAPH_SETTINGS },
    selectedNodeId: null,
    focusNodeId: null,
    pathFrom: null,
    pathTo: null,
    source: { kind: 'workspace', workspace: '' },
    workGraphOpen: false
  })
})

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
})

describe('useNodeGraphStore.load', () => {
  it('stores the projection and the requested workspace', async () => {
    client.fetchNodeGraph.mockResolvedValue(projection(['a']))
    await useNodeGraphStore.getState().load({ workspace: '/repo' })
    const state = useNodeGraphStore.getState()
    expect(state.status).toBe('ready')
    expect(state.workspace).toBe('/repo')
    expect(state.projection.nodes).toHaveLength(1)
    expect(client.fetchNodeGraph).toHaveBeenCalledWith({
      workspace: '/repo',
      includeChangedFiles: true
    })
  })

  it('records the error message on failure', async () => {
    client.fetchNodeGraph.mockRejectedValue(new Error('runtime offline'))
    await useNodeGraphStore.getState().load()
    expect(useNodeGraphStore.getState().status).toBe('error')
    expect(useNodeGraphStore.getState().error).toBe('runtime offline')
  })

  it('drops a stale response when a newer load is already in flight', async () => {
    let resolveFirst: (value: NodeGraphProjection) => void = () => undefined
    client.fetchNodeGraph.mockImplementationOnce(
      () => new Promise<NodeGraphProjection>((resolve) => { resolveFirst = resolve })
    )
    client.fetchNodeGraph.mockResolvedValueOnce(projection(['fresh']))
    const first = useNodeGraphStore.getState().load({ workspace: '/one' })
    await useNodeGraphStore.getState().load({ workspace: '/two' })
    resolveFirst(projection(['stale']))
    await first
    expect(useNodeGraphStore.getState().projection.nodes[0]!.id).toBe('fresh')
  })

  it('clears a selection and focus that the new projection no longer contains', async () => {
    client.fetchNodeGraph.mockResolvedValue(projection(['a']))
    useNodeGraphStore.setState({ selectedNodeId: 'gone', focusNodeId: 'gone' })
    await useNodeGraphStore.getState().load()
    expect(useNodeGraphStore.getState().selectedNodeId).toBeNull()
    expect(useNodeGraphStore.getState().focusNodeId).toBeNull()
  })

  it('keeps a selection that survives the reload', async () => {
    client.fetchNodeGraph.mockResolvedValue(projection(['a']))
    useNodeGraphStore.setState({ selectedNodeId: 'a', focusNodeId: 'a' })
    await useNodeGraphStore.getState().load()
    expect(useNodeGraphStore.getState().selectedNodeId).toBe('a')
    expect(useNodeGraphStore.getState().focusNodeId).toBe('a')
  })
})

describe('useNodeGraphStore settings', () => {
  it('toggles a node kind', () => {
    useNodeGraphStore.getState().toggleKind('memory')
    expect(useNodeGraphStore.getState().settings.kinds.memory).toBe(false)
    useNodeGraphStore.getState().toggleKind('memory')
    expect(useNodeGraphStore.getState().settings.kinds.memory).toBe(true)
  })

  it('refetches when the changed-file layer is toggled', async () => {
    client.fetchNodeGraph.mockResolvedValue(projection([]))
    useNodeGraphStore.getState().patchSettings({ includeChangedFiles: false })
    await Promise.resolve()
    await Promise.resolve()
    expect(client.fetchNodeGraph).toHaveBeenCalledWith({
      includeChangedFiles: false,
      refresh: true
    })
  })

  it('does not refetch for a display-only change', () => {
    useNodeGraphStore.getState().patchSettings({ nodeSize: 2 })
    expect(client.fetchNodeGraph).not.toHaveBeenCalled()
    expect(useNodeGraphStore.getState().settings.nodeSize).toBe(2)
  })

  it('adds, updates, and removes groups', () => {
    useNodeGraphStore.getState().addGroup({ query: 'kind:document', name: 'Docs' })
    const created = useNodeGraphStore.getState().settings.groups[0]!
    expect(created.query).toBe('kind:document')
    expect(created.name).toBe('Docs')
    useNodeGraphStore.getState().updateGroup(created.id, { query: 'kind:memory' })
    expect(useNodeGraphStore.getState().settings.groups[0]!.query).toBe('kind:memory')
    useNodeGraphStore.getState().removeGroup(created.id)
    expect(useNodeGraphStore.getState().settings.groups).toHaveLength(0)
  })

  it('gives each new group an unused palette color', () => {
    useNodeGraphStore.getState().addGroup()
    useNodeGraphStore.getState().addGroup()
    const [first, second] = useNodeGraphStore.getState().settings.groups
    expect(first!.color).not.toBe(second!.color)
  })

  it('normalizes a color written through updateGroup', () => {
    const id = useNodeGraphStore.getState().addGroup()!
    useNodeGraphStore.getState().updateGroup(id, { color: '#ABC' })
    expect(useNodeGraphStore.getState().settings.groups[0]!.color).toBe('#aabbcc')
    useNodeGraphStore.getState().updateGroup(id, { color: 'nonsense' })
    expect(useNodeGraphStore.getState().settings.groups[0]!.color).toBe('#aabbcc')
  })

  it('caps groups at the documented maximum and reports the refusal', () => {
    for (let index = 0; index < MAX_NODE_GRAPH_GROUPS; index += 1) {
      expect(useNodeGraphStore.getState().addGroup({ query: `q${index}` })).toBeTruthy()
    }
    expect(useNodeGraphStore.getState().addGroup({ query: 'overflow' })).toBeNull()
    expect(useNodeGraphStore.getState().settings.groups).toHaveLength(MAX_NODE_GRAPH_GROUPS)
  })
})

describe('useNodeGraphStore group membership', () => {
  it('assigns a node to a group', () => {
    const id = useNodeGraphStore.getState().addGroup({ name: 'Research' })!
    useNodeGraphStore.getState().assignNodesToGroup(['thread:a'], id)
    expect(useNodeGraphStore.getState().settings.groups[0]!.nodeIds).toEqual(['thread:a'])
  })

  it('moves a node rather than letting it sit in two groups', () => {
    const first = useNodeGraphStore.getState().addGroup({ name: 'One' })!
    const second = useNodeGraphStore.getState().addGroup({ name: 'Two' })!
    useNodeGraphStore.getState().assignNodesToGroup(['thread:a'], first)
    useNodeGraphStore.getState().assignNodesToGroup(['thread:a'], second)
    const groups = useNodeGraphStore.getState().settings.groups
    expect(groups.find((group) => group.id === first)!.nodeIds).toEqual([])
    expect(groups.find((group) => group.id === second)!.nodeIds).toEqual(['thread:a'])
  })

  it('does not duplicate a node already in the group', () => {
    const id = useNodeGraphStore.getState().addGroup()!
    useNodeGraphStore.getState().assignNodesToGroup(['thread:a'], id)
    useNodeGraphStore.getState().assignNodesToGroup(['thread:a'], id)
    expect(useNodeGraphStore.getState().settings.groups[0]!.nodeIds).toEqual(['thread:a'])
  })

  it('clears a node from whichever group holds it', () => {
    const id = useNodeGraphStore.getState().addGroup()!
    useNodeGraphStore.getState().assignNodesToGroup(['thread:a'], id)
    useNodeGraphStore.getState().clearNodesGroup(['thread:a'])
    expect(useNodeGraphStore.getState().settings.groups[0]!.nodeIds).toEqual([])
  })

  it('creates a group seeded with one node and named after it', () => {
    useNodeGraphStore.getState().createGroupForNodes(['thread:a'], 'Root chat')
    const group = useNodeGraphStore.getState().settings.groups[0]!
    expect(group.name).toBe('Root chat')
    expect(group.nodeIds).toEqual(['thread:a'])
    expect(group.query).toBe('')
  })

  it('moves the node out of its old group when a new one is created for it', () => {
    const existing = useNodeGraphStore.getState().addGroup({ name: 'Old' })!
    useNodeGraphStore.getState().assignNodesToGroup(['thread:a'], existing)
    useNodeGraphStore.getState().createGroupForNodes(['thread:a'], 'New')
    const groups = useNodeGraphStore.getState().settings.groups
    expect(groups.find((group) => group.id === existing)!.nodeIds).toEqual([])
    expect(groups.find((group) => group.name === 'New')!.nodeIds).toEqual(['thread:a'])
  })

  it('reuses a plain color group instead of piling up duplicates', () => {
    useNodeGraphStore.getState().colorNodes(['thread:a'], '#ff0000')
    useNodeGraphStore.getState().colorNodes(['thread:b'], '#ff0000')
    const groups = useNodeGraphStore.getState().settings.groups
    expect(groups).toHaveLength(1)
    expect(groups[0]!.nodeIds).toEqual(['thread:a', 'thread:b'])
  })

  it('never hijacks a named or query-driven group when coloring a node', () => {
    const named = useNodeGraphStore.getState().addGroup({ name: 'Research', color: '#ff0000' })!
    useNodeGraphStore.getState().colorNodes(['thread:a'], '#ff0000')
    const groups = useNodeGraphStore.getState().settings.groups
    expect(groups).toHaveLength(2)
    expect(groups.find((group) => group.id === named)!.nodeIds).toEqual([])
  })

  it('colors a hub and its children in one call', () => {
    useNodeGraphStore.getState().colorNodes(
      ['workspace:/repo', 'thread:a', 'thread:b'],
      '#123456'
    )
    const groups = useNodeGraphStore.getState().settings.groups
    expect(groups).toHaveLength(1)
    expect(groups[0]!.nodeIds).toEqual(['workspace:/repo', 'thread:a', 'thread:b'])
  })

  it('pulls children out of their old groups when coloring a hub', () => {
    const old = useNodeGraphStore.getState().addGroup({ name: 'Old' })!
    useNodeGraphStore.getState().assignNodesToGroup(['thread:a'], old)
    useNodeGraphStore.getState().colorNodes(['workspace:/repo', 'thread:a'], '#123456')
    const groups = useNodeGraphStore.getState().settings.groups
    expect(groups.find((group) => group.id === old)!.nodeIds).toEqual([])
    expect(groups.find((group) => group.color === '#123456')!.nodeIds)
      .toEqual(['workspace:/repo', 'thread:a'])
  })

  it('clears a hub and its children together', () => {
    useNodeGraphStore.getState().colorNodes(['workspace:/repo', 'thread:a'], '#123456')
    useNodeGraphStore.getState().clearNodesGroup(['workspace:/repo', 'thread:a'])
    expect(useNodeGraphStore.getState().settings.groups[0]!.nodeIds).toEqual([])
  })

  it('creates one group for a hub and its children', () => {
    useNodeGraphStore.getState().createGroupForNodes(
      ['workspace:/repo', 'thread:a'],
      'Repo'
    )
    const groups = useNodeGraphStore.getState().settings.groups
    expect(groups).toHaveLength(1)
    expect(groups[0]!.name).toBe('Repo')
    expect(groups[0]!.nodeIds).toEqual(['workspace:/repo', 'thread:a'])
  })

  it('ignores an assignment to a group that does not exist', () => {
    useNodeGraphStore.getState().addGroup({ name: 'Only' })
    useNodeGraphStore.getState().assignNodesToGroup(['thread:a'], 'missing')
    expect(useNodeGraphStore.getState().settings.groups[0]!.nodeIds).toEqual([])
  })

  it('ignores an empty target list', () => {
    const id = useNodeGraphStore.getState().addGroup()!
    useNodeGraphStore.getState().assignNodesToGroup([], id)
    useNodeGraphStore.getState().clearNodesGroup([])
    expect(useNodeGraphStore.getState().settings.groups[0]!.nodeIds).toEqual([])
  })

  it('recolors a node by moving it to the group for the new color', () => {
    useNodeGraphStore.getState().colorNodes(['thread:a'], '#ff0000')
    useNodeGraphStore.getState().colorNodes(['thread:a'], '#00ff00')
    const groups = useNodeGraphStore.getState().settings.groups
    expect(groups.find((group) => group.color === '#ff0000')!.nodeIds).toEqual([])
    expect(groups.find((group) => group.color === '#00ff00')!.nodeIds).toEqual(['thread:a'])
  })

  it('restores defaults on reset', () => {
    useNodeGraphStore.getState().patchSettings({ nodeSize: 3, showArrows: true })
    useNodeGraphStore.getState().resetSettings()
    expect(useNodeGraphStore.getState().settings).toEqual(DEFAULT_NODE_GRAPH_SETTINGS)
  })
})

describe('useNodeGraphStore selection', () => {
  it('selects the node it focuses', () => {
    useNodeGraphStore.getState().focusNode('a')
    expect(useNodeGraphStore.getState().focusNodeId).toBe('a')
    expect(useNodeGraphStore.getState().selectedNodeId).toBe('a')
  })

  it('leaves the selection alone when focus is cleared', () => {
    useNodeGraphStore.getState().focusNode('a')
    useNodeGraphStore.getState().focusNode(null)
    expect(useNodeGraphStore.getState().focusNodeId).toBeNull()
    expect(useNodeGraphStore.getState().selectedNodeId).toBe('a')
  })
})

describe('useNodeGraphStore path endpoints', () => {
  it('sets and clears both ends', () => {
    useNodeGraphStore.getState().setPathEndpoint('from', 'thread:a')
    useNodeGraphStore.getState().setPathEndpoint('to', 'thread:b')
    expect(useNodeGraphStore.getState().pathFrom).toBe('thread:a')
    expect(useNodeGraphStore.getState().pathTo).toBe('thread:b')
    useNodeGraphStore.getState().clearPath()
    expect(useNodeGraphStore.getState().pathFrom).toBeNull()
    expect(useNodeGraphStore.getState().pathTo).toBeNull()
  })

  it('drops endpoints the reloaded projection no longer contains', async () => {
    client.fetchNodeGraph.mockResolvedValue(projection(['thread:a']))
    useNodeGraphStore.setState({ pathFrom: 'thread:a', pathTo: 'thread:gone' })
    await useNodeGraphStore.getState().load()
    expect(useNodeGraphStore.getState().pathFrom).toBe('thread:a')
    expect(useNodeGraphStore.getState().pathTo).toBeNull()
  })
})

describe('useNodeGraphStore cluster groups', () => {
  it('creates one group per multi-member cluster and drops singletons', () => {
    useNodeGraphStore.getState().applyClusterGroups([
      ['a', 'b', 'c'],
      ['d', 'e'],
      ['solo']
    ])
    const groups = useNodeGraphStore.getState().settings.groups
    expect(groups).toHaveLength(2)
    expect(groups[0]!.nodeIds).toEqual(['a', 'b', 'c'])
    expect(groups[0]!.color).not.toBe(groups[1]!.color)
  })

  it('replaces existing groups rather than layering on them', () => {
    useNodeGraphStore.getState().addGroup({ name: 'Mine' })
    useNodeGraphStore.getState().applyClusterGroups([['a', 'b']])
    const groups = useNodeGraphStore.getState().settings.groups
    expect(groups).toHaveLength(1)
    expect(groups[0]!.name).toBe('Cluster 1')
  })

  it('does nothing when every cluster is a singleton', () => {
    useNodeGraphStore.getState().addGroup({ name: 'Mine' })
    useNodeGraphStore.getState().applyClusterGroups([['a'], ['b']])
    expect(useNodeGraphStore.getState().settings.groups[0]!.name).toBe('Mine')
  })
})

describe('useNodeGraphStore background refresh', () => {
  function folderProjection(ids: string[], builtAt = 'a'): NodeGraphProjection {
    return { ...projection(ids), builtAt }
  }

  it('does not flip into the loading state', async () => {
    client.fetchNodeGraphFolder.mockResolvedValue(folderProjection(['a']))
    await useNodeGraphStore.getState().loadFolder(['/vault'])
    const statuses: string[] = []
    const unsubscribe = useNodeGraphStore.subscribe((state) => statuses.push(state.status))
    await useNodeGraphStore.getState().loadFolder(['/vault'], { background: true })
    unsubscribe()
    expect(statuses).not.toContain('loading')
  })

  it('keeps the same projection object when nothing changed', async () => {
    client.fetchNodeGraphFolder.mockResolvedValue(folderProjection(['a'], 'first'))
    await useNodeGraphStore.getState().loadFolder(['/vault'])
    const before = useNodeGraphStore.getState().projection
    // Only `builtAt` differs, as it does on every rebuild.
    client.fetchNodeGraphFolder.mockResolvedValue(folderProjection(['a'], 'second'))
    await useNodeGraphStore.getState().loadFolder(['/vault'], { background: true })
    expect(useNodeGraphStore.getState().projection).toBe(before)
  })

  it('replaces the projection when a node appears', async () => {
    client.fetchNodeGraphFolder.mockResolvedValue(folderProjection(['a']))
    await useNodeGraphStore.getState().loadFolder(['/vault'])
    const before = useNodeGraphStore.getState().projection
    client.fetchNodeGraphFolder.mockResolvedValue(folderProjection(['a', 'b']))
    await useNodeGraphStore.getState().loadFolder(['/vault'], { background: true })
    expect(useNodeGraphStore.getState().projection).not.toBe(before)
    expect(useNodeGraphStore.getState().projection.nodes).toHaveLength(2)
  })

  it('replaces the projection when only an edge appears', async () => {
    client.fetchNodeGraphFolder.mockResolvedValue(folderProjection(['a', 'b']))
    await useNodeGraphStore.getState().loadFolder(['/vault'])
    const linked = {
      ...folderProjection(['a', 'b']),
      edges: [{ id: 'link|a|b', from: 'a', to: 'b', kind: 'link' as const }]
    }
    client.fetchNodeGraphFolder.mockResolvedValue(linked)
    await useNodeGraphStore.getState().loadFolder(['/vault'], { background: true })
    expect(useNodeGraphStore.getState().projection.edges).toHaveLength(1)
  })

  it('replaces the projection when only node metadata changed', async () => {
    client.fetchNodeGraphFolder.mockResolvedValue(folderProjection(['a']))
    await useNodeGraphStore.getState().loadFolder(['/vault'])
    const before = useNodeGraphStore.getState().projection
    // Identical topology, but the note was renamed: same id, new label.
    const renamed = {
      ...folderProjection(['a'], 'second'),
      nodes: [{ id: 'a', kind: 'thread' as const, label: 'renamed', degree: 0 }]
    }
    client.fetchNodeGraphFolder.mockResolvedValue(renamed)
    await useNodeGraphStore.getState().loadFolder(['/vault'], { background: true })
    expect(useNodeGraphStore.getState().projection).not.toBe(before)
    expect(useNodeGraphStore.getState().projection.nodes[0]!.label).toBe('renamed')
  })

  it('coalesces polls: a tick during a slow scan is dropped, the scan still lands', async () => {
    client.fetchNodeGraphFolder.mockResolvedValue(folderProjection(['a']))
    await useNodeGraphStore.getState().loadFolder(['/vault'])
    client.fetchNodeGraphFolder.mockClear()
    let release!: (value: NodeGraphProjection) => void
    client.fetchNodeGraphFolder.mockImplementationOnce(
      () => new Promise<NodeGraphProjection>((resolve) => {
        release = resolve
      })
    )
    const slowPoll = useNodeGraphStore.getState().loadFolder(['/vault'], { background: true })
    // The next tick arrives while the scan is still running: dropped, not queued.
    await useNodeGraphStore.getState().loadFolder(['/vault'], { background: true })
    expect(client.fetchNodeGraphFolder).toHaveBeenCalledTimes(1)
    release(folderProjection(['a', 'b'], 'later'))
    await slowPoll
    // The slow scan's own result is applied — before, the next tick's token
    // bump would have discarded it, and a large workspace never refreshed.
    expect(useNodeGraphStore.getState().projection.nodes).toHaveLength(2)
  })

  it('never lets a background poll discard a foreground load', async () => {
    client.fetchNodeGraphFolder.mockResolvedValue(folderProjection(['a']))
    await useNodeGraphStore.getState().loadFolder(['/vault'])
    let release!: (value: NodeGraphProjection) => void
    client.fetchNodeGraphFolder.mockImplementationOnce(
      () => new Promise<NodeGraphProjection>((resolve) => {
        release = resolve
      })
    )
    const slowPoll = useNodeGraphStore.getState().loadFolder(['/vault'], { background: true })
    client.fetchNodeGraphFolder.mockResolvedValue(folderProjection(['a', 'b'], 'fg'))
    await useNodeGraphStore.getState().loadFolder(['/vault'])
    release(folderProjection(['stale'], 'bg'))
    await slowPoll
    const ids = useNodeGraphStore.getState().projection.nodes.map((node) => node.id)
    expect(ids).toEqual(['a', 'b'])
  })

  it('keeps the graph on screen when a background poll fails', async () => {
    client.fetchNodeGraphFolder.mockResolvedValue(folderProjection(['a']))
    await useNodeGraphStore.getState().loadFolder(['/vault'])
    client.fetchNodeGraphFolder.mockRejectedValue(new Error('transient'))
    await useNodeGraphStore.getState().loadFolder(['/vault'], { background: true })
    expect(useNodeGraphStore.getState().status).toBe('ready')
    expect(useNodeGraphStore.getState().error).toBeNull()
    expect(useNodeGraphStore.getState().projection.nodes).toHaveLength(1)
  })

  it('still surfaces a failure for an explicit load', async () => {
    client.fetchNodeGraphFolder.mockRejectedValue(new Error('broken'))
    await useNodeGraphStore.getState().loadFolder(['/vault'])
    expect(useNodeGraphStore.getState().status).toBe('error')
  })
})

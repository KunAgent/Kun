import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_NODE_GRAPH_SETTINGS,
  MAX_NODE_GRAPH_GROUPS,
  NODE_GRAPH_SETTINGS_KEY,
  groupForNode,
  USER_TOGGLEABLE_NODE_KINDS,
  nextGroupColor,
  normalizeNodeGraphColor,
  nodeGraphSliderRange,
  normalizeNodeGraphSettings,
  readStoredNodeGraphSettings,
  writeStoredNodeGraphSettings
} from './node-graph-settings'
import { NODE_GRAPH_NODE_KINDS } from './node-graph-types'

function installStorage(): Map<string, string> {
  const entries = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key)
  }
  return entries
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
})

describe('normalizeNodeGraphSettings', () => {
  it('falls back to defaults for absent input', () => {
    expect(normalizeNodeGraphSettings(undefined)).toEqual(DEFAULT_NODE_GRAPH_SETTINGS)
  })

  it('clamps sliders into their declared range', () => {
    const settings = normalizeNodeGraphSettings({
      nodeSize: 99,
      linkDistance: -50,
      centerForce: 4,
      localDepth: 12
    })
    expect(settings.nodeSize).toBe(nodeGraphSliderRange('nodeSize').max)
    expect(settings.linkDistance).toBe(nodeGraphSliderRange('linkDistance').min)
    expect(settings.centerForce).toBe(nodeGraphSliderRange('centerForce').max)
    expect(settings.localDepth).toBe(nodeGraphSliderRange('localDepth').max)
  })

  it('rejects non-numeric slider values', () => {
    const settings = normalizeNodeGraphSettings({ nodeSize: 'big', repelForce: null })
    expect(settings.nodeSize).toBe(DEFAULT_NODE_GRAPH_SETTINGS.nodeSize)
    expect(settings.repelForce).toBe(DEFAULT_NODE_GRAPH_SETTINGS.repelForce)
  })

  it('restores every kind from storage now that the legend toggles them all', () => {
    const settings = normalizeNodeGraphSettings({
      kinds: { workspace: false, thread: false, document: false, memory: false, section: true }
    })
    for (const kind of ['workspace', 'thread', 'document', 'memory'] as const) {
      expect(settings.kinds[kind]).toBe(false)
    }
    expect(settings.kinds.section).toBe(true)
  })

  it('only restores kinds that have a control', () => {
    // The guard that makes the above safe: a kind absent from this list would
    // take its default instead, so a stored value can never strand a kind with
    // no way to switch it back on.
    expect(USER_TOGGLEABLE_NODE_KINDS).toEqual(NODE_GRAPH_NODE_KINDS)
  })

  it('ignores unknown kinds and non-boolean values', () => {
    const settings = normalizeNodeGraphSettings({
      kinds: { bogus: false, thread: 'yes' }
    })
    expect('bogus' in settings.kinds).toBe(false)
    expect(settings.kinds.thread).toBe(true)
  })

  it('repairs group ids and colors and drops non-object entries', () => {
    const settings = normalizeNodeGraphSettings({
      groups: [
        { query: 'kind:thread' },
        { id: 'g2', query: 'kind:document', color: 'not-a-color' },
        { id: 'g3', color: '#123456' },
        'nonsense'
      ]
    })
    // A group with only a colour is now valid: it is a colour slot awaiting
    // hand-assigned nodes.
    expect(settings.groups).toHaveLength(3)
    expect(settings.groups[0]!.id).toBe('group-1')
    expect(settings.groups[0]!.name).toBe('')
    expect(settings.groups[0]!.nodeIds).toEqual([])
    expect(settings.groups[1]!.color).toMatch(/^#[0-9a-f]{6}$/i)
    expect(settings.groups[2]!.color).toBe('#123456')
    expect(settings.groups[2]!.query).toBe('')
  })

  it('normalizes shorthand hex and rejects junk colors', () => {
    expect(normalizeNodeGraphColor('#ABC', '#000000')).toBe('#aabbcc')
    expect(normalizeNodeGraphColor('  #A1B2C3 ', '#000000')).toBe('#a1b2c3')
    expect(normalizeNodeGraphColor('red', '#000000')).toBe('#000000')
    expect(normalizeNodeGraphColor(42, '#000000')).toBe('#000000')
  })

  it('keeps assigned node ids, deduplicated', () => {
    const settings = normalizeNodeGraphSettings({
      groups: [{ id: 'g', nodeIds: ['thread:a', 'thread:a', ' ', 7, 'thread:b'] }]
    })
    expect(settings.groups[0]!.nodeIds).toEqual(['thread:a', 'thread:b'])
  })

  it('reports the group a node is assigned to', () => {
    const groups = [
      { id: 'g1', name: '', query: '', color: '#111111', nodeIds: ['thread:a'] },
      { id: 'g2', name: '', query: '', color: '#222222', nodeIds: ['thread:b'] }
    ]
    expect(groupForNode(groups, 'thread:b')?.id).toBe('g2')
    expect(groupForNode(groups, 'thread:z')).toBeNull()
  })

  it('caps groups at the documented maximum', () => {
    const settings = normalizeNodeGraphSettings({
      groups: Array.from({ length: 90 }, (_, index) => ({ query: `q${index}` }))
    })
    expect(settings.groups).toHaveLength(MAX_NODE_GRAPH_GROUPS)
  })

  it('treats absent booleans as their default rather than false', () => {
    const settings = normalizeNodeGraphSettings({})
    expect(settings.showOrphans).toBe(true)
    expect(settings.includeChangedFiles).toBe(true)
    // Arrows and edge labels ship on: link direction is the thing the graph is
    // read for, and an undirected line hides it.
    expect(settings.showArrows).toBe(true)
    expect(settings.showEdgeLabels).toBe(true)
    expect(settings.showMinimap).toBe(true)
  })
})

describe('settings persistence', () => {
  it('round-trips through storage without persisting the search lens', () => {
    const entries = installStorage()
    writeStoredNodeGraphSettings({
      ...DEFAULT_NODE_GRAPH_SETTINGS,
      search: 'kind:document',
      nodeSize: 2
    })
    expect(JSON.parse(entries.get(NODE_GRAPH_SETTINGS_KEY)!).search).toBe('')
    const restored = readStoredNodeGraphSettings()
    expect(restored.nodeSize).toBe(2)
    expect(restored.search).toBe('')
  })

  it('falls back to defaults when stored data is corrupt', () => {
    const entries = installStorage()
    entries.set(NODE_GRAPH_SETTINGS_KEY, '{not json')
    expect(readStoredNodeGraphSettings()).toEqual(DEFAULT_NODE_GRAPH_SETTINGS)
  })

  it('returns defaults with no storage available', () => {
    expect(readStoredNodeGraphSettings()).toEqual(DEFAULT_NODE_GRAPH_SETTINGS)
  })
})

describe('nextGroupColor', () => {
  it('cycles the palette so consecutive groups differ', () => {
    const first = nextGroupColor([])
    const second = nextGroupColor([{ id: 'a', name: '', query: '', color: first, nodeIds: [] }])
    expect(second).not.toBe(first)
  })
})

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { KUN_NODE_ICON_SOURCES, kunNodeIcon, loadKunNodeIcons } from './node-graph-kun-icons'
import { KUN_NODE_STYLE_KINDS } from '../../node-graph/kun-node-style'

describe('KUN_NODE_ICON_SOURCES', () => {
  it('has artwork for every Kun-styled kind', () => {
    for (const kind of KUN_NODE_STYLE_KINDS) {
      // A data URI, not a file URL: a `file://` image taints the canvas in the
      // packaged app and takes Save as PNG down with it.
      expect(KUN_NODE_ICON_SOURCES[kind], kind).toMatch(/^data:image\/svg\+xml[,;]/)
    }
    expect(Object.keys(KUN_NODE_ICON_SOURCES).sort()).toEqual([...KUN_NODE_STYLE_KINDS].sort())
  })

  it('gives each kind its own file', () => {
    const sources = Object.values(KUN_NODE_ICON_SOURCES)
    expect(new Set(sources).size).toBe(sources.length)
  })
})

describe('kunNodeIcon', () => {
  it('has nothing for a kind without artwork, so the painter keeps the silhouette', () => {
    expect(kunNodeIcon('memory')).toBeNull()
    expect(kunNodeIcon('tag')).toBeNull()
  })

  it('withholds an icon until it has actually decoded', () => {
    // Nothing fetches images here, so every icon stays undecodable — which is
    // the state the painter has to survive on its first Kun-style frame.
    loadKunNodeIcons(() => undefined)
    for (const kind of KUN_NODE_STYLE_KINDS) {
      expect(kunNodeIcon(kind), kind).toBeNull()
    }
  })

  it('is safe to call repeatedly', () => {
    expect(() => {
      loadKunNodeIcons(() => undefined)
      loadKunNodeIcons(() => undefined)
    }).not.toThrow()
  })
})

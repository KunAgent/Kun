import { describe, expect, it } from 'vitest'
import {
  CITATION_GRAPH_MAX_NODES,
  layoutCitationGraph,
  pickCitationGraphNeighbors
} from './paper-citation-graph'
import type { PaperLibraryEntry, PaperReferenceItem } from '@shared/paper/paper-library-types'

const ref = (n: number, extra: Partial<PaperReferenceItem> = {}): PaperReferenceItem => ({
  n,
  title: `Paper ${n}`,
  ...extra
})

const entry = (arxivId: string): PaperLibraryEntry => ({
  unitDir: `papers/${arxivId}`,
  meta: {
    version: 2,
    title: arxivId,
    slug: arxivId,
    authors: [],
    importedAt: '2024-01-01',
    arxivId
  },
  hasPdf: true,
  hasNotes: false,
  interpretationCount: 0,
  group: ''
})

describe('pickCitationGraphNeighbors', () => {
  it('puts in-library and resolvable items first, capped at max', () => {
    const items = [
      ref(1),
      ref(2, { doi: '10.1/a' }),
      ref(3, { arxivId: '2401.00003' }),
      ref(4),
      ref(5)
    ]
    const picked = pickCitationGraphNeighbors(items, [entry('2401.00003')])
    expect(picked[0].ref.n).toBe(3)
    expect(picked[0].inLibrary?.meta.arxivId).toBe('2401.00003')
    expect(picked[1].ref.n).toBe(2)
  })

  it('caps the neighbor count', () => {
    const items = Array.from({ length: 40 }, (_, i) => ref(i + 1))
    expect(pickCitationGraphNeighbors(items, [])).toHaveLength(CITATION_GRAPH_MAX_NODES)
  })

  it('returns empty for no items', () => {
    expect(pickCitationGraphNeighbors([], [])).toEqual([])
  })
})

describe('layoutCitationGraph', () => {
  it('spreads neighbors on the ring inside the box', () => {
    const neighbors = pickCitationGraphNeighbors(
      Array.from({ length: 8 }, (_, i) => ref(i + 1)),
      []
    )
    const layout = layoutCitationGraph(neighbors)
    expect(layout).toHaveLength(8)
    for (const node of layout) {
      expect(node.x).toBeGreaterThan(0)
      expect(node.x).toBeLessThan(1)
      expect(node.y).toBeGreaterThan(0)
      expect(node.y).toBeLessThan(1)
    }
  })

  it('places the first neighbor at the top', () => {
    const layout = layoutCitationGraph(
      pickCitationGraphNeighbors([ref(1)], [])
    )
    expect(layout[0].x).toBeCloseTo(0.5, 5)
    expect(layout[0].y).toBeLessThan(0.2)
  })

  it('handles zero neighbors', () => {
    expect(layoutCitationGraph([])).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import type { PrototypeFlowEdge } from '../../../design/canvas/prototype-flow'
import { prototypeFlowPath, visiblePrototypeFlowEdges } from './PrototypeFlowOverlay'

function edge(patch: Partial<PrototypeFlowEdge>): PrototypeFlowEdge {
  return {
    id: 'home->signup',
    sourceArtifactId: 'home',
    targetArtifactId: 'signup',
    sourceTitle: 'Home',
    targetTitle: 'Signup',
    x1: 1280,
    y1: 400,
    x2: 1500,
    y2: 400,
    controlX: 1390,
    controlY: -96,
    kind: 'explicit',
    direct: true,
    ...patch
  }
}

describe('prototype flow overlay', () => {
  it('never draws reading-order guesses and scopes links to the selection by default', () => {
    const authored = edge({})
    const other = edge({ id: 'a->b', sourceArtifactId: 'a', targetArtifactId: 'b' })
    const guessed = edge({ id: 'guess', kind: 'fallback' })
    const edges = [authored, other, guessed]

    expect(visiblePrototypeFlowEdges(edges, new Set(), false)).toEqual([])
    expect(visiblePrototypeFlowEdges(edges, new Set(['signup']), false)).toEqual([authored])
    expect(visiblePrototypeFlowEdges(edges, new Set(), true)).toEqual([authored, other])
  })

  it('joins neighbouring boards with an inset S-curve', () => {
    const path = prototypeFlowPath(edge({ y2: 500 }), 10)
    expect(path.d).toBe('M 1290 400 C 1390 400 1390 500 1490 500')
    expect(path).toMatchObject({ midX: 1390, midY: 450 })

    const vertical = prototypeFlowPath(edge({ x2: 1280, y2: 1200 }), 10)
    expect(vertical.d).toBe('M 1280 410 C 1280 800 1280 800 1280 1190')
  })

  it('keeps the lane route when another board is in the way', () => {
    const path = prototypeFlowPath(edge({ direct: false, x2: 4000 }), 10)
    expect(path.d).toBe('M 1280 400 Q 1390 -96 4000 400')
    expect(path.midY).toBe(0.25 * 400 + 0.5 * -96 + 0.25 * 400)
  })
})

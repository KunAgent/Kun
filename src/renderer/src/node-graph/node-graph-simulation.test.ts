import { describe, expect, it } from 'vitest'
import { NodeGraphSimulation, type NodeGraphForces } from './node-graph-simulation'

const FORCES: NodeGraphForces = {
  centerForce: 0.12,
  repelForce: 1,
  linkForce: 0.35,
  linkDistance: 90
}

function nodes(count: number): { id: string }[] {
  return Array.from({ length: count }, (_, index) => ({ id: `n${index}` }))
}

function distance(
  simulation: NodeGraphSimulation,
  left: string,
  right: string
): number {
  const a = simulation.node(left)!
  const b = simulation.node(right)!
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function snapshot(simulation: NodeGraphSimulation): string {
  return JSON.stringify(
    simulation.nodePositions().map((node) => [node.id, node.x.toFixed(6), node.y.toFixed(6)])
  )
}

describe('NodeGraphSimulation', () => {
  it('seeds deterministic positions with no overlap', () => {
    const first = new NodeGraphSimulation(FORCES)
    const second = new NodeGraphSimulation(FORCES)
    first.setGraph(nodes(20), [])
    second.setGraph(nodes(20), [])
    expect(snapshot(first)).toBe(snapshot(second))
    expect(distance(first, 'n0', 'n1')).toBeGreaterThan(0)
  })

  it('produces the same layout from the same input every run', () => {
    const edges = [
      { from: 'n0', to: 'n1' },
      { from: 'n1', to: 'n2' },
      { from: 'n2', to: 'n0' }
    ]
    const first = new NodeGraphSimulation(FORCES)
    const second = new NodeGraphSimulation(FORCES)
    first.setGraph(nodes(3), edges)
    second.setGraph(nodes(3), edges)
    first.run(200)
    second.run(200)
    expect(snapshot(first)).toBe(snapshot(second))
  })

  it('pulls linked nodes toward the configured link distance', () => {
    const simulation = new NodeGraphSimulation({ ...FORCES, centerForce: 0, repelForce: 0 })
    simulation.setGraph(nodes(2), [{ from: 'n0', to: 'n1' }])
    simulation.run(400)
    expect(distance(simulation, 'n0', 'n1')).toBeCloseTo(90, 0)
  })

  it('honours a shorter link distance', () => {
    const simulation = new NodeGraphSimulation({
      ...FORCES,
      centerForce: 0,
      repelForce: 0,
      linkDistance: 30
    })
    simulation.setGraph(nodes(2), [{ from: 'n0', to: 'n1' }])
    simulation.run(400)
    expect(distance(simulation, 'n0', 'n1')).toBeCloseTo(30, 0)
  })

  it('pushes unlinked nodes apart under repulsion alone', () => {
    const simulation = new NodeGraphSimulation({ ...FORCES, centerForce: 0, linkForce: 0 })
    simulation.setGraph(nodes(2), [])
    const before = distance(simulation, 'n0', 'n1')
    simulation.run(200)
    expect(distance(simulation, 'n0', 'n1')).toBeGreaterThan(before)
  })

  it('separates nodes that start at the same point', () => {
    const simulation = new NodeGraphSimulation({ ...FORCES, centerForce: 0, linkForce: 0 })
    simulation.setGraph(nodes(2), [])
    simulation.pin('n0', 0, 0)
    simulation.pin('n1', 0, 0)
    simulation.release('n0')
    simulation.release('n1')
    simulation.run(80)
    expect(distance(simulation, 'n0', 'n1')).toBeGreaterThan(1)
  })

  it('compacts the layout as center force rises', () => {
    const loose = new NodeGraphSimulation({ ...FORCES, centerForce: 0.02 })
    const tight = new NodeGraphSimulation({ ...FORCES, centerForce: 0.9 })
    const graph = nodes(24)
    loose.setGraph(graph, [])
    tight.setGraph(graph, [])
    loose.run(400)
    tight.run(400)
    const spread = (simulation: NodeGraphSimulation): number =>
      Math.max(...simulation.nodePositions().map((node) => Math.hypot(node.x, node.y)))
    expect(spread(tight)).toBeLessThan(spread(loose))
  })

  it('keeps positions of nodes that survive a graph swap', () => {
    const simulation = new NodeGraphSimulation(FORCES)
    simulation.setGraph(nodes(4), [{ from: 'n0', to: 'n1' }])
    simulation.run(120)
    const before = simulation.node('n1')!
    const kept = { x: before.x, y: before.y }
    simulation.setGraph([{ id: 'n1' }, { id: 'n2' }], [])
    expect(simulation.node('n1')!.x).toBe(kept.x)
    expect(simulation.node('n1')!.y).toBe(kept.y)
    expect(simulation.node('n0')).toBeUndefined()
  })

  it('holds a pinned node exactly where it was placed', () => {
    const simulation = new NodeGraphSimulation(FORCES)
    simulation.setGraph(nodes(3), [{ from: 'n0', to: 'n1' }])
    simulation.pin('n0', 42, -17)
    simulation.run(50)
    expect(simulation.node('n0')!.x).toBe(42)
    expect(simulation.node('n0')!.y).toBe(-17)
    simulation.release('n0')
    simulation.run(50)
    expect(simulation.node('n0')!.x).not.toBe(42)
  })

  it('settles and stops ticking', () => {
    const simulation = new NodeGraphSimulation(FORCES)
    simulation.setGraph(nodes(3), [])
    simulation.run(5_000)
    expect(simulation.settled).toBe(true)
    expect(simulation.tick()).toBe(false)
  })

  it('reheats when a force changes so the layout re-relaxes', () => {
    const simulation = new NodeGraphSimulation(FORCES)
    simulation.setGraph(nodes(3), [])
    simulation.run(5_000)
    expect(simulation.settled).toBe(true)
    simulation.setForces({ ...FORCES, linkDistance: 200 })
    expect(simulation.settled).toBe(false)
    expect(simulation.tick()).toBe(true)
  })

  it('does not reheat when the same forces are reapplied', () => {
    const simulation = new NodeGraphSimulation(FORCES)
    simulation.setGraph(nodes(3), [])
    simulation.run(5_000)
    simulation.setForces({ ...FORCES })
    expect(simulation.settled).toBe(true)
  })

  it('ignores self edges and edges to missing nodes', () => {
    const simulation = new NodeGraphSimulation(FORCES)
    simulation.setGraph(nodes(2), [
      { from: 'n0', to: 'n0' },
      { from: 'n0', to: 'missing' }
    ])
    expect(() => simulation.run(20)).not.toThrow()
    expect(Number.isFinite(simulation.node('n0')!.x)).toBe(true)
  })

  it('keeps every coordinate finite on a dense graph', () => {
    const simulation = new NodeGraphSimulation(FORCES)
    const graph = nodes(120)
    const edges = graph.slice(1).map((node, index) => ({ from: graph[index]!.id, to: node.id }))
    simulation.setGraph(graph, edges)
    simulation.run(300)
    for (const node of simulation.nodePositions()) {
      expect(Number.isFinite(node.x)).toBe(true)
      expect(Number.isFinite(node.y)).toBe(true)
    }
  })
})

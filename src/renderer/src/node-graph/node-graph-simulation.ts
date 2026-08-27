/**
 * Deterministic force-directed layout for the Node Graph canvas.
 *
 * Obsidian exposes exactly four dials — center, repel, link, link distance —
 * and this simulation maps one-to-one onto them so the settings panel means
 * what it says. There is no `Math.random()` anywhere: seed positions come from
 * a phyllotaxis spiral, so the same graph always relaxes into the same layout
 * and the behaviour is unit-testable.
 *
 * Repulsion uses a uniform spatial hash bounded by a cutoff radius rather than
 * an all-pairs pass, which is what keeps a few thousand nodes interactive.
 */

export type NodeGraphForces = {
  centerForce: number
  repelForce: number
  linkForce: number
  linkDistance: number
}

export type SimulationNode = {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  /** Set while the pointer drags a node; forces are applied but not motion. */
  pinned: boolean
}

type SimulationLink = {
  source: SimulationNode
  target: SimulationNode
  /** Inverse-degree bias, so hubs move less than leaves (as in d3-force). */
  bias: number
}

const ALPHA_MIN = 0.002
const ALPHA_DECAY = 0.0228
const VELOCITY_DECAY = 0.4
const REPEL_SCALE = 420
const PHI = Math.PI * (3 - Math.sqrt(5))

export class NodeGraphSimulation {
  private nodes: SimulationNode[] = []
  private byId = new Map<string, SimulationNode>()
  private links: SimulationLink[] = []
  /** Canonical endpoint-pair signature of `links`, for change detection. */
  private linkSignature = ''
  private forces: NodeGraphForces
  private currentAlpha = 1

  constructor(forces: NodeGraphForces) {
    this.forces = { ...forces }
  }

  get alpha(): number {
    return this.currentAlpha
  }

  get settled(): boolean {
    return this.currentAlpha <= ALPHA_MIN
  }

  setForces(forces: NodeGraphForces): void {
    const changed =
      forces.centerForce !== this.forces.centerForce ||
      forces.repelForce !== this.forces.repelForce ||
      forces.linkForce !== this.forces.linkForce ||
      forces.linkDistance !== this.forces.linkDistance
    this.forces = { ...forces }
    if (changed) this.reheat(0.4)
  }

  /**
   * Replaces the graph while keeping the position of every node that survives,
   * so filtering or a refresh nudges the layout instead of reshuffling it.
   */
  setGraph(
    nodes: readonly { id: string }[],
    edges: readonly { from: string; to: string }[]
  ): void {
    const previous = this.byId
    const next: SimulationNode[] = []
    const nextById = new Map<string, SimulationNode>()
    let seeded = 0
    for (const node of nodes) {
      const existing = previous.get(node.id)
      if (existing) {
        existing.pinned = false
        next.push(existing)
        nextById.set(node.id, existing)
        continue
      }
      const radius = 12 * Math.sqrt(0.5 + seeded)
      const angle = seeded * PHI
      seeded += 1
      const created: SimulationNode = {
        id: node.id,
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
        vx: 0,
        vy: 0,
        pinned: false
      }
      next.push(created)
      nextById.set(node.id, created)
    }
    const degrees = new Map<string, number>()
    for (const edge of edges) {
      degrees.set(edge.from, (degrees.get(edge.from) ?? 0) + 1)
      degrees.set(edge.to, (degrees.get(edge.to) ?? 0) + 1)
    }
    this.links = []
    for (const edge of edges) {
      const source = nextById.get(edge.from)
      const target = nextById.get(edge.to)
      if (!source || !target || source === target) continue
      const sourceDegree = degrees.get(edge.from) ?? 1
      const targetDegree = degrees.get(edge.to) ?? 1
      this.links.push({
        source,
        target,
        bias: sourceDegree / (sourceDegree + targetDegree)
      })
    }
    // Edges count as structure too: adding or removing a wikilink changes no
    // node, but a settled layout (alpha 0) would otherwise never feel the new
    // spring and the edge would render at whatever distance it happened to be.
    const nextSignature = this.links
      .map((link) => (link.source.id < link.target.id
        ? `${link.source.id}\u0000${link.target.id}`
        : `${link.target.id}\u0000${link.source.id}`))
      .sort()
      .join('\n')
    const structureChanged =
      next.length !== previous.size || seeded > 0 || nextSignature !== this.linkSignature
    this.linkSignature = nextSignature
    this.nodes = next
    this.byId = nextById
    if (structureChanged) this.reheat(1)
  }

  reheat(alpha = 1): void {
    this.currentAlpha = Math.max(this.currentAlpha, Math.min(1, alpha))
  }

  node(id: string): SimulationNode | undefined {
    return this.byId.get(id)
  }

  nodePositions(): SimulationNode[] {
    return this.nodes
  }

  pin(id: string, x: number, y: number): void {
    const node = this.byId.get(id)
    if (!node) return
    node.pinned = true
    node.x = x
    node.y = y
    node.vx = 0
    node.vy = 0
    this.reheat(0.3)
  }

  release(id: string): void {
    const node = this.byId.get(id)
    if (node) node.pinned = false
  }

  /** Advances one step. Returns false once the layout has settled. */
  tick(): boolean {
    if (this.nodes.length === 0) return false
    if (this.currentAlpha <= ALPHA_MIN) {
      this.currentAlpha = 0
      return false
    }
    this.currentAlpha += (0 - this.currentAlpha) * ALPHA_DECAY
    const alpha = this.currentAlpha
    this.applyRepulsion(alpha)
    this.applyLinks(alpha)
    this.applyCentering(alpha)
    for (const node of this.nodes) {
      if (node.pinned) {
        node.vx = 0
        node.vy = 0
        continue
      }
      node.vx *= 1 - VELOCITY_DECAY
      node.vy *= 1 - VELOCITY_DECAY
      node.x += node.vx
      node.y += node.vy
    }
    return true
  }

  /** Runs a fixed number of steps. Used by tests and by first paint. */
  run(steps: number): void {
    for (let step = 0; step < steps; step += 1) {
      if (!this.tick()) return
    }
  }

  private applyRepulsion(alpha: number): void {
    const strength = this.forces.repelForce * REPEL_SCALE * alpha
    if (strength <= 0) return
    const cutoff = Math.max(40, this.forces.linkDistance * 3)
    const cells = new Map<string, SimulationNode[]>()
    for (const node of this.nodes) {
      const key = `${Math.floor(node.x / cutoff)},${Math.floor(node.y / cutoff)}`
      const bucket = cells.get(key)
      if (bucket) bucket.push(node)
      else cells.set(key, [node])
    }
    const cutoffSquared = cutoff * cutoff
    for (const node of this.nodes) {
      const column = Math.floor(node.x / cutoff)
      const row = Math.floor(node.y / cutoff)
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (const other of cells.get(`${column + dx},${row + dy}`) ?? []) {
            if (other === node) continue
            let deltaX = node.x - other.x
            let deltaY = node.y - other.y
            let distanceSquared = deltaX * deltaX + deltaY * deltaY
            if (distanceSquared > cutoffSquared) continue
            if (distanceSquared < 1) {
              // Deterministic nudge so coincident nodes still separate.
              deltaX = (node.id < other.id ? -1 : 1) * 0.5
              deltaY = (node.id < other.id ? 1 : -1) * 0.5
              distanceSquared = 0.5
            }
            const push = strength / distanceSquared
            node.vx += deltaX * push
            node.vy += deltaY * push
          }
        }
      }
    }
  }

  private applyLinks(alpha: number): void {
    const strength = this.forces.linkForce * alpha
    if (strength <= 0) return
    const target = this.forces.linkDistance
    for (const link of this.links) {
      const deltaX = link.target.x - link.source.x
      const deltaY = link.target.y - link.source.y
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY) || 0.001
      const pull = ((distance - target) / distance) * strength
      const shiftX = deltaX * pull
      const shiftY = deltaY * pull
      link.target.vx -= shiftX * link.bias
      link.target.vy -= shiftY * link.bias
      link.source.vx += shiftX * (1 - link.bias)
      link.source.vy += shiftY * (1 - link.bias)
    }
  }

  private applyCentering(alpha: number): void {
    const strength = this.forces.centerForce * alpha
    if (strength <= 0) return
    for (const node of this.nodes) {
      node.vx -= node.x * strength
      node.vy -= node.y * strength
    }
  }
}

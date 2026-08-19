import { describe, expect, it } from 'vitest'
import {
  NODE_GRAPH_MAX_SCALE,
  NODE_GRAPH_MIN_SCALE,
  clampNodeGraphScale,
  fitNodeGraphCamera,
  nodeGraphDragPosition,
  paintedNodeRadius,
  nodeGraphGrabOffset,
  nodeGraphHitTest,
  nodeGraphIconBox,
  nodeGraphLayoutPoint,
  nodeGraphZoomFactor,
  paintNodeGraph,
  withAlpha,
  KUN_NODE_ICON_MIN_RADIUS,
  screenToWorld,
  worldToScreen,
  type NodeGraphCamera
} from './node-graph-paint'
import { nodeGraphRadius } from './node-graph-theme'
import type { NodeGraphView } from '../../node-graph/node-graph-filter'
import type { SimulationNode } from '../../node-graph/node-graph-simulation'
import { DEFAULT_NODE_GRAPH_SETTINGS } from '../../node-graph/node-graph-settings'
import type { NodeGraphMotionFrame } from '../../node-graph/node-graph-animation'

const WIDTH = 800
const HEIGHT = 600

function camera(overrides: Partial<NodeGraphCamera> = {}): NodeGraphCamera {
  return { x: 0, y: 0, scale: 1, ...overrides }
}

function position(id: string, x: number, y: number): SimulationNode {
  return { id, x, y, vx: 0, vy: 0, pinned: false }
}

function view(degrees: Record<string, number>): NodeGraphView {
  return {
    nodes: Object.keys(degrees).map((id) => ({
      id,
      kind: 'thread' as const,
      label: id,
      degree: degrees[id]!
    })),
    edges: [],
    degrees: new Map(Object.entries(degrees)),
    groupColors: new Map(),
    hiddenCount: 0
  }
}

describe('camera transforms', () => {
  it('places the camera target at the canvas center', () => {
    const screen = worldToScreen(50, -20, camera({ x: 50, y: -20 }), WIDTH, HEIGHT)
    expect(screen).toEqual({ x: WIDTH / 2, y: HEIGHT / 2 })
  })

  it('round-trips world and screen coordinates at any zoom', () => {
    for (const scale of [0.25, 1, 3.5]) {
      const active = camera({ x: 120, y: -45, scale })
      const screen = worldToScreen(17, 91, active, WIDTH, HEIGHT)
      const world = screenToWorld(screen.x, screen.y, active, WIDTH, HEIGHT)
      expect(world.x).toBeCloseTo(17, 6)
      expect(world.y).toBeCloseTo(91, 6)
    }
  })

  it('clamps zoom to the supported range', () => {
    expect(clampNodeGraphScale(0)).toBe(NODE_GRAPH_MIN_SCALE)
    expect(clampNodeGraphScale(1_000)).toBe(NODE_GRAPH_MAX_SCALE)
    expect(clampNodeGraphScale(1.5)).toBe(1.5)
  })
})

describe('nodeGraphRadius', () => {
  it('grows with degree but sublinearly', () => {
    const small = nodeGraphRadius(1, 1)
    const large = nodeGraphRadius(100, 1)
    expect(large).toBeGreaterThan(small)
    expect(large).toBeLessThan(small * 100)
  })

  it('scales with the node size setting', () => {
    expect(nodeGraphRadius(4, 2)).toBeCloseTo(nodeGraphRadius(4, 1) * 2, 6)
  })
})

describe('nodeGraphHitTest', () => {
  const positions = new Map([
    ['a', position('a', 0, 0)],
    ['b', position('b', 200, 0)]
  ])

  function hit(screenX: number, screenY: number, active = camera()): string | null {
    return nodeGraphHitTest({
      screenX,
      screenY,
      width: WIDTH,
      height: HEIGHT,
      view: view({ a: 4, b: 4 }),
      positions,
      camera: active,
      nodeSize: 1
    })
  }

  it('hits the node under the pointer', () => {
    expect(hit(WIDTH / 2, HEIGHT / 2)).toBe('a')
    expect(hit(WIDTH / 2 + 200, HEIGHT / 2)).toBe('b')
  })

  it('misses empty canvas', () => {
    expect(hit(10, 10)).toBeNull()
  })

  it('picks the nearer node when two are close', () => {
    const tight = new Map([
      ['a', position('a', 0, 0)],
      ['b', position('b', 12, 0)]
    ])
    const picked = nodeGraphHitTest({
      screenX: WIDTH / 2 + 11,
      screenY: HEIGHT / 2,
      width: WIDTH,
      height: HEIGHT,
      view: view({ a: 4, b: 4 }),
      positions: tight,
      camera: camera(),
      nodeSize: 1
    })
    expect(picked).toBe('b')
  })

  it('hits inside the painted circle and misses just outside it', () => {
    const radius = paintedNodeRadius(4, 1, 1)
    expect(hit(WIDTH / 2 + radius - 0.5, HEIGHT / 2)).toBe('a')
    expect(hit(WIDTH / 2 + radius + 0.5, HEIGHT / 2)).toBeNull()
  })

  it('does not claim clicks in the empty ring around a node', () => {
    // A tolerance halo here would swallow clicks on links passing nearby.
    const radius = paintedNodeRadius(4, 1, 1)
    expect(hit(WIDTH / 2 + radius + 3, HEIGHT / 2 + radius + 3)).toBeNull()
  })

  it('shrinks the hit region with the drawn circle when zoomed out', () => {
    const zoomedOut = camera({ scale: 0.1 })
    // The dot itself is still grabbable; the space it used to claim is not.
    expect(hit(WIDTH / 2, HEIGHT / 2, zoomedOut)).toBe('a')
    expect(hit(WIDTH / 2 + 4, HEIGHT / 2 + 4, zoomedOut)).toBeNull()
  })

  it('never lets a node shrink below a grabbable floor', () => {
    expect(paintedNodeRadius(0, 0.4, NODE_GRAPH_MIN_SCALE)).toBeGreaterThan(0)
    expect(paintedNodeRadius(4, 1, 1)).toBeCloseTo(nodeGraphRadius(4, 1), 6)
  })

  it('ignores nodes with no simulated position', () => {
    const picked = nodeGraphHitTest({
      screenX: WIDTH / 2,
      screenY: HEIGHT / 2,
      width: WIDTH,
      height: HEIGHT,
      view: view({ ghost: 2 }),
      positions: new Map(),
      camera: camera(),
      nodeSize: 1
    })
    expect(picked).toBeNull()
  })
})

describe('node drag grab offset', () => {
  it('does not move the node when the grab is off-center', () => {
    const node = { x: 100, y: 40 }
    // Pressing inside the tolerance ring, 4px above-left of the center.
    const grabbedAt = { x: 96, y: 36 }
    const offset = nodeGraphGrabOffset(node, grabbedAt)
    expect(nodeGraphDragPosition(grabbedAt, offset)).toEqual(node)
  })

  it('translates the node by exactly the pointer delta', () => {
    const node = { x: 100, y: 40 }
    const grabbedAt = { x: 96, y: 36 }
    const offset = nodeGraphGrabOffset(node, grabbedAt)
    const moved = nodeGraphDragPosition({ x: grabbedAt.x + 30, y: grabbedAt.y - 12 }, offset)
    expect(moved).toEqual({ x: 130, y: 28 })
  })

  it('keeps a dead-center grab exactly under the pointer', () => {
    const node = { x: -7, y: 19 }
    const offset = nodeGraphGrabOffset(node, node)
    expect(offset).toEqual({ x: 0, y: 0 })
    expect(nodeGraphDragPosition({ x: 5, y: 5 }, offset)).toEqual({ x: 5, y: 5 })
  })

  it('survives a round trip through the camera at any zoom', () => {
    for (const scale of [0.3, 1, 4]) {
      const active = camera({ x: 12, y: -8, scale })
      const node = { x: 60, y: -30 }
      const grabScreen = worldToScreen(node.x + 3, node.y + 3, active, WIDTH, HEIGHT)
      const grabWorld = screenToWorld(grabScreen.x, grabScreen.y, active, WIDTH, HEIGHT)
      const offset = nodeGraphGrabOffset(node, grabWorld)
      const held = nodeGraphDragPosition(grabWorld, offset)
      expect(held.x).toBeCloseTo(node.x, 6)
      expect(held.y).toBeCloseTo(node.y, 6)
    }
  })
})

describe('UI-scale coordinate conversion', () => {
  it('measures no zoom as exactly 1', () => {
    expect(nodeGraphZoomFactor(1200, 1200)).toBe(1)
  })

  it('measures a shrunk and an enlarged UI scale', () => {
    expect(nodeGraphZoomFactor(1080, 1200)).toBeCloseTo(0.9, 6)
    expect(nodeGraphZoomFactor(1320, 1200)).toBeCloseTo(1.1, 6)
  })

  it('falls back to 1 for a degenerate layout box', () => {
    expect(nodeGraphZoomFactor(0, 0)).toBe(1)
    expect(nodeGraphZoomFactor(100, 0)).toBe(1)
    expect(nodeGraphZoomFactor(Number.NaN, 1200)).toBe(1)
  })

  it('maps a client point into the element CSS pixel space', () => {
    // Host at client x=400 with a 0.9 UI scale: a click 90 client px in is
    // 100 CSS px in, which is the space the canvas paints in.
    const point = nodeGraphLayoutPoint({ x: 490, y: 245 }, { left: 400, top: 200 }, 0.9)
    expect(point.x).toBeCloseTo(100, 6)
    expect(point.y).toBeCloseTo(50, 6)
  })

  it('is a no-op at scale 1', () => {
    expect(nodeGraphLayoutPoint({ x: 490, y: 245 }, { left: 400, top: 200 }, 1))
      .toEqual({ x: 90, y: 45 })
  })

  it('never divides by a bogus zoom', () => {
    expect(nodeGraphLayoutPoint({ x: 10, y: 10 }, { left: 0, top: 0 }, 0))
      .toEqual({ x: 10, y: 10 })
    expect(nodeGraphLayoutPoint({ x: 10, y: 10 }, { left: 0, top: 0 }, Number.NaN))
      .toEqual({ x: 10, y: 10 })
  })

  it('lands a scaled click on the node it visually covers', () => {
    // Regression: with a 0.8 UI scale a node drawn at the canvas center used to
    // be grabbable only ~1/0.8 of the way further from the canvas corner.
    const zoom = 0.8
    const active = camera()
    const positions = new Map([['a', position('a', 0, 0)]])
    const target = worldToScreen(0, 0, active, WIDTH, HEIGHT)
    const clientPoint = {
      x: 300 + target.x * zoom,
      y: 120 + target.y * zoom
    }
    const local = nodeGraphLayoutPoint(clientPoint, { left: 300, top: 120 }, zoom)
    expect(nodeGraphHitTest({
      screenX: local.x,
      screenY: local.y,
      width: WIDTH,
      height: HEIGHT,
      view: view({ a: 4 }),
      positions,
      camera: active,
      nodeSize: 1
    })).toBe('a')
  })
})

describe('fitNodeGraphCamera', () => {
  it('centers on the bounding box of every node', () => {
    const camera = fitNodeGraphCamera(
      [{ x: -100, y: -50 }, { x: 300, y: 150 }],
      WIDTH,
      HEIGHT
    )
    expect(camera.x).toBeCloseTo(100, 6)
    expect(camera.y).toBeCloseTo(50, 6)
  })

  it('scales so the whole graph fits with a margin', () => {
    const camera = fitNodeGraphCamera([{ x: 0, y: 0 }, { x: 1600, y: 0 }], WIDTH, HEIGHT)
    // 1600 world units into 800 screen px needs a scale below 0.5.
    expect(camera.scale).toBeLessThan(0.5)
    const left = worldToScreen(0, 0, camera, WIDTH, HEIGHT)
    const right = worldToScreen(1600, 0, camera, WIDTH, HEIGHT)
    expect(left.x).toBeGreaterThanOrEqual(0)
    expect(right.x).toBeLessThanOrEqual(WIDTH)
  })

  it('handles a single node without dividing by zero', () => {
    const camera = fitNodeGraphCamera([{ x: 42, y: -7 }], WIDTH, HEIGHT)
    expect(camera.x).toBe(42)
    expect(camera.y).toBe(-7)
    expect(Number.isFinite(camera.scale)).toBe(true)
    expect(camera.scale).toBeLessThanOrEqual(NODE_GRAPH_MAX_SCALE)
  })

  it('handles a perfectly horizontal line of nodes', () => {
    const camera = fitNodeGraphCamera([{ x: 0, y: 0 }, { x: 400, y: 0 }], WIDTH, HEIGHT)
    expect(Number.isFinite(camera.scale)).toBe(true)
  })

  it('falls back to the identity camera for an empty or unmeasured canvas', () => {
    expect(fitNodeGraphCamera([], WIDTH, HEIGHT)).toEqual({ x: 0, y: 0, scale: 1 })
    expect(fitNodeGraphCamera([{ x: 5, y: 5 }], 0, 0)).toEqual({ x: 0, y: 0, scale: 1 })
  })
})

/**
 * Enough of a 2D context to run the painter and record what it drew. The real
 * canvas is unavailable in this environment, and the questions here are about
 * which calls the painter makes, not about the pixels they produce.
 */
function recordingContext(): {
  context: CanvasRenderingContext2D
  images: { x: number; y: number; width: number; height: number }[]
  fills: () => number
  alphas: () => number[]
  dashes: () => number[][]
  gradients: () => number
} {
  const images: { x: number; y: number; width: number; height: number }[] = []
  const alphas: number[] = []
  const dashes: number[][] = []
  let fills = 0
  let gradients = 0
  const noop = (): void => undefined
  const context = {
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    ellipse: noop,
    arcTo: noop,
    roundRect: noop,
    stroke: noop,
    fillRect: noop,
    fillText: noop,
    translate: noop,
    rotate: noop,
    setTransform: noop,
    measureText: () => ({ width: 10 }) as TextMetrics,
    fill: () => {
      fills += 1
      // The halo fills with a gradient; keeping it out means `alphas` stays one
      // entry per node, so an index means the same thing across frames.
      if (typeof context.fillStyle === 'string') alphas.push(context.globalAlpha)
    },
    setLineDash: (pattern: number[]) => {
      dashes.push([...pattern])
    },
    createRadialGradient: () => {
      gradients += 1
      return { addColorStop: () => undefined } as unknown as CanvasGradient
    },
    drawImage: (_source: unknown, x: number, y: number, width: number, height: number) => {
      images.push({ x, y, width, height })
    },
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: 'round',
    font: '',
    textAlign: 'center',
    textBaseline: 'top',
    fillStyle: '',
    strokeStyle: ''
  } as unknown as CanvasRenderingContext2D
  return {
    context,
    images,
    fills: () => fills,
    alphas: () => [...alphas],
    dashes: () => dashes.map((pattern) => [...pattern]),
    gradients: () => gradients
  }
}

const KUN_THEME = {
  background: '#000',
  link: '#111',
  linkStrong: '#222',
  text: '#fff',
  textMuted: '#aaa',
  textFaint: '#777',
  accent: '#f0f',
  ring: '#fff'
}

function paintOne(options: {
  kunStyle: boolean
  icon: CanvasImageSource | null
  nodeSize?: number
  motion?: Partial<NodeGraphMotionFrame>
}): ReturnType<typeof recordingContext> {
  const recorded = recordingContext()
  const single = view({ a: 4 })
  paintNodeGraph({
    context: recorded.context,
    width: WIDTH,
    height: HEIGHT,
    view: single,
    positions: new Map([['a', position('a', 0, 0)]]),
    camera: camera(),
    settings: {
      ...DEFAULT_NODE_GRAPH_SETTINGS,
      nodeSize: options.nodeSize ?? DEFAULT_NODE_GRAPH_SETTINGS.nodeSize
    },
    theme: KUN_THEME,
    selectedNodeId: null,
    highlighted: new Set(),
    pathNodeIds: new Set(),
    pathEdgeIds: new Set(),
    kindLabel: () => 'Thread',
    edgeLabel: () => 'in workspace',
    pixelRatio: 1,
    kunStyle: options.kunStyle,
    nodeIcon: () => options.icon,
    motion: { ...SETTLED_MOTION, ...options.motion }
  })
  return recorded
}

const FAKE_ICON = { width: 463, height: 460 } as unknown as CanvasImageSource

/** A frame with every animation already finished — the steady state. */
const SETTLED_MOTION: NodeGraphMotionFrame = {
  entry: () => 1,
  hover: 0,
  dim: 0,
  focus: null,
  flow: 0,
  settled: true
}

describe('Kun style node painting', () => {
  it('draws the icon instead of filling a silhouette', () => {
    const painted = paintOne({ kunStyle: true, icon: FAKE_ICON })
    expect(painted.images).toHaveLength(1)
    expect(painted.fills()).toBe(0)
  })

  it('keeps the icon inside the radius the hit test uses', () => {
    // Artwork drawn past this radius would be visible where it cannot be clicked.
    const painted = paintOne({ kunStyle: true, icon: FAKE_ICON })
    const box = painted.images[0]!
    const radius = paintedNodeRadius(4, DEFAULT_NODE_GRAPH_SETTINGS.nodeSize, 1)
    const corner = Math.hypot(box.width / 2, box.height / 2)
    expect(corner).toBeLessThanOrEqual(radius + 1e-9)
    expect(box.width).toBeCloseTo(box.height, 9)
    // Centred on the node, which sits at the canvas centre here.
    expect(box.x + box.width / 2).toBeCloseTo(WIDTH / 2, 9)
    expect(box.y + box.height / 2).toBeCloseTo(HEIGHT / 2, 9)
  })

  it('falls back to the silhouette when the icon has not loaded', () => {
    const painted = paintOne({ kunStyle: true, icon: null })
    expect(painted.images).toHaveLength(0)
    expect(painted.fills()).toBeGreaterThan(0)
  })

  it('never reaches for an icon with Kun style off', () => {
    const painted = paintOne({ kunStyle: false, icon: FAKE_ICON })
    expect(painted.images).toHaveLength(0)
    expect(painted.fills()).toBeGreaterThan(0)
  })

  it('drops back to the silhouette once a node is painted too small', () => {
    const tiny = 0.05
    expect(paintedNodeRadius(4, tiny, 1)).toBeLessThan(KUN_NODE_ICON_MIN_RADIUS)
    const painted = paintOne({ kunStyle: true, icon: FAKE_ICON, nodeSize: tiny })
    expect(painted.images).toHaveLength(0)
  })
})

describe('nodeGraphIconBox', () => {
  it('inscribes the square in the hit circle', () => {
    for (const radius of [4, 12, 40]) {
      const side = nodeGraphIconBox(radius)
      expect(Math.hypot(side / 2, side / 2)).toBeCloseTo(radius, 9)
    }
  })
})

describe('animated painting', () => {
  it('fades a node in with its entry progress', () => {
    const half = paintOne({ kunStyle: false, icon: null, motion: { entry: () => 0.5 } })
    const full = paintOne({ kunStyle: false, icon: null })
    expect(half.alphas()[0]).toBeCloseTo(0.5, 6)
    expect(full.alphas()[0]).toBeCloseTo(1, 6)
  })

  it('scales a node up as it enters, so it grows into place', () => {
    const half = paintOne({ kunStyle: true, icon: FAKE_ICON, motion: { entry: () => 0.5 } })
    const full = paintOne({ kunStyle: true, icon: FAKE_ICON })
    expect(half.images[0]!.width).toBeLessThan(full.images[0]!.width)
  })

  it('keeps every alpha a paintable 0..1 across the whole entry', () => {
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      const painted = paintOne({ kunStyle: false, icon: null, motion: { entry: () => progress } })
      for (const alpha of painted.alphas()) {
        expect(Number.isFinite(alpha), String(progress)).toBe(true)
        expect(alpha).toBeGreaterThanOrEqual(0)
        expect(alpha).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('hover highlight', () => {
  function paintHovered(hover: number): ReturnType<typeof recordingContext> {
    const recorded = recordingContext()
    const two = view({ a: 4, b: 1 })
    paintNodeGraph({
      context: recorded.context,
      width: WIDTH,
      height: HEIGHT,
      view: two,
      positions: new Map([
        ['a', position('a', 0, 0)],
        ['b', position('b', 60, 0)]
      ]),
      camera: camera(),
      settings: DEFAULT_NODE_GRAPH_SETTINGS,
      theme: KUN_THEME,
      selectedNodeId: null,
      highlighted: new Set(),
      pathNodeIds: new Set(),
      pathEdgeIds: new Set(),
      kindLabel: () => 'Thread',
      edgeLabel: () => 'in workspace',
      pixelRatio: 1,
      kunStyle: false,
      nodeIcon: () => null,
      motion: { ...SETTLED_MOTION, hover, dim: hover, focus: 'a' }
    })
    return recorded
  }

  it('paints a halo around the hovered node', () => {
    expect(paintHovered(1).gradients()).toBe(1)
  })

  it('holds the halo back until the transition starts', () => {
    expect(paintHovered(0).gradients()).toBe(0)
  })

  it('eases the dimming of everything else in rather than snapping', () => {
    // Mid-transition the unrelated node must sit between full and dimmed.
    const settled = paintHovered(1).alphas()
    const midway = paintHovered(0.5).alphas()
    const started = paintHovered(0).alphas()
    expect(started[1]).toBeCloseTo(1, 6)
    expect(midway[1]).toBeGreaterThan(settled[1]!)
    expect(midway[1]).toBeLessThan(started[1]!)
  })
})

describe('flowing links', () => {
  function paintEdge(options: {
    hoverNodeId: string | null
    flow: number
  }): ReturnType<typeof recordingContext> {
    const recorded = recordingContext()
    const linked: NodeGraphView = {
      nodes: [
        { id: 'a', kind: 'thread', label: 'a', degree: 1 },
        { id: 'b', kind: 'thread', label: 'b', degree: 1 }
      ],
      edges: [{ id: 'e', from: 'a', to: 'b', kind: 'link' }],
      degrees: new Map([['a', 1], ['b', 1]]),
      groupColors: new Map(),
      hiddenCount: 0
    }
    paintNodeGraph({
      context: recorded.context,
      width: WIDTH,
      height: HEIGHT,
      view: linked,
      positions: new Map([
        ['a', position('a', -80, 0)],
        ['b', position('b', 80, 0)]
      ]),
      camera: camera(),
      settings: DEFAULT_NODE_GRAPH_SETTINGS,
      theme: KUN_THEME,
      selectedNodeId: null,
      highlighted: new Set(),
      pathNodeIds: new Set(),
      pathEdgeIds: new Set(),
      kindLabel: () => 'Thread',
      edgeLabel: () => 'link',
      pixelRatio: 1,
      kunStyle: false,
      nodeIcon: () => null,
      motion: { ...SETTLED_MOTION, flow: options.flow, focus: options.hoverNodeId }
    })
    return recorded
  }

  it('dashes an edge that touches the hovered node', () => {
    const dashes = paintEdge({ hoverNodeId: 'a', flow: 12 }).dashes()
    expect(dashes.some((pattern) => pattern.length === 2)).toBe(true)
  })

  it('always clears the dash again, so unrelated edges stay solid', () => {
    // A pattern left set would leak onto every line drawn afterwards.
    const dashes = paintEdge({ hoverNodeId: 'a', flow: 12 }).dashes()
    expect(dashes[dashes.length - 1]).toEqual([])
  })

  it('leaves every edge solid with nothing hovered', () => {
    const dashes = paintEdge({ hoverNodeId: null, flow: 12 }).dashes()
    expect(dashes.every((pattern) => pattern.length === 0)).toBe(true)
  })

  it('leaves edges solid under reduced motion, where flow is zero', () => {
    const dashes = paintEdge({ hoverNodeId: 'a', flow: 0 }).dashes()
    expect(dashes.every((pattern) => pattern.length === 0)).toBe(true)
  })
})

describe('withAlpha', () => {
  it('applies alpha to the hex the accent token resolves to', () => {
    expect(withAlpha('#5b78ff', 0.5)).toBe('rgba(91, 120, 255, 0.5)')
  })

  it('expands a three-digit hex', () => {
    expect(withAlpha('#08f', 1)).toBe('rgba(0, 136, 255, 1)')
  })

  it('replaces the alpha on an rgb or rgba colour', () => {
    expect(withAlpha('rgb(10, 20, 30)', 0.25)).toBe('rgba(10, 20, 30, 0.25)')
    expect(withAlpha('rgba(10, 20, 30, 0.9)', 0.25)).toBe('rgba(10, 20, 30, 0.25)')
  })

  it('tolerates the whitespace a computed custom property carries', () => {
    // getPropertyValue keeps the author's spacing, so the token is rarely clean.
    expect(withAlpha('  #5b78ff  ', 1)).toBe('rgba(91, 120, 255, 1)')
  })

  it('falls back to color-mix for a space this cannot parse', () => {
    // Themes may resolve the accent to oklch; the halo still has to work.
    expect(withAlpha('oklch(0.7 0.2 250)', 0.4))
      .toBe('color-mix(in srgb, oklch(0.7 0.2 250) 40%, transparent)')
  })

  it('clamps out-of-range alpha instead of emitting an invalid colour', () => {
    expect(withAlpha('#5b78ff', 2)).toBe('rgba(91, 120, 255, 1)')
    expect(withAlpha('#5b78ff', -1)).toBe('rgba(91, 120, 255, 0)')
  })
})

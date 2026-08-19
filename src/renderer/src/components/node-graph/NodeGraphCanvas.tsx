import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactElement
} from 'react'
import type { NodeGraphView } from '../../node-graph/node-graph-filter'
import { neighborIds } from '../../node-graph/node-graph-filter'
import {
  NodeGraphSimulation,
  type SimulationNode
} from '../../node-graph/node-graph-simulation'
import type { NodeGraphSettings } from '../../node-graph/node-graph-settings'
import type {
  NodeGraphEdgeKind,
  NodeGraphNodeKind
} from '../../node-graph/node-graph-types'
import {
  clampNodeGraphScale,
  fitNodeGraphCamera,
  nodeGraphDragPosition,
  nodeGraphGrabOffset,
  nodeGraphHitTest,
  nodeGraphLayoutPoint,
  nodeGraphZoomFactor,
  paintNodeGraph,
  screenToWorld,
  type NodeGraphCamera
} from './node-graph-paint'
import { readNodeGraphCanvasTheme, type NodeGraphCanvasTheme } from './node-graph-theme'
import { kunNodeIcon, loadKunNodeIcons } from './node-graph-kun-icons'
import { useKunNodeStyle } from '../../node-graph/kun-node-style'
import { NodeGraphMotion } from '../../node-graph/node-graph-animation'
import { useNodeGraphReducedMotion } from './use-node-graph-reduced-motion'

type Props = {
  view: NodeGraphView
  settings: NodeGraphSettings
  selectedNodeId: string | null
  onSelectNode: (id: string | null) => void
  /** Double click / Enter: re-anchor the local graph on a node. */
  onFocusNode: (id: string) => void
  /** Emitted on hover so the parent can show a tooltip-free inspector preview. */
  onHoverNode?: (id: string | null) => void
  /** Right-click on a node. `x`/`y` are viewport CSS pixels for a fixed menu. */
  onNodeContextMenu?: (id: string, position: { x: number; y: number }) => void
  /** Nodes and edges on the active shortest path, drawn on top and undimmed. */
  pathNodeIds: ReadonlySet<string>
  pathEdgeIds: ReadonlySet<string>
  /** Stops the simulation so a laid-out graph holds still. */
  paused: boolean
  /** Localized singular kind name, drawn above each node's own label. */
  kindLabel: (kind: NodeGraphNodeKind) => string
  /** Localized relationship name, drawn along each edge. */
  edgeLabel: (kind: NodeGraphEdgeKind) => string
  /** Reports camera changes so the zoom readout and minimap can follow. */
  onCameraChange?: (camera: NodeGraphCamera) => void
  /** Reports the canvas size, which the minimap needs for its viewport box. */
  onViewportChange?: (size: { width: number; height: number }) => void
  ariaLabel: string
}

/** Imperative camera and export controls the toolbars drive. */
export type NodeGraphCanvasHandle = {
  fitToView: () => void
  zoomBy: (factor: number) => void
  setScale: (scale: number) => void
  centerOn: (world: { x: number; y: number }) => void
  /** Live simulation positions, read by the minimap on each of its frames. */
  positions: () => readonly SimulationNode[]
  exportPng: () => Promise<Blob | null>
}

const KEYBOARD_PAN = 60
const KEYBOARD_ZOOM = 1.2

export const NodeGraphCanvas = forwardRef<NodeGraphCanvasHandle, Props>(function NodeGraphCanvas({
  view,
  settings,
  selectedNodeId,
  onSelectNode,
  onFocusNode,
  onHoverNode,
  onNodeContextMenu,
  pathNodeIds,
  pathEdgeIds,
  paused,
  kindLabel,
  edgeLabel,
  onCameraChange,
  onViewportChange,
  ariaLabel
}: Props, handleRef): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const cameraRef = useRef<NodeGraphCamera>({ x: 0, y: 0, scale: 1 })
  const sizeRef = useRef({ width: 0, height: 0 })
  /** Client pixels per CSS pixel, from the shell's `body { zoom }` UI scale. */
  const zoomRef = useRef(1)
  const dragRef = useRef<
    | { kind: 'pan'; pointerId: number; lastX: number; lastY: number; moved: boolean }
    | {
        kind: 'node'
        pointerId: number
        id: string
        moved: boolean
        /** World-space delta from the pointer to the node center at grab time. */
        offset: { x: number; y: number }
      }
    | null
  >(null)
  const themeRef = useRef<NodeGraphCanvasTheme>(readNodeGraphCanvasTheme())
  const kunStyle = useKunNodeStyle()
  const kunStyleRef = useRef(kunStyle)
  kunStyleRef.current = kunStyle
  const reducedMotion = useNodeGraphReducedMotion()
  const motionRef = useRef<NodeGraphMotion | null>(null)
  if (!motionRef.current) motionRef.current = new NodeGraphMotion()
  const motion = motionRef.current
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null)
  const [keyboardFocus, setKeyboardFocus] = useState(false)
  const hoverRef = useRef<string | null>(null)
  const viewRef = useRef(view)
  const settingsRef = useRef(settings)
  const selectedRef = useRef(selectedNodeId)
  const dirtyRef = useRef(true)

  // Constructed exactly once and then driven by the effects below, so the
  // layout survives every re-render instead of restarting from a fresh spiral.
  const simulationRef = useRef<NodeGraphSimulation | null>(null)
  if (!simulationRef.current) {
    simulationRef.current = new NodeGraphSimulation({
      centerForce: settings.centerForce,
      repelForce: settings.repelForce,
      linkForce: settings.linkForce,
      linkDistance: settings.linkDistance
    })
  }
  const simulation = simulationRef.current

  viewRef.current = view
  settingsRef.current = settings
  selectedRef.current = selectedNodeId
  const pathNodesRef = useRef(pathNodeIds)
  const pathEdgesRef = useRef(pathEdgeIds)
  pathNodesRef.current = pathNodeIds
  pathEdgesRef.current = pathEdgeIds
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const kindLabelRef = useRef(kindLabel)
  kindLabelRef.current = kindLabel
  const edgeLabelRef = useRef(edgeLabel)
  edgeLabelRef.current = edgeLabel
  const cameraChangeRef = useRef(onCameraChange)
  cameraChangeRef.current = onCameraChange
  const viewportChangeRef = useRef(onViewportChange)
  viewportChangeRef.current = onViewportChange
  const ratioRef = useRef(1)
  const reportedCameraRef = useRef<NodeGraphCamera>({ x: 0, y: 0, scale: 1 })

  // Neighbours follow the motion frame's focus, not the live pointer, so they
  // stay lit through the fade-out alongside the node they belong to. Cached on
  // the focus id because a painted frame would otherwise walk every edge again.
  const neighborsRef = useRef<{ focus: string | null; ids: ReadonlySet<string> }>({
    focus: null,
    ids: new Set()
  })
  const neighborsOf = useCallback(
    (focus: string | null): ReadonlySet<string> => {
      const cached = neighborsRef.current
      if (cached.focus === focus) return cached.ids
      const ids = focus ? neighborIds(viewRef.current.edges, focus) : new Set<string>()
      neighborsRef.current = { focus, ids }
      return ids
    },
    []
  )

  useEffect(() => {
    motion.setReducedMotion(reducedMotion)
    dirtyRef.current = true
  }, [motion, reducedMotion])

  useEffect(() => {
    simulation.setGraph(view.nodes, view.edges)
    // Only nodes that were not already on screen animate in, so a background
    // refresh does not re-enter the whole graph.
    motion.setNodes(view.nodes.map((node) => node.id), performance.now())
    // The cached neighbour set belongs to the old edges.
    neighborsRef.current = { focus: null, ids: new Set() }
    dirtyRef.current = true
  }, [motion, simulation, view.nodes, view.edges])

  useEffect(() => {
    simulation.setForces({
      centerForce: settings.centerForce,
      repelForce: settings.repelForce,
      linkForce: settings.linkForce,
      linkDistance: settings.linkDistance
    })
    dirtyRef.current = true
  }, [
    simulation,
    settings.centerForce,
    settings.repelForce,
    settings.linkForce,
    settings.linkDistance
  ])

  // Node size, link thickness, arrows, groups and fade only change pixels.
  useEffect(() => {
    dirtyRef.current = true
  }, [
    settings.nodeSize,
    settings.linkThickness,
    settings.showArrows,
    settings.textFadeThreshold,
    settings.showEdgeLabels,
    view.groupColors,
    selectedNodeId,
    hoverNodeId,
    pathNodeIds,
    pathEdgeIds,
    paused
  ])

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return
    const applySize = (): void => {
      // Everything below stays in the host's own CSS pixels. Mixing in the
      // client pixels that getBoundingClientRect reports would offset every
      // node from its hit region by the UI scale, growing with distance from
      // the canvas corner. The canvas keeps its `h-full w-full` CSS size so it
      // covers the host exactly; only the backing store is set here.
      const rect = host.getBoundingClientRect()
      const width = host.clientWidth
      const height = host.clientHeight
      zoomRef.current = nodeGraphZoomFactor(rect.width, width)
      sizeRef.current = { width, height }
      viewportChangeRef.current?.({ width, height })
      const density = Math.min(
        4,
        Math.max(1, (window.devicePixelRatio || 1) * zoomRef.current)
      )
      ratioRef.current = density
      canvas.width = Math.max(1, Math.round(width * density))
      canvas.height = Math.max(1, Math.round(height * density))
      const context = canvas.getContext('2d')
      if (context) context.setTransform(density, 0, 0, density, 0, 0)
      dirtyRef.current = true
    }
    applySize()
    const observer = new ResizeObserver(applySize)
    observer.observe(host)
    // The UI scale is written as an inline custom property on <html>, which
    // does not always change this element's layout box, so watch for it.
    const scaleObserver = typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(applySize)
    scaleObserver?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style']
    })
    return () => {
      observer.disconnect()
      scaleObserver?.disconnect()
    }
  }, [])

  // The artwork decodes off-thread, and the canvas only paints when something is
  // dirty, so the load callback is what turns the first silhouette frame into an
  // icon frame.
  useEffect(() => {
    dirtyRef.current = true
    if (!kunStyle) return
    loadKunNodeIcons(() => {
      dirtyRef.current = true
    })
  }, [kunStyle])

  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(() => {
      themeRef.current = readNodeGraphCanvasTheme()
      dirtyRef.current = true
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class']
    })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let frame = 0
    const render = (): void => {
      frame = window.requestAnimationFrame(render)
      const canvas = canvasRef.current
      const context = canvas?.getContext('2d')
      const { width, height } = sizeRef.current
      if (!context || width === 0 || height === 0) return
      const now = performance.now()
      const focus = hoverRef.current ?? selectedRef.current
      motion.setFocus(focus, now)
      motion.setFlowing(focus !== null || pathEdgesRef.current.size > 0)
      const frameMotion = motion.frame(now)
      const moved = pausedRef.current ? false : simulation.tick()
      // An unsettled frame is one where something is still easing, so the loop
      // keeps painting; once everything lands it idles again, exactly as before.
      if (!moved && !dirtyRef.current && frameMotion.settled) return
      dirtyRef.current = false
      const positions = new Map(simulation.nodePositions().map((node) => [node.id, node]))
      paintNodeGraph({
        context,
        width,
        height,
        view: viewRef.current,
        positions,
        camera: cameraRef.current,
        settings: settingsRef.current,
        theme: themeRef.current,
        selectedNodeId: selectedRef.current,
        highlighted: neighborsOf(frameMotion.focus),
        pathNodeIds: pathNodesRef.current,
        pathEdgeIds: pathEdgesRef.current,
        kindLabel: kindLabelRef.current,
        edgeLabel: edgeLabelRef.current,
        pixelRatio: ratioRef.current,
        kunStyle: kunStyleRef.current,
        nodeIcon: kunNodeIcon,
        motion: frameMotion
      })
      const camera = cameraRef.current
      const last = reportedCameraRef.current
      if (
        Math.abs(camera.x - last.x) > 0.5 ||
        Math.abs(camera.y - last.y) > 0.5 ||
        Math.abs(camera.scale - last.scale) > 0.001
      ) {
        reportedCameraRef.current = { ...camera }
        cameraChangeRef.current?.({ ...camera })
      }
    }
    frame = window.requestAnimationFrame(render)
    return () => window.cancelAnimationFrame(frame)
  }, [motion, neighborsOf, simulation])

  const localPoint = useCallback((event: { clientX: number; clientY: number }) => {
    const rect = hostRef.current?.getBoundingClientRect()
    return nodeGraphLayoutPoint(
      { x: event.clientX, y: event.clientY },
      { left: rect?.left ?? 0, top: rect?.top ?? 0 },
      zoomRef.current
    )
  }, [])

  const pickNode = useCallback(
    (point: { x: number; y: number }) =>
      nodeGraphHitTest({
        screenX: point.x,
        screenY: point.y,
        width: sizeRef.current.width,
        height: sizeRef.current.height,
        view: viewRef.current,
        positions: new Map(simulation.nodePositions().map((node) => [node.id, node])),
        camera: cameraRef.current,
        nodeSize: settingsRef.current.nodeSize
      }),
    [simulation]
  )

  // Applied imperatively so a cursor change never costs a re-render mid-drag.
  const applyCursor = useCallback((cursor: 'grab' | 'grabbing' | 'pointer') => {
    if (hostRef.current) hostRef.current.style.cursor = cursor
  }, [])

  const setHover = useCallback(
    (id: string | null) => {
      if (hoverRef.current === id) return
      hoverRef.current = id
      setHoverNodeId(id)
      onHoverNode?.(id)
      if (!dragRef.current) applyCursor(id ? 'pointer' : 'grab')
      dirtyRef.current = true
    },
    [applyCursor, onHoverNode]
  )

  const zoomAt = useCallback((factor: number, point?: { x: number; y: number }) => {
    const { width, height } = sizeRef.current
    const camera = cameraRef.current
    const nextScale = clampNodeGraphScale(camera.scale * factor)
    if (nextScale === camera.scale) return
    if (point) {
      // Keep the world point under the cursor pinned while zooming.
      const before = screenToWorld(point.x, point.y, camera, width, height)
      camera.scale = nextScale
      const after = screenToWorld(point.x, point.y, camera, width, height)
      camera.x += before.x - after.x
      camera.y += before.y - after.y
    } else {
      camera.scale = nextScale
    }
    dirtyRef.current = true
  }, [])

  useImperativeHandle(handleRef, () => ({
    fitToView: () => {
      const { width, height } = sizeRef.current
      cameraRef.current = fitNodeGraphCamera(simulation.nodePositions(), width, height)
      dirtyRef.current = true
    },
    zoomBy: (factor: number) => zoomAt(factor),
    setScale: (scale: number) => {
      cameraRef.current.scale = clampNodeGraphScale(scale)
      dirtyRef.current = true
    },
    centerOn: (world: { x: number; y: number }) => {
      cameraRef.current.x = world.x
      cameraRef.current.y = world.y
      dirtyRef.current = true
    },
    positions: () => simulation.nodePositions(),
    exportPng: async () => {
      const canvas = canvasRef.current
      if (!canvas) return null
      return new Promise<Blob | null>((resolve) => {
        canvas.toBlob((blob) => resolve(blob), 'image/png')
      })
    }
  }), [simulation, zoomAt])

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      event.preventDefault()
      zoomAt(Math.exp(-event.deltaY * 0.0015), localPoint(event))
    },
    [localPoint, zoomAt]
  )

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      setKeyboardFocus(false)
      hostRef.current?.focus({ preventScroll: true })
      const point = localPoint(event)
      const id = pickNode(point)
      event.currentTarget.setPointerCapture(event.pointerId)
      applyCursor('grabbing')
      if (id) {
        const world = screenToWorld(
          point.x, point.y, cameraRef.current, sizeRef.current.width, sizeRef.current.height
        )
        const grabbed = simulation.node(id)
        const offset = grabbed ? nodeGraphGrabOffset(grabbed, world) : { x: 0, y: 0 }
        // Pinning at the node's own position means the grab itself moves nothing.
        const held = nodeGraphDragPosition(world, offset)
        simulation.pin(id, held.x, held.y)
        dragRef.current = { kind: 'node', pointerId: event.pointerId, id, moved: false, offset }
        return
      }
      dragRef.current = {
        kind: 'pan', pointerId: event.pointerId, lastX: point.x, lastY: point.y, moved: false
      }
    },
    [applyCursor, localPoint, pickNode, simulation]
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const point = localPoint(event)
      const drag = dragRef.current
      if (!drag) {
        setHover(pickNode(point))
        return
      }
      if (drag.pointerId !== event.pointerId) return
      if (drag.kind === 'pan') {
        const camera = cameraRef.current
        camera.x -= (point.x - drag.lastX) / camera.scale
        camera.y -= (point.y - drag.lastY) / camera.scale
        if (Math.abs(point.x - drag.lastX) > 1 || Math.abs(point.y - drag.lastY) > 1) {
          drag.moved = true
        }
        drag.lastX = point.x
        drag.lastY = point.y
        dirtyRef.current = true
        return
      }
      const world = screenToWorld(
        point.x, point.y, cameraRef.current, sizeRef.current.width, sizeRef.current.height
      )
      const held = nodeGraphDragPosition(world, drag.offset)
      simulation.pin(drag.id, held.x, held.y)
      drag.moved = true
      dirtyRef.current = true
    },
    [localPoint, pickNode, setHover, simulation]
  )

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      dragRef.current = null
      applyCursor(hoverRef.current ? 'pointer' : 'grab')
      if (!drag || drag.pointerId !== event.pointerId) return
      if (drag.kind === 'node') {
        simulation.release(drag.id)
        // A press without motion is a selection, not a drag.
        if (!drag.moved) onSelectNode(drag.id)
        return
      }
      // `moved` accumulates across the whole gesture; comparing against the
      // last move alone would read a long slow pan as a click.
      if (!drag.moved && !pickNode(localPoint(event))) onSelectNode(null)
    },
    [applyCursor, localPoint, onSelectNode, pickNode, simulation]
  )

  const onDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const id = pickNode(localPoint(event))
      if (id) onFocusNode(id)
    },
    [localPoint, onFocusNode, pickNode]
  )

  const onContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const id = pickNode(localPoint(event))
      if (!id || !onNodeContextMenu) return
      event.preventDefault()
      // A `fixed` menu positions in CSS pixels, so the client coordinates need
      // the same UI-scale conversion the canvas itself uses.
      const viewport = nodeGraphLayoutPoint(
        { x: event.clientX, y: event.clientY },
        { left: 0, top: 0 },
        zoomRef.current
      )
      onSelectNode(id)
      onNodeContextMenu(id, viewport)
    },
    [localPoint, onNodeContextMenu, onSelectNode, pickNode]
  )

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = KEYBOARD_PAN * (event.shiftKey ? 3 : 1) / cameraRef.current.scale
      const camera = cameraRef.current
      switch (event.key) {
        case '+':
        case '=':
          zoomAt(KEYBOARD_ZOOM)
          break
        case '-':
          zoomAt(1 / KEYBOARD_ZOOM)
          break
        case 'ArrowLeft':
          camera.x -= step
          break
        case 'ArrowRight':
          camera.x += step
          break
        case 'ArrowUp':
          camera.y -= step
          break
        case 'ArrowDown':
          camera.y += step
          break
        case 'Enter':
          if (selectedRef.current) onFocusNode(selectedRef.current)
          break
        case 'Escape':
          onSelectNode(null)
          break
        default:
          return
      }
      setKeyboardFocus(true)
      event.preventDefault()
      dirtyRef.current = true
    },
    [onFocusNode, onSelectNode, zoomAt]
  )

  return (
    <div
      ref={hostRef}
      role="application"
      aria-label={ariaLabel}
      tabIndex={0}
      className={`ds-no-drag relative h-full min-h-0 w-full flex-1 overflow-hidden outline-none ${
        keyboardFocus ? 'ring-1 ring-inset ring-accent' : ''
      }`}
      style={{ cursor: 'grab' }}
      onBlur={() => setKeyboardFocus(false)}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setHover(null)}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  )
})

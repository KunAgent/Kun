import { useCallback, useEffect, useRef, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { NodeGraphView } from '../../node-graph/node-graph-filter'
import type { SimulationNode } from '../../node-graph/node-graph-simulation'
import { NODE_GRAPH_KIND_COLORS, readNodeGraphCanvasTheme } from './node-graph-theme'
import type { NodeGraphCamera } from './node-graph-paint'

const WIDTH = 180
const HEIGHT = 120
const PADDING = 8

type Props = {
  view: NodeGraphView
  /** Live node positions; read on each paint rather than copied. */
  positions: () => readonly SimulationNode[]
  camera: NodeGraphCamera
  /** Canvas size in CSS pixels, for drawing the viewport rectangle. */
  viewport: { width: number; height: number }
  /** Recenters the main camera on a world point. */
  onNavigate: (world: { x: number; y: number }) => void
}

type Bounds = { minX: number; minY: number; spanX: number; spanY: number }

function boundsOf(nodes: readonly SimulationNode[]): Bounds {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const node of nodes) {
    minX = Math.min(minX, node.x)
    maxX = Math.max(maxX, node.x)
    minY = Math.min(minY, node.y)
    maxY = Math.max(maxY, node.y)
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, spanX: 1, spanY: 1 }
  return {
    minX,
    minY,
    // A floor keeps a single node, or a perfectly straight line, from dividing
    // by zero and blanking the map.
    spanX: Math.max(maxX - minX, 1),
    spanY: Math.max(maxY - minY, 1)
  }
}

/**
 * Overview map with the current viewport drawn on it.
 *
 * A force graph is easy to get lost in: once panned, the only cues are the
 * nodes still on screen. This answers "where am I in the whole thing" without
 * changing the zoom, and clicking it jumps the camera there.
 */
export function NodeGraphMinimap({
  view,
  positions,
  camera,
  viewport,
  onNavigate
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const boundsRef = useRef<Bounds>({ minX: 0, minY: 0, spanX: 1, spanY: 1 })
  const colorsRef = useRef(view.groupColors)
  colorsRef.current = view.groupColors
  const nodeKinds = useRef(new Map<string, string>())
  nodeKinds.current = new Map(view.nodes.map((node) => [node.id, node.kind]))

  useEffect(() => {
    let frame = 0
    const paint = (): void => {
      frame = window.requestAnimationFrame(paint)
      const canvas = canvasRef.current
      const context = canvas?.getContext('2d')
      if (!context || !canvas) return
      const theme = readNodeGraphCanvasTheme()
      const ratio = Math.min(3, Math.max(1, window.devicePixelRatio || 1))
      if (canvas.width !== WIDTH * ratio) {
        canvas.width = WIDTH * ratio
        canvas.height = HEIGHT * ratio
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, WIDTH, HEIGHT)
      const nodes = positions()
      const bounds = boundsOf(nodes)
      boundsRef.current = bounds
      const scale = Math.min(
        (WIDTH - PADDING * 2) / bounds.spanX,
        (HEIGHT - PADDING * 2) / bounds.spanY
      )
      const project = (x: number, y: number): { x: number; y: number } => ({
        x: PADDING + (x - bounds.minX) * scale,
        y: PADDING + (y - bounds.minY) * scale
      })
      for (const node of nodes) {
        const point = project(node.x, node.y)
        const kind = nodeKinds.current.get(node.id)
        context.fillStyle = colorsRef.current.get(node.id) ??
          NODE_GRAPH_KIND_COLORS[(kind ?? 'thread') as keyof typeof NODE_GRAPH_KIND_COLORS] ??
          theme.textMuted
        context.beginPath()
        context.arc(point.x, point.y, 1.7, 0, Math.PI * 2)
        context.fill()
      }
      // The viewport rectangle: the world span the main canvas currently shows.
      if (viewport.width > 0 && camera.scale > 0) {
        const halfWidth = viewport.width / 2 / camera.scale
        const halfHeight = viewport.height / 2 / camera.scale
        const topLeft = project(camera.x - halfWidth, camera.y - halfHeight)
        const bottomRight = project(camera.x + halfWidth, camera.y + halfHeight)
        context.strokeStyle = theme.accent
        context.lineWidth = 1
        context.strokeRect(
          topLeft.x,
          topLeft.y,
          Math.max(3, bottomRight.x - topLeft.x),
          Math.max(3, bottomRight.y - topLeft.y)
        )
      }
    }
    frame = window.requestAnimationFrame(paint)
    return () => window.cancelAnimationFrame(frame)
  }, [camera, positions, viewport.height, viewport.width])

  const navigate = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      if (rect.width === 0) return
      const bounds = boundsRef.current
      const scale = Math.min(
        (WIDTH - PADDING * 2) / bounds.spanX,
        (HEIGHT - PADDING * 2) / bounds.spanY
      )
      // The rect may be scaled by the shell's UI zoom, so normalize through it.
      const localX = ((event.clientX - rect.left) / rect.width) * WIDTH
      const localY = ((event.clientY - rect.top) / rect.height) * HEIGHT
      onNavigate({
        x: bounds.minX + (localX - PADDING) / scale,
        y: bounds.minY + (localY - PADDING) / scale
      })
    },
    [onNavigate]
  )

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={t('nodeGraphMinimap')}
      title={t('nodeGraphMinimap')}
      className="ds-no-drag block cursor-crosshair rounded-control border border-ds-border-muted bg-ds-card/85 shadow-panel backdrop-blur"
      style={{ width: WIDTH, height: HEIGHT }}
      onPointerDown={navigate}
      onPointerMove={(event) => {
        if (event.buttons === 1) navigate(event)
      }}
    />
  )
}

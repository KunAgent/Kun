import { memo, useMemo } from 'react'
import type { CanvasShape } from '../../../design/canvas/canvas-types'
import { computePrototypeFlowEdges, type PrototypeFlowEdge } from '../../../design/canvas/prototype-flow'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import { useCanvasInspectorStore } from '../../../design/canvas/canvas-inspector-store'
import type { DesignArtifact } from '../../../design/design-types'

/** Screen pixels kept clear above boards for their label row. */
const BOARD_LABEL_CLEARANCE_PX = 40
/** Gap between a connector's ends and the board edges, in screen pixels. */
const CONNECTOR_INSET_PX = 6
/** Explicit link labels only render once boards are large enough to read them. */
const LABEL_MIN_ZOOM = 0.3

type Props = {
  artifacts: readonly DesignArtifact[]
  objects: Record<string, CanvasShape>
  zoom: number
}

/**
 * Authored links only (reading-order guesses are not drawn); without the
 * "all flows" view, only links touching a selected board are shown.
 */
export function visiblePrototypeFlowEdges(
  edges: readonly PrototypeFlowEdge[],
  selectedArtifactIds: ReadonlySet<string>,
  showAll: boolean
): PrototypeFlowEdge[] {
  return edges.filter((edge) => edge.kind === 'explicit' && (
    showAll || selectedArtifactIds.has(edge.sourceArtifactId) || selectedArtifactIds.has(edge.targetArtifactId)
  ))
}

/** Connector path in canvas units plus the point its label is centred on. */
export function prototypeFlowPath(
  edge: PrototypeFlowEdge,
  inset: number
): { d: string; midX: number; midY: number } {
  if (!edge.direct) {
    return {
      d: `M ${edge.x1} ${edge.y1} Q ${edge.controlX} ${edge.controlY} ${edge.x2} ${edge.y2}`,
      midX: 0.25 * edge.x1 + 0.5 * edge.controlX + 0.25 * edge.x2,
      midY: 0.25 * edge.y1 + 0.5 * edge.controlY + 0.25 * edge.y2
    }
  }
  const horizontal = Math.abs(edge.x2 - edge.x1) >= Math.abs(edge.y2 - edge.y1)
  if (horizontal) {
    const sign = edge.x2 >= edge.x1 ? 1 : -1
    const x1 = edge.x1 + sign * inset
    const x2 = edge.x2 - sign * inset
    const bend = (x2 - x1) / 2
    return {
      d: `M ${x1} ${edge.y1} C ${x1 + bend} ${edge.y1} ${x2 - bend} ${edge.y2} ${x2} ${edge.y2}`,
      midX: (x1 + x2) / 2,
      midY: (edge.y1 + edge.y2) / 2
    }
  }
  const sign = edge.y2 >= edge.y1 ? 1 : -1
  const y1 = edge.y1 + sign * inset
  const y2 = edge.y2 - sign * inset
  const bend = (y2 - y1) / 2
  return {
    d: `M ${edge.x1} ${y1} C ${edge.x1} ${y1 + bend} ${edge.x2} ${y2 - bend} ${edge.x2} ${y2}`,
    midX: (edge.x1 + edge.x2) / 2,
    midY: (y1 + y2) / 2
  }
}

function PrototypeFlowOverlayInner({ artifacts, objects, zoom }: Props) {
  const selectedIds = useCanvasSelectionStore((s) => s.selectedIds)
  const showAll = useCanvasInspectorStore((s) => s.flowsVisible)
  const px = 1 / Math.max(zoom, 0.01)
  const edges = useMemo(
    () => computePrototypeFlowEdges(artifacts, objects, { topClearance: BOARD_LABEL_CLEARANCE_PX * px }),
    [artifacts, objects, px]
  )
  const selectedArtifactIds = useMemo(() => {
    const ids = new Set<string>()
    for (const id of selectedIds) {
      const artifactId = objects[id]?.htmlArtifactId
      if (artifactId) ids.add(artifactId)
    }
    return ids
  }, [objects, selectedIds])
  const visible = useMemo(
    () => visiblePrototypeFlowEdges(edges, selectedArtifactIds, showAll),
    [edges, selectedArtifactIds, showAll]
  )
  if (visible.length === 0) return null

  const accent = { stroke: 'var(--ds-accent)' }
  return (
    <g pointerEvents="none" aria-hidden="true" data-prototype-flows={visible.length}>
      <defs>
        <marker
          id="prototype-flow-arrow"
          viewBox="0 0 10 10"
          markerWidth={7 * px}
          markerHeight={7 * px}
          refX="9"
          refY="5"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M 1 1 L 9 5 L 1 9 z" style={{ fill: 'var(--ds-accent)' }} />
        </marker>
      </defs>
      {visible.map((edge) => {
        const path = prototypeFlowPath(edge, CONNECTOR_INSET_PX * px)
        const label = zoom >= LABEL_MIN_ZOOM ? edge.label?.trim() : ''
        const labelWidth = label ? (label.length * 6.4 + 16) * px : 0
        return (
          <g key={edge.id}>
            <path
              d={path.d}
              fill="none"
              strokeWidth={1.5 * px}
              strokeOpacity="0.72"
              strokeLinecap="round"
              markerEnd="url(#prototype-flow-arrow)"
              style={accent}
            />
            {label ? (
              <g transform={`translate(${path.midX} ${path.midY})`}>
                <rect
                  x={-labelWidth / 2}
                  y={-10 * px}
                  width={labelWidth}
                  height={20 * px}
                  rx={10 * px}
                  strokeWidth={px}
                  strokeOpacity="0.35"
                  style={{ ...accent, fill: 'var(--ds-surface-elevated)' }}
                />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={11 * px}
                  fontFamily="Inter, system-ui, sans-serif"
                  style={{ fill: 'var(--ds-accent)' }}
                >
                  {label}
                </text>
              </g>
            ) : null}
          </g>
        )
      })}
    </g>
  )
}

export const PrototypeFlowOverlay = memo(PrototypeFlowOverlayInner)

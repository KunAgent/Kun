import { memo, useMemo } from 'react'
import type { CanvasShape } from '../../../design/canvas/canvas-types'
import { computePrototypeFlowEdges } from '../../../design/canvas/prototype-flow'
import type { DesignArtifact } from '../../../design/design-types'

const FLOW_COLOR = '#14b8a6'
/** Screen pixels kept clear above boards for their label row. */
const BOARD_LABEL_CLEARANCE_PX = 40

type Props = {
  artifacts: readonly DesignArtifact[]
  objects: Record<string, CanvasShape>
  zoom: number
}

function PrototypeFlowOverlayInner({ artifacts, objects, zoom }: Props) {
  const edges = useMemo(
    () => computePrototypeFlowEdges(artifacts, objects, { topClearance: BOARD_LABEL_CLEARANCE_PX / Math.max(zoom, 0.01) }),
    [artifacts, objects, zoom]
  )
  if (edges.length === 0) return null

  const strokeWidth = Math.max(1.5, 2 / zoom)
  const fontSize = Math.max(10, 12 / zoom)
  const labelOffset = Math.max(12, 16 / zoom)

  return (
    <g pointerEvents="none" aria-hidden="true">
      <defs>
        <marker
          id="prototype-flow-arrow"
          markerWidth="10"
          markerHeight="10"
          refX="8"
          refY="5"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={FLOW_COLOR} opacity="0.78" />
        </marker>
      </defs>
      {edges.map((edge) => {
        const label = edge.label || edge.targetTitle
        return (
          <g key={edge.id}>
            <path
              d={`M ${edge.x1} ${edge.y1} Q ${edge.controlX} ${edge.controlY} ${edge.x2} ${edge.y2}`}
              fill="none"
              stroke={FLOW_COLOR}
              strokeWidth={strokeWidth}
              strokeOpacity="0.62"
              strokeLinecap="round"
              strokeDasharray={`${8 / zoom} ${7 / zoom}`}
              markerEnd="url(#prototype-flow-arrow)"
            />
            <text
              x={edge.controlX}
              y={edge.controlY - labelOffset}
              textAnchor="middle"
              fontSize={fontSize}
              fontFamily="Inter, system-ui, sans-serif"
              fill={FLOW_COLOR}
              stroke="var(--ds-bg-main, #ffffff)"
              strokeWidth={Math.max(3, 4 / zoom)}
              paintOrder="stroke fill"
              opacity="0.86"
            >
              {label}
            </text>
          </g>
        )
      })}
    </g>
  )
}

export const PrototypeFlowOverlay = memo(PrototypeFlowOverlayInner)

import { useTranslation } from 'react-i18next'
import type { CanvasShape, CanvasSticky } from '../../../../design/canvas/canvas-types'
import { STICKY_PALETTE, stickyMentionsKun } from '../../../../design/canvas/canvas-sticky'

const FOOTER_HEIGHT = 34
const DOG_EAR = 18

/**
 * Paper, fold and status line of a sticky note. The text itself is the shape's
 * regular editable text; this only paints around it. The footer carries the
 * request status so a note that talks to Kun shows where it stands.
 */
export function StickyCard({
  shape,
  sticky,
  editing
}: {
  shape: CanvasShape
  sticky: CanvasSticky
  editing: boolean
}): React.JSX.Element {
  const { t } = useTranslation('common')
  const palette = STICKY_PALETTE[sticky.color]
  const { width, height } = shape
  const addressed = stickyMentionsKun(shape.textContent)
  const done = sticky.status === 'done'
  let footer: string
  if (sticky.status === 'sent') footer = t('canvasStickySent')
  else if (done) footer = sticky.resultNote || t('canvasStickyDone')
  else if (editing && addressed) footer = t('canvasStickySendHint')
  else if (addressed) footer = t('canvasStickyDraftKun')
  else footer = t('canvasStickyPlain')
  return (
    <g data-canvas-sticky={sticky.status} style={{ pointerEvents: 'none' }}>
      <path
        d={`M0 0 H${width} V${height - DOG_EAR} L${width - DOG_EAR} ${height} H0 Z`}
        fill={palette.fill}
        opacity={done ? 0.62 : 1}
      />
      <path
        d={`M${width} ${height - DOG_EAR} L${width - DOG_EAR} ${height} V${height - DOG_EAR} Z`}
        fill="#000"
        opacity={0.1}
      />
      {sticky.status === 'sent' ? (
        <circle cx={14} cy={height - FOOTER_HEIGHT / 2} r={3} fill="#6a4df4">
          <animate attributeName="opacity" values="1;0.35;1" dur="1.4s" repeatCount="indefinite" />
        </circle>
      ) : null}
      <text
        x={sticky.status === 'sent' ? 24 : 14}
        y={height - FOOTER_HEIGHT / 2 + 4}
        fontSize={12}
        fontFamily="Inter, system-ui, sans-serif"
        fill={palette.muted}
        textDecoration={done ? 'line-through' : undefined}
      >
        {footer}
      </text>
    </g>
  )
}

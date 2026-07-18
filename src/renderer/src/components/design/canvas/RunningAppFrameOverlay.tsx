import type { ReactElement } from 'react'
import { ExternalLink, Monitor } from 'lucide-react'
import type { CanvasShape } from '../../../design/canvas/canvas-types'
import { runningAppFrameLabel } from '../../../design/canvas/running-app-frame'
import { htmlFrameOverlayPointerEvents } from './html-frame/html-frame-helpers'
import { useCanvasMotionPortalStyle } from '../../../design/motion/canvas-motion-preview'

type Props = {
  shape: CanvasShape
  screenX: number
  screenY: number
  screenWidth: number
  screenHeight: number
  zIndex: number
  zoom: number
  active: boolean
  interactive: boolean
  panning: boolean
  editing: boolean
  onDoubleClick: (shapeId: string) => void
}

export function RunningAppFrameOverlay({
  shape,
  screenX,
  screenY,
  screenWidth,
  screenHeight,
  zIndex,
  zoom,
  active,
  interactive,
  panning,
  editing,
  onDoubleClick
}: Props): ReactElement | null {
  const motionStyle = useCanvasMotionPortalStyle(shape, zoom)
  const frame = shape.runningApp
  if (!frame?.url) return null
  const pointerEvents = htmlFrameOverlayPointerEvents({ panning, interactive, editing })
  const label = runningAppFrameLabel(frame)
  return (
    <div
      className="absolute overflow-hidden rounded-[10px] bg-white shadow-[0_18px_42px_rgba(15,23,42,0.18)] ring-1 ring-black/10 dark:bg-[#111318] dark:ring-white/10"
      data-canvas-motion-target={shape.id}
      data-canvas-motion-kind="portal"
      style={{
        left: screenX,
        top: screenY,
        width: screenWidth,
        height: screenHeight,
        zIndex,
        pointerEvents,
        ...motionStyle
      }}
      onDoubleClick={(event) => {
        event.stopPropagation()
        onDoubleClick(shape.id)
      }}
      title={label}
    >
      <iframe
        src={frame.url}
        title={label}
        className="block border-0 bg-white"
        style={{
          width: shape.width,
          height: shape.height,
          transform: `scale(${zoom})`,
          transformOrigin: 'left top',
          pointerEvents: interactive ? 'auto' : 'none'
        }}
      />
      <div
        className={`pointer-events-none absolute left-2 top-2 flex max-w-[calc(100%-16px)] items-center gap-1.5 rounded-full border px-2 py-1 text-[10.5px] shadow-sm backdrop-blur ${
          active
            ? 'border-[#3b82d8]/40 bg-white/90 text-[#1f2733] dark:bg-[#111318]/90 dark:text-white'
            : 'border-black/10 bg-white/78 text-[#526070] dark:border-white/10 dark:bg-[#111318]/78 dark:text-white/70'
        }`}
      >
        <Monitor className="h-3 w-3 shrink-0" strokeWidth={1.8} />
        <span className="min-w-0 truncate">{label}</span>
        <ExternalLink className="h-3 w-3 shrink-0" strokeWidth={1.8} />
      </div>
    </div>
  )
}

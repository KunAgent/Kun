import { memo } from 'react'
import {
  MousePointer2,
  Square,
  Circle,
  Type,
  Frame,
  ImagePlus,
  Hand,
  ZoomIn,
  ZoomOut,
  Maximize,
  Undo2,
  Redo2,
  Grid3x3,
  Magnet
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCanvasViewportStore } from '../../../design/canvas/canvas-viewport-store'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import type { CanvasTool } from '../../../design/canvas/canvas-types'

const tools: { id: CanvasTool; icon: typeof MousePointer2; labelKey: string }[] = [
  { id: 'select', icon: MousePointer2, labelKey: 'canvasToolSelect' },
  { id: 'frame', icon: Frame, labelKey: 'canvasToolFrame' },
  { id: 'rect', icon: Square, labelKey: 'canvasToolRect' },
  { id: 'ellipse', icon: Circle, labelKey: 'canvasToolEllipse' },
  { id: 'text', icon: Type, labelKey: 'canvasToolText' },
  { id: 'image', icon: ImagePlus, labelKey: 'canvasToolImage' },
  { id: 'hand', icon: Hand, labelKey: 'canvasToolHand' }
]

function CanvasToolbarInner() {
  const { t } = useTranslation()
  const activeTool = useCanvasViewportStore((s) => s.activeTool)
  const setActiveTool = useCanvasViewportStore((s) => s.setActiveTool)
  const zoomTo = useCanvasViewportStore((s) => s.zoomTo)
  const zoomToFit = useCanvasViewportStore((s) => s.zoomToFit)
  const zoom = useCanvasViewportStore((s) => s.getZoom())
  const gridVisible = useCanvasViewportStore((s) => s.gridVisible)
  const toggleGrid = useCanvasViewportStore((s) => s.toggleGrid)
  const snapEnabled = useCanvasViewportStore((s) => s.snapEnabled)
  const toggleSnap = useCanvasViewportStore((s) => s.toggleSnap)
  const undo = useCanvasShapeStore((s) => s.undo)
  const redo = useCanvasShapeStore((s) => s.redo)

  const zoomPercent = `${Math.round(zoom * 100)}%`

  const btnBase =
    'flex items-center justify-center h-7 w-7 rounded-md transition-colors'
  const btnActive = 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'
  const btnInactive =
    'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/10'
  const divider = 'w-px h-5 bg-gray-200 dark:bg-white/10 mx-1'

  return (
    <div className="flex items-center gap-0.5 px-2 py-1 border-b border-gray-200 dark:border-white/10 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm">
      {tools.map((tool) => (
        <button
          key={tool.id}
          className={`${btnBase} ${activeTool === tool.id ? btnActive : btnInactive}`}
          onClick={() => setActiveTool(tool.id)}
          title={t(tool.labelKey)}
        >
          <tool.icon className="h-4 w-4" />
        </button>
      ))}

      <div className={divider} />

      <button className={`${btnBase} ${btnInactive}`} onClick={undo} title={t('canvasUndo')}>
        <Undo2 className="h-4 w-4" />
      </button>
      <button className={`${btnBase} ${btnInactive}`} onClick={redo} title={t('canvasRedo')}>
        <Redo2 className="h-4 w-4" />
      </button>

      <div className={divider} />

      <button
        className={`${btnBase} ${btnInactive}`}
        onClick={() => zoomTo(1 / zoom, { x: 0, y: 0 })}
        title={t('canvasZoomReset')}
      >
        <span className="text-xs font-medium w-10 text-center">{zoomPercent}</span>
      </button>
      <button
        className={`${btnBase} ${btnInactive}`}
        onClick={() => zoomTo(1.25, { x: 0, y: 0 })}
        title={t('canvasZoomIn')}
      >
        <ZoomIn className="h-4 w-4" />
      </button>
      <button
        className={`${btnBase} ${btnInactive}`}
        onClick={() => zoomTo(0.8, { x: 0, y: 0 })}
        title={t('canvasZoomOut')}
      >
        <ZoomOut className="h-4 w-4" />
      </button>
      <button
        className={`${btnBase} ${btnInactive}`}
        onClick={() => zoomToFit({ x: -200, y: -200, width: 400, height: 400 })}
        title={t('canvasZoomFit')}
      >
        <Maximize className="h-4 w-4" />
      </button>

      <div className={divider} />

      <button
        className={`${btnBase} ${gridVisible ? btnActive : btnInactive}`}
        onClick={toggleGrid}
        title={t('canvasGridToggle')}
      >
        <Grid3x3 className="h-4 w-4" />
      </button>
      <button
        className={`${btnBase} ${snapEnabled ? btnActive : btnInactive}`}
        onClick={toggleSnap}
        title={t('canvasSnap')}
      >
        <Magnet className="h-4 w-4" />
      </button>
    </div>
  )
}

export const CanvasToolbar = memo(CanvasToolbarInner)

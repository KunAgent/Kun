import { type ReactElement } from 'react'
import { Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  requestStickyKun,
  STICKY_PALETTE,
  stickyMentionsKun
} from '../../../design/canvas/canvas-sticky'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { useCanvasViewportStore } from '../../../design/canvas/canvas-viewport-store'

const STATUS_KEYS = {
  draft: 'canvasStickyPlain',
  sent: 'canvasStickySent',
  done: 'canvasStickyDone'
} as const

/** Every sticky note on the open page, with its request status. */
export function CanvasStickyNotesPanel(): ReactElement {
  const { t } = useTranslation('common')
  const objects = useCanvasShapeStore((s) => s.document.objects)
  const notes = Object.values(objects).filter((shape) => shape.sticky && shape.visible)

  const reveal = (id: string): void => {
    const shape = useCanvasShapeStore.getState().document.objects[id]
    if (!shape) return
    useCanvasSelectionStore.getState().select([id])
    useCanvasViewportStore.getState().zoomToFit(
      { x: shape.x, y: shape.y, width: shape.width, height: shape.height },
      160,
      { maxZoom: 1.5 }
    )
  }

  if (notes.length === 0) {
    return <p className="px-4 py-6 text-[13px] text-ds-muted">{t('canvasNotesEmpty')}</p>
  }
  return (
    <ul className="flex flex-col gap-1 p-2.5">
      {notes.map((shape) => {
        const sticky = shape.sticky!
        const palette = STICKY_PALETTE[sticky.color]
        const addressed = stickyMentionsKun(shape.textContent)
        return (
          <li key={shape.id} className="flex items-center gap-2.5 rounded-[8px] px-2 py-1.5 hover:bg-ds-hover">
            <span className="h-4 w-4 shrink-0 rounded-[3px]" style={{ background: palette.fill }} aria-hidden="true" />
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => reveal(shape.id)}>
              <span className="block truncate text-[13px] text-ds-ink">{shape.textContent?.trim() || t('canvasStickyEmpty')}</span>
              <span className="block text-[11.5px] text-ds-muted">
                {sticky.status === 'done' && sticky.resultNote ? sticky.resultNote : t(STATUS_KEYS[sticky.status])}
              </span>
            </button>
            {addressed && sticky.status === 'draft' ? (
              <button
                type="button"
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[7px] px-2 text-[12px] text-accent hover:bg-accent-soft"
                onClick={() => requestStickyKun(shape.id)}
              >
                <Send className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden="true" />
                {t('canvasStickySendToKun')}
              </button>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

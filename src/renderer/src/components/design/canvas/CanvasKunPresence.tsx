import { memo, type ReactElement } from 'react'
import { MousePointer2, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { useCanvasViewportStore } from '../../../design/canvas/canvas-viewport-store'
import { useKunPresenceStore } from '../../../design/canvas/kun-presence-store'
import { useChatStore } from '../../../store/chat-store'

const KUN_VIOLET = '#6a4df4'

/**
 * Canvas-level "Kun is here": a violet cursor with the step label on the board
 * being written, and a progress strip with Stop while boards are queued.
 */
function CanvasKunPresenceInner(): ReactElement | null {
  const { t } = useTranslation('common')
  const entries = useKunPresenceStore((s) => s.entries)
  const runTotal = useKunPresenceStore((s) => s.runTotal)
  const doc = useCanvasShapeStore((s) => s.document)
  const vbox = useCanvasViewportStore((s) => s.vbox)
  const containerWidth = useCanvasViewportStore((s) => s.containerWidth)
  const interrupt = useChatStore((s) => s.interrupt)
  const ids = Object.keys(entries)
  if (ids.length === 0) return null
  const zoom = containerWidth / vbox.width
  const currentId = ids.find((id) => entries[id].state === 'generating')
  const current = currentId ? doc.objects[currentId] : undefined
  const done = Math.max(0, runTotal - ids.length)
  return (
    <>
      {current && currentId ? (
        <div
          className="pointer-events-none absolute z-30 flex flex-col items-start"
          data-kun-presence="cursor"
          style={{
            left: (current.x - vbox.x) * zoom + Math.min(48, current.width * zoom * 0.2),
            top: (current.y - vbox.y) * zoom + Math.min(96, current.height * zoom * 0.2),
            transition: 'left 360ms cubic-bezier(0.22,1,0.36,1), top 360ms cubic-bezier(0.22,1,0.36,1)'
          }}
        >
          <MousePointer2 className="h-4 w-4 drop-shadow" strokeWidth={1.6} style={{ color: KUN_VIOLET, fill: KUN_VIOLET }} />
          <span
            className="ml-3 mt-0.5 max-w-[220px] truncate rounded-full px-2 py-0.5 text-[11px] font-medium text-white shadow"
            style={{ background: KUN_VIOLET }}
          >
            {t('canvasKunWriting', { name: entries[currentId].name })}
          </span>
        </div>
      ) : null}
      {runTotal > 1 ? (
        <div
          className="pointer-events-auto absolute left-1/2 z-30 flex -translate-x-1/2 items-center gap-2.5 rounded-full border border-ds-border bg-ds-card px-3 py-1.5 text-[12px] text-ds-ink shadow-[0_2px_8px_rgba(20,20,19,0.08)]"
          style={{ bottom: 'calc(var(--canvas-bottom-ui-inset, 16px) + 8px)' }}
          data-kun-presence="progress"
        >
          <span className="h-1 w-28 overflow-hidden rounded-full bg-ds-hover" aria-hidden="true">
            <span className="block h-full rounded-full" style={{ width: `${(done / runTotal) * 100}%`, background: KUN_VIOLET }} />
          </span>
          <span>{t('canvasKunProgress', { done, total: runTotal })}</span>
          <button
            type="button"
            onClick={() => void interrupt()}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-ds-muted transition-colors hover:bg-ds-hover hover:text-ds-ink"
          >
            <Square className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
            {t('canvasKunStop')}
          </button>
        </div>
      ) : null}
    </>
  )
}

export const CanvasKunPresence = memo(CanvasKunPresenceInner)

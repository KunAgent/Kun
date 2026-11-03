import type { ReactElement } from 'react'
import { PenLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** "AI edit image" pill anchored under a selected filled image. */
export function CanvasImageAnnotationAction({
  action,
  onOpen
}: {
  action: { shapeId: string; left: number; top: number; width: number; height: number }
  onOpen: (shapeId: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <button
      type="button"
      className="ds-no-drag absolute z-30 flex items-center justify-center gap-1.5 rounded-full border border-accent-tint/20 bg-ds-elevated px-3 text-[12px] font-medium text-accent shadow-[0_8px_24px_rgba(15,23,42,0.14)] transition hover:bg-accent-soft hover:shadow-[0_10px_28px_rgba(15,23,42,0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-tint/40"
      style={{ left: action.left, top: action.top, width: action.width, height: action.height }}
      title={t('canvasInspectorAnnotateOpen', '在图片上标注修改')}
      aria-label={t('canvasInspectorAnnotate', 'AI 修改图片')}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onOpen(action.shapeId)
      }}
    >
      <PenLine className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
      <span className="whitespace-nowrap">{t('canvasInspectorAnnotate', 'AI 修改图片')}</span>
    </button>
  )
}

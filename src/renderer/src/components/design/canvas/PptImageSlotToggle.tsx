import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ImageIcon } from 'lucide-react'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { isPptReviewSlotShape } from '../../../design/canvas/ppt-review-slots'
import type { CanvasShape } from '../../../design/canvas/canvas-types'

const STORAGE_KEY = 'kun.pptReview.imageSlots'

function readPreference(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'hidden'
  } catch {
    return true
  }
}

function writePreference(visible: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, visible ? 'shown' : 'hidden')
  } catch {
    // The toggle still works for this session without storage.
  }
}

/** `count:visible` keeps the store selector a primitive so unrelated edits do not re-render. */
function slotSignature(objects: Readonly<Record<string, CanvasShape>>): string {
  let count = 0
  let visible = 0
  for (const shape of Object.values(objects)) {
    if (!isPptReviewSlotShape(shape)) continue
    count += 1
    if (shape.visible) visible += 1
  }
  return `${count}:${visible}`
}

/**
 * Board control for PPT review image slots. It appears only when a review
 * card carries slot overlays, applies one remembered show/hide choice to every
 * slot (including ones a later revision adds), and never enters undo history.
 */
export function PptImageSlotToggle(): ReactElement | null {
  const { t } = useTranslation('common')
  const signature = useCanvasShapeStore((s) => slotSignature(s.document.objects))
  const [visible, setVisible] = useState(readPreference)
  const count = Number(signature.split(':')[0])

  useEffect(() => {
    const { document, updateShape } = useCanvasShapeStore.getState()
    for (const shape of Object.values(document.objects)) {
      if (isPptReviewSlotShape(shape) && shape.visible !== visible) updateShape(shape.id, { visible }, true)
    }
  }, [signature, visible])

  if (count === 0) return null
  const label = visible ? t('pptReviewSlotsHide') : t('pptReviewSlotsShow')
  return (
    <button
      type="button"
      aria-pressed={visible}
      aria-label={label}
      title={label}
      onClick={() => {
        setVisible(!visible)
        writePreference(!visible)
      }}
      className="flex h-8 items-center gap-2 rounded-full border border-ds-border bg-ds-card px-3 text-[12px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
      data-testid="ppt-image-slot-toggle"
    >
      <ImageIcon className="h-3.5 w-3.5 text-ds-muted" strokeWidth={2} aria-hidden="true" />
      {t('pptReviewSlotsToggle')}
      <span className={`relative h-4 w-7 rounded-full transition ${visible ? 'bg-accent' : 'bg-ds-border'}`} aria-hidden="true">
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${visible ? 'left-3.5' : 'left-0.5'}`} />
      </span>
    </button>
  )
}

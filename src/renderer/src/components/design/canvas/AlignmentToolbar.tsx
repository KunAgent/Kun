import { memo } from 'react'
import {
  AlignHorizontalDistributeCenter,
  AlignHorizontalJustifyCenter,
  AlignVerticalDistributeCenter,
  AlignVerticalJustifyCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignEndHorizontal,
  AlignEndVertical
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  alignShapes,
  distributeShapes,
  type AlignAxis,
  type BoundsWithId,
  type DistributeAxis
} from '../../../design/canvas/canvas-align'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { useCanvasUndoStore } from '../../../design/canvas/canvas-undo-store'

type AlignButton = {
  axis: AlignAxis
  Icon: typeof AlignStartVertical
  labelKey: string
}

type DistributeButton = {
  axis: DistributeAxis
  Icon: typeof AlignHorizontalDistributeCenter
  labelKey: string
}

const ALIGN_BUTTONS: AlignButton[] = [
  { axis: 'left', Icon: AlignStartVertical, labelKey: 'canvasAlignLeft' },
  { axis: 'h-center', Icon: AlignHorizontalJustifyCenter, labelKey: 'canvasAlignHCenter' },
  { axis: 'right', Icon: AlignEndVertical, labelKey: 'canvasAlignRight' },
  { axis: 'top', Icon: AlignStartHorizontal, labelKey: 'canvasAlignTop' },
  { axis: 'v-center', Icon: AlignVerticalJustifyCenter, labelKey: 'canvasAlignVCenter' },
  { axis: 'bottom', Icon: AlignEndHorizontal, labelKey: 'canvasAlignBottom' }
]

const DISTRIBUTE_BUTTONS: DistributeButton[] = [
  { axis: 'horizontal', Icon: AlignHorizontalDistributeCenter, labelKey: 'canvasDistributeH' },
  { axis: 'vertical', Icon: AlignVerticalDistributeCenter, labelKey: 'canvasDistributeV' }
]

function collectSelectedBounds(selectedIds: Set<string>): BoundsWithId[] {
  const doc = useCanvasShapeStore.getState().document
  const out: BoundsWithId[] = []
  for (const id of selectedIds) {
    const s = doc.objects[id]
    if (!s) continue
    out.push({ id, x: s.x, y: s.y, width: s.width, height: s.height })
  }
  return out
}

function applyAlign(axis: AlignAxis): void {
  const ids = useCanvasSelectionStore.getState().selectedIds
  if (ids.size < 2) return
  const shapes = collectSelectedBounds(ids)
  const result = alignShapes(shapes, axis)
  if (result.size === 0) return
  useCanvasUndoStore.getState().withGroup(`align-${axis}`, () => {
    const store = useCanvasShapeStore.getState()
    for (const [id, patch] of result) {
      store.updateShape(id, patch)
    }
  })
}

function applyDistribute(axis: DistributeAxis): void {
  const ids = useCanvasSelectionStore.getState().selectedIds
  if (ids.size < 3) return
  const shapes = collectSelectedBounds(ids)
  const result = distributeShapes(shapes, axis)
  if (result.size === 0) return
  useCanvasUndoStore.getState().withGroup(`distribute-${axis}`, () => {
    const store = useCanvasShapeStore.getState()
    for (const [id, patch] of result) {
      store.updateShape(id, patch)
    }
  })
}

function AlignmentToolbarInner() {
  const { t } = useTranslation('common')
  const selectionCount = useCanvasSelectionStore((s) => s.selectedIds.size)

  if (selectionCount < 2) return null

  const distributeEnabled = selectionCount >= 3

  const btnBase =
    'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors'
  const btnEnabled =
    'text-[#1f2733] hover:bg-black/[0.06] dark:text-white/85 dark:hover:bg-white/10'
  const btnDisabled = 'text-[#c8d0d8] dark:text-white/20 cursor-not-allowed'
  const divider = 'mx-1 h-5 w-px bg-[var(--ds-sidebar-row-ring)]'

  return (
    <div className="ds-no-drag pointer-events-auto absolute right-4 top-4 z-20 flex items-center gap-0.5 rounded-xl border border-[var(--ds-sidebar-row-ring)] bg-white px-1 py-1 shadow-[0_4px_18px_rgba(20,47,95,0.08)] dark:bg-[#1f242c] dark:shadow-[0_4px_18px_rgba(0,0,0,0.3)]">
      {ALIGN_BUTTONS.map(({ axis, Icon, labelKey }) => (
        <button
          key={axis}
          type="button"
          onClick={() => applyAlign(axis)}
          className={`${btnBase} ${btnEnabled}`}
          title={t(labelKey)}
          aria-label={t(labelKey)}
        >
          <Icon className="h-4 w-4" strokeWidth={1.9} />
        </button>
      ))}
      <div className={divider} />
      {DISTRIBUTE_BUTTONS.map(({ axis, Icon, labelKey }) => (
        <button
          key={axis}
          type="button"
          onClick={() => applyDistribute(axis)}
          disabled={!distributeEnabled}
          className={`${btnBase} ${distributeEnabled ? btnEnabled : btnDisabled}`}
          title={t(labelKey)}
          aria-label={t(labelKey)}
        >
          <Icon className="h-4 w-4" strokeWidth={1.9} />
        </button>
      ))}
    </div>
  )
}

export const AlignmentToolbar = memo(AlignmentToolbarInner)

import { memo, useEffect, useRef, useState, type ReactElement } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ChevronDown,
  Copy,
  Lock,
  MessageSquarePlus,
  MoreVertical,
  Square,
  Trash2,
  Unlock
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { useCanvasUndoStore } from '../../../design/canvas/canvas-undo-store'
import { useCanvasViewportStore } from '../../../design/canvas/canvas-viewport-store'
import { createStickyShape } from '../../../design/canvas/canvas-sticky'
import { isArtifactFrame, type CanvasShape, type Fill } from '../../../design/canvas/canvas-types'
import { addShapeForCreation, commitCreatedShapeUndo } from '../../../design/canvas/tools/creation-undo'
import {
  CANVAS_CHROME_MENU,
  CANVAS_CHROME_PILL,
  CanvasChromeMenuItem,
  useCanvasChromeDismiss
} from './chrome/canvas-chrome-primitives'

const FONT_SIZES = [12, 14, 16, 20, 24, 32, 48, 64]
const FONT_FAMILIES = [
  { id: 'sans', labelKey: 'canvasFontSans', css: 'Inter, system-ui, sans-serif', short: 'Sans' },
  { id: 'serif', labelKey: 'canvasFontSerif', css: 'Georgia, "Times New Roman", serif', short: 'Serif' },
  { id: 'mono', labelKey: 'canvasFontMono', css: 'ui-monospace, "SF Mono", Menlo, monospace', short: 'Mono' }
] as const
const TOOLBAR_HEIGHT = 44
const TOOLBAR_GAP = 12

const button =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-[8px] px-1.5 text-ds-muted transition-colors hover:bg-ds-hover hover:text-ds-ink'

function hexOf(color: string | null | undefined, fallback: string): string {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : fallback
}

function familyOf(shape: CanvasShape): (typeof FONT_FAMILIES)[number] {
  const css = shape.fontFamily ?? FONT_FAMILIES[0].css
  return FONT_FAMILIES.find((family) => css.toLowerCase().includes(family.short.toLowerCase())) ?? FONT_FAMILIES[0]
}

/** Applies one patch to every shape as a single undo step. */
function patchAll(ids: string[], label: string, patch: Partial<CanvasShape>): void {
  useCanvasUndoStore.getState().withGroup(label, () => {
    for (const id of ids) useCanvasShapeStore.getState().updateShape(id, patch)
  })
}

/**
 * A color input that previews live and records one undo step when the picker
 * closes, instead of one per drag tick.
 */
function ColorSwatch({
  value,
  label,
  onLive,
  onCommit,
  onCancel
}: {
  value: string
  label: string
  onLive: (color: string) => void
  onCommit: (color: string) => void
  onCancel: () => void
}): ReactElement {
  const ref = useRef<HTMLInputElement | null>(null)
  const dirty = useRef(false)
  useEffect(() => {
    const input = ref.current
    if (!input) return
    const onChange = (): void => {
      if (!dirty.current) return
      dirty.current = false
      onCommit(input.value)
    }
    input.addEventListener('change', onChange)
    return () => input.removeEventListener('change', onChange)
  }, [onCommit, onCancel])
  return (
    <label className={`${button} relative w-8 cursor-pointer`} title={label}>
      <span className="h-[18px] w-[18px] rounded-[5px] border border-ds-border" style={{ background: value }} />
      <input
        ref={ref}
        type="color"
        aria-label={label}
        value={value}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        onInput={(event) => {
          dirty.current = true
          onLive(event.currentTarget.value)
        }}
      />
    </label>
  )
}

function CanvasSelectionToolbarInner({ onComment }: { onComment?: () => void }): ReactElement | null {
  const { t } = useTranslation('common')
  const selectedIds = useCanvasSelectionStore((s) => s.selectedIds)
  const editingId = useCanvasSelectionStore((s) => s.editingId)
  const objects = useCanvasShapeStore((s) => s.document.objects)
  const vbox = useCanvasViewportStore((s) => s.vbox)
  const containerWidth = useCanvasViewportStore((s) => s.containerWidth)
  const containerHeight = useCanvasViewportStore((s) => s.containerHeight)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [menu, setMenu] = useState<'font' | 'radius' | 'more' | null>(null)
  const closeMenu = (): void => setMenu(null)
  useCanvasChromeDismiss(menu !== null, rootRef, closeMenu)
  const beforeRef = useRef<{ ids: string[]; before: Map<string, Partial<CanvasShape>> } | null>(null)

  const shapes = [...selectedIds].map((id) => objects[id]).filter((shape): shape is CanvasShape => Boolean(shape))
  if (shapes.length === 0 || editingId) return null
  const ids = shapes.map((shape) => shape.id)
  const zoom = containerWidth / vbox.width
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  for (const shape of shapes) {
    minX = Math.min(minX, shape.x)
    minY = Math.min(minY, shape.y)
    maxX = Math.max(maxX, shape.x + shape.width)
  }
  const centerX = ((minX + maxX) / 2 - vbox.x) * zoom
  const topY = (minY - vbox.y) * zoom
  if (centerX < -200 || centerX > containerWidth + 200 || topY > containerHeight) return null
  const placeBelow = topY - TOOLBAR_HEIGHT - TOOLBAR_GAP < 56
  const top = placeBelow
    ? Math.max(...shapes.map((shape) => (shape.y + shape.height - vbox.y) * zoom)) + TOOLBAR_GAP + 34
    : topY - TOOLBAR_HEIGHT - TOOLBAR_GAP - 30

  const allText = shapes.every((shape) => shape.type === 'text')
  const filled = shapes.filter((shape) => shape.type !== 'text' && !isArtifactFrame(shape) && shape.type !== 'image')
  // Screens draw their own corner radius, so only plain shapes expose it.
  const radiusable = shapes.every((shape) => ['rect', 'frame', 'image'].includes(shape.type) && !isArtifactFrame(shape))
  const first = shapes[0]
  const single = shapes.length === 1
  const locked = shapes.every((shape) => shape.locked)

  const liveFill = (color: string): void => {
    if (!beforeRef.current) {
      beforeRef.current = { ids: filled.map((s) => s.id), before: new Map(filled.map((s) => [s.id, { fills: s.fills }])) }
    }
    for (const shape of filled) {
      const fill: Fill = shape.fills[0]?.type === 'solid' ? { ...shape.fills[0], color } : { type: 'solid', color, opacity: 1 }
      useCanvasShapeStore.getState().updateShape(shape.id, { fills: [fill, ...shape.fills.slice(1)] }, true)
    }
  }
  const liveTextColor = (color: string): void => {
    if (!beforeRef.current) {
      beforeRef.current = { ids, before: new Map(shapes.map((s) => [s.id, { fontColor: s.fontColor }])) }
    }
    for (const shape of shapes) useCanvasShapeStore.getState().updateShape(shape.id, { fontColor: color }, true)
  }
  const commitLive = (label: string, keys: Array<keyof CanvasShape>): void => {
    const snapshot = beforeRef.current
    beforeRef.current = null
    if (!snapshot) return
    const doc = useCanvasShapeStore.getState().document
    useCanvasUndoStore.getState().pushChange({
      label,
      patches: snapshot.ids.map((id) => {
        const after: Partial<CanvasShape> = {}
        for (const key of keys) (after as Record<string, unknown>)[key] = doc.objects[id]?.[key]
        return { id, before: snapshot.before.get(id) ?? {}, after }
      })
    })
  }

  const comment = (): void => {
    const anchor = shapes[0]
    const note = createStickyShape(maxX + 24, minY)
    note.sticky = { ...note.sticky!, anchorId: anchor.id }
    note.name = `Comment · ${anchor.name}`.slice(0, 80)
    const undo = addShapeForCreation(note)
    commitCreatedShapeUndo(undo, 'comment-on-element')
    useCanvasSelectionStore.getState().select([note.id])
    useCanvasSelectionStore.getState().setEditing(note.id)
    onComment?.()
  }

  const align = (): void => {
    const order = ['left', 'center', 'right'] as const
    const current = first.textAlign ?? 'left'
    patchAll(ids, 'text-align', { textAlign: order[(order.indexOf(current) + 1) % order.length] })
  }
  const AlignIcon = first.textAlign === 'center' ? AlignCenter : first.textAlign === 'right' ? AlignRight : AlignLeft
  const fontSize = first.fontSize ?? 16
  const family = familyOf(first)
  const radiusValue = typeof first.cornerRadius === 'number' ? first.cornerRadius : 0
  const stop = (event: React.SyntheticEvent): void => event.stopPropagation()

  return (
    <div
      ref={rootRef}
      className={`ds-no-drag pointer-events-auto absolute z-[25] -translate-x-1/2 ${CANVAS_CHROME_PILL}`}
      style={{ left: Math.min(Math.max(centerX, 160), Math.max(160, containerWidth - 160)), top }}
      data-canvas-selection-toolbar="true"
      role="toolbar"
      aria-label={t('canvasSelectionToolbar')}
      onPointerDown={stop}
      onDoubleClick={stop}
    >
      {allText ? (
        <div className="relative">
          <button type="button" className={`${button} px-2 text-[12.5px] text-ds-ink`} aria-haspopup="menu" aria-expanded={menu === 'font'} onClick={() => setMenu(menu === 'font' ? null : 'font')}>
            <span className="max-w-[120px] truncate">{family.short} · {fontSize}</span>
            <ChevronDown className="h-3 w-3 text-ds-faint" strokeWidth={2} />
          </button>
          {menu === 'font' ? (
            <div role="menu" className={`${CANVAS_CHROME_MENU} left-0 top-full mt-2 w-44`}>
              {FONT_FAMILIES.map((item) => (
                <CanvasChromeMenuItem key={item.id} role="menuitemradio" checked={family.id === item.id} label={t(item.labelKey)} onSelect={() => { patchAll(ids, 'font-family', { fontFamily: item.css }); closeMenu() }} />
              ))}
              <div className="my-1 h-px bg-ds-border-muted" />
              {FONT_SIZES.map((size) => (
                <CanvasChromeMenuItem key={size} role="menuitemradio" checked={fontSize === size} label={String(size)} onSelect={() => { patchAll(ids, 'font-size', { fontSize: size }); closeMenu() }} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {allText ? (
        <ColorSwatch
          value={hexOf(first.fontColor, '#1e1e1e')}
          label={t('canvasSelectionTextColor')}
          onLive={liveTextColor}
          onCommit={() => commitLive('text-color', ['fontColor'])}
          onCancel={() => { beforeRef.current = null }}
        />
      ) : null}
      {filled.length > 0 && filled.length === shapes.length ? (
        <ColorSwatch
          value={hexOf(filled[0].fills[0]?.type === 'solid' ? filled[0].fills[0].color : null, '#d9d9d9')}
          label={t('canvasSelectionFill')}
          onLive={liveFill}
          onCommit={() => commitLive('fill-color', ['fills'])}
          onCancel={() => { beforeRef.current = null }}
        />
      ) : null}
      {allText ? (
        <button type="button" className={`${button} w-8`} onClick={align} title={t('canvasSelectionAlign')} aria-label={t('canvasSelectionAlign')}>
          <AlignIcon className="h-4 w-4" strokeWidth={1.9} />
        </button>
      ) : null}
      {radiusable ? (
        <div className="relative">
          <button type="button" className={`${button} w-8`} aria-haspopup="dialog" aria-expanded={menu === 'radius'} onClick={() => setMenu(menu === 'radius' ? null : 'radius')} title={t('canvasSelectionRadius')} aria-label={t('canvasSelectionRadius')}>
            <Square className="h-4 w-4" strokeWidth={1.9} style={{ borderRadius: Math.min(8, radiusValue) }} />
          </button>
          {menu === 'radius' ? (
            <div className={`${CANVAS_CHROME_MENU} left-0 top-full mt-2 flex w-48 items-center gap-2 px-3 py-2`}>
              <input
                type="range"
                min={0}
                max={64}
                value={radiusValue}
                aria-label={t('canvasSelectionRadius')}
                className="min-w-0 flex-1"
                onChange={(event) => patchAll(ids, 'corner-radius', { cornerRadius: Number(event.currentTarget.value) })}
              />
              <span className="w-6 text-right text-[12px] tabular-nums text-ds-muted">{radiusValue}</span>
            </div>
          ) : null}
        </div>
      ) : null}
      {single || shapes.length > 0 ? (
        <button type="button" className={`${button} w-8 text-accent`} onClick={comment} title={t('canvasSelectionComment')} aria-label={t('canvasSelectionComment')} data-canvas-comment-on-element="true">
          <MessageSquarePlus className="h-4 w-4" strokeWidth={1.9} />
        </button>
      ) : null}
      <div className="relative">
        <button type="button" className={`${button} w-8`} aria-haspopup="menu" aria-expanded={menu === 'more'} onClick={() => setMenu(menu === 'more' ? null : 'more')} title={t('canvasSelectionMore')} aria-label={t('canvasSelectionMore')}>
          <MoreVertical className="h-4 w-4" strokeWidth={1.9} />
        </button>
        {menu === 'more' ? (
          <div role="menu" className={`${CANVAS_CHROME_MENU} right-0 top-full mt-2 w-44`}>
            <CanvasChromeMenuItem
              icon={<Copy className="h-3.5 w-3.5" strokeWidth={1.8} />}
              label={t('canvasSelectionDuplicate')}
              disabled={shapes.some(isArtifactFrame)}
              onSelect={() => {
                const copies = ids.map((id) => useCanvasShapeStore.getState().duplicateShape(id)).filter((id): id is string => Boolean(id))
                if (copies.length > 0) useCanvasSelectionStore.getState().select(copies)
                closeMenu()
              }}
            />
            <CanvasChromeMenuItem
              icon={locked ? <Unlock className="h-3.5 w-3.5" strokeWidth={1.8} /> : <Lock className="h-3.5 w-3.5" strokeWidth={1.8} />}
              label={t(locked ? 'canvasSelectionUnlock' : 'canvasSelectionLock')}
              onSelect={() => { patchAll(ids, 'toggle-lock', { locked: !locked }); closeMenu() }}
            />
            <CanvasChromeMenuItem
              icon={<Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />}
              label={t('canvasSelectionDelete')}
              onSelect={() => {
                useCanvasUndoStore.getState().withGroup('delete-selection', () => {
                  for (const id of ids) useCanvasShapeStore.getState().deleteShape(id)
                })
                useCanvasSelectionStore.getState().clearSelection()
                closeMenu()
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

export const CanvasSelectionToolbar = memo(CanvasSelectionToolbarInner)
